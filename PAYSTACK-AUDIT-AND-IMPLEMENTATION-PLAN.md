# Paystack audit and implementation plan

Audited: 4 November 2026. Repository revision: `4dba35c`.

## Verdict and scope

The integration has a sensible foundation, but checkout is currently blocked by code and the payment-to-delivery lifecycle is incomplete. Keep the static frontend, Vercel functions, Supabase and private Blob architecture. A framework rewrite or payment-provider replacement is unnecessary.

Reviewed all tracked application, API, configuration and documentation files, the catalogue migration commits, and current official Paystack documentation. Executed isolated Node probes with synthetic credentials and mocked network responses. No payment was initiated, no deployment changed, and no real credentials were accessed. This report is the only added file.

Live Vercel configuration, Supabase schema/data/RLS, actual Blob files and credentials, Paystack account activation/currencies, dashboard webhook configuration and historical transaction logs were not available in this checkout. These remain deployment checks, not proven failures. No database migrations, automated test suite, lockfile, local environment template or CI configuration are tracked.

## Current flow

1. `index.html` loads `products.js`, then `catalog-loader.js`.
2. The loader fetches `/api/catalog`, keeps locally defined enquiry services, and starts `app.js`.
3. `/api/catalog` uses Supabase published products through `api/_catalog.js`. Missing database configuration returns an empty product list; failures return 503. The frontend then shows services only.
4. Checkout posts email, product ID and currency to `/api/initialize-payment`.
5. Initialization reads `api/_products.js`, not Supabase; every one of its seven products has `enabled: false`. All seven are rejected before the Paystack call.
6. If enabled, initialization redirects to Paystack hosted checkout with product metadata and a callback URL.
7. The callback page verifies once, issues a ten-minute delivery token and renders one or several file links.
8. Each file download re-verifies with Paystack and streams a private Blob.
9. The webhook validates a legacy signature but its successful-payment branch contains only a TODO. No durable order or entitlement is created.

## What is right

| Strength | Evidence and value |
| --- | --- |
| Hosted checkout | `app.js` redirects to a server-obtained authorization URL; the site never collects card numbers. |
| Server-controlled price | `initialize-payment.js` chooses integer subunit amounts from the server catalogue; browser prices cannot change the charge. |
| Server verification | `_paystack.js` checks HTTP/API success, transaction success and exact amount for a known currency/product. |
| Private delivery | `download.js` retrieves private storage server-side without returning permanent Blob URLs. Its `get()` result/stream handling matches the current documented interface in principle; installed-version behavior still requires testing. |
| Expiring signed tokens | `_delivery-token.js` uses HMAC-SHA256, constant-time comparison with a length check, and an expiry check. |
| File selection restriction | Downloads select an integer index from a server-controlled list instead of accepting arbitrary storage paths. |
| Bundle support | Verification produces multiple links and downloads validate each file index. The deployment guide incorrectly says only the first file is supported. |
| Fail-closed catalogue | A failed catalogue request does not expose stale static Buy buttons. Preserve this property while showing a clear outage message. |
| Frontend safeguards | Email validation, disabled submission while waiting, and DOM text for callback messages are useful foundations. |

## Findings, ranked

| Priority | Finding and evidence | Impact / required response |
| --- | --- | --- |
| P0 | Split catalogue: `_catalog.js` serves Supabase products, while initialization, verification, webhook and download import `_products.js`. Its `getProduct()` helper is unused by payments. | A visible Buy button can lead to rejection or incompatible prices/files. Use one authoritative catalogue for new orders and an immutable order snapshot for paid purchases. |
| P0 | All seven server products are disabled. Confirmed by directly invoking initialization for each ID: all return 400 `Product is not available.` with zero fetch calls. | Current checkout cannot initialize for these products. Do not simply enable everything; validate files, amounts and environments first. |
| P0 | Webhook success branch only contains a persistence/fulfillment TODO and still returns 200. | Payments are acknowledged without an order record or independent delivery. Closing the browser can leave a buyer without access or recovery. Persist authenticated events and process them reliably. |
| P1 | No durable order, payment-attempt, entitlement or fulfillment data exists in the repository. | No reliable reconciliation, concurrency protection, recovery, audit trail or refund revocation. Introduce database constraints and atomic transitions. |
| P1 | Webhook hashes a string or `JSON.stringify(req.body)` rather than guaranteed original bytes; Buffer bodies are also mishandled. | Parsing/reserializing can change the signed representation. Capture raw bytes using a runtime-supported approach and test it in a deployed function. |
| P1 | Webhook calls `timingSafeEqual` without checking signature length. A short signature reproducibly throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`. JSON parsing is also unguarded. | Bad requests can produce function failures. Validate header format/length, payload size and JSON shape; reject safely. |
| P1 | Webhook supports only legacy `x-paystack-signature`. Current Paystack docs also describe timestamped `Paystack-Signature` with a dedicated `whsec_` secret. | Check the account's actual signing mode; implement the documented mode, rotation and replay checks. Keep legacy compatibility only for an explicit migration window. Do not silently fall back after an invalid modern signature. |
| P1 | Verification compares payment against today's hardcoded product amount and files, with no checkout snapshot. | Price changes can invalidate old purchases; changing file order/path can change an existing token's file. Snapshot purchased price and versioned asset IDs. |
| P1 | `_paystack.js` has no exact requested/returned reference comparison, expected test/live domain check, or order binding. A mocked mismatched response is accepted. | Add defense-in-depth matching against a stored payment attempt. This probe demonstrates missing validation, not evidence that Paystack returns arbitrary mismatches. |
| P1 | Anyone holding a successful reference can call verification and obtain fresh links plus the buyer email. Email inside the signed token does not authenticate the requesting person. | The reference effectively becomes a renewable bearer credential. Introduce a checkout session and email-based recovery; avoid returning full email to an unauthenticated caller. |
| P1 | No `Cache-Control: no-store` on the verification response containing tokens/email. Download responses already have it. | Set explicit no-store on sensitive payment/status responses, add referrer protection, and redact references/tokens from logs where practical. |
| P1 | No recovery email, persistent purchase page or reconciliation process; callback verification happens once. | Pending, interrupted or delayed confirmations look like failures. Provide pending/retry states and recovery that does not depend on a browser callback. |
| P2 | Checkout always offers NGN and USD; the collections product has only NGN and public catalogue exposes no structured currency amounts. | Select currencies from validated product prices intersected with actual account support. USD capability is unverified; launch NGN first unless confirmed. |
| P2 | Initialization checks `deliveryReady` but not a nonempty validated asset list or actual asset availability. | Products can accept money with unusable delivery. Gate publication on preflight checks and monitor storage separately. |
| P2 | Paystack and database fetches lack explicit deadlines and bounded failure handling; no initiation idempotency or rate limits. | Hanging requests, repeated attempts and API amplification are possible. Add timeouts, request validation, durable attempt IDs and abuse controls. Avoid blind initialization retries. |
| P2 | Callback URL falls back to `req.headers.host` when `SITE_URL` is absent. | Require a validated environment-specific canonical HTTPS origin in deployed environments. Test and production must not redirect into each other's store. |
| P2 | Frontend discards useful backend errors; catalogue outage looks like an empty store. | Return safe error codes/messages and render actionable states with a support reference. |
| P2 | Dynamic product IDs are inserted into inline JavaScript handlers after HTML escaping; categories are inserted as raw HTML. | HTML escaping does not make inline JavaScript safe after entity decoding. Use event listeners/data attributes, DOM text and validated URLs for dynamic catalogue content. Treat database/admin content as a trust boundary. |
| P2 | Stream piping has no stream error/client-abort handling. Token parser accepts extra dot segments and loosely validates claims. | Use a supported pipeline with abort/error handling, strict token structure/claims and maximum TTL. These are hardening items; there is no demonstrated signature bypass. |
| P2 | No refund/dispute entitlement lifecycle. | A verified historical success alone cannot express whether access should now be revoked. Store revocations and define the refund/dispute policy before launch. |
| P2 | No tracked tests/scripts, lockfile, runtime declaration, CI, `.gitignore` or environment example. | Builds and releases are difficult to reproduce and configuration can be mishandled. Add a small, explicit verification workflow. No committed secret was observed in current tracked source; repository history was not exhaustively secret-scanned. |
| P2 | README and deployment guide describe outdated activation state, static hosting and external delivery. | GitHub Pages alone cannot run these APIs. Replace instructions with the implemented Vercel/Supabase/private Blob workflow. |

Disabled publication should prevent new sales; it should not automatically revoke a legitimate existing buyer. Preserve that distinction when changing the verifier. Similarly, duplicate download requests are legitimate; enforce exactly one entitlement per paid order rather than exactly one file download ever.

## Recommended architecture

Keep the current small application. Use Supabase Postgres for catalogue, orders and durable processing; retain Vercel functions for the public API and private Blob for assets. Add transactional email for receipts/recovery only when fulfillment is ready. A new queue vendor, user-account system or framework is not required for the initial release.

```text
Store -> published catalogue -> checkout session + pending order snapshot
      -> durable payment attempt/reference -> Paystack initialize -> hosted checkout

Paystack webhook -> raw-byte authentication -> durable event inbox -> shared confirmation service
Browser callback -> session-protected status/verify -----------> shared confirmation service
Scheduled reconciliation of unresolved attempts -------------> shared confirmation service

Confirmation -> atomic paid transition + unique entitlement + email outbox
Entitlement -> short-lived asset-scoped token -> private file delivery
Email recovery -> verified buyer access -> same entitlement
```

The database owns payment/entitlement state. Paystack owns provider payment truth. Catalogue changes govern future orders; stored order/asset snapshots govern existing purchases. Storage configuration remains server-only.

## Implementation sequence and acceptance gates

### Phase 0 — establish the deployment baseline

1. Inventory Vercel runtime, framework/output settings, actual deployed commit, environments and protection rules. Ensure callback/webhook routes are publicly reachable by Paystack without exposing administration.
2. Check secret presence and environment assignments without logging values: Paystack secret, canonical `SITE_URL`, delivery signing secret, Supabase URL/service role and supported Blob credentials. Add a webhook signing secret if the dashboard uses the modern mode.
3. Inspect Supabase schema, published product rows, RLS and asset mappings. Compare them with all seven legacy IDs. Service-role credentials bypass RLS, so public API field selection and server authorization remain essential.
4. Verify actual private ZIP existence, filenames, sizes and successful streaming under the deployed SDK/runtime. Confirm installed package support for the configured Blob authentication method; do not assume current docs apply to the declared 2.x dependency.
5. Check Paystack account activation, available currencies, test/live webhook settings and failed-event logs. Reconcile any historical paid references before changing their product mapping.

Gate: a written environment/product readiness matrix and known-good test configuration. Keep unvalidated products unpublished.

### Phase 1 — unify catalogue and establish order storage

Files: `api/_catalog.js`, `api/catalog.js`, payment handlers, new database migrations and server modules.

1. Make Supabase authoritative for purchasable products; remove silent legacy fallback from production payment paths. Keep static enquiry services separately. Retain an explicit legacy mapping only for historical-order migration.
2. Define published product validation: stable ID, positive safe-integer subunit amounts, supported currency, valid ready assets. Return public fields plus structured prices/currencies, never private paths or credentials.
3. Add these tables with migrations, foreign keys, indexes and private access policies:

| Table | Essential fields and constraints |
| --- | --- |
| `orders` | ID, buyer email, selected currency/amount, product/name/version snapshot, status, creation/payment timestamps, session-token hash, environment |
| `order_assets` | Order ID, immutable asset/version ID, private path snapshot, display filename; unique order/asset pair |
| `payment_attempts` | Order ID, provider, unique reference, provider transaction ID, expected environment, initialization/result state, authorization URL and timestamps; unique provider/environment/transaction ID when known |
| `payment_events` | Authenticated event identity/deduplication key, reference, payload or restricted relevant fields, received/processed timestamps, processing state/error and retry count |
| `entitlements` | Unique order ID, granted/revoked state, grant/revoke timestamps and reason |
| `email_outbox` | Unique order/message-type key, delivery status, next retry and attempts |

4. Implement database transactions/RPC for paid transitions and entitlement/outbox insertion. Plain independent REST writes are insufficient for atomic fulfillment.
5. Separate payment state from fulfillment and refund/dispute state; success cannot be downgraded by a late failed/pending event. Refund/revocation is an explicit subsequent transition.

Gate: changing a catalogue price, publication flag or asset list cannot invalidate or alter a stored paid order. Concurrent confirmation creates one entitlement and one receipt task.

### Phase 2 — reliable initialization

Files: `api/initialize-payment.js`, shared Paystack client, `app.js`, `index.html`.

1. Validate bounded scalar email/product/currency inputs with own-property-safe catalogue lookup. Select supported currencies server-side. Require configured canonical callback origin.
2. Create a secure checkout session and an immutable pending order before contacting Paystack. Generate a random server reference and persist the attempt first; use allowed Paystack reference characters.
3. Bind order and attempt IDs in server-generated metadata. Submit the snapshot amount/currency and explicit reference. Check returned URL/reference shape and expected HTTPS checkout host.
4. Use a client idempotency key scoped to the checkout session, protected by a unique database constraint. Repeated submits reuse the recorded attempt/URL. On initialization timeout, resolve the existing attempt before creating another reference; do not assume the provider request failed.
5. Add explicit request deadlines and safe upstream error mapping. Log correlation IDs and provider status without secrets, token URLs or complete customer/payment objects.
6. Render product-specific currency choices, clear pending/error states, and safe server messages. Guard responses arriving after a modal closes or a different product opens. Replace inline dynamic handlers.

Gate: amount tampering has no effect; unavailable currencies/products fail before provider calls; repeat submission does not silently create a second order/attempt.

### Phase 3 — shared confirmation, authenticated webhooks and reconciliation

Files: `api/_paystack.js`, `api/paystack-webhook.js`, `api/verify-payment.js`, new confirmation/inbox processing modules.

1. Centralize confirmation for callback, webhook and scheduled recovery. Resolve a known attempt and verify provider success, exact reference, currency, snapshot amount, expected environment and order identity. Match buyer email against the order according to a documented normalization rule.
2. Capture exact raw webhook bytes before parsing using the deployed Vercel runtime's supported mechanism. Validate size, content type, signature header format and length. Handle malformed JSON without uncaught errors.
3. Implement the active signature mode from the dashboard. Modern mode requires timestamp tolerance, dedicated signing secret and rotation support; legacy mode requires raw-body HMAC with the API secret. Add explicit migration configuration.
4. Persist authenticated events into a deduplicated inbox before acknowledging. Return 200 for already recorded duplicates and irrelevant valid events; return a retryable error if durable storage fails. A unique business key must suppress duplicate fulfillment even if delivery signatures/timestamps change.
5. Process the inbox through a durable scheduled worker or equivalent. Do not rely on unawaited work after a Vercel response. Provider verification failure leaves the event retryable; exhausted retries become visible to support.
6. Add bounded reconciliation for old initializing/pending attempts with backoff, pagination and a manual review path. Protect scheduler access; retry transient failures without rewriting paid history.
7. Normalize pending/failed/abandoned/not-found/upstream-unavailable states. Add no-store headers to sensitive responses. Implement refund/dispute recording and entitlement revocation rules.

Gate: webhook-first, callback-first, simultaneous and repeated confirmations produce the same paid order and single entitlement. A buyer receives access even if their browser never returns. Invalid signatures never mutate state.

### Phase 4 — delivery and purchase recovery

Files: `api/_delivery-token.js`, `api/download.js`, `payment-success.html`, new recovery/email endpoints.

1. Protect order status/access with the original secure checkout session (HttpOnly, Secure and appropriate SameSite cookie) and a buyer email magic-link recovery path. Do not use reference knowledge as unlimited identity proof.
2. Make email recovery rate limited and non-enumerating. Store only a hash of the random recovery credential, enforce expiry and single-use exchange, then establish a session.
3. Issue strict versioned delivery claims: order/entitlement ID, immutable asset ID, issued-at/expiry and signing-key ID where needed. Reject extra token segments, invalid types, oversized tokens and unreasonable TTLs. Tokens are signed, not encrypted; avoid embedding email.
4. Validate entitlement/revocation in the database on download, then stream the order's authorized asset. A Paystack API call on every file is unnecessary after durable confirmation; this reduces provider dependence and latency. Scheduled reconciliation and refund events maintain state.
5. Add stream error/abort handling, no-store and referrer controls. Measure largest ZIP delivery against actual deployment duration/transfer constraints. Introduce supported short-lived private storage URLs only if measurements justify it and the installed SDK supports them.
6. Callback UI shows confirming/pending/paid/temporarily unavailable states, a retry control and email recovery/support instructions. Keep retries bounded and avoid telling a paid buyer to pay again.
7. Send receipts/recovery through the durable outbox. Email failure retries independently and cannot revoke a paid entitlement. Display bundle files with stable names.

Gate: expired or changed tokens fail, all bundle files download, revoked orders are denied, interrupted callbacks recover, and temporary Paystack outage does not block an already entitled buyer.

### Phase 5 — repeatable validation and controlled release

1. Add `.gitignore`, secret-free `.env.example`, runtime declaration, package lock, scripts for syntax/unit/integration checks and CI. Use Node's built-in test runner unless a broader tool is demonstrably needed.
2. Replace stale README/deployment instructions with environment setup, migrations, product publication, signing mode, recovery, troubleshooting and rollback procedures.
3. Deploy isolated test resources and test keys. Exercise the real Vercel parsing/signature boundary and real private Blob delivery, not only mocked handlers.
4. Run the matrix below. Publish one verified NGN product first; expand to bundle and USD only after their own checks pass.
5. After test acceptance, configure live resources and make one small authorized live smoke purchase. Check provider amount/currency, database state, webhook, email and download. Never run an automated live charge as part of CI.
6. Monitor initialization success, pending age, confirmation mismatch, inbox backlog, email retry age and download failures. Alert on paid orders lacking entitlements; keep PII retention/access restricted.
7. Rollback by disabling new checkout while preserving paid-order access and webhook intake. Keep schema migrations backward compatible; avoid switching fulfillment back to a mutable catalogue.

## Required validation matrix

| Area | Cases / expected outcome |
| --- | --- |
| Catalogue | Published/draft/missing, database outage, malformed prices/assets; public and checkout eligibility agree, outages are visible and fail closed. |
| Initialization | Every product/currency, altered price, invalid body, duplicate submission, provider 4xx/5xx/timeout and invalid response; no false success or duplicate silent purchase. |
| Confirmation | Correct success, pending/failed/abandoned, wrong amount/currency/reference/domain/order/customer, malformed metadata and unknown attempt; only exact legitimate orders gain entitlement. |
| Webhooks | Raw whitespace/escapes/Buffer, absent/short/nonhex signature, malformed JSON, modern timestamp/rotation, duplicate/reordered events and DB outage; safe rejection or durable processing with correct retry behavior. |
| Concurrency | Webhook/callback/worker races; one paid transition, entitlement and receipt task under database constraints. |
| Historical purchases | Catalogue reprice/unpublish, asset changes, removed legacy product; purchased version remains accessible unless explicitly revoked. |
| Delivery | Single product/all bundle indices, unknown asset, expired/tampered token, excessive TTL, stream error, missing Blob, large ZIP, client disconnect and revoked order. |
| Recovery/privacy | Closed browser, new device, lost session, email retry, brute-force throttling, non-enumerating responses, no full buyer email/tokens in public logs or cached status responses. |
| Deployment | Real test callback/webhook reaches correct environment, SDK/auth compatibility, no preview-to-production redirect or test purchase granting live access. |

## Local verification performed

- All API files and standalone frontend JavaScript parsed successfully under locally installed Node v26.13.0. This is not proof of the Vercel runtime version.
- All seven hardcoded product initialization requests returned the same availability error before any external call.
- A three-character webhook signature threw the expected length exception.
- A correctly legacy-signed synthetic success event returned 200; inspection confirms the fulfillment branch performs no persistence.
- A mocked successful verification with a different returned reference was accepted, demonstrating absent equality validation.
- Working tree was clean before this report. No production application files were edited.

## Completion criteria

Implementation is complete when the store sells only deliverable published products, preserves the exact purchased price/assets, confirms every payment through a durable and idempotent process, supports recovery without the original callback, denies invalid/revoked delivery, and passes both automated failure/concurrency tests and deployed test-mode checkout-to-file validation. Production readiness also requires verified dashboard/environment configuration and a controlled live smoke purchase.

## Official references checked

- [Paystack: Accept Payments](https://paystack.com/docs/payments/accept-payments/) — hosted initialization, subunit amounts and server confirmation.
- [Paystack: Verify Payments](https://paystack.com/docs/payments/verify-payments/) — verification and avoiding duplicate delivery.
- [Paystack: Webhooks](https://paystack.com/docs/payments/webhooks/) — delivery retries, raw bytes, modern and legacy signatures, rotation and timestamp tolerance. Check the account's actual signing mode before migration.
- [Paystack: Transaction API](https://paystack.com/docs/api/transaction/) — initialization and verification contracts.
- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk) — private retrieval result shape and authentication; validate against the resolved installed SDK version.
