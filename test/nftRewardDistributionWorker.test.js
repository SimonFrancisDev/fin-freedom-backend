import './setupEnv.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNftRewardDistributionPass } from '../src/services/nftRewardDistributionWorker.js';

function fixture(options = {}) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const snapshot = { cutoff: new Date(Date.UTC(year, month - 1, 1)), cutoffBlock: 100,
    roots: ['a', 'b', 'c'], counts: [1, 0, 0],
    eligibility: [{ wallet: 'member', tier: 1, proof: [] }] };
  const job = { status: 'pending', cursor: 0 };
  const calls = { rpc: 0, created: 0, paid: 0, published: 0 };
  let created = Boolean(options.created);
  const update = async (_filter, change) => {
    Object.assign(job, change.$set || {});
    return { matchedCount: 1 };
  };
  const distributor = {
    connect() { return this; },
    async periodOf() { return { created, cutoff: snapshot.cutoff.getTime() / 1000,
      eligibleRoots: options.badRoot ? ['wrong', 'b', 'c'] : snapshot.roots,
      eligibleCounts: snapshot.counts }; },
    async rewardOperator() { return options.wrongOperator ? 'other' : 'operator'; },
    async rewardToken() { return 'token'; },
    async createPeriod() {
      calls.created += 1;
      created = true;
      return { hash: 'create', wait: async () => {} };
    },
    async distributeBatch(_period, members) {
      calls.paid += 1;
      assert.deepEqual(members, ['member']);
      if (options.failPayment) throw new Error('Payment failed');
      return { hash: 'pay', wait: async () => {} };
    },
  };
  const dependencies = {
    env: { CHAIN_ID: 80002, NFT_REWARD_FIRST_PERIOD: year * 100 + month,
      FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS: 'distributor', SYNC_CONFIRMATIONS: 1 },
    shouldStop: () => false,
    Job: { updateOne: update,
      findOneAndUpdate: () => ({ lean: async () =>
        ['complete', 'empty'].includes(job.status) ? null : job }),
      findOne: () => ({ lean: async () => job }) },
    Snapshot: { updateOne: async () => { calls.published += 1; } },
    Wallet: class { address = 'operator'; },
    getProvider: () => { calls.rpc += 1; return {
      getNetwork: async () => ({ chainId: options.wrongChain ? 137 : 80002 }) }; },
    getFreedomPlusContracts: () => ({ nftRewardDistributor: distributor,
      nftPoolVault: { unreservedBalance: async () => 100n } }),
    buildSnapshot: async () => {
      if (options.incompleteIndex) throw new Error('Index incomplete');
      return snapshot;
    },
  };
  return { dependencies, job, calls };
}

test('publishes and pays once; completed periods make no further RPC calls', async () => {
  const f = fixture();
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.job.status, 'complete');
  assert.equal(f.job.cursor, 1);
  await runNftRewardDistributionPass(f.dependencies);
  assert.deepEqual(f.calls, { rpc: 1, created: 1, paid: 1, published: 1 });
});

test('resumes an existing on-chain period without republishing', async () => {
  const f = fixture({ created: true });
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.paid, 1);
  assert.equal(f.job.status, 'complete');
});

for (const reason of ['badRoot', 'wrongOperator', 'wrongChain', 'incompleteIndex']) {
  test(`refuses payment when ${reason}`, async () => {
    const f = fixture({ [reason]: true, created: reason === 'badRoot' });
    await runNftRewardDistributionPass(f.dependencies);
    assert.equal(f.calls.paid, 0);
    assert.equal(f.job.cursor, 0);
    assert.equal(f.job.status, 'pending');
    assert.ok(f.job.lastError);
    assert.equal(f.job.leaseOwner, '');
  });
}

test('failed payment preserves cursor and retries the existing period', async () => {
  const options = { failPayment: true };
  const f = fixture(options);
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.job.cursor, 0);
  assert.equal(f.job.status, 'pending');
  options.failPayment = false;
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.calls.created, 1);
  assert.equal(f.job.status, 'complete');
});

test('before the first period, performs no RPC work', async () => {
  const f = fixture();
  f.dependencies.env.NFT_REWARD_FIRST_PERIOD = (new Date().getUTCFullYear() + 1) * 100 + 1;
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.calls.rpc, 0);
});
