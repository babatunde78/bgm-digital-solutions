# Campus Bursary Documents 0.1.0 release review

Latest internal renderer review: `ui-review/release/win-unpacked/resources/app.asar` under the ignored version directory has SHA-256 `a31cf9c45e218008cdff0f3e8b50a65990dad96066dac3bb64114448ee50f6d7`. It passes the 12-file package/source/secret inspection and Windows packaged-app regression, including officer-before-setup ordering and record-selection preservation across refresh. The three renderer regressions first failed and now pass; total desktop tests: 34. This remains an unsigned audit artifact, not an installer; the source UI and cancellation fix do not approve human acceptance or paid fulfilment. Earlier artifacts/checksums below remain historical evidence.

Subsequent internal pilot fix: `window-fix-review/release/win-unpacked/resources/app.asar` under the same ignored version directory has SHA-256 `a446e713301ded7d0768f13b9183b759d60b7411e6d4a3e52184145087f9754d`. It includes the minimized-window restore helper, passes a 12-file source/secret allowlist inspection and the packaged historical-access/licence-denial regression, and remains unsigned/unpublished. Windows source regression verified minimize/restore and the shortened smoke profile removed the former cache warning. All 31 desktop tests pass; human acceptance and signing remain pending. The earlier artifact/checksum below is preserved as historical evidence.

## Publication decision

Publish **request-pilot preview only** at https://www.bgmsolutions.site/campus-documents.html. Public metadata: https://www.bgmsolutions.site/campus-documents-release.json. This metadata is informational, not a replacement for the Supabase catalogue. Product ID remains `campus-bursary-documents`. NGN and USD prices remain unapproved/request-quote; no desktop paid product row, installer entitlement or permanent public installer link is created.

No signed Windows installer was produced. The actual Windows build stopped at enforced code signing, and Authenticode inspection reports `NotSigned` for the unpacked executable. Do not upload the unsigned audit output as a customer release or change existing purchase entitlements to point to it. Installer SHA-256 is therefore **unavailable**, not the hash of a sample or source archive.

## Artifacts and integrity

Fresh unsigned application package for inspection only:

`.product-work/campus-bursary-documents/v0.1.0/release-audit-2026-11-09/release/win-unpacked/resources/app.asar`

SHA-256: `b973c867e392e222d13f81d1a99eed1284b364249baac59e2203e3a50546e3b9`.

The ASAR inspection verified exactly 11 allowed application files, exact source bytes for application files, and no packaged server bindings, private signing keys, `.env` files, database/backup/CSV records or development tests. This is an application-package inspection, **not certification of a nonexistent installer**. Electron's standard runtime files and notices remain in the unpacked build. No production secrets were decrypted or copied into packages.

Retained synthetic sample ZIP (not software or an installer): `.product-work/campus-bursary-documents/v0.1.0/campus-bursary-documents-synthetic-samples-v0.1.0.zip`, SHA-256 `05ed8403e3572e4f8a16d8a2a350ca417cd6c85f583cdc67acb90fdc5fbc55a5`. Earlier artifacts are preserved. New native evidence is under `.product-work/cbd-native-audit/.product-work/campus-bursary-documents/v0.1.0/demo/`.

## Tests actually performed

- 25 desktop tests passed on Windows, including monetary values, import validation/atomicity, duplicate receipts, interrupted jobs, cancellation/corrections, backup restoration/integrity, signed-file verification, licence-expiry export and Windows path-length validation.
- 112 repository tests passed, including the preview release gate and existing synthetic SQL-backed purchase/delivery/refund lifecycle, cross-customer denial, token expiry/tampering and payment replay. They use synthetic providers; they are not paid production transactions.
- Actual Windows Electron 45.2.3 / Node 24.22.2 / SQLite 3.53.4 run on a disposable source copy: receipt, statement and voucher generation, encrypted backup restoration and real synthetic UI screenshots passed. The deeply nested first audit failed; the shorter copy succeeded, confirming the Windows path-length issue. Database paths over 240 characters now fail before SQLite opens them, with a clear startup message.
- PDF.js confirmed searchable expected amounts/references, page numbers and repeated table headers. Each short sample is one page; the 250-row statement is eight pages. Rendered receipt and final stress-statement pages were visually inspected.
- Syntax/configuration checks, public asset build and diff whitespace checks passed. Package scanning and Authenticode inspection were performed on the fresh unpacked Windows build.

No clean installer/uninstaller, institutional ACL, signed installer download or production desktop entitlement test passed or is claimed. No customer records, fake production orders or payments were created.

## Production verification and monitoring

Before publication, the read-only verifier saved all 10 public catalogue products under ignored `release-audit-2026-11-09/catalogue-before.json`. After deployment, run `node scripts/verify-desktop-preview.js --after`: it compares every existing product/price/availability flag; checks exact page/CSS/screenshot bytes and public release metadata; verifies invalid download tokens, unauthenticated purchase verification and protected operator readiness return 401; and verifies desktop source and `.env.local` return 404. Results are retained as `production-verification.json`. No actual purchaser token is issued by this script.

Production environment metadata confirmed existing Supabase bindings and private Blob/delivery bindings by name/presence only; no binding was replaced. Existing payment handlers, storage policies, Supabase data and product rows remain unchanged. Successful production delivery and signed-link expiry for this desktop product remain unverified because there is no releasable installer or legitimate controlled desktop entitlement.

Vercel runtime-log access was verified. Recent error-level entries were expected unauthenticated 401 checks plus an existing Node URL deprecation warning; no successful paid delivery is inferred from them. GitHub payment-worker configuration names are present and the last three returned scheduled runs succeeded; the latest returned run at `2026-11-09T10:17:27Z` actually executed its processing step. No worker event was found in the reviewed recent 30-minute log window, so current five-minute scheduler cadence is **not established**. Confirm current scheduler execution and alerting before a paid desktop launch. Existing workflows were not changed or manually dispatched.

## Installation and recovery

Customer installation is not available yet. For authorised source-code pilot evaluation, use Node 24: open `desktop/`, run `npm ci`, then `npm start`; start with synthetic records and no production credentials. Development finalisation is not a paid licence. Normal Windows data path is `%LOCALAPPDATA%/BGM Digital Solutions/CampusBursaryDocuments/`, on a private local drive. Do not use a shared SQLite file. Database paths must be at most 240 characters; a profile-relocation feature is not implemented.

Back up with the application's encrypted backup command and verify restoration into a separate empty profile. Preserve the passphrase securely; it cannot be recovered. Historical export remains accessible if licensing is unavailable/expired. See `desktop/README.md` for the full workflow and limits.

After an eligible signing provider, institution licence keys/terms and approved pricing are supplied, build with `npm run dist` in `desktop/`. Verify Authenticode/timestamp, clean installation/uninstallation and preserved records, backup/upgrade recovery and release-package contents. Only then upload an immutable versioned installer to the existing private Blob store, verify full read-back SHA-256, and validate the existing catalogue/order asset contract and legitimate controlled entitlement before enabling paid sales. Do not overwrite assets snapshotted by existing orders.

## Rollback

Before this preview update, production was `dpl_FuQ6hx8veRsvF5AJSyNCthh6bCwm` (commit `e34047f5beb67c90d745c56fa87749df80e2b4fd`) on the existing BGM project. Use the existing Vercel project's rollback action to that production deployment; verify the custom-domain alias, catalogue and access-denial checks afterwards. Alternatively revert only this release's page/metadata/allowlist changes in a new commit and deploy through the same Git workflow. Do not reset unrelated work, disable store-wide checkout or remove existing private assets.

No remote schema/data migration or paid-asset publication occurred, so there is no database/data rollback. Desktop audit runs use disposable profiles. Do not downgrade a customer's newer schema against an older application; restore a verified matching pre-upgrade backup into an empty profile. Signed update installation and multi-schema rollback acceptance remain pending.

## Remaining launch blockers

Code-signing provider/certificate; approved NGN/USD prices and existing-customer rights; commercial licence issuance/public keys and support terms; clean Windows installer/uninstaller/permissions/data-preservation acceptance; signed update installation and migration recovery; legitimate desktop entitlement, private download integrity/expiry/cross-customer acceptance; recent scheduler cadence/alerting; and unsupported product scope described on the preview (including XLSX mapping, logo import and additional schedules). The preview must not be presented as a finished commercial installer.
