# Connected revenue pilot: manual and approved-rule modes

Correction continuation: [CONNECTED_CORRECTIONS.md](CONNECTED_CORRECTIONS.md) supersedes the missing-source-correction statements below for credits, refunds, allocation releases, chargebacks and full invoice/receipt reversals. It also defines schema-2 gross/adjustment/net totals. Reversals of posted corrections, external money execution and production acceptance remain pending.

This local development slice adds student records, line-based invoices, recorded receipts, allocations, source approvals and atomic source-to-journal posting. It is not the complete Package A or a production service. Use synthetic data until hosted security, recovery, professional accounting acceptance and the missing correction workflows are complete. Both manual and rule-generated instructions were requested by the owner on 8 November 2026.

## Configure and prepare

Apply dedicated-project migrations 004 and 005 after 001–003, with backup/review precautions in DEPLOYMENT.md. Do not apply them to the storefront database. No customer accounting rules are seeded. Configure accounts, periods, independently approved cash/accrual policies and named account mappings using CONNECTED_GUIDE.md.

Student references, receipt references and account codes remain text. Amount inputs are integer minor units, not decimal naira: NGN 1,000.00 is entered as `100000`. Currency-specific display precision and rounding configuration beyond this pilot remain pending; the institution currency is fixed at provisioning. The application does not convert transaction currencies.

Student accounts officers/bursars create students and invoice drafts. Cashiers/bursars record receipt drafts. Cashiers/student accounts/bursars create allocations. Records and all references are institution-scoped; institution administrators do not acquire finance access automatically. A receipt records a collection submitted by an authorised officer. It does not verify bank settlement, a payment screenshot or an external provider transaction, and it does not execute a payment.

Create invoice lines with fee classification account, description, amount and due date. Multiple due dates support instalment schedules; academic session is explicitly separate from the financial period. Programme/level fee scheduling and batch billing are not yet connected. Receipt student IDs can be blank for unidentified funds; a student-specific receipt cannot be allocated to another student's invoice. Sponsorship administration and allocation approvals for more complex sponsor arrangements remain pending.

## Two accounting entry modes

Every source requires explicit instructions for both cash and accrual. The software never adds the two ledgers together.

**Manual:** the preparer enters an approved policy ID and either balanced journal lines or a documented non-recognition decision for each basis. Each nonzero journal must debit and credit the exact source amount, use eligible mapped accounts, and have one positive side per line. Multi-account splits are supported. Non-recognition requires an explicit explanation and independent review; it is not an automatic zero or a missing-policy fallback. Human reviewers must assess whether the treatment actually follows the institution's recognition policy. Numeric balance alone cannot establish accounting correctness.

**Approved rules:** an institution administrator proposes a rule tied to an approved policy, basis, source kind and effective date. It specifies either one mapped debit and one distinct mapped credit for the full source amount, or an explicit non-recognition explanation. A bursar other than its preparer approves an immutable rule version. The source preparer selects an approved cash rule and accrual rule; the server copies their deterministic results into the submitted source plan and records both rule IDs in `revenue_rule_usage`. Missing, unapproved, wrong-kind, wrong-basis or not-yet-effective rules are rejected, with no silent fallback to manual or zero.

Approved rules currently handle full-amount two-leg entries only. Use manual instructions for complex splits, overpayment reclassification or treatments not represented by that rule. There is no automatic recognition-policy authoring, tax logic, transaction classification, latest-version selection, rule revocation/editing or autonomous financial posting. New rules receive new versions; their approved copies and source instruction snapshots remain unchanged. Selecting approved rules still requires per-source review and approval.

## Review and post

1. Create the source draft. Save its ID; drafts do not contribute to financial totals.
2. Submit manual instructions or generate from two approved rules. Source version moves from 1 to 2. Refresh revenue schedules to inspect the immutable source and both instruction sets before taking action.
3. A reviewer/bursar other than the preparer marks it reviewed (version 3). A bursar other than the preparer approves it (version 4). The same independent bursar can review and approve in this pilot; configurable extra separation and thresholds remain pending.
4. A bursar posts the approved source (version 5). Source status, generated journals, journal lines and audit events commit in one transaction. Generated journals inherit the source's preparer/reviewer/approver and are explicitly audited as `approved_source_posted`; they do not pretend to have undergone an additional independent journal workflow. Their version is 2 (creation and source-controlled posting).
5. Retry only after reloading the source after a conflict or uncertain network result. Duplicate IDs/references prevent duplicate records, and expected versions prevent repeated posting. The form reuses a candidate source UUID after an uncertain create response. Duplicate creation may return conflict rather than a second success; verify the existing record before starting a new request.

Allocation sources require posted, chronologically valid receipt/invoice sources. Approval reserves the amount; approved and posted allocations are counted for balance limits, while only posted allocations enter financial totals. The database locks source rows and rechecks availability at approval/posting, preventing allocations beyond either receipt availability or invoice-line balance. Pending draft/reviewed allocations do not reserve funds and may fail later if another allocation uses them. A bursar can cancel any unposted source; its preparer can cancel its own draft. Cancellation releases an approved reservation and retains its audit history. Posted sources cannot be cancelled.

Period locking also refuses any unposted/uncancelled revenue sources. Source-linked journals cannot be independently created, posted or reversed through standalone journal controls; the posting RPC uses a private transaction-bound authorisation record. Financial source corrections must remain coordinated with their subledgers. Credit notes, refunds, source reversals, chargebacks and allocation releases are not yet implemented, so live financial use remains blocked.

## Read schedules honestly

Revenue totals use all posted source dates and all academic sessions in the institution: billed, recorded receipts, allocated collections, invoice remainder and unapplied receipts. They are not income, verified bank balances or a financial-year dashboard. The lists show at most 100 source/student records; totals use the complete posted set. Full pagination, as-of/period/session filters, ageing, financial statements and complete exports remain pending. Academic session, financial period and both accounting bases must not be interpreted as interchangeable.

The schedules expose source IDs, versions, detailed invoice lines, receipt references, allocations and both posting instruction sets for review. Rule provenance is stored in the institution-scoped usage table; a dedicated provenance timeline/report is still pending. Non-recognition decisions remain visible in the source's approved instruction snapshot. No blanket exception-to-zero behaviour is used.

## Recorded synthetic acceptance

The worked example manually specifies a bill of 100000 minor units, receipts of 40000 and 80000, and allocations of 40000 and 60000. It produces billed 100000, receipts 120000, allocated 100000, receivable 0 and unapplied 20000. Explicit manual journals split the excess to an unapplied liability; both ledgers show fee income of 100000 in this fixture. This is a test example, not a recommended policy for every institution.

A second invoice of 2000 uses two independently approved synthetic rules: explicit cash non-recognition and an accrual receivable/income entry. Unapproved rules fail; once approved, the generated lines equal the independently specified expected entry. A synthetic failure on the second accounting basis verifies that the first journal and source posting roll back together. Tests also cover duplicate-post conflicts, isolated reads, excess allocations, standalone source-journal tampering, preserved references and closed-period creation refusal. These are local PostgreSQL tests, not hosted-provider or multi-connection performance acceptance.
