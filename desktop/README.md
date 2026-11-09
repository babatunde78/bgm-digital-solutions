# Campus Bursary Documents — development pilot 0.1.1

BGM means **BGM Digital Solutions**, the existing storefront in this repository. This is an offline Windows desktop application, separate from the Campus Excel products and the Connected application. Product display name is configurable in institution setup; release/installer names are configured in `release.json` and `package.json`.

## Run and verify

Use the repository's Node 24 runtime and npm. In `desktop/`, run `npm ci`, then `npm start`. Core and storage tests: `node --test desktop/*.test.js` from the repository root. No production credentials are needed. Version 0.1.1 enables offline finalisation without licence activation in source and packaged mode. Development mode is not a paid customer release.

Windows native synthetic acceptance: run `desktop/node_modules/electron/dist/electron.exe desktop --smoke-test` from the repository root. It creates a fresh disposable profile and sample PDFs under ignored `.product-work/campus-bursary-documents/v0.1.0/`. Then run `node desktop/verify-pdfs.mjs` to extract searchable text, check expected values and references, check page numbers/repeated table headings and render first/last pages to PNG. Inspect the PNGs; semantic checks alone do not prove layout quality. Smoke records are fictional.

## Daily workflow

1. Enter the recorded officer name above Institution setup, then save setup. NGN and USD are supported, with exactly two decimal places. Dates are ISO `YYYY-MM-DD`; displayed preparation times use the institution timezone. There is no implicit currency conversion or financial rounding: amounts with more than two decimal places are rejected.
2. Copy `resources/import-template.csv`. Export reference/account columns as text from the source system; digits already lost in Excel cannot be recovered by this application. Use distinct institution-wide source references, even across systems. `student` identifies the student account or voucher payee. Kinds are `charge`, `credit`, `payment`, `voucher`.
3. Select a CSV and inspect preview, errors, row count and control total in minor units. The preview shows the first 20 valid rows; the batch validates every row. Up to 10,000 rows/20 MB per CSV are accepted. Mixed currencies are refused. This pilot requires exact headers; XLSX import and custom column mappings are pending.
4. Review the source records before accepting. For payments, record the actual bank/provider or authorised cash-ledger reference and confirmation notes; a screenshot is insufficient. Acceptance is a human attestation, not automatic bank verification. Source data is not independently audited. An accepted batch commits atomically; stale duplicates roll back the entire acceptance. Repeating an identical source/import returns its existing batch.
5. Select one payment for a receipt, one student's relevant charge/credit/payment movements for a statement, or voucher rows for a voucher. A statement requires explicit opening-balance provenance, including a confirmed zero. Opening is entered as integer minor units: `10000` means NGN/USD 100.00. Check the selected period and completeness against the source system.
6. Create a draft, preview it, then enter a different recorded reviewer name and record review. Names are workflow records, not authenticated identities. Queue the final PDF. Multiple reviewed documents can be queued; jobs run sequentially with individual outcomes and retries. A failed renderer retains source data and the same number.
7. Preview final documents from retained PDF bytes. Export original PDFs or generate marked copies. Cancellation retains the original and its hash; ordinary exports of cancelled originals are refused. For correction, cancel with a reason, then enter the original ID and correction reason before creating a replacement draft. Replacement receipts retain a revision link and require review again. Financial source reversals and allocation accounting are not implemented.

Statements show opening + charges − credits − payments = closing. A negative closing balance is credit. Payments are shown in full, separately from charges/credits; invoice allocation, settlement matching and bank reconciliation are not calculated. Vouchers do not execute payment or prove settlement. Document generation never grants clearance.

## Backups, export and recovery

Use Save encrypted backup regularly and before installing updates. Backups include configuration, source records, document snapshots, final PDF bytes, jobs, receipt claims and event history. The format uses scrypt-derived keys and AES-256-GCM authenticated encryption with a random salt/nonce. Use a unique passphrase of at least 12 characters and store it securely apart from the backup. There is **no passphrase recovery**; losing it can make the backup permanently unreadable. The pilot limit is 256 MB of plaintext backup data.

Test restoration on a separate Windows test account/profile. Start with an empty profile, enter the passphrase and select Restore. Existing profiles are refused rather than overwritten. Restoration runs in one SQLite transaction and checks references and PDF hashes. Compare record counts, control totals and retained PDFs afterwards. Keep the original profile/backup until verified. Plain JSON export is unencrypted and may contain sensitive records/PDFs; protect it like the original database. No spreadsheet export is provided, so formula injection in exported spreadsheet cells is not introduced.

Production profile target: `%LOCALAPPDATA%/BGM Digital Solutions/CampusBursaryDocuments/`. Data is separate from installation files. Do not move the database to a network/shared drive, cloud-sync directory or removable shared working folder. Use one Windows user/computer; local administrators can bypass application controls. SQLite and ordinary exports are not encrypted at rest by this pilot. Use institution-managed Windows account permissions and disk encryption; managed ACL acceptance is pending.

Windows database paths longer than 240 characters are refused before SQLite opens them, leaving room for its sidecar filenames. If startup reports this condition, use an institution-approved Windows account with a shorter private local profile path; do not relocate the live database to a shared folder. No supported in-app profile relocation is available yet.

## Installation, licensing and updates

Target: Windows 11 x64. Native development PDF generation has been exercised on Windows; clean installer/uninstaller acceptance and full compatibility are pending. The intended installer includes Electron/Node and does not require Excel, Adobe, a browser service or an internet connection for calculations/PDF generation. Application uninstall configuration preserves app data; that behaviour still needs installer acceptance.

`npm run dist` in `desktop/` prepares a Windows NSIS installer and enforces code signing. The current build stops at the signing gate because no signing certificate/provider is configured. There is no published installer or installer checksum. Never disable antivirus or OS security to run a release.

Version 0.1.1 uses `licensing.activation: "none"`: packaged document finalisation, retrieval and export require no activation, licence file or internet check. Missing or expired licence files do not block this mode. BGM server-side purchase entitlements control access to paid downloads; they do not prevent copying an already downloaded application. This is a distribution policy, not device enforcement. Existing Ed25519 verification primitives remain available for a future explicitly configured mode; no private keys ship. Commercial usage/support terms and prior customer rights still need confirmation.

Update files can be verified against a separately configured public key; authenticity binds product, version, schema, size, SHA-256 and the existing BGM private delivery origin. The downloader, installer verification/application, pre-migration backup orchestration and rollback UI are pending. No automatic update is installed and ordinary offline work does not require an update check. The current schema refuses a database newer than the application. Do not replace an application with an older version against a newer profile: restore a matching application plus a verified pre-upgrade backup into a fresh profile.

## Limits and release status

Implemented: institution text/colour configuration; CSV staging/atomic acceptance; three curated document templates; reviewed finalisation; searchable PDFs; durable per-document jobs; local search; cancellation/correction links; retained original bytes, SHA-256, source/configuration/template/application snapshots and timestamps; encrypted backups and empty-profile restore; signed licence/update verification primitives.

Not available: logo import, unrestricted template designer, XLSX/mapping, OCR, signature images, certificate-based document signatures, authenticated officer roles, server edition, complete accounting, invoice allocation, automatic bank verification, the additional requested schedules/audit-pack builder, commercial licence issuance or automatic updates. No PDF/A or accessibility-standard conformance is claimed. Signature revocation acceptance is inapplicable until signature images are implemented; default manual lines have no cryptographic authentication.

Commercial signing, customer rights, licence scope, prices, support terms and clean installation remain release blockers. NGN/USD prices remain request-quote. Existing Excel customers' rights are unchanged, and no customer is charged for the desktop product. See `../docs/DESKTOP_ARCHITECTURE.md` and `../docs/DESKTOP_RESEARCH.md`.
