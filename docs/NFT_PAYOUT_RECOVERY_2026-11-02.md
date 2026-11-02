# Production NFT payout recovery

## User-approved rule

Only eligibility freezes 24 hours before the scheduled distribution. All
available, unreserved NFT pool funds count at cycle publication, including
post-cutoff contributions. Minting remains open; late minters wait for the
next cycle. A published cycle's amount and recipients remain fixed on retries.
The 50/30/20 tier split, retention of empty-tier allocations, 30-day schedule,
00:00 UTC distribution time and ID1 exclusion are unchanged.

The prior interpretation that retained 436.00 solely because it arrived after
cutoff was incorrect for the clarified requirement and is not used by this fix.

## Verified mainnet evidence

- Chain: Polygon mainnet, actual `eth_chainId` 137.
- Block 96591603, 2026-11-02 04:14:21 UTC.
- Cycle 1 distribution: 2026-11-02 00:00:00 UTC.
- Eligibility cutoff: 2026-11-01 00:00:00 UTC; last pre-cutoff block 96523828.
- Current shared vault: 1,717.60 USDT0, reserved 0.
- Previous NFT vault: 3,306.24 USDT0.
- Combined available: 5,023.84 USDT0.
- Five current NFT holders; four qualified at cutoff, all Foundation.
- Direct on-chain membership enumeration matches production database event
  reconstruction, including qualification and excluded-wallet checks.
- No period or payout had been created at that block.

Current projected recipients, at the above pool amount:

| Wallet | Tier | USDT0 |
| --- | --- | ---: |
| 0x117c9258a95775ecf448fd086d00ca22506ea79d | Foundation | 627.98 |
| 0xaa254e8e177de104d9f87211b0f4a6b7ec71306a | Foundation | 627.98 |
| 0xb673c9d14da920f187d25cc793f1955a43284622 | Foundation | 627.98 |
| 0xe8b1ac47231651ccc38326a59645a8d976d0eabf | Foundation | 627.98 |

Foundation total: 2,511.92. Intermediate retains 1,507.152 and Advanced
retains 1,004.768 because both have zero qualifying members. Total retained:
2,511.92. These are projections, not completed payments. New inflow before
publication changes the budget and per-member amounts.

The fifth current holder, 0xea2bcf620d164af63fba2f832c5f37e9eabdc528, was not
in the qualifying cutoff membership set. It must not be added to cycle 1.

## Blockers and changes

1. Fixed the worker's ID1 lookup: the getter belongs to F-Freedom's manager,
   not the Freedom-Plus manager. Added a regression check using the real ABIs.
2. Replaced historical funding with the live shared-vault unreserved balance.
   Require the exact executed funding proposal and an empty legacy vault
   before first-cycle publication. Do not add migrated funds twice.
3. Preserve immutable published budgets, roots, counts, cursor and proofs on
   retries. Renew the publication lease before sending a transaction.
4. Check the RPC's actual chain ID, not only its configured network identity.
5. A prior environment diagnostic exposed secrets, including the payout key.
   Prepared a replacement payout wallet and its governance authorization.
   Other exposed application/database credentials require separate rotation;
   they have not been silently changed as part of this payout repair.
6. At 04:14 UTC the hosted job also reported an RPC TLS error. The rollout
   updates the worker's HTTP RPC entries to the user-supplied, verified
   sleek-floral-sunset endpoint. No bulk environment replacement is used.

## Founders' actions

Multisig: `0x785cC854ce9e13CE1140cbFD7C08620713E1711d`.
Both proposals were simulated successfully before submission. They need
three owner confirmations and owner execution; the timelock is 120 seconds.
The agent submitted proposals only, not founder approvals or executions.

- Proposal **128**: move exactly 3,306.24 USDT0 from previous NFT vault
  `0xf8F60Da42681b73DFeCa7731E78b29C8707C184b` into shared NFT vault
  `0xbb2cF7ef867F46A93ae1F9DEd564927874b79B52`.
  Submission: `0xd9b7b5b52ba7ab4a11fe28b14c7742a697e7f3244f7f555a8a99ee6d63645ca6`.
- Proposal **129**: distributor
  `0xD3b9637281C41fc7575aF34d5e63C4dE2D86c838` authorizes replacement
  payout wallet `0xfFe24eD92941c30832fAcC60dabfd13608062DCa`.
  Submission: `0x4724e4e69f5e2083b1fc014bc3adb93e74ce32ae445dbb5a57e0d481785c6200`.

3.90 POL was transferred from the old funded payout wallet to its replacement,
confirmed at block 96591784:
`0xbb170f93cf8f9b1d1afbeb445c3d9c3c2eb3e36885a2c700a6fd1dd1f4fb7023`.
This was gas funding only, not a USDT reward payment.

## Validation and rollout

38 focused tests passed: worker publication, retry idempotency, wrong-chain
rejection, real manager ABI, ID1 exclusion, live funding, recovery governance,
schedule, Merkle proofs and bounded membership catch-up.

Commands, from backend:

```powershell
node --test test/nftRewardDistributionWorker.test.js test/nftRewardFundingRecovery.test.js test/nftRewardSchedule.test.js test/freedomPlusRewardSnapshot.test.js test/nftMembershipCatchup.test.js
node scripts/auditNftCycleEligibility.mjs
```

The audit requires the supplied mainnet RPC in process `AUDIT_RPC_URL` and
the existing production database environment. It does not write to MongoDB.
Reports contain public addresses, proofs and transaction hashes, no keys.

Production worker only: `srv-d7eit4favr4c73c08t8g`. The deployment helper uses
Render's individual-key update endpoint and verifies that unrelated environment
values, including the Mongo URI, are unchanged. It does not touch the two
suspended staging services, production database contents, frontend or contracts.

After both proposals execute and the corrected worker is live, it can publish
cycle 1 and distribute to the four verified recipients. Completion requires
receipt status 1, RewardClaimed events, matching token transfers, claimed flags,
updated vault reservations and a completed database job. Founder approval alone
must not be reported as payout completion.

Evidence:
- `reports/nft-cycle-1-eligibility-2026-11-02.json`
- `reports/nft-recovery-proposals-2026-11-02.json`
- `reports/nft-worker-rollout-2026-11-02.json`
