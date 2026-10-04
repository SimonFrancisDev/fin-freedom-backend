# Monetary Data Truth

## Scope

Production monetary totals combine indexed Polygon mainnet records for F-Freedom and Freedom Plus. UI code must consume these backend totals and must not reconstruct global values from wallet-local data.

## Canonical fields

- `generatedGross`: indexed activation value across both programs.
- `walletCreditedLiquid`: indexed F-Freedom receipts, escrow releases, ordinary Freedom Plus payments, and the individual founder-income ledger entries created when an ID1 payment is divided among the eight founders.
- `escrowLockedLifetime`, `autoUpgradeUsed`, `escrowReleasedToUser`, and `currentEscrowLocked`: indexed escrow accounting.
- `nftPoolAllocated` / `nftRewardPool.totalInflow`: lifetime NFT allocation. This is the public accumulated figure.
- `operationsAllocated` / `devOperations.totalInflow`: lifetime operations allocation. This is the public accumulated figure.
- `nftPoolDistributed`: indexed NFT claims reconciled against accumulated inflow minus a fully verified aggregate live balance.
- `operationsUtilized`: indexed withdrawals reconciled against accumulated inflow minus a fully verified aggregate live balance.
- `nftPoolLiveBalance` and `operationsLiveBalance`: aggregate current USDT balances of all configured current and legacy vaults.

## Failure semantics

A failed RPC balance read is not zero. The API returns a null live balance and a false verification flag when any required vault balance cannot be read. In that state, distributed/utilized values remain event-backed and are not inferred from a false zero.

## Leaderboard

Leaderboard earnings include F-Freedom indexed receipts, Freedom Plus payments, and per-founder Freedom Plus income. ID1 shows the full amount routed to ID1 before its mandatory split among the eight founders; each founder also shows the amount actually credited to that founder. This intentional attribution overlap is limited to the leaderboard. Global monetary totals exclude the aggregate ID1 founder-payment record to prevent double-counting system money.

## UI rules

- Public NFT and operations cards show lifetime accumulated inflow.
- Admin financial truth shows accumulated, distributed/utilized, and verified current balance separately.
- An unavailable current balance is displayed as `Unavailable`, never `$0.00`.
- Personal wallet balances and individual transaction values keep their wallet-specific sources.

## Validation

- Backend: `npm test` passes all 32 tests.
- Frontend: `npm run build` completes successfully.
