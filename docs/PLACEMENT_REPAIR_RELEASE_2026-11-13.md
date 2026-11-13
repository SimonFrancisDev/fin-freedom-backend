# Production placement-repair integration

## Scope

Polygon mainnet (137) only. Prepare the existing API and worker to read the
already-reviewed F-Freedom and Freedom Plus historical repair events. This
release does not execute a repair, create payments, reset the database, alter
permanent sponsors, or restart the two suspended staging services.

## Changes and reason

- Previously committed F-Freedom/FP repair projections preserve original receipt
  provenance and keep structural repairs separate from earnings and payments.
- Synchronize P4/P12/P39 `mirrorPositionDetailed` ABI output with the tested
  candidate's fifth field, `mirrorRecycleAmount`. Application code does not call
  this internal orbit interface directly; existing read interfaces are unchanged.
- Add a read-only production binding audit. It records public addresses, service
  commits, configuration fingerprints and database-URI presence, never secrets.

## Validation before release

35 targeted tests passed: both historical repair projections, genesis decoding,
realtime indexing without recurring HTTP polling, and independent NFT worker
startup. The cross-repository integration check passed 22 ABI comparisons and
verified mainnet addresses in the actual production frontend bundle.

At 2026-11-13 22:48 UTC, production API `srv-d7eeof8sfn5c738thl60` ran
`28f010a2afa7054c0054aae5e0d6e1286b128618`; worker
`srv-d7eit4favr4c73c08t8g` ran `02389acb260097bbc6532ef3361413766dcb07d0`.
Neither yet contained the repair projections. Both retained their database URI
and verified mainnet bindings. Polling was disabled. Only the worker enabled
indexing and NFT auto-distribution; this separation must remain unchanged.

## Release boundary

Deploy the tested source commit to those two production services only, using
commit-specific Render deployments. No environment replacement or database
operation is part of this release. Record the resulting live deployment IDs.
Then finish verified deployment-manifest binding before submitting replacement
governance proposals. Actual historical positions can only be reconciled after
the founders execute the ordered repair package.
