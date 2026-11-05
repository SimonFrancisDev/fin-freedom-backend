# Production NFT API balance recovery - 2026-11-04

## Confirmed cause

The production public summary returned currentBalance=null and balanceVerified=false.
At 07:02:45 UTC the API logs recorded EPROTO / TLS alert 80 for both NFT vaults
and Operations. Independent ethers requests reproduced EPROTO on both configured
HTTP RPC slots. Both referenced boldest-tame-waterfall.matic.quiknode.pro.
The provider-side cause of the TLS failure is unknown. This was a transport failure,
not evidence of missing funds or failed NFT payouts.

## Applied repair

- Production API: https://fin-freedom-backend-3.onrender.com
- Render service: srv-d7eeof8sfn5c738thl60.
- Updated only RPC_URL_1 and RPC_URL_2, via individual-key PUT requests, to the
  user-supplied sleek-floral-sunset.matic.quiknode.pro mainnet endpoint.
- Verified chain ID 137 and balances before updating. TLS validation remained enabled.
- Full before/after environment comparison: 114 keys before and after; only those
  two values changed. All other 112 settings, including database configuration,
  contract addresses, secrets, WebSocket settings and RUN_INDEXER=false, were equal.
- Redeployed the same production commit: 28f010a2afa7054c0054aae5e0d6e1286b128618.
- Deployment dep-dbldp9k9v7es739o4mjg became live at 07:20:51.848260 UTC.
- No application code or contract changes, wallet signing, payout execution,
  proposals, database reset, manual database mutations, or new polling.
- Production worker and suspended staging services were not changed or restarted.
- API WebSocket settings were not changed; the API does not run the indexer.

## Verification

Before repair, direct mainnet reads at block 96714059 returned 2621.52 USDT in
the shared NFT vault and zero in the legacy vault.

After repair, at 2026-11-04 07:44:28.843 UTC, the public API returned:

```json
{
  "totalInflow": "5133.44",
  "totalDistributed": "2511.92",
  "currentBalance": "2621.52",
  "balanceVerified": true
}
```

The API also returned operations=174.36 and operationsBalanceVerified=true.
The independent chain comparison below covers NFT balances, not a separate
Operations reconciliation.

Independent Polygon mainnet balanceOf reads at block 96715216:

| NFT vault | Raw USDT (six decimals) | USDT |
| --- | ---: | ---: |
| 0xbb2cf7ef867f46a93ae1f9ded564927874b79b52 | 2621520000 | 2621.52 |
| 0xf8f60da42681b73dfeca7731e78b29c8707c184b | 0 | 0.00 |

USDT contract: 0xc2132D05D31c914a87C6611C10748AEb04B58e8F.
Verdict: verified public API current NFT pool matches direct mainnet balances.
The amount was not hard-coded or inferred by subtraction.

## Follow-up verification - 2026-11-05

At 03:52:31.351 UTC, the production summary returned HTTP 200 with
totalInflow=5159.84, totalDistributed=2511.92, currentBalance=2647.92,
and balanceVerified=true. These supersede the older snapshot above; the
amounts are read dynamically, not fixed to yesterday's values.

At 03:53:01.518 UTC, independent reads explicitly verified chain ID 137 and
used the same mainnet block 96763550 for both vaults. The shared vault held
2647920000 raw USDT (2647.92 USDT); the legacy vault held zero. This matches
the public API's verified current pool balance exactly.

The first browser attempt could not start the locally bundled Chromium
headless executable within 30 seconds. The API and RPC checks succeeded
independently of that local tooling failure.

Installed Microsoft Edge completed the live production-page check at
03:55:16.333 UTC without connecting a wallet. The actual browser response
had balanceVerified=true. Rendered values were $5,159.84 accumulated and
$2,647.92 current pool, and both were asserted equal to their corresponding
API fields. No mocked data or local replacement page was used.

Screenshots were saved at mobile 390x844 and desktop 1440x1000 viewports:
- `_ui-verification/nft-pool/production-current-pool-repaired-mobile.png`
- `_ui-verification/nft-pool/production-current-pool-repaired-desktop.png`

Browser verdict: PASS. The local image-viewer sandbox could not open the
saved screenshots, so no separate image-inspection claim is made. The live
DOM, rendered numeric values, real network response, and screenshot capture
all passed in the browser run.

Repair complete: production API balance reads and live-page rendering are
verified. No further rollout, founder signature, or wallet funding is needed
for this display repair. This does not claim a new payout or full-system audit.

## Repository and rollout boundary

This documentation-only worktree starts from existing origin/main (02389ac).
It excludes the unrelated local-only d716894 commit and untracked operational
files. No new backend code was needed or deployed. Frontend commit 4ce80b6
already separates all-time accumulated, current pool, and distributed metrics.

Render API references:
- https://api-docs.render.com/reference/update-env-var
- https://api-docs.render.com/reference/create-deploy
