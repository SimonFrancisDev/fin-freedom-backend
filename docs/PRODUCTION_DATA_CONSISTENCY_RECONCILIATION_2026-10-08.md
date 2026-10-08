# Production data consistency reconciliation - 2026-10-08

## Canonical rules

- F-Freedom registration is the canonical ecosystem participant registry.
- ID1 is a system participant and is counted exactly once.
- Freedom Plus participants and Freedom NFT members are subsets of the
  F-Freedom population. They are never added to the ecosystem total.
- Blockchain events are the source of truth for activations, placements,
  payments, spillovers, recycle state, escrow, utility tokens, and treasury
  movements.
- MongoDB snapshots are rebuildable read projections. Rebuilding them must not
  alter blockchain state.

## Defects corrected

1. Legacy orbit events indexed before cycle tagging used cycle number zero.
   When newer tagged events existed, the snapshot builder discarded those
   legacy rows even when they occurred inside the current cycle.
2. A request with newer indexed activity returned the old snapshot and only
   refreshed it in the background. The first post-transaction view could
   therefore appear empty.
3. Snapshot rebuilds did not record the latest indexed block and performed the
   live enrichment twice. This caused repeated RPC work.
4. Several read services retried a contract object still bound to the original
   RPC provider. They now reconnect the contract to each provider selected by
   the failover layer.
5. The community analytics endpoint counted ordinary registration events but
   omitted ID1. It now uses the contract's canonical total and reports Freedom
   Plus and NFT counts as subsets.

## Controlled repair

`scripts/reconcileOrbitSnapshots.js` is dry-run by default. It identifies:

- activated levels with no snapshot;
- orbit owners with no snapshot;
- current-cycle placement events missing from the current snapshot.

Run with `--apply` only after the dry-run has been reviewed. Apply mode
rebuilds MongoDB read projections from indexed chain events and verified live
contract reads. It does not submit transactions, deploy contracts, reset the
database, or alter program state.

After repair, run `scripts/auditProductionReadConsistency.js` and require:

- zero duplicate event keys;
- zero activations without receipts;
- zero missing activated-level snapshots;
- zero current-cycle event/snapshot placement mismatches;
- API participant total equal to F-Freedom `totalParticipants()`;
- Freedom Plus and NFT subset counts no greater than the canonical total.

## Verified production result

The controlled repair rebuilt 115 stale or missing projections. The independent
post-repair dry run returned zero remaining targets.

At the verification checkpoint:

- ordinary registered wallets: 429;
- canonical participants including ID1 exactly once: 430;
- Freedom Plus participants: 33;
- Freedom NFT members: 4;
- duplicate indexed event keys: 0;
- activations without receipts: 0;
- missing Level 1 snapshots: 0;
- internal snapshot mismatches: 0;
- current-cycle placement/snapshot mismatches: 0.

Freedom Plus and NFT counts are subsets of the 430 canonical participants and
are not added to that total.
