# Deployment and operations

## 1. Apply the database migration

Use the **single shared Supabase project now configured for Preview and Production**. Back up the database first. Open SQL Editor and run the complete contents of:

`supabase/migrations/202611040001_store_payments.sql`

Run it once, in full. It is wrapped in a transaction. It creates the order/event/session/recovery/rate-limit/outbox tables and transactional functions. Existing product rows are preserved; it does not publish products or upload buyer files. New private tables deny anonymous and authenticated client access; only the backend service role can operate them. Existing `products` must have the columns listed in the migration; if SQL Editor reports an existing-schema mismatch, stop and inspect the schema rather than deleting or recreating products.

Environment variables alone cannot apply SQL migrations. No direct SQL connection or Supabase management connector was available during implementation, so the remote migration has not been executed by the agent.

## 2. Configure Vercel environments

The Supabase keys were checked through Vercel metadata and are now assigned to **both Production and Preview**. Values were not decrypted. The existing project uses Node 24. Its metadata also indicates deployment authentication on non-custom-domain URLs; verify that the chosen callback and webhook URLs are reachable by customers and Paystack. Do not globally disable protection to solve a route-specific access issue.

| Variable | Production | Preview/development |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Shared project, server-only | Same shared project, server-only |
| `PAYSTACK_MODE` | `test` for acceptance; then `live` for launch | `test` only |
| `PAYSTACK_SECRET_KEY` | Key matching the mode | Test key only |
| `SITE_URL` | `https://www.bgmsolutions.site` (canonical origin, no path) | Canonical test deployment origin; localhost allowed only locally |
| `DELIVERY_SECRET` | Random secret of at least 32 characters | A different random secret |
| `CRON_SECRET` | Strong random worker bearer secret | A different worker secret if scheduling tests |
| `PAYSTACK_CURRENCIES` | `NGN` initially | `NGN` initially |
| `PAYSTACK_WEBHOOK_MODE` | `legacy` or `modern`, according to dashboard | According to test dashboard |
| `PAYSTACK_WEBHOOK_SECRETS` | Comma-separated current/overlap `whsec_` secrets for modern mode | Separate test secrets if modern |
| `BLOB_STORE_ID` | Existing connected private store with Vercel OIDC | Existing private store; use test files |
| `BLOB_READ_WRITE_TOKEN` | Optional fallback if not using connected OIDC | Needed locally unless local OIDC is configured |
| `CHECKOUT_ENABLED` | `false` until acceptance checks pass | `true` only in a configured test environment |
| `EMAIL_ENABLED` | **`false` while Resend is paused** | `false` unless explicitly testing email |

Environment metadata inspected on 8 November 2026 showed Production `PAYSTACK_MODE=live` and `CHECKOUT_ENABLED=true`. Preview showed `PAYSTACK_MODE=test`, `CHECKOUT_ENABLED=false`, and no Preview `PAYSTACK_SECRET_KEY`. No secret values were decrypted. Configure a test key through Vercel's secure environment settings and enable Preview checkout before attempting a provider sandbox transaction; do not change Production mode for a test.

Email is optional. Do not add Resend credentials now. Later, if requested, configure `RESEND_API_KEY` and a verified `EMAIL_FROM`, then set `EMAIL_ENABLED=true`. Paused receipt tasks remain stored without email-provider calls; their access-token age begins on their first email processing attempt. Already-issued links expire after seven days. Invalid, expired or exhausted tasks require operator review.

Do not expose secrets through frontend environment prefixes or commit `.env.local`. Updating environment variables requires a redeployment. Keep test and live signing keys distinct even though their orders share a database.

Production session requests validate the browser Origin against `SITE_URL`. Keep it on the custom domain above; an old `vercel.app` value rejects checkout with HTTP 403 and sends payment callbacks to the wrong host. To repair production, update that project's Production `SITE_URL` value, then deploy the reviewed `main` commit; changing the setting without redeploying does not update running functions.

## 3. Deploy the implementation

Vercel's project root is this repository. Framework preset: Other. The checked-in config sets `npm run build`, output `public`, and Node function deadlines. Commit/push or deploy the reviewed source to a test deployment first. A redeployment made before these local source changes are pushed still runs the previous implementation.

The build includes a strict script policy; all browser JavaScript is external. WhatsApp contact is `https://wa.me/2349031921294` with prefilled general enquiry text, including a floating link on the storefront and purchase-support links. Visitors choose whether to send a message; the app sends no automatic WhatsApp messages.

## 4. Schedule durable payment work

`GET /api/process-payments` requires `Authorization: Bearer <CRON_SECRET>`. It processes authenticated events, reconciles old unresolved orders, and, only when enabled, processes email tasks. It uses leased database claims and bounded batches, so overlapping calls are safe.

A five-minute GitHub Actions workflow is included and is **disabled until configured**. In the repository's Actions settings set:

- Repository variable `STORE_WORKER_ENABLED=true`.
- Repository variable `STORE_URL` to the canonical production store origin.
- Repository secret `STORE_CRON_SECRET` to the matching Vercel `CRON_SECRET`.

Then run “Process payment inbox and emails” manually once. Enable Actions for the repository if necessary. GitHub schedules can be delayed or disabled on inactive repositories; they are not a hard real-time guarantee. An existing authenticated scheduler can call the same endpoint every one to five minutes instead. No paid Vercel cron schedule is provisioned automatically. A shared database does not mean one worker handles both modes: use a test endpoint/test worker for test orders and the live endpoint/live worker for live orders.

The callback can confirm purchases immediately even before the next worker run. The worker is necessary for independent confirmation if the browser never returns. Do not enable production checkout without a working scheduler.

## 5. Publish only deliverable products

Use Supabase `products`; do not edit static browser prices or legacy `_products.js` to activate checkout.

Required fields: stable slug `id`, name, category, short, description, string-array features, integer-subunit `amounts` (for example `{"NGN":750000}`), `status='published'`, `delivery_ready=true`, and nonempty `blob_pathnames` containing private asset paths.

Upload ZIPs into the connected **private** store and use actual pathnames, not temporary URLs. Use immutable/versioned paths such as `guide/v1/buyer.zip`; never overwrite or delete an asset still referenced by orders. New checkout checks every asset exists, is nonempty and has a private storage URL. Bundles store all their paths and expose each authorized file separately.

Only currencies in both product amounts and `PAYSTACK_CURRENCIES` appear at checkout. Do not enable USD until the account is approved for it. Catalogue publication is shared across Preview and Production; coordinate changes accordingly. Unpublishing stops new sales while existing paid-order access stays available.

## 6. Configure and test Paystack

Webhook: `https://YOUR-STORE/api/paystack-webhook`. Callback: `https://YOUR-STORE/payment-success.html`, supplied by initialization.

Use the documented signing mode that your Paystack account actually emits. Legacy mode checks `x-paystack-signature` using the API secret. Modern mode checks timestamped `Paystack-Signature` using dedicated signing secrets, with five-minute tolerance and rotation support. Modern mode never falls back to a legacy signature after a failed modern check. The Node handler reads original bytes without invoking Vercel's lazy JSON body getter.

In test mode verify:

1. One product's exact amount/currency, hosted checkout and callback.
2. Stored order becomes paid once, and every private file downloads.
3. Close the browser before returning; webhook and worker still record the paid order.
4. Duplicate webhook/callback requests do not create duplicate orders or receipt tasks.
5. Reload confirmation after ten minutes to refresh download links in the same browser.
6. With email paused, recovery explains WhatsApp support. Verify the operator access link works once on another browser.
7. Failed/pending/invalid references, bad signature and unauthorized worker requests are rejected safely.
8. Refund/dispute handling suspends access; resolution requires manual review before restoring it.
9. Largest ZIP downloads successfully within actual function/transfer limits.
10. Preview test purchases cannot be verified or downloaded through the live environment.

Only then switch Production to matching live key/mode, redeploy and make one small authorized live purchase yourself. Test keys, provider stubs and a passing local test suite do not prove live account readiness.

## Support and troubleshooting

| Symptom | Action |
| --- | --- |
| Catalogue outage notice | Check Supabase environment scope, migration/schema and API logs. |
| Checkout unavailable | Check `CHECKOUT_ENABLED`, key/mode, canonical URL, delivery secret, Blob auth and worker secret. Email credentials are not required when paused. |
| Initialization remains unresolved | Preserve the reference; inspect Paystack before retrying or creating a new purchase. There is one initialization claim per order to prevent blind retry after an ambiguous provider timeout. If Paystack created checkout but saving its URL failed, recover that URL from provider/dashboard evidence and update only that pending order. A definitive rejection can be reset by an operator after confirming no provider transaction exists. |
| Paid customer lost browser access | Verify the buyer using checkout identity/provider records, then run `scripts/support-access.js`; send the resulting one-time link privately. Reference knowledge alone is not identity proof. |
| Old reference predates migration | Use the verified legacy import script described in README, then operator support access. Unknown historical prices require manual review. |
| Download denied after refund/dispute | Inspect `revoked_at` and `revocation_reason`; resolve the dispute before any deliberate access restoration. |
| Webhook not received | Check public reachability, correct mode URL, signing configuration and Paystack delivery logs. |
| Inbox tasks stuck or under review | Check scheduler runs, `last_error`, attempts and provider availability. Review unknown references instead of granting access automatically. |

Monitor private order/event tables for old pending orders, `state='review'`, revoked orders and worker errors. Order reconciliation backs off and stops after 100 attempts; investigate remaining old pending orders manually. Transient inbox/email failures back off; the twelfth failure moves work to review. API errors return safe incident identifiers and never log complete transaction objects, buyer emails, credentials or download URLs.

For rollback set `CHECKOUT_ENABLED=false` and redeploy. Keep webhook intake, scheduled processing and access to already-paid orders running. Do not drop the new tables or revert paid-order authorization to the mutable catalogue.

## Verification evidence and remaining boundary

Local syntax, build, database and flow tests pass. Provider calls in the integration test are synthetic; no charge or outbound email was performed. The browser automation host was unavailable, so visual screenshots could not be collected. DOM behavior, API handling and the complete SQL-backed lifecycle were tested programmatically.

The Campus Excel production release is deployed; the owner confirmed one real production purchase and file download on 8 November 2026. This confirmation was not independently matched to the provider or database records in this session. Preview provider acceptance remains pending because its test checkout is disabled and no Preview Paystack secret is configured. Other historical storefront deployment/database checks in this guide may also be superseded by later release records; consult `docs/IMPLEMENTATION_STATUS.md` for the current Campus Excel release evidence.

References: [Paystack verification](https://paystack.com/docs/payments/verify-payments/), [webhook signatures](https://paystack.com/docs/payments/webhooks/), [Vercel Node request bodies](https://vercel.com/docs/functions/runtimes/node-js), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [Supabase database functions](https://supabase.com/docs/guides/database/functions).
