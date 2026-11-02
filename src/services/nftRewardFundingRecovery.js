import { Contract, Interface, ZeroHash } from 'ethers';
import recovery from '../config/nftRewardFundingRecovery.json' with { type: 'json' };

export const legacyNftVaultAbi = [
  'function owner() view returns (address)',
  'function usdt() view returns (address)',
  'function distribute(address recipient,uint256 amount,bytes32 distributionId,string reason)',
];
export const recoveryMultisigAbi = [
  'function transactions(uint256) view returns (address to,uint256 value,bytes data,bool executed,bool cancelled,uint256 confirmations,uint256 submittedAt,uint256 executeAfter)',
];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function recoveryCalldata(plan = recovery) {
  return new Interface(legacyNftVaultAbi).encodeFunctionData('distribute', [
    plan.vault, BigInt(plan.amountRaw), ZeroHash, plan.reason,
  ]);
}

// Gate first-cycle publication on the audited transfer. Its amount is already
// included in the live vault balance; this check never adds to the budget.
export async function legacyRewardFunding({ chainId, cycleId, distributor, token,
  vault, provider, plan = recovery,
  contractFactory = (address, abi) => new Contract(address, abi, provider) }) {
  if (Number(chainId) !== plan.chainId || Number(cycleId) !== plan.cycleId
      || !same(distributor, plan.distributor)) return;
  if (!same(token, plan.token) || !same(vault, plan.vault)) {
    throw new Error('NFT recovery deployment mismatch');
  }
  if (!Number.isSafeInteger(plan.proposalId) || plan.proposalId < 0) {
    throw new Error('NFT legacy funding proposal has not been configured');
  }
  const governance = contractFactory(plan.multisig, recoveryMultisigAbi);
  const proposal = await governance.transactions(plan.proposalId);
  if (!same(proposal.to, plan.legacyVault) || proposal.value !== 0n
      || !same(proposal.data, recoveryCalldata(plan)) || proposal.cancelled) {
    throw new Error('NFT legacy funding proposal does not match the approved transfer');
  }
  if (!proposal.executed) {
    throw new Error(`Awaiting founders execution of NFT funding proposal ${plan.proposalId}`);
  }
  const legacy = contractFactory(plan.legacyVault, legacyNftVaultAbi);
  if (!same(await legacy.owner(), plan.multisig) || !same(await legacy.usdt(), token)) {
    throw new Error('NFT legacy funding source verification failed');
  }
  const rewardToken = contractFactory(token, ['function balanceOf(address) view returns (uint256)']);
  if (await rewardToken.balanceOf(plan.legacyVault) !== 0n) {
    throw new Error('NFT legacy pool still has funds; complete consolidation before publication');
  }
}
