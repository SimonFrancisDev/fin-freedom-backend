# Freedom Plus historical repair projection

Status: local candidate, not deployed. No production database or environment
was edited. No polling or suspended staging service was enabled.

The contract repair emits `FreedomPlusHistoricalPositionRestored` and
`FreedomPlusHistoricalOrbitRestored`, not ordinary activation/payment events.
The four affected orbit ABI specifications include these events for the
existing event-driven indexer. Single-position events produce one append-only
`FreedomPlusPosition`; summary events produce no financial projection.

Each restoration requires an indexed original `PositionRecorded` from the same
chain, engine, original transaction, participant and activation. The original
timestamp must match the encoded historical position. Missing/mismatched
evidence stops projection; no historical receipt is invented.

`txHash`, `blockNumber`, and `timestamp` identify the original placement.
`historicalRepair`, `repairTxHash`, `repairBlockNumber`, and `repairedAt` identify
the later correction. The original activation ID links the restored appearance
to existing payment records. Neither payments nor ledger earnings are inserted.
Genesis setup links retain amount zero and `financial: false`.

Upserts include participant/activation/placement identity as well as the unique
orbit slot. A different existing occupant causes a unique-index conflict instead
of being overwritten. Repeated delivery uses `$setOnInsert` and is idempotent.
The position-count reconciliation includes both ordinary and restoration events.
Existing reorg handling still requires operator reconciliation; this patch does
not introduce a new rollback mechanism or silently rewrite historical state.

Validation: `node --test test/freedomPlusHistoricalRepair.test.js test/historicalOrbitRepair.test.js`
passed 22 tests (14 new Freedom Plus and 8 existing F-Freedom cases), without a
database connection. Tests cover provenance, zero-money genesis, bad network,
engine, identity, dates and payloads, idempotence, occupied-slot conflicts and
absence of payment/earnings/activation writes. Unique-index behavior is simulated
in unit tests, not claimed as a live MongoDB deployment test.

Release this support before the on-chain repair, then verify the exact executed
repair receipt has been indexed and projected. Compare restored orbit slots to
chain and verify payment/earnings counts did not grow because of repair events.
Contract evidence and the combined governance prerequisites are documented in
the source repository's `docs/FREEDOM_PLUS_PLACEMENT_REPAIR_VALIDATION_2026-11-13.md`.
