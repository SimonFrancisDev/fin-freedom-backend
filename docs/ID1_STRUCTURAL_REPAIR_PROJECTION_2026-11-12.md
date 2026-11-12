# ID1 structural-repair projection

## Scope and reason

The historical F-Freedom repair emits correction events, not new activations or
payments. Existing snapshot builders only consumed ordinary placement events;
they would therefore keep displaying pre-repair occupants after a successful
contract repair. This change prepares the backend to consume the distinct
repair journal without changing the monetary ledger.

There is no 512-USDT compensation in the revised repair. The restored ancestry
mirror has zero amount, zero payout-rule amounts, and its original activation
identity. Existing actual transfers and earnings remain unchanged.

## Implementation

- Extend the existing orbit contract interfaces with the three repair events.
- Receive them through the existing WebSocket and bounded recovery paths. No
  polling timer, environment change or additional provider is introduced.
- Save repair events idempotently in IndexedOrbitEvent with `amount: '0'`.
  The encoded old/current/archive slot states remain in the original raw log.
- Apply corrections to level, individual-position and cycle snapshots in chain
  order. Later fills/resets win. A cleared slot cannot be resurrected by an old
  placement event; another cycle is not changed.
- Match actual historical receipts by activation identity, not by the old slot
  number. Do not attribute the displaced occupant's receipts to a restored user.
- Mark a zero-value ancestry mirror as `STRUCTURAL_REPAIR`, with no invented or
  borrowed receipt. The existing frontend renders that truth label as text.
- Never write IndexedReceipt, activation summaries, financial events, token
  events, user balances or earnings from these repair events.

## Verification

`npm test`: **73 passed, 0 failed**, including eight dedicated repair tests.
JavaScript syntax checks passed for modified indexing and snapshot modules.
The targeted repair/data-consistency invocation passed all 15 cases.

The offline integration validator accepts the completed structural-only fork
evidence and compares its emitted slot journal with every expected manifest slot:

```text
node scripts/validateId1RepairProjection.mjs <completed-fork-evidence.json> <output.json>
```

It refuses an incomplete/failed rehearsal, a different source network, a live
execution network, a nonzero repair transfer or differing before/after money
and earnings invariants. This is not a hosted API/browser certification.

The validator passed against the revised direct-call fork evidence at block
97175651: **149 slots checked**, 44 journaled slot updates and 52 decoded repair
events. The 44 updates include counter normalization, not 44 relocated wallets.
No database writes or invented payments occurred. Evidence is saved in the
staging source repository at
`docs/evidence/id1-repair-backend-projection-2026-11-12.json`.

## Release boundary

This is a local candidate. No production database, hosted service, environment
variable or contract has been changed. Both suspended staging services remain
suspended. Deploy this event support before the eventual authorized structural
repair, then compare chain, indexed events, API snapshots and desktop/mobile
orbit views at the same execution block. Matrix-parent audit events and the
complete deployment/recovery runbook still require final integration review.
