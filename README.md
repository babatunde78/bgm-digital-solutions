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

For a read-only design preview without private credentials, run `npm run dev -- --preview-catalogue`. This reads the public production catalogue, disables all purchase buttons and rejects payment initialization. It does not copy private assets or customer data.

The storefront includes shareable `product.html?id=PRODUCT_ID` pages and `support.html` with the seven-day digital-product refund policy. Published database prices remain authoritative for checkout. USD references in `app.js` use the existing guide display values and the owner-supplied US$40.75 reference for the university toolkit. They do not enable USD payments or guarantee the card issuer's exchange rate.

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

`POST /api/sync-products` accepts `{"ids":["ai-side-hustles", "remote-job-2026-2027"]}` with the operator bearer credential. It imports known definitions from `lib/product-import.json`, validates all private files before writing, and preserves existing rows, prices and draft decisions. Definitions default to published for the existing products; an explicit `draft` stays unpublished. Campus Excel entries are drafts, use first-year NGN amounts from `lib/campus-prices.json`, and remain unavailable until commercial acceptance and an authorised catalogue publication. Their USD references are calculated from the same dated price book and never enter checkout. Bundle files follow the currently mapped five guides. Supabase remains authoritative after import. Unknown ZIPs need an identified product, description and price before publication.

For the Campus pilot only, check the three release ZIPs with `node --env-file-if-exists=.env.local scripts/campus-upload-private.mjs --check-only`. After configuring the existing private store's `BLOB_READ_WRITE_TOKEN` in ignored `.env.local`, run the same command with `--upload`. It uploads only the three immutable versioned Campus ZIP paths, refuses overwrites and verifies private read-back checksums. This does not contact Supabase or publish products. Keep the token outside chat and source control. The definitions stay in draft pending the release gates in `docs/KNOWN_LIMITATIONS.md`.

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
