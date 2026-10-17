import './setupEnv.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNftRewardDistributionPass } from '../src/services/nftRewardDistributionWorker.js';

function fixture(options = {}) {
  const now = new Date();
  const distributionAt = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
  ));
  const cutoff = new Date(distributionAt.getTime() - 24 * 60 * 60 * 1000);
  const snapshot = { distributionAt, cutoff, cutoffBlock: 100,
    roots: options.emptyEligibility ? ['0x0', '0x0', '0x0'] : ['a', 'b', 'c'],
    counts: options.emptyEligibility ? [0, 0, 0] : [1, 0, 0],
    eligibility: options.emptyEligibility ? [] : [{ wallet: 'member', tier: 1, proof: [] }] };
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
      distributionAt: snapshot.distributionAt.getTime() / 1000,
      eligibleRoots: options.badRoot ? ['wrong', 'b', 'c'] : snapshot.roots,
      eligibleCounts: snapshot.counts }; },
    async firstDistributionAt() {
      const seconds = BigInt(snapshot.distributionAt.getTime() / 1000);
      return options.badSchedule ? seconds + 1n : seconds;
    },
    async rewardExcluded() { return !options.id1NotExcluded; },
    async rewardOperator() { return options.wrongOperator ? 'other' : 'operator'; },
    async rewardToken() { return 'token'; },
    async createCycle() {
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
    env: { CHAIN_ID: 80002, NFT_REWARD_FIRST_DISTRIBUTION_AT: distributionAt.toISOString(),
      FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS: 'distributor', SYNC_CONFIRMATIONS: 1 },
    shouldStop: () => false,
    Job: { updateOne: update,
      findOneAndUpdate: (filter) => ({ lean: async () =>
        filter.status.$nin.includes(job.status) ? null : job }),
      findOne: () => ({ lean: async () => job }) },
    Snapshot: { updateOne: async () => { calls.published += 1; } },
    Wallet: class { address = 'operator'; },
    getProvider: () => { calls.rpc += 1; return {
      getNetwork: async () => ({ chainId: options.wrongChain ? 137 : 80002 }) }; },
    getFreedomPlusContracts: () => ({ nftRewardDistributor: distributor,
      levelManager: { id1Wallet: async () => 'id1' },
      nftPoolVault: { unreservedBalance: async () => 100n } }),
    buildSnapshot: async (target) => {
      if (options.incompleteIndex) throw new Error('Index incomplete');
      assert.deepEqual(target.excludedWallets, ['id1']);
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

test('publishes an auditable empty cycle while retaining all funds in the pool', async () => {
  const f = fixture({ emptyEligibility: true });
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.calls.created, 1);
  assert.equal(f.calls.paid, 0);
  assert.equal(f.job.status, 'empty');
});

test('freezes one snapshot at cutoff and performs no repeated RPC work before distribution', async () => {
  const f = fixture();
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  f.dependencies.env.NFT_REWARD_FIRST_DISTRIBUTION_AT = tomorrow.toISOString();
  f.dependencies.getFreedomPlusContracts().nftRewardDistributor.firstDistributionAt = async () =>
    BigInt(tomorrow.getTime() / 1000);
  f.dependencies.buildSnapshot = async (target) => {
    assert.deepEqual(target.excludedWallets, ['id1']);
    return {
      distributionAt: tomorrow,
      cutoff: new Date(tomorrow.getTime() - 24 * 60 * 60 * 1000),
      cutoffBlock: 100,
      roots: ['a', 'b', 'c'],
      counts: [1, 0, 0],
      eligibility: [{ wallet: 'member', tier: 1, proof: [] }],
    };
  };
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.job.status, 'snapshotted');
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.paid, 0);
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.calls.rpc, 1);
});

for (const reason of [
  'badRoot', 'wrongOperator', 'wrongChain', 'incompleteIndex', 'badSchedule', 'id1NotExcluded',
]) {
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
  f.dependencies.env.NFT_REWARD_FIRST_DISTRIBUTION_AT = `${new Date().getUTCFullYear() + 1}-01-01T00:00:00.000Z`;
  await runNftRewardDistributionPass(f.dependencies);
  assert.equal(f.calls.rpc, 0);
});
