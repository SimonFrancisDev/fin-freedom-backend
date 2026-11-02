import './setupEnv.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRewardFunding, recoveryCalldata } from '../src/services/nftRewardFundingRecovery.js';

const plan = {
  chainId: 137, cycleId: 1, distributor: 'distributor', token: 'token',
  vault: '0x0000000000000000000000000000000000000003',
  legacyVault: 'legacy', multisig: 'multisig', amountRaw: '50',
  proposalId: 7, reason: 'verified recovery',
};

function contracts(options = {}) {
  return (_address, abi) => {
    if (abi.some((entry) => entry.startsWith('function transactions'))) return {
      transactions: async () => ({ to: options.wrongTarget ? 'other' : 'legacy', value: 0n,
        data: options.wrongAmount ? recoveryCalldata({ ...plan, amountRaw: '49' }) : recoveryCalldata(plan),
        executed: !options.pending, cancelled: Boolean(options.cancelled) }),
    };
    if (abi.some((entry) => entry.startsWith('function owner'))) return {
      owner: async () => 'multisig', usdt: async () => 'token',
    };
    return { balanceOf: async () => options.wrongBalance ? 49n : 0n };
  };
}

const input = (options = {}) => ({ chainId: 137, cycleId: 1, distributor: 'distributor',
  token: 'token', vault: plan.vault, provider: {}, plan,
  contractFactory: contracts(options) });

test('accepts exact executed transfer without adding it to the live balance again', async () => {
  assert.equal(await legacyRewardFunding(input()), undefined);
});

test('does not add first-cycle recovery to later cycles', async () => {
  assert.equal(await legacyRewardFunding({ ...input(), cycleId: 2 }), undefined);
});

for (const condition of ['pending', 'wrongTarget', 'wrongBalance', 'wrongAmount', 'cancelled']) {
  test(`rejects ${condition} recovery evidence`, async () => {
    await assert.rejects(legacyRewardFunding(input({ [condition]: true })));
  });
}

test('unconfigured proposal prevents publication', async () => {
  await assert.rejects(legacyRewardFunding({ ...input(), plan: { ...plan, proposalId: null } }), /not been configured/);
});
