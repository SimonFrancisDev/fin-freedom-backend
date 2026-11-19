# Mainnet orbit receipt linking correction

## Status and scope

Deployed and verified on Polygon mainnet production on 19 November 2026. Both production Render services run commit `61993cae3c45f55dcfdcc34abbc19e2f329f79d1`. All nine affected entries passed the live checks in all three views. Production environment values, contracts and payment records were preserved; both staging services remain suspended. A separate historical registration catch-up decoder issue remains open, described below.

The change corrects the F-Freedom backend's association between existing payout receipts and corresponding recipient orbit positions. It does not change placement rules, create positions, move participants, recalculate earnings or send payments. Freedom Plus and NFT behavior are unchanged.

## Evidence and cause

The preceding read-only audit used Polygon mainnet, chain ID 137, from block 97403238 through 97593035, covering 16 November 2026 06:25:26 UTC through 19 November 2026 13:30:22 UTC. Its 13 F-Freedom activation transactions passed 126 financial checks. The production receipt endpoint matched all 21 payout records.

Nevertheless, nine recipient-side orbit entries had the correct occupant and placement but returned activation ID zero, no linked receipts and zero displayed receipt earnings. The payments were not missing on chain. The snapshot builders looked up receipts only by the originating orbit owner and source coordinates. A corresponding position in a recipient's orbit instead uses the receiver, mirrored position and mirrored cycle. Those coordinates can differ from the source in all three respects.

For example, activation 1192 recycled source position 4 in cycle 1, while its recipient occupied position 3 in cycle 4. Joining the recipient's entry to the source cycle or position cannot find the correct receipt. The source reset was emitted before the final payout event in the same transaction, so timestamp ordering alone must not override an explicit receipt cycle.

The nine entries account for 208.00 USDT of already-recorded receipt earnings: 190.00 liquid and 18.00 in auto-upgrade escrow. This is a display-linking total, not an unpaid balance or an additional payment to make.

| Activation | Recipient orbit owner | Level | Position | Cycle | Liquid USDT | Escrow USDT |
| --- | --- | --- | --- | --- | --- | --- |
| 1187 | 0xbA14da48b3111DFb40A65E272833A2B1838b062D | 2 | 5 | 1 | 10.00 | 0.00 |
| 1188 | 0xbA14da48b3111DFb40A65E272833A2B1838b062D | 3 | 8 | 1 | 8.00 | 0.00 |
| 1188 | 0x52253B7e997205ce00fE2A2148a8a849D0143A74 | 3 | 22 | 1 | 20.00 | 0.00 |
| 1190 | 0x267DB05031c672c82cd88D5ec91a1f350a0d1aAf | 2 | 3 | 1 | 8.00 | 0.00 |
| 1191 | 0x216A79859bdaBAC8264B589623C3f2dC44B11F78 | 3 | 1 | 1 | 8.00 | 0.00 |
| 1191 | 0x9D283BD551956c6824E96c6F24e4fC8692E5B962 | 3 | 4 | 1 | 0.00 | 8.00 |
| 1192 | 0xF93AB102473De4886e5E82ED48f6dfe21f82afD0 | 4 | 3 | 4 | 72.00 | 0.00 |
| 1193 | 0xbA14da48b3111DFb40A65E272833A2B1838b062D | 5 | 3 | 1 | 64.00 | 0.00 |
| 1195 | 0xc042a549EF42133E9a7c0FC4fe5cd7141c03915B | 2 | 7 | 1 | 0.00 | 10.00 |

The versionable fixture at `test/fixtures/mainnet-orbit-receipts-2026-11-19.json` includes full participant wallets, transaction hashes, block numbers, log indices, receipt amounts and placement events. Original audit outputs are in the workspace's `tmp/post-upgrade-audit-2026-11-19` directory, including `financial-verification.json`, `api-receipt-verification.json`, `api-current-mirror-findings.json` and `affected-orbit-entries.json`.

## Implementation

1. `orbitReceiptProjection.js` selects source and recipient receipts using their own owner, position and cycle coordinates. An ID1 fallback payment with no mirrored position cannot manufacture a recipient position. Duplicate event identities are counted once per selection.
2. The level, position-details and cycle-history builders use the same selection and activation metadata. Explicit cycle numbers take precedence over reset log ordering. Legacy receipts without cycle tags use reset boundaries.
3. Position details take their occupied wallet from `PositionFilled`, not from a later unrelated event sharing the position number. Existing historical repair handling remains authoritative, including zero-payment structural links.
4. The read service includes recipient receipts in freshness checks and the historical metadata fallback. Snapshot versions are now level 5, position 4 and cycle 7. Older versions rebuild when requested, subject to the existing short response-cache lifetime.
5. Receipt ingestion schedules the existing bounded snapshot refresh for both the source orbit and a genuine mirrored recipient orbit, deduplicating an identical owner. This remains event-driven; it adds no polling loop or full-history replay. Existing bounded chain enrichment may still perform reads during refresh.

## Validation

Command, from `backend`:

```text
node --test test/*.test.js
```

Result: 109 tests passed, zero failed, zero skipped. The new receipt projection file contributes 22 tests. All nine saved mainnet cases were replayed through the actual three snapshot builders with in-memory model substitutes. The chain-summary enricher was deliberately bypassed; these tests do not connect to a live database or submit blockchain transactions. The recycle fixture seeds its previously verified completed-cycle count as a synthetic test anchor, not as a claimed additional chain event.

Additional coverage includes direct-owner receipts and viewer-specific totals, separate source/destination cycles, closing-cycle payouts emitted after reset, legacy boundaries, duplicate delivery, no invented occupant from payment evidence alone, non-placement events, and zero-payment historical repairs. Existing Freedom Plus, NFT worker, earnings and realtime-indexer tests also passed. Snapshot-version and refresh wiring checks are source-level guards, not a substitute for deployment verification.

## Production rollout procedure

1. Review and commit only this backend correction, its tests, fixture and this document. Preserve unrelated local files.
2. Deploy that reviewed commit to the existing production API and production worker. Preserve all existing secrets, database configuration, contract addresses and realtime/polling settings. Do not restart either suspended staging service. No Vercel build, contract upgrade or founder proposal is required by this fix.
3. After deployment, request the affected current-level, position-details and relevant cycle-history views. Existing version checks rebuild outdated snapshots; no database reset or chain replay is required. If a current orbit has since recycled, verify the saved case in its recorded historical cycle, not in a newly occupied current position.
4. Verify each entry against the fixture: occupied wallet, activation ID, recipient cycle, mirror flag and liquid/escrow split. Also verify the recycled source remains empty in its next cycle and its closing payment remains in the prior history.
5. Confirm production services are healthy on chain 137, realtime capture remains enabled on the worker, polling remains disabled and the suspended staging services remain suspended. Check the public main-site views after their existing cache expires.

The completed checks below resolve this display issue in production for the nine audited entries. They do not certify later transactions or scenarios absent from the audited window.

## Completed production verification

Code was pushed to `SimonFrancisDev/fin-freedom-backend` branch `main`, without force-pushing or including unrelated local files. Both deployments were pinned to commit `61993cae3c45f55dcfdcc34abbc19e2f329f79d1`.

| Service | Service ID | Deployment ID | Live at UTC |
| --- | --- | --- | --- |
| Production API | srv-d7eeof8sfn5c738thl60 | dep-dbvgeqrm8hqs739tqe80 | 19 November 2026 14:28:25 |
| Production worker | srv-d7eit4favr4c73c08t8g | dep-dbvgerec6qcc73b75v80 | 19 November 2026 14:28:32 |

- All 27 live orbit-view comparisons passed: nine entries across current level, position details and cycle history. None required skipping a changed current cycle.
- All 15 distinct original payout records across the seven affected activations still match the saved chain evidence, including recipients, coordinates, amounts, transaction hashes and log indices.
- The recycled source's current level and position detail are empty in cycle 2. Its cycle-1 history retains activation 1192 and the outgoing receipt, with zero earnings credited to the recycling source. These three additional checks passed.
- Both production health endpoints returned HTTP 200 with database ready state 1. Full sorted environment fingerprints match before and after: all 114 API variables and 115 worker variables are unchanged, including secrets, database URI and contract settings. Both chain IDs remain 137.
- The worker reported `REALTIME_EVENT_INDEXER_CONNECTED` and `REALTIME_EVENT_INDEXER_STARTED` with 75 listeners at 14:29:23 UTC. It also reported `Polling indexer not started in this process.` Both polling flags remain false.
- Staging API `srv-d8h37kj7uimc73cg3750` and staging worker `srv-d8h3bptdt1ts73fuc7eg` remain suspended.
- The public main site returned HTTP 200 and still serves `/assets/index-CcGRg5lU.js`, the previously verified production entry bundle. That bundle still references `https://fin-freedom-backend-3.onrender.com`. No Vercel deployment or environment update was performed.

Detailed evidence is stored locally in `tmp/orbit-receipt-rollout-2026-11-19`: `release.json`, `deployments.json`, `before.json`, `after.json`, `live-verification.json`, `source-and-site-verification.json`, individual API responses and filtered worker logs. Environment evidence contains fingerprints and key names, not secret values.

## Separate open catch-up issue

Worker startup attempted its existing historical recovery and reported `PARSE_LOG_EMPTY` for registration transaction `0xf60d906cc61369abb59881abf3ebb98cf37dbf1b999e8812347ad7af5d0ceff4`, block 97368395, log index 2062. A read-only mainnet receipt check confirmed the emitting address is registration proxy `0x02ECA97e944Ac66b0444fd5F61A716917E83CfF5`.

The log's topic matches `HistoricalMatrixParentRepaired(address,uint8,address,address,bytes32)` in `Id1RegistrationRepairMigrator`, from `contracts/migration/Id1HistoricalRepair.sol`. The ordinary registration decoder does not recognize this historical repair event. The audit snapshot taken before this deployment already recorded an unresolved registration checkpoint range of 97368362-97368461; startup encountered the event again. This is not an RPC outage or evidence of a failed payout.

Realtime subscription startup and the receipt correction passed, but the registration historical catch-up cannot be called healthy while it is blocked on this log. No decoder changes or manual checkpoint advancement were made in this rollout. The next separate correction must recognize the reviewed structural event, test that it cannot produce a registration or payment, and verify bounded recovery through the blocked range. Do not blindly ignore unknown events, advance the checkpoint past them, enable polling or reset the database.

## Rollback boundary

If rollout validation fails, stop promotion and retain the failed API response and deployment identifier. A backend rollback does not roll back smart contracts or payouts. Reverting code alone may leave newer cached snapshots in the database, so any cache repair must be limited to the affected derived snapshots and reviewed separately. Never delete indexed events, payment receipts or user records to reverse a display correction.
