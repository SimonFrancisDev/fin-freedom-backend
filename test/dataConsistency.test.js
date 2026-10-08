import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

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
