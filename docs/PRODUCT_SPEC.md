# Campus Bursary — requirements baseline

Version 0.1, 7 November 2026. Source: owner's six prompts supplied in this session. These are accepted product requirements, not claims of implemented functionality. Product name is configurable in `lib/campus-prices.json`.

## Delivery stages

1. Requirements, architecture, shared data dictionary, versioned pricing and application/workbook foundations.
2. Shared generator for Package A, Package B and Full Excel; clean templates and separate synthetic demos; accounting scenarios and print/recalculation acceptance.
3. Connected application using the same financial definitions; server-enforced controls and two-institution acceptance.
4. Public site and customer portal; truthful availability, quotes, sandbox payment verification, entitlement downloads and onboarding.
5. Correctness/security/recovery review, repair, launch-readiness evidence and staging preparation.
6. Staging smoke tests followed by specifically scoped production deployment. No implicit live charging.

## Packages and functional acceptance

Package A: academic/institution setup, student master, fee schedules, controlled batch billing, instalments, waivers, discounts, penalties, credit notes, sponsor/scholarship allocations, partial/over/unapplied payments, refunds/reversals/chargebacks, receipts/statements/ageing/clearance, cashier handovers, bank/provider imports and reviewed reconciliation, revenue/treasury dashboard.

Package B: budgets/revisions/virements, commitments/actuals, requisitions/POs/goods and service receipts/bills, payables/vouchers/proposed payments, staff expenses/advances/imprests/retirements, restricted grants/projects, assets/depreciation/disposals, payroll import checking and period comparison, expenditure/control dashboard. Payroll is not statutory payroll processing.

Full Excel: A+B with common configuration/masters, account mappings, journals, GL, trial balance, control accounts and consolidated reporting. Financial statements depend on supported accounting policies and mappings.

Connected: all above plus authentication, institution membership, least privilege, approval separation, concurrent updates, audit events, protected documents/signatures, transactions, server period locks, managed backups with tested restore, and supported Excel import/export.

## Integrity contract

Owner decision, 8 November 2026: support both cash and accrual accounting. Each journal belongs to exactly one basis and one effective, versioned institution policy. A source event may have a distinct journal under each basis; reports must select a basis and must never add the two ledgers together. This does not approve recognition rules, statutory treatments or account/report mappings. Excel v0.2.1 retains its previously tested illustrative mappings and is not newly certified for dual-basis reporting.

Use stable text IDs and references, including leading zeros. All financial child references must resolve within the owning institution. Monetary storage uses integer minor units and explicit currency/rounding policy; no binary-float financial arithmetic. Model invoices/lines, payments/allocations, settlements/matches, credits/refunds/reversals, journals/lines, budgets/commitments/bills/payments separately. Billing creates receivables/revenue according to approved policy; collections reduce receivables; settlements move clearing cash and recognise fees, never duplicate income. Opening balances must reconcile; unmapped items block posting. Journals balance and subledgers reconcile to control accounts. Posted corrections use linked reversals. Financial-year and academic-session filters are distinct.

Imports require staging, mapping, unambiguous dates, row errors, referenced-record checks, formula/CSV-injection protection, batch hashes, duplicate prevention, totals and atomic posting. Exact matches can be proposed; fuzzy, grouped and tolerance matches require explicit review. Handle unidentified receipts, fees, timing, reversals and split/group settlements; screenshots cannot prove payment.

## Configuration and Excel

Separate institutional branding/legal contacts, academic structures, years/sessions, currency/date/timezone/rounding, banks/funds/projects/cost centres, accounts/report mappings, numbering, officers/approval thresholds and dashboard settings from posted transactions. Preserve image proportions and validate type/size. Excel uses supported image replacement and manual signature blocks by default.

Target macro-free Microsoft 365 Excel for Windows 64-bit, one authorised writer. Use tables, validation, protected formulas, visible exception totals, supported queries/Pivots, print/PDF layouts and version/upgrade/backup instructions. No hidden workbook dependencies or blanket error-to-zero formulas. Passwords, hidden sheets, views and editable logs provide no strong access/audit security. Sensitive payroll may require separate storage. Mac/web/older Excel and capacity remain unverified until measured. Generation/static inspection is distinct from execution/recalculation in Excel.

## Connected controls and documents

Roles: institution administrator, bursar, cashier, student accounts, budget officer, payables officer, reviewer, auditor; platform administration is separate. Server resolves membership, scopes every query/storage object, enforces permissions, optimistic concurrency, preparer/approver separation and draft → submitted → reviewed → approved → posted transitions. Audit events are append-only to application users. Secure sessions, TLS and secrets outside source control are mandatory.

Receipts, statements, vouchers, reconciliation/payment schedules, budget/refund approvals and advance retirements include stable document ID, date/status/amount/currency/revision and named officer/title blocks. Distinguish manual lines, signature images, authenticated approvals and certificate signatures. Image release needs consent, effective dates, revocation and version binding; material changes require reapproval. No verification QR without a real secure verification service.

Every dashboard KPI needs formula, source schedule, status/date rules, filters, refresh timestamp/staleness treatment and missing/zero-denominator treatment. Required measures include billed/allocated/aged balances, cash/reconciliation, budgets/commitments/actuals, payables/advances and pending approvals.

## Commercial and customer journey

See PRICING.md. Website pages: home, each package, comparison/pricing, synthetic demo, implementation/training, security/limitations, docs/support, contact/quote, policy drafts and customer login. Mark unfinished products pilot/coming soon. No fabricated endorsements, compliance badges or guaranteed outcomes.

Excel journey: institution registration → confirmed order/payment → entitlement → secure versioned download → setup questionnaire/onboarding → opted update notices. Connected starts with assisted quote/provisioning. Hosted sandbox checkout requires server verification, signed/deduplicated webhooks, exact currency/amount, atomic fulfilment and reconciliation. Manual activation requires authorised verification/audit. Platform subscription billing is separate from student collections. Offline copy protection is limited; expiry must preserve historical records/export.

Legal/privacy/licensing/refund drafts need owner and professional review; do not invent business details, statutory rates or compliance. Verify current Microsoft/provider and local regulatory primary sources before implementation claims, recording URL/date/evidence limits. Competitor facts/prices require verified sources; unknown means unverified.

## Acceptance and release gates

Synthetic scenarios cover partial/over/sponsor payments, instalments, credits/refunds/chargebacks/reversals; duplicate/interrupted imports; grouped settlements/fees/ambiguity; commitment liquidation; close/rollover; refresh failures; backup/restore; signature revocation/document changes; tenant/permission denial; webhook replay/wrong values; concurrent updates; denied downloads. Require balanced journals, reconciled controls, source/dashboard agreement, exact prices, no duplicate posting/fulfilment or unauthorised documents. Record actual evidence and unresolved issues per stage.

Preserve existing BGM website/email. Discover actual project/domain ownership before release. Separate environments and an isolated subdomain are preferred. Stage before production, with migrations/backup/rollback, HTTPS/headers, health monitoring/redaction, CI and safe bootstrap. No destructive changes or live financial actions without specific approval.
