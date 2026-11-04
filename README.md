# BGM Digital Solutions

A lightweight storefront with Paystack hosted checkout, Supabase order storage and private Vercel Blob delivery. Business enquiries are available on [WhatsApp](https://wa.me/2349031921294) and email.

## Current delivery settings

Email delivery through Resend is **paused** (`EMAIL_ENABLED=false`). Customers download from their confirmation page in the original browser. Customers who need another device or lose their session contact WhatsApp support; the operator can issue a short-lived access link after verifying the purchase. No email credentials are required to run checkout in this mode.

One Supabase project is used for Preview and Production, as requested. Orders, idempotency keys, recovery exchanges and worker batches are separated by Paystack `test`/`live` environment. The product catalogue is shared. Preview must use test keys and `PAYSTACK_MODE=test`; it must never receive the live Paystack key.

## Run locally

Use Node 24 (matching the configured Vercel runtime).

```sh
npm ci
# Copy .env.example to .env.local, then enter development credentials privately.
npm run dev
```

Open `http://localhost:3000`. Without credentials, the storefront shows a catalogue outage notice and retains service enquiries and WhatsApp. The local server is a development adapter, not a production server. This application needs server functions; GitHub Pages alone cannot run checkout.

```sh
npm run check
npm test
npm run build
```

Tests execute the actual SQL migration in PGlite (PostgreSQL compiled to WASM), verify permissions and atomic transitions, exercise the API handlers and frontend DOM, and run checkout through refund revocation with synthetic providers. They do not charge Paystack, access customer records or send email. These are local integration checks, not deployed provider acceptance tests.

The build copies only approved browser assets into `public/`. Server libraries, SQL, tests, documentation and credentials are excluded from static hosting. Dependencies are locked; a narrowly scoped Zod override patches the upstream Blob authentication dependency. Review the override when updating the SDK.

## Application structure

| Location | Responsibility |
| --- | --- |
| `api/` | Small HTTP handlers for catalogue, sessions, checkout, verification, webhooks, delivery, recovery and scheduled work |
| `lib/` | Shared configuration, validation, database access, Paystack confirmation, storage and cryptographic tokens |
| `supabase/migrations/` | Database schema and server-only transactional functions |
| `app.js`, `purchase.js` | Store and confirmation/recovery interactions |
| `tests/` | Security, PostgreSQL, frontend and complete payment-flow tests |
| `scripts/` | Build/dev/check utilities and operator-only recovery tools |

Supabase `products` is authoritative for new purchases. Each order stores its original price, product name and private asset paths. Paid, non-revoked orders are the entitlement; a separate entitlement table is unnecessary for this one-product-per-order store. Each order has one unique payment reference. Receipt creation and the paid transition occur in one database transaction.

Callbacks and scheduled processing share one verification function. Webhooks validate original bytes and persist deduplicated event records before returning 200. Downloads check the stored entitlement and a ten-minute file-scoped signature, without depending on Paystack for every file request.

See [the deployment guide](SECURE-DELIVERY-DEPLOY.md) for the required migration, environment matrix, scheduler setup, publication checks and live acceptance test. The original [audit](PAYSTACK-AUDIT-AND-IMPLEMENTATION-PLAN.md) records the pre-implementation findings.

## Import existing uploaded products

The bearer-protected operator inventory is `GET /api/process-payments?check=inventory`. It lists private file metadata and current catalogue records without returning permanent Blob URLs. It is unavailable to visitors.

`POST /api/sync-products` accepts `{"ids":["ai-side-hustles", "remote-job-2026-2027"]}` with the operator bearer credential. It imports known definitions from `lib/product-import.json`, validates all private files before publishing, and preserves existing rows, prices and draft decisions. Bundle files follow the currently mapped five guides. The JSON definitions are an import source; Supabase remains authoritative after import. Unknown ZIPs need an identified product, description and price before publication.

## Operator recovery

After verifying the buyer's checkout identity and paid reference, an operator with private development credentials can create a one-time, one-hour access link:

```sh
node --env-file=.env.local scripts/support-access.js PAYMENT_REFERENCE
```

Treat the printed URL as a credential. Share it privately with the verified buyer; never put it in public logs, issues or screenshots. The script does not send WhatsApp or email messages.

Old purchases from before order storage require verified import first:

```sh
node --env-file=.env.local scripts/import-legacy-purchase.js PAYMENT_REFERENCE
```

The importer verifies status, reference, environment, historical amount/product mapping and private file existence. It starts no payment. Keep `api/_products.js` solely as the historical import mapping; no active checkout or download handler uses it. Prices that differ from that historical mapping require manual investigation rather than automatic import.
