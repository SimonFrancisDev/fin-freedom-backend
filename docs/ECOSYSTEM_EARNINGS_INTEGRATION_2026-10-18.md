# Ecosystem Earnings Integration - 2026-10-18

## Objective

Expose one verified per-wallet earnings total across F-Freedom, Freedom-Plus, and Freedom NFT. The same calculation powers the community leaderboard and the Account financial summary.

## Accounting Rules

- F-Freedom earnings use each indexed payout receipt's gross amount. This includes the liquid payment and any amount reserved for auto-upgrade.
- Releasing escrow increases wallet-credit history but does not create earnings again.
- Freedom-Plus normal component payments are attributed to their indexed recipient.
- Freedom-Plus founder components are attributed to ID1 as earnings. The corresponding founder-income events remain attributed to each of the eight founder wallets as their actual split receipts.
- Freedom NFT earnings include only indexed reward claims. Membership deposits and undistributed pool balances are not user earnings.
- Recycle payments belong to the eligible recipient recorded by the contract event. They are not reassigned to the orbit owner in reporting.

## API Surface

- Community leaderboard rows now use ecosystem gross earnings and expose wallet-credited and escrow-reserved values.
- Global account summaries expose `ecosystemEarnings` with a total and per-program breakdown.
- Community member summaries expose the same `ecosystemEarnings` structure.
- Every query is filtered by the configured chain ID.

## Production Reconciliation

Read-only reconciliation against production database `finfreedom` on Polygon mainnet (`chainId 137`) returned:

- ID1 `0xCE38722a72c9099D9237897E18B0cfb6D51c4470`: `12,074.00 USDT` total earned.
- ID1 F-Freedom component: `11,194.00 USDT`.
- ID1 Freedom-Plus founder attribution: `880.00 USDT`.
- Freedom-Plus founder components: 18 events totaling `880.00 USDT`.
- Founder-wallet distributions: 144 events totaling `880.00 USDT`.
- Founder component/distribution reconciliation: exact match.
- Freedom NFT claims before the first distribution cycle: 0 events and `0.00 USDT`.

## Validation

- Backend test suite: 48 passed, 0 failed.
- Added unit coverage for escrow counted once, ID1/founder attribution, and Freedom-Plus plus NFT aggregation.
- Frontend Account page ESLint: passed.
- Frontend production build to an isolated output directory: passed.
- Git whitespace validation: passed.

The existing local `dist` directory is locked by another process, so validation used a separate build output directory. This does not affect source code or deployment builds.
