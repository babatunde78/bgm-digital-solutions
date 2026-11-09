# Offline desktop architecture and BGM integration

Version 0.1.0 development pilot, inspected 9 November 2026.

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

Current schema creation is transactional and rejects newer schema versions. Before schema 2 is authored, implement a verified encrypted pre-migration backup, migration journal and tested restore path; do not claim multi-version upgrade acceptance from the initial schema. App uninstall is configured to retain app data but execution remains unverified. A future institution-server edition must use a proper server database, authenticated roles and server-enforced transactions; never share the SQLite file across computers.

## Documents and recovery invariants

Source confirmation is a recorded review against an external bank/provider/authorised cash ledger; screenshots alone are insufficient. Documents do not audit sources, settle payments or grant clearance. Receipt claims prevent repeated receipts for the same payment. Statements explicitly distinguish charges, credits, full payments, opening and closing; allocations/settlements remain separate unsupported concepts. Draft → reviewed → final requires recorded distinct names. Cancellation retains original evidence; correction links to a cancelled original and increments revision. Reprints/cancelled copies are visibly marked.

Each final PDF commits with its hash, source/configuration snapshot, template/application versions, preparer/reviewer and timestamps. The rendered HTML/CSS is retained with the final snapshot, so future marked copies can use the original template. Final previews/export use retained PDF bytes. SQL guards freeze final snapshot/PDF updates; privileged local users can bypass controls. Hashes check integrity, not certificate signatures.

Jobs have stable UUIDs, one job per document, attempts, outcomes and generic safe error manifests. Startup recovers `running` jobs to `queued`; final bytes/state commit atomically. Cancellation discards in-flight output. Selective retry preserves document numbers. Numbers are allocated at draft creation and gaps/cancelled drafts remain historical, not promised gap-free. A PDF is stored inside SQLite, avoiding split filesystem/database commits. Very large local archives require measured capacity before publication.

Encrypted backups use scrypt and AES-256-GCM with authenticated format headers; restoration checks PDF hashes/references and commits into an empty profile only. Plain exports remain possible independently of licence expiry. No cloud backup is enabled. Passphrases cannot be recovered. Memory copies of JavaScript strings cannot be reliably zeroed; the derived key buffer is cleared. Current SQLite files are not application-encrypted at rest.

## Catalogue and release contract

Proposed stable ID: `campus-bursary-documents`; display name configurable. `desktop/release.json` deliberately uses request-quote NGN/USD placeholders, `deliveryReady=false`, `paymentEnabled=false`. It is release metadata, not a Supabase catalogue row. No draft is inserted through the existing importer because that consumer requires validated private buyer files. The enquiry-only `campus-documents.html` uses existing BGM support links and explicitly lists missing functionality.

Once a signed installer passes acceptance, create an immutable versioned private Blob object, calculate/read-back-verify SHA-256, and prepare one additive product row using the existing schema. Validate NGN/USD price books and existing customer rights first. Do not infer desktop rights from historical Excel prices. Existing paid orders must keep their snapshotted assets. If licences need version/scope entitlement beyond existing paid orders, add reviewed backwards-compatible server data/functions with a backup/rollback plan; the current order token alone does not establish a desktop device licence.

Reuse existing server-side payment verification, refund/revocation and recovery rules. No browser redirect or desktop assertion grants a paid entitlement. Downloads can be redistributed after delivery; expiring links are delivery access control only. Installer sizes must be acceptance-tested against the existing proxy/download limits before enabling sales; if necessary, introduce a reviewed short-lived private direct-delivery mechanism without exposing permanent URLs.

## Signing, dependencies and updates

Electron and electron-builder use MIT licences, inspected in installed packages; Electron distribution includes Chromium and other third-party notices that must remain in customer artifacts. Windows system Arial is used, not redistributed. PDF.js (Apache-2.0) and napi canvas (MIT) are development-only inspection tools. No cloud PDF provider is a runtime dependency. Keep the locked desktop dependency tree separate from the storefront lockfile. A scoped minimatch 11.0.1 override resolves the initial builder advisories; rerun audit and packaging when changing it.

NSIS configuration enforces `forceCodeSigning=true`, per-user installation and data retention. The actual Windows build reached packaging then stopped because no code-signing certificate/provider exists. No signed installer/checksum or clean installation claim is available. Evaluate a CA-issued Authenticode certificate or Microsoft Artifact Signing eligibility, identity validation, key custody, timestamping and renewal with the owner; public pricing varies and no cost is invented. Do not turn off OS protection.

Ed25519 signed offline licence and update-manifest verification are implemented/tested. Only public keys may ship; private keys must stay with an authorised signing system outside source and installer. Commercial issuer keys and terms are absent. Packaged finalisation is fail-closed; historical export survives expiry/missing licence. Clock rollback/admin bypass remain limitations. No online grace requirement exists in the pilot. Signed manifests bind version/schema/hash/size and the existing private delivery origin; download, binary verification and installation are not implemented. Keep updates manual until pre-migration backup and end-to-end verification exist.

## Rollback and next gates

The preview changes only add a public page/CSS and explicit build/dev allowlist entries. Rollback to the prior Vercel deployment or remove these assets; no database rollback is needed. Preserve existing product delivery and paused-email configuration. Keep desktop source, data and paid packages outside the static allowlist. Baseline production deployment above remains a rollback reference.

Release blockers: signing provider, final licence/customer rights, institution approval of document content, Windows installation/uninstallation/ACL acceptance, production delivery capacity, upgrade/recovery acceptance and incomplete requested features. First next engineering step is validated XLSX/mapping and account completeness controls, followed by signed release/licence issuance and additional schedules. Logo/signature image features must have their own input and authorisation controls before being advertised.
