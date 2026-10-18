import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildEcosystemEarningsMap,
  serializeEcosystemEarnings,
} from '../src/ecosystemEarnings.js';

const builderSource = await readFile(
  new URL('../src/services/snapshots/orbitLevelSnapshotBuilder.js', import.meta.url),
  'utf8'
);
const querySource = await readFile(
  new URL('../src/services/read/orbitQueryService.js', import.meta.url),
  'utf8'
);
const participantSource = await readFile(
  new URL('../src/services/read/canonicalParticipantService.js', import.meta.url),
  'utf8'
);
const analyticsSource = await readFile(
  new URL('../src/services/read/communityAnalyticsService.js', import.meta.url),
  'utf8'
);
const indexerSource = await readFile(
  new URL('../src/services/indexerService.js', import.meta.url),
  'utf8'
);

test('current orbit projections preserve untagged rows after the reset boundary', () => {
  assert.match(
    builderSource,
    /cycleNumber === 0 \|\| cycleNumber === currentCycleNumber/
  );
  assert.match(
    builderSource,
    /sourceCycle === 0 \|\| sourceCycle === Number\(currentCycleNumber \|\| 0\)/
  );
  assert.doesNotMatch(
    builderSource,
    /Number\(event\.position \|\| 0\) === positionNumber &&\s*Number\(event\.cycleNumber/
  );
});

test('a newer indexed placement is rebuilt before the API responds', () => {
  assert.match(querySource, /if \(isMissing \|\| hasNewIndexedActivity\)/);
  assert.match(querySource, /freshnessBlock: Number\(activity\?\.latestBlock \|\| 0\)/);
  assert.doesNotMatch(
    querySource,
    /await buildOrbitLevelSnapshot\(address, level\);\s*await enrichOrbitLevelSnapshot/
  );
});

test('indexed orbit changes coalesce into a bounded snapshot refresh', () => {
  const refreshCalls =
    indexerSource.match(/^  scheduleOrbitLevelSnapshotRefresh\(\{/gm) || [];

  assert.equal(refreshCalls.length, 2);
  assert.match(indexerSource, /ORBIT_SNAPSHOT_REFRESH_CONCURRENCY = 1/);
  assert.match(indexerSource, /freshnessBlock: targetBlock/);
  assert.match(indexerSource, /Math\.max\(state\.blockNumber, normalizedBlock\)/);
  assert.doesNotMatch(indexerSource, /setInterval\([^)]*OrbitSnapshot/);
});

test('ecosystem totals come from F-Freedom and count ID1 once', () => {
  assert.match(
    participantSource,
    /registration\.connect\(provider\)\.totalParticipants\(\)/
  );
  assert.match(
    participantSource,
    /indexedRegisteredWallets \+ \(id1AlreadyRegistered \? 0 : 1\)/
  );
  assert.match(
    analyticsSource,
    /totalUsers: participantCounts\.totalParticipants/
  );
  assert.match(analyticsSource, /programSubsets:/);
});

const USER = '0x0000000000000000000000000000000000000001';
const FOUNDER = '0x0000000000000000000000000000000000000002';

test('gross earnings include escrow once while wallet credit includes releases', () => {
  const rows = buildEcosystemEarningsMap({
    receipts: [{ receiver: USER, liquidPaid: '7000000', escrowLocked: '3000000', grossAmount: '10000000' }],
    escrowReleases: [{ user: USER, amount: '3000000' }],
  });
  const result = serializeEcosystemEarnings(rows.get(USER));

  assert.equal(result.totalEarned, '10.00');
  assert.equal(result.walletCredited, '10.00');
  assert.equal(result.escrowReserved, '3.00');
  assert.equal(result.byProgram.fFreedom.escrowReleased, '3.00');
});

test('founder components are attributed to ID1 without duplicating wallet credit', () => {
  const rows = buildEcosystemEarningsMap({
    freedomPlusPayments: [{ recipient: USER, amount: '10000000', distributedToFounders: true }],
    founderIncome: [{ wallet: FOUNDER, amount: '1250000' }],
  });
  const id1 = serializeEcosystemEarnings(rows.get(USER));
  const founder = serializeEcosystemEarnings(rows.get(FOUNDER));

  assert.equal(id1.totalEarned, '10.00');
  assert.equal(id1.walletCredited, '0.00');
  assert.equal(id1.byProgram.freedomPlus.founderAttribution, '10.00');
  assert.equal(founder.totalEarned, '1.25');
  assert.equal(founder.walletCredited, '1.25');
});

test('Freedom Plus payments and NFT claims are included by actual recipient', () => {
  const rows = buildEcosystemEarningsMap({
    freedomPlusPayments: [{ recipient: USER, amount: '25000000', distributedToFounders: false }],
    nftClaims: [{ wallet: USER, amount: '5000000' }],
  });
  const result = serializeEcosystemEarnings(rows.get(USER));

  assert.equal(result.totalEarned, '30.00');
  assert.equal(result.byProgram.freedomPlus.totalEarned, '25.00');
  assert.equal(result.byProgram.freedomNft.totalEarned, '5.00');
});
