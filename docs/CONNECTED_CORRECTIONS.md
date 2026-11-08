# Connected source corrections

This local pilot adds credit notes against invoice lines, recorded refunds, allocation releases, recorded chargebacks and full invoice/receipt reversals. It uses the same institution isolation, explicit cash/accrual plans, independent review/approval, expected versions and atomic source posting as the revenue workflow. It does not execute bank/provider payments, confirm settlement or authorise production launch.

Apply `006_revenue_corrections.sql` after migrations 001–005 only in the dedicated project, following DEPLOYMENT.md. The migration adds separate correction records, same-institution original references and protected wrappers around existing submission/posting functions. The renamed base functions lose authenticated execution permission; never grant it back. Existing sources/journals are preserved. Verify the Data API schema cache reflects the new public functions and hides private helpers before staging acceptance.

## Create the correct adjustment

Select an institution, open the student revenue workspace and refresh its schedules. Use the correction form with a stable candidate ID, original ID, open target financial period, correction date, positive integer minor-unit amount and reason. The correction date must be on/after its original source date. A closed original period can remain closed while the new adjustment posts in an open period.

| Kind | Original ID | Limit and effect |
| --- | --- | --- |
| Credit | Invoice line | Reduces the unallocated invoice-line amount. Release allocations first if necessary. |
| Refund | Receipt | Reduces unallocated receipt funds. It records an approved refund, without sending money. |
| Allocation release | Posted allocation | Restores receivable and unapplied availability for the released amount. It does not refund cash or cancel the original allocation. |
| Chargeback | Receipt | Reduces available receipt funds; release allocations first. It records the reviewed correction, without verifying a provider notice. |
| Full invoice reversal | Invoice | Must equal the original total, with no remaining allocations, credits or prior reversal reductions. |
| Full receipt reversal | Receipt | Must equal the original total, with no remaining allocations, refunds, chargebacks or prior reversal reductions. |

Student accounts officers/bursars prepare credits and invoice reversals. Cashiers/bursars prepare refunds, receipt reversals and chargebacks. All three can prepare allocation releases. Reviewers/bursars review and a different bursar from the preparer approves; the same independent bursar can review and approve in this pilot. Auditors remain read-only. Current preparer permissions are rechecked at submission.

Approval reserves a correction amount; approved/posted corrections participate in availability checks. Cancelling an unposted correction releases that reservation and retains history. Draft/reviewed corrections do not reserve funds and can fail at approval if another approved adjustment has used the balance. Availability is rechecked under original-source locks at approval and posting. A posted allocation release frees balances only on/after its correction date; backdated requests cannot borrow from a later release.

## Submit and approve

Credits, refunds, allocation releases and chargebacks use reviewed manual plans or institution-approved rules for both cash and accrual, as described in CONNECTED_REVENUE.md. Each journal must balance to the exact correction amount and use the selected policy's mapped accounts. Non-recognition must be explicit and independently reviewed. No customer correction mappings or statutory treatments are supplied automatically.

Full invoice/receipt reversals instead use **Generate exact reversal and submit**. The server copies the original's approved plans, exchanges each debit/credit and preserves each basis/policy and explicit non-recognition decision. Manual/rule overrides for those full reversals are refused. An independent officer reviews, a different bursar from the preparer approves, and a bursar posts the correction. Reversal journals link to their original journals, carry the correction reason and an explicit audit event. Their final version is 3: creation, source posting and original-journal linkage. All links, journals, source state and audit records commit together.

The original source and journals remain posted and unchanged; schedules calculate the net position from the linked adjustments. Duplicate approval/posting and over-correction are rejected. Standalone reversal of a source-linked journal remains blocked: use the source correction workflow.

## Read gross and net amounts

Revenue schedule schema version 2 exposes the original gross totals and adjustments separately:

- Net billed = billed − credits − invoice reversals.
- Net receipts = recorded receipts − refunds − receipt reversals/chargebacks.
- Net allocated = allocations − allocation releases.
- Receivable = net billed − net allocated.
- Unapplied = net receipts − net allocated.

Only posted records affect these totals; approved reservations affect availability but not totals. These remain all-date/all-session source schedules, not verified bank balances or financial statements. Earlier schema-1 responses are explicitly accepted for prior-release tests; they do not silently acquire correction fields or invented zero values.

## Synthetic acceptance and limits

The recorded fixture starts with a 100000-minor-unit invoice, 120000 receipt and 100000 allocation. A 30000 release, 20000 credit, 40000 refund and approved-rule 5000 chargeback produce net billed 80000, net receipts 75000, net allocated 70000, receivable 10000 and unapplied 5000. Independently specified cash/accrual journal balances agree. This is a synthetic clearing-account policy example, not a recommendation for every institution.

A separate 20000 invoice and receipt are fully reversed into an open 2027 period while the original 2026 period stays locked. Three reversal journals link to their originals; original source status/version stays unchanged. Tests force failure during linkage and verify that source posting and generated journals roll back. They also reject self-approval, excess/competing refunds, backdated use of release funds, allocations against reversed receipts, unauthorised/private-function calls and closed-period corrections.

Reversing a posted correction itself, cascading a whole mixed correction chain, combined release/refund batches, external payment execution/verification, settlement reconciliation, signed document release, complete pagination/as-of exports and native/hosted/concurrent-session acceptance remain pending. Fully reversing an already partially corrected source is intentionally unavailable; use reviewed remaining adjustments rather than erasing history. Privileged database administrators remain trusted. Production financial use still requires professional policy acceptance, broader workflow acceptance, hosted security checks and tested restoration.
