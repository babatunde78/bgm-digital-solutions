# Architecture decisions

## 014 — Journal-backed expense budgets

Migration 012 implements institution-scoped funds, expense budget lines and immutable authorisation/commitment/actual/release events. It reuses the workbook rule that linked actual expenditure reduces outstanding commitments rather than consuming availability twice. Initial authorisation is supported; revisions, virements, capital budgets and procurement documents remain future work. Every line selects one basis explicitly, and reports require a financial period and in-period as-of date.

Actuals reference existing posted journal debit lines instead of posting expenditure again. Approved obligations reserve capacity under period/line locks; attribution across funds cannot exceed the debit. Unattributed debits on configured accounts remain visible and block new commitments. Manual journal posting is not yet universal budget enforcement. Actual releases restore the commitment reservation; commitment releases free unused obligations. Journal reversal requires prior posted actual release. Close rejects unfinished events, open commitments and configured-account attribution exceptions. See CONNECTED_BUDGETS.md for precise formulas, authority and remaining acceptance.

## 013 — Approved clearing transfers and explicit variance controls

Migrations 010/011 bind settlement profiles to approved cash/accrual policies and actual bank/clearing/fee/variance mappings. No tolerance threshold is invented; every nonzero bank/book residual needs its own independent approval and remains visible. Existing matching capacity includes approved residual reservations. Settlements require complete reviewed coverage and sufficient original clearing entries, preventing double booking of directly recorded bank cash and additional income recognition.

Immutable previews bind both bases, source amounts, reviewed matches and differences. Posting is atomic, with private transaction-bound journal authority and source-clearing consumption records. Active previews freeze linked evidence; posted backout requires fresh approval and exact opposite journals, restoring capacity without deleting history. After backout, tolerances must be voided before matching. See CONNECTED_SETTLEMENTS.md for supported accounting mechanics and limitations.

## 012 — Staged statements and reviewed gross matching

Migrations 008/009 separate raw/mapped import rows, accepted bank lines and reviewed reconciliation allocations. Canonical content fingerprints and per-source transaction IDs prevent duplicate acceptance; invalid control totals remain unavailable rather than zero. Independent human verification is recorded explicitly and never described as an automatic bank/provider call. The shared CSV parser is exported for reuse without changing Excel import behaviour.

Matching is against gross amounts on posted receipts or refund/chargeback sources, with fees/net visible separately. Split/grouped allocations require independent approval; exact/amount/partial suggestions never approve themselves. Sorted bank/source locks and capacity rechecks protect matching. Reviewed voids retain original pairs and release capacity only when final. Active matched receipts cannot be undone by bookkeeping reversal. Reconciliation metadata does not create income or ledger entries; settlement/fee accounting and nonzero tolerances need later explicit controls. See CONNECTED_TREASURY.md.

## 011 — Approved fee snapshots and transactional draft batches

Migration 007 preserves the Excel session/programme/level matching rule through immutable per-session enrolments and versioned, independently approved fee schedules. Batch snapshots bind the exact cohort, fee lines, effective version and dates. Generation rechecks that snapshot under a session lock and atomically creates draft invoices through the existing invoice function. Financial source instructions and approvals remain separate; batch generation creates no income or journals.

An institution/student/session/fee-key primary key prevents overlapping controlled batches from issuing the same logical charge, including after a schedule revision. Replays with equivalent inputs are idempotent; changed inputs under the same batch ID fail. Cancelled/corrected invoices do not silently free that reservation. Rebilling, enrolment edits and full correction-chain handling remain explicit future workflows. See CONNECTED_BILLING.md for boundaries and acceptance.

## 010 — Coordinated source corrections

Migration 006 adds separate correction records referencing original invoice lines, receipts, allocations and invoices. Original transactions remain posted. Shared source-row locks and approval reservations prevent refunds/credits/releases/reversals exceeding available balances; only posted, chronologically available releases free funds. Existing allocation checks include corrections so reversed or refunded amounts cannot be reused.

Manual/approved-rule treatments remain available for partial adjustments. Full invoice/receipt reversal plans must instead be exact opposites of the original approved snapshot, with original journal links and fresh source approval. The source-posting wrapper commits linkage atomically and private base functions lose authenticated execution. Schema-2 reports distinguish gross, adjustments and net amounts. See CONNECTED_CORRECTIONS.md for explicit constraints, evidence and remaining gaps.

## 009 — Revenue source workflow and dual entry modes

The owner requested both manual and automated accounting entry modes on 8 November 2026. Operational source records remain separate from journals: students, invoice headers/lines, receipts and allocations reference an immutable workflow event. Manual plans specify each basis explicitly; rule-generated plans use independently approved, effective-dated rules bound to approved policies and named mappings. No recognition defaults or tax rules are invented. Initial rules handle a full-amount mapped debit/credit or explicit non-recognition, not arbitrary recognition logic.

Both modes converge on the same per-source independent review/approval and atomic posting transaction. Generated journal approvals bind to that immutable source snapshot, with an explicit source-posting audit action. A private transaction-scoped capability blocks standalone source-journal creation/posting; standalone source-journal reversal is refused until coordinated source corrections exist. Approval/posting rechecks allocation availability under row locks. Period close includes unposted sources. See CONNECTED_REVENUE.md for semantics and acceptance limits.

## 008 — Controlled accounting configuration

Migration 003 adds administrator-created accounts/periods and immutable policy proposals, approved by a distinct bursar. Approved policies receive per-basis versions serialized on the institution row; mapped accounts must belong to that institution. Guidance is owner/professional-authored narrative, not guessed recognition logic. Named mappings determine journal-account eligibility only. Database triggers apply those checks to the existing journal and reversal creation functions; no client/API bypass is introduced. Legacy policy/account records receive no invented mappings or classifications.

Bursars can lock periods using an expected version after all journals in that period are posted. Period-row locks serialize creation/posting/locking. No reopen or full close/rollover procedure is inferred. Approval and configuration actions produce administration audit records; authenticated table writes remain revoked. This is an additive, unapplied migration outside the storefront; prior SQL files and workbook editions are preserved.

## 007 — Isolated staff application and reversal workflow

`002_operations.sql` extends the dedicated ledger without changing migration 001 or the storefront. Platform provisioning and institutional membership administration have separate checks and audit records. A new Auth-user foreign key rejects fabricated membership IDs. The initial institutional administrator is fixed; this release does not improvise a replacement/extra-administrator policy. Linked reversals are atomic opposite journals, with original-row locking, one reversal per original, an open target period and fresh approvals. Original posted entries remain unchanged.

The standalone Node application in `campus/app.js` uses the existing runtime and dependencies. Its assets have an explicit allowlist and restrictive CSP; same-origin JSON POSTs and bearer identity are required for requests. Auth access tokens stay in tab memory, provider refresh tokens are discarded, and reloading requires sign-in. This keeps a development login functional without introducing a shared session database or reusing storefront purchase cookies. Persistent sessions, MFA and production rate limiting remain launch work. Configuration examples and startup validation are separate from the storefront.

## 006 — Connected dual-basis foundation, 8 November 2026

The owner selected both cash and accrual. `campus/migrations/001_ledger.sql` is an isolated, unapplied migration for a dedicated Connected database, outside storefront migrations. One source UUID can have one journal per basis; same-basis duplicates are blocked. Policy versions/effective dates are explicit; recognition automation and policy approval interfaces remain pending. No automatic conversion or combined-basis totals are implemented.

The database owns membership checks, same-institution foreign keys, integer monetary validation, transactional creation, ordered approvals, preparer/approver separation, row locks, version conflicts and period-lock checks at posting. Authenticated users get RLS-filtered SELECT and explicit RPC execution, without direct table writes. Privileged database administrators remain trusted and can modify data; audit records are application-append-only, not tamper-proof.

`campus/server.js` validates explicit dedicated-project configuration and requests, verifies the bearer token against Auth, then forwards the same user token to schema-scoped RPCs. It accepts a publishable API key, never a service-role key or actor override. It is a library, not a deployed endpoint or login/session implementation. No environment variables are added yet. Network failures are not retried automatically because a commit may have occurred.

Primary-source review on 8 November 2026: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [JWT identity](https://supabase.com/docs/guides/auth/jwts), and [authenticated requests](https://supabase.com/docs/guides/functions/auth-legacy-jwt). These support user-context/RLS and fixed-search-path controls; real Auth/PostgREST permissions still require staging verification.

## 001 — Isolated foundation, existing runtime

Keep existing CommonJS Node/Vercel storefront and Supabase/Blob delivery untouched. Add pure CommonJS product modules, with no new dependency or environment variable. This minimises integration risk and uses existing test tooling. Connected application is planned as a separate Vercel application with a dedicated Supabase database/storage and authenticated server APIs; provision nothing until tenant schema and identity controls are implemented and tested. Do not reuse the storefront service-role handlers as tenant APIs.

## 002 — Shared schema contract

`lib/campus-model.js` is the executable table/column dictionary and package sheet selector. Text IDs are opaque stable identifiers; backend UUIDs are planned. `text?` means optional, `date` means ISO date, `integer` means safe integer with amounts in minor units, and `json` is configuration/staging data. `posting-state` requires the workflow specified in PRODUCT_SPEC. Explicit reference maps define same-institution relationships. Institutions use `institution_id = id`. `lib/campus-finance.js` validates local datasets; neither these definitions nor local validation is a deployed database constraint or server permission check.

The Excel pilot expands the dictionary for sponsors/scholarships, sessions, credit lines, revisions/virements, expenses, grants, assets/disposals, approvals and source-linked journal headers/lines. It deliberately leaves connected membership/audit, authenticated signatures and platform billing for later server implementation. Automated accounting mappings remain pending accounting-policy approval; manual journal controls are provided instead.

## 003 — Pricing authority and history

One draft versioned Campus price book supplies pure quote snapshots and historical-reference display calculations. NGN kobo is authoritative; integer arithmetic rounds converted USD once at the requested total. No checkout adapter exists yet. Later publication must be an administrator-authorised effective-dated database transaction that validates the version against this contract and preserves immutable quote/invoice snapshots. Existing Supabase catalogue authority is unchanged; editing JSON does not publish prices.

## 004 — Workbook foundations

All three Excel packages select from the same dictionary; Full Excel adds accounting. Shared artifact-tool generation produces private clean/demo workbooks with real formulas/tables, with lxml restricted to unsupported print/protection settings. Native Excel finalises pivots/query-function storage and performs recalculation/print acceptance. Preserve namespaces while editing OOXML. No claim of secure multi-user Excel or tamper-proof worksheet logs is permitted.

## 005 — Versioned acceptance fixes

`lib/campus-release.json` supplies the active edition and prepared-row bounds to generation, finishing, native verification and packaging. v0.2.1 is prepared from hash-verified v0.2.0 files without overwriting the old edition, then reverified after changes. Source print areas cover the entire prepared table; users filter empty IDs before printing. Full-suite pivots sit side by side so 100 student rows cannot collide with the supplier pivot. The CSV preview uses culture-text date parsing for the installed engine, verifies exact ISO round trips and records a successful-preview UTC timestamp. All refresh and capacity tests use disposable copies; results do not imply broader compatibility or automatic financial posting.
