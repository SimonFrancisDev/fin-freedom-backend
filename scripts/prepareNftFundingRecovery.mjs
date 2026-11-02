// Mainnet recovery: read-only unless --submit or --fund-operator is supplied.
// Submits proposals only; it cannot approve or execute founders' transactions.
import fs from 'node:fs';
import { Contract, Interface, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';
import plan from '../src/config/nftRewardFundingRecovery.json' with { type: 'json' };
import { recoveryCalldata, legacyNftVaultAbi, recoveryMultisigAbi } from '../src/services/nftRewardFundingRecovery.js';

const provider = new JsonRpcProvider(process.env.AUDIT_RPC_URL, 137, { batchMaxCount: 1 });
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const abi = (name) => JSON.parse(fs.readFileSync(`src/blockchain/abis/freedom-plus/${name}.abi.json`, 'utf8'));
const output = 'reports/nft-recovery-proposals-2026-11-02.json';
const submit = process.argv.includes('--submit');
const fund = process.argv.includes('--fund-operator');
const submitterAddress = '0x884e48f9897E8633238747b608DD49dE12bF94df';
const previousOperator = '0xcDE2a3A6dcD046D3550421272DD329Dd81146604';
const replacement = new Wallet(process.env.NFT_REPLACEMENT_KEY).address;
const governance = new Contract(plan.multisig, [...recoveryMultisigAbi,
  'function getTransactionCount() view returns (uint256)',
  'function requiredConfirmations() view returns (uint256)',
  'function timelockDelay() view returns (uint256)',
  'function isOwner(address) view returns (bool)',
  'function isProposalSubmitter(address) view returns (bool)',
  'function submitTransaction(address to,uint256 value,bytes data) returns (uint256)',
  'event Submit(uint256 indexed txId)',
], provider);
const distributor = new Contract(plan.distributor, abi('FreedomNFTRewardDistributor'), provider);
const legacy = new Contract(plan.legacyVault, legacyNftVaultAbi, provider);
const token = new Contract(plan.token, ['function balanceOf(address) view returns (uint256)'], provider);
const calls = [
  { kind: 'consolidate-nft-pool', to: plan.legacyVault, data: recoveryCalldata(plan) },
  { kind: 'replace-exposed-payout-operator', to: plan.distributor,
    data: new Interface(['function setRewardOperator(address)']).encodeFunctionData('setRewardOperator', [replacement]) },
];
const report = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { proposals: [] };
function save() {
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
async function fees() {
  const data = await provider.getFeeData();
  const tip = data.maxPriorityFeePerGas > 25_000000000n ? data.maxPriorityFeePerGas : 25_000000000n;
  const maximum = data.maxFeePerGas > tip ? data.maxFeePerGas : tip * 2n;
  return { maxFeePerGas: maximum, maxPriorityFeePerGas: tip };
}

try {
  if (Number(BigInt(await provider.send('eth_chainId', []))) !== 137) throw new Error('Not Polygon mainnet');
  if (same(replacement, previousOperator)) throw new Error('Replacement must be a fresh wallet');
  const audit = JSON.parse(fs.readFileSync('reports/nft-cycle-1-eligibility-2026-11-02.json', 'utf8'));
  if (audit.chainId !== 137 || !audit.database.matchesCutoff || !same(audit.distributor, plan.distributor)) {
    throw new Error('Verified production eligibility evidence required');
  }
  if ((await distributor.periodOf(1)).created) throw new Error('Cycle 1 already published; inspect before recovery');
  if (!same(await distributor.owner(), plan.multisig) || !same(await legacy.owner(), plan.multisig)
      || !same(await legacy.usdt(), plan.token) || !same(await distributor.vault(), plan.vault)
      || !same(await distributor.rewardToken(), plan.token)) throw new Error('Mainnet governance wiring mismatch');
  const activeOperator = await distributor.rewardOperator();
  if (!same(activeOperator, previousOperator) && !same(activeOperator, replacement)) throw new Error('Unexpected current operator');
  const currentBalance = await token.balanceOf(plan.legacyVault);
  if (currentBalance !== BigInt(plan.amountRaw) && currentBalance !== 0n) throw new Error('Legacy balance changed; revise proposal');
  const proposalCount = Number(await governance.getTransactionCount());
  if (proposalCount > 300) throw new Error('Governance scan bound exceeded');
  const existing = [];
  for (let id = 0; id < proposalCount; id += 1) {
    const tx = await governance.transactions(id);
    existing.push({ id, ...Object.fromEntries(['to', 'value', 'data', 'executed', 'cancelled', 'confirmations'].map((key) => [key, tx[key]])) });
  }
  const signer = submit ? new Wallet(process.env.PRODUCTION_SUBMITTER_KEY, provider) : null;
  if (signer && (!same(signer.address, submitterAddress)
      || !(await governance.isOwner(signer.address) || await governance.isProposalSubmitter(signer.address)))) {
    throw new Error('Wrong or unauthorized proposal submitter');
  }
  Object.assign(report, { chainId: 137, checkedAt: new Date().toISOString(), multisig: plan.multisig,
    replacementOperator: replacement, previousOperator, transferAmountRaw: plan.amountRaw,
    recipientVault: plan.vault, requiredConfirmations: Number(await governance.requiredConfirmations()),
    timelockSeconds: Number(await governance.timelockDelay()), approvalsExecutedByThisScript: false });
  for (const call of calls) {
    const match = existing.find((tx) => same(tx.to, call.to) && tx.value === 0n && same(tx.data, call.data) && !tx.cancelled);
    if (!match?.executed) await provider.call({ from: plan.multisig, to: call.to, data: call.data });
    const record = { ...call, proposalId: match?.id ?? null, executed: match?.executed ?? false,
      confirmations: Number(match?.confirmations || 0n), simulationPassed: true };
    if (submit && !match) {
      const writer = governance.connect(signer);
      const gasLimit = (await writer.submitTransaction.estimateGas(call.to, 0n, call.data)) * 120n / 100n;
      const fee = await fees();
      if (gasLimit * fee.maxFeePerGas > parseEther('0.35')) throw new Error('Proposal gas exceeds 0.35 POL cap');
      const tx = await writer.submitTransaction(call.to, 0n, call.data, { gasLimit, ...fee });
      record.txHash = tx.hash;
      report.proposals = [...report.proposals.filter((entry) => entry.kind !== call.kind), record];
      save();
      const receipt = await tx.wait(2);
      if (receipt.status !== 1) throw new Error('Proposal submission failed');
      const emitted = receipt.logs.filter((log) => same(log.address, plan.multisig))
        .map((log) => { try { return governance.interface.parseLog(log); } catch { return null; } })
        .find((event) => event?.name === 'Submit');
      if (!emitted) throw new Error('Submitted proposal id not found');
      record.proposalId = Number(emitted.args.txId);
      record.blockNumber = receipt.blockNumber;
    }
    const prior = report.proposals.find((entry) => entry.kind === call.kind);
    report.proposals = [...report.proposals.filter((entry) => entry.kind !== call.kind), { ...prior, ...record }];
    save();
    console.log(JSON.stringify({ kind: record.kind, proposalId: record.proposalId,
      executed: record.executed, txHash: record.txHash, simulationPassed: true }));
  }
  if (fund) {
    const old = new Wallet(process.env.PRODUCTION_NFT_REWARD_OPERATOR_KEY, provider);
    if (!same(old.address, previousOperator)) throw new Error('Saved old operator key does not match');
    const newBalance = await provider.getBalance(replacement);
    if (newBalance < parseEther('1')) {
      const value = parseEther('3.90');
      const fee = await fees();
      const gasLimit = 21000n;
      if (gasLimit * fee.maxFeePerGas > parseEther('0.05')) throw new Error('Gas transfer fee above cap');
      if (await provider.getBalance(old.address) < value + gasLimit * fee.maxFeePerGas) throw new Error('Insufficient old operator gas');
      const tx = await old.sendTransaction({ to: replacement, value, gasLimit, ...fee });
      report.operatorFunding = { from: old.address, to: replacement, amountPol: '3.90', txHash: tx.hash };
      save();
      const receipt = await tx.wait(2);
      if (receipt.status !== 1) throw new Error('Operator funding failed');
      report.operatorFunding.blockNumber = receipt.blockNumber;
      save();
    }
  }
  console.log(JSON.stringify({ ...report, replacementBalancePol: formatEther(await provider.getBalance(replacement)) }, null, 2));
} catch (error) {
  console.error(String(error.shortMessage || error.message).replace(/https?:\/\/\S+/g, '[RPC]'));
  process.exitCode = 1;
} finally { provider.destroy(); }
