# Offline desktop architecture and BGM integration

Version 0.1.1 Windows pilot and BGM integration, updated 10 November 2026.

## Repository and production findings

README.md (Application structure/Current delivery settings), SECURE-DELIVERY-DEPLOY.md sections 2, 5, 6, and PRODUCT_SPEC.md (Integrity contract/Connected controls) constrain this implementation. The CommonJS Node 24 storefront is hosted on the existing BGM Digital Solutions Vercel project. Supabase `products` is the price/publication authority. `lib/product-import.json` supplies guarded import definitions, not a replacement catalogue. Published Campus IDs are `campus-bursary-package-a`, `campus-bursary-package-b`, `campus-bursary-full-excel`; existing prices and files are preserved.

Actual integration readers inspected: `lib/catalog.js`, `lib/product-import.js`, `lib/orders.js`, `lib/tokens.js`, `api/verify-payment.js`, `api/download.js`, `lib/config.js`, build/dev allowlists and Vercel configuration. Paid non-revoked orders, with immutable product/price/private-file snapshots, are entitlements. Purchase authentication is the original browser session or operator-verified recovery exchange, not a general customer Supabase Auth login. File-scoped download tokens expire after ten minutes; delivery rechecks paid/revoked/environment status. Private files use Vercel Blob, not a new public Supabase bucket. Existing webhook/payment tests remain the acceptance basis; desktop code does not change those handlers.

Read-only Vercel metadata confirmed project `bgm-digital-solutions` owns `www.bgmsolutions.site`, Node 24, and production deployment `dpl_3HC8H1FZNnxD5DbyyeZwpEePTCp8` at baseline commit `d9c6cc62eae1ad044b6cbb3a08c1483e1da80f9f`. Non-custom-domain deployments have Vercel authentication protection. No secrets were decrypted. The following reports names/presence only:

| Binding | Production | Preview |
| --- | --- | --- |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | present | present |
| BLOB_STORE_ID | present | present |
| DELIVERY_SECRET / CRON_SECRET / PAYSTACK_SECRET_KEY / SITE_URL | present | absent in inspected metadata |
| PAYSTACK_MODE / CHECKOUT_ENABLED / PAYSTACK_WEBHOOK_MODE / PAYSTACK_CURRENCIES / EMAIL_ENABLED | present | present |

Local `.env.local` did not supply populated standard bindings in the inspection. No new project, remote migration, fake order, synthetic production customer, financial data upload or policy change is required for this pilot. Do not copy production secrets into desktop files or packages. Preview provider checkout acceptance remains unavailable until secure Preview bindings are configured; no live charge is substituted.

## Chosen stack and boundaries

An isolated Electron application reuses JavaScript/CommonJS, Node testing and exact integer financial conventions. Electron 45.2.3 embeds Node 24.22.2 and SQLite in the exercised Windows runtime. Built-in `node:sqlite` avoids distributing a separately rebuilt native database addon. A .NET desktop alternative would offer native Windows controls and a different runtime footprint, but the SDK is absent and would introduce a second language/toolchain. Electron costs more disk/RAM and requires Chromium/Node security maintenance; that trade-off is accepted for the initial reusable JavaScript foundation. No web server is started for the desktop UI.

`desktop/main.js` owns local file dialogs, the sole database connection and sequential PDF jobs. Sandboxed, isolated renderers have no Node integration. Narrow IPC dispatch checks the sender and main frame; SQL values are parameterised. Imported text is escaped; templates are curated code with no expression evaluator. All HTTP(S) requests, permissions, new windows and renderer navigation are denied. Core calculations, records, PDF printing and backup/restore make no Supabase calls.

`core.js` validates CSV fields/configuration, keeps identifiers as strings and uses BigInt for decimal-safe two-place NGN/USD arithmetic. `store.js` stores monetary values as decimal strings in SQLite JSON snapshots, uses FULL synchronous WAL commits and atomic import/finalisation transactions. Code/templates live in the installation; configuration and financial records have separate tables in the private local profile. Only manual signature lines are implemented. Local names are not verified identities; no strong role separation or tamper-proof audit claim is made.

Current schema creation is transactional and rejects newer schema versions. Before schema 2 is authored, implement a verified encrypted pre-migration backup, migration journal and tested restore path; do not claim multi-version upgrade acceptance from the initial schema. App uninstall is configured to retain app data; one isolated custom-directory install/uninstall and synthetic-profile-preservation test passed, while default-profile ACLs and upgrades remain unverified. A future institution-server edition must use a proper server database, authenticated roles and server-enforced transactions; never share the SQLite file across computers.

## Documents and recovery invariants

Source confirmation is a recorded review against an external bank/provider/authorised cash ledger; screenshots alone are insufficient. Documents do not audit sources, settle payments or grant clearance. Receipt claims prevent repeated receipts for the same payment. Statements explicitly distinguish charges, credits, full payments, opening and closing; allocations/settlements remain separate unsupported concepts. Draft → reviewed → final requires recorded distinct names. Cancellation retains original evidence; correction links to a cancelled original and increments revision. Reprints/cancelled copies are visibly marked.

Each final PDF commits with its hash, source/configuration snapshot, template/application versions, preparer/reviewer and timestamps. The rendered HTML/CSS is retained with the final snapshot, so future marked copies can use the original template. Final previews/export use retained PDF bytes. SQL guards freeze final snapshot/PDF updates; privileged local users can bypass controls. Hashes check integrity, not certificate signatures.

Jobs have stable UUIDs, one job per document, attempts, outcomes and generic safe error manifests. Startup recovers `running` jobs to `queued`; final bytes/state commit atomically. Cancellation discards in-flight output. Selective retry preserves document numbers. Numbers are allocated at draft creation and gaps/cancelled drafts remain historical, not promised gap-free. A PDF is stored inside SQLite, avoiding split filesystem/database commits. Very large local archives require measured capacity before publication.

Encrypted backups use scrypt and AES-256-GCM with authenticated format headers; restoration checks PDF hashes/references and commits into an empty profile only. Plain exports remain possible independently of licence expiry. No cloud backup is enabled. Passphrases cannot be recovered. Memory copies of JavaScript strings cannot be reliably zeroed; the derived key buffer is cleared. Current SQLite files are not application-encrypted at rest.

## Catalogue and release contract

Stable ID: `campus-bursary-documents`; display name configurable. The existing production Supabase row is NGN-only, still `draft`, and `delivery_ready=false`. Public metadata shows the approved NGN 200,000 price as not for sale and has no public installer URL. `desktop/release.json` remains internal development metadata and does not control checkout. The versioned private installer read-back matched the local file by full byte count and SHA-256 using protected Preview. The public page is an enquiry/request-pilot preview using existing BGM support links and lists material limitations.

The unsigned pilot installer is already stored as an immutable versioned private Blob object and read-back verified. Keep the existing product row draft and not delivery-ready until real purchaser-entitlement/download, token-expiry and cross-customer denial checks pass. Price is NGN 200,000 only. Confirm customer rights before publication; do not infer desktop rights from historical Excel purchases. Existing paid orders must keep their snapshotted assets. A download entitlement controls delivery, not device use; the application has no activation or device lock. Any stronger licence scope requires a separately reviewed, backwards-compatible server design and must not be assumed from an order token.

Reuse existing server-side payment verification, refund/revocation and recovery rules. No browser redirect or desktop assertion grants a paid entitlement. Downloads can be redistributed after delivery; expiring links are delivery access control only. Installer sizes must be acceptance-tested against the existing proxy/download limits before enabling sales; if necessary, introduce a reviewed short-lived private direct-delivery mechanism without exposing permanent URLs.

## Signing, dependencies and updates

Electron and electron-builder use MIT licences, inspected in installed packages; Electron distribution includes Chromium and other third-party notices that must remain in customer artifacts. Windows system Arial is used, not redistributed. PDF.js (Apache-2.0) and napi canvas (MIT) are development-only inspection tools. No cloud PDF provider is a runtime dependency. Keep the locked desktop dependency tree separate from the storefront lockfile. A scoped minimatch 11.0.1 override resolves the initial builder advisories; rerun audit and packaging when changing it.

NSIS defaults to `forceCodeSigning=true`, per-user installation and data retention. At the owner's direction, version 0.1.1 was built unsigned with a one-build override and passed install/uninstall acceptance only to an isolated custom path on one Windows 11 x64 machine. The installer is not signed; Windows may show publisher warnings. Do not ask customers to turn off OS protection. Code signing is waived for this pilot. A release-specific third-party runtime notice inventory, default-profile ACL acceptance, upgrades and other Windows versions remain unverified.

Ed25519 signed offline licence and update-manifest verification are implemented/tested. Only public keys may ship; private keys must stay with an authorised signing system outside source and installer. Commercial issuer keys and terms are absent. Packaged finalisation is fail-closed; historical export survives expiry/missing licence. Clock rollback/admin bypass remain limitations. No online grace requirement exists in the pilot. Signed manifests bind version/schema/hash/size and the existing private delivery origin; download, binary verification and installation are not implemented. Keep updates manual until pre-migration backup and end-to-end verification exist.

## Rollback and next gates

The preview changes only add a public page/CSS and explicit build/dev allowlist entries. Rollback to the prior Vercel deployment or remove these assets; no database rollback is needed. Preserve existing product delivery and paused-email configuration. Keep desktop source, data and paid packages outside the static allowlist. Baseline production deployment above remains a rollback reference.

Reviewer-reported human pilot result: Pass for all 14 scenarios on 10 November 2026; individual artifacts were not attached. Remaining paid-release blockers are final licence/support scope and existing Campus customer rights; a legitimate purchaser-to-download entitlement check; signed-link expiry and cross-customer denial; delivery capacity for the 121 MB installer; default-profile ACL and upgrade/recovery acceptance; third-party runtime notices; and payment-worker monitoring. Requested XLSX/mapping, logo import, authenticated officer roles and additional schedules remain product limitations, not advertised features. Keep the request-pilot listing until release blockers are resolved.
