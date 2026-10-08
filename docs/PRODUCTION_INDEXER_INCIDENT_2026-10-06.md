# Production Indexer Incident: 2026-10-06

## Summary

F-Freedom and Freedom-Plus transactions continued succeeding on Polygon
mainnet while the production worker's event projection became stale. The
primary WebSocket disconnected and the worker selected a secondary endpoint
that had exhausted its provider quota. Reconnecting listeners did not replay
blocks missed during the disconnection.

No smart-contract state or production records were deleted or reset.

## Impact

- On-chain activations, payments, and placements remained authoritative.
- API and UI views could omit successful events until their projections were
  replayed.
- The reported Level 3 placement for
  0x8384Eaf0F3b569B9c9Dc999e750dE97aC50ED08C was one affected case.

## Evidence

- The affected Level 3 transaction was successful at block 95098083:
  0x1807d5192a1d85bac5249191fc7b7803eb167522916d47b1f13f20698362b10e.
- Its P39 placement was recorded on-chain under
  0xc9dbb95a75745fa81cb7c027446078abce004c4c, position 2.
- The outage scan found 278 relevant logs across 12 transactions.
- Eleven transactions were program events represented after recovery.
- The remaining transaction was a successful Operations Vault Misc expense,
  not an activation, placement, or program payout. Its deployed event
  signature is not represented by the current local vault ABI.

## Recovery Performed

- Replayed the affected F-Freedom block range.
- Continued F-Freedom synchronization through block 95155544.
- Replayed Freedom-Plus from the pre-outage checkpoint through confirmed block
  95154824.
- Verified that the affected placement became visible through the live API.

All recovery writes were additive or idempotent projection updates.

## Permanent Fix

1. RPC retries now bind each contract read to the provider selected for that
   retry. A failed endpoint can no longer remain captured by the original
   contract instance.
2. Every successful realtime WebSocket startup or reconnect requests one
   checkpoint-based F-Freedom catch-up pass.
3. A shared WebSocket reconnect requests the existing Freedom-Plus confirmed
   catch-up.
4. Continuous indexer polling remains disabled. The recovery pass runs only at
   startup or reconnect and scans from durable checkpoints to the confirmed
   chain head.

## Deployment Requirements

- Keep INDEXER_POLLING_ENABLED=false.
- Keep the worker realtime indexer and Freedom-Plus indexer enabled.
- Remove exhausted RPC endpoints from HTTP and WebSocket failover lists.
- Preserve every unrelated Render environment variable when updating endpoint
  configuration.
- Confirm these worker log events after deployment:
  - REALTIME_EVENT_INDEXER_CONNECTED
  - REALTIME_EVENT_CONFIRMED_RECOVERY_COMPLETE
  - FREEDOM_PLUS_REALTIME_CONNECTED

## Residual Follow-Up

- Reconcile the Operations Vault deployed event signature with the maintained
  ABI and accounting indexer.
- Resolve the existing MongoDB walletAddress_1 index-definition warning.
- Audit older projection inconsistencies separately from this recovered outage
  range.
