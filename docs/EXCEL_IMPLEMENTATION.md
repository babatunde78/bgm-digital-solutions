# Excel pilot 0.2.1

## Buyer outcome and release boundary

Package A supports student billing, allocations/credits/refunds, receipt returns, settlement matching and source-linked revenue schedules. Package B supports budget amendments/transfers, commitment liquidation, bills/payments, advances, grant cash schedules, assets and payroll comparison. Full Excel combines both and adds manual journal inputs, trial balance and control-account comparisons. These are macro-free, single-writer schedules with procedural controls, not secure multi-user accounting software. The pilot is not published for purchase.

All monetary input columns ending `_minor` are integer kobo, not NGN. For example, NGN 1,200.50 is entered as 120050. Reports divide by 100 and display NGN. Monetary input validation accepts whole numbers only. NGN is the only implemented workbook currency; changing the currency label does not convert data. IDs/references are text, including leading zeros. Dates are native Excel dates displayed `yyyy-mm-dd`; CSV dates must be ISO.

## Generate reproducibly

Use the repository's Node runtime and the separately managed `@oai/artifact-tool` runtime (no storefront dependency change). `--artifact-modules PATH` can identify that runtime's `node_modules`; otherwise the generator checks the documented Codex runtime cache under the user's home directory. It creates a junction/symlink in ignored product work. Missing runtime means generation cannot run; do not substitute dummy files.

```text
node scripts/campus-build.mjs
<managed-python> scripts/campus-finish.py
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/campus-excel-verify.ps1
```

`campus-finish.py` requires the managed Python runtime's lxml package to preserve OOXML namespace declarations. It adds print areas, repeat headings and accidental-edit protection using unsupported-feature postprocessing. Run it before Excel native verification. Do not apply it to customer-modified workbooks. The native finaliser/verifier adds PivotAnalysis using real Excel PivotTables and embeds the optional CampusImportPreview Power Query function, then tests and saves recalculated workbooks. It uses a separate hidden Excel instance, never an existing user session. RemoteSigned is a process-only option where local script policy requires it; do not change machine policy.

The active edition is defined once in `lib/campus-release.json`. Default output is `.product-work/campus-bursary/v0.2.1/`: `a-clean.xlsx`, `a-demo.xlsx`, `b-clean.xlsx`, `b-demo.xlsx`, `excel-clean.xlsx`, `excel-demo.xlsx`. The earlier v0.2.0 artifacts are retained. Only generated draft outputs are overwritten by regeneration; never use the generation folder as the only customer record store. Templates contain no financial transactions; demos contain fictional entities and illustrative journal mappings. No file is on the public website or uploaded to storage.

For a validated private dataset, use `node scripts/campus-build.mjs --dataset YOUR_DATA.json --package a` (or b/excel). This writes a new timestamped private directory. Pass that directory to `campus-finish.py` and the verifier's `-OutputDirectory` parameter. Over 100 source rows per table are rejected, never silently truncated. Monetary inputs are limited to 999999999999 kobo per field, matching worksheet validation and keeping these bounded schedules within Excel precision. One hundred prepared rows is a layout limit, not measured commercial capacity. Expansion requires retesting.

## Institution setup

Save a dated copy outside the build folder. Configure the Institutions row and its configuration JSON, then Config: product name, institution, address/contact, NGN, as-of date, academic session and financial period, timezone/date format, officers, numbering and control accounts. AcademicStructures holds campus/faculty/department/programme/level/study-mode records using `kind` and parent IDs. Set Sessions, Periods, Accounts, Funds, Banks, CostCentres and Officers before dependent transactions. Institution IDs must match throughout.

Config's primary-colour field records a desired brand colour; automatic recolouring is not implemented. Product name is linked to dashboard titles. Institution name is linked to documents. For a logo, use Excel Insert > Pictures and preserve aspect ratio manually. No upload widget, logo validation or signature-image release is implemented in standalone Excel. Do not embed confidential signatures in distributed copies.

Review > Unprotect Sheet (no password) permits deliberate structural maintenance. Re-protect after edits. Input cells are amber/blue; calculated columns are sage/green. Filters and input cells remain available under protection. The protection prevents accidents and is not a confidentiality or integrity boundary. Use restricted file storage and one authorised writer. Keep sensitive payroll separately where needed.

## Daily use

1. Create master records before dependent rows. Fill all required source columns; use visible input_status and Exceptions. Do not rename table/column IDs or paste over formula columns.
2. Enter invoices and separate lines. Multiple due dates support instalments. Use explicit fee accounts. Credit rows identify the exact invoice line and reason for a waiver/discount; charges/penalties are additional invoice lines. Scholarships record awards and applied amounts; actual fee reductions/collections still need credits or receipt allocations, never a second revenue entry.
3. Record payments independently from allocations. Split allocations across lines and receipts as needed. Unapplied receipts remain separate. Refunds and chargebacks require an explicit allocation release where already allocated; never erase the original receipt. Keep source documents and manual approval evidence.
4. ReconciliationMatches supports split and grouped matches by adding rows. Only manually reviewed `approved` matches affect settlement totals. Net must equal gross less fees. Suggested matches remain unapproved; no fuzzy auto-posting exists. Do not confirm bank receipt from screenshots.
5. Budgets have one base record per account/period/fund. Revisions use signed BudgetChanges; virements use paired from/to budget IDs. Bills liquidate linked commitments; a bill is actual expenditure and a payment settles the liability, not a second expense. Expenses and retirement expenses contribute actuals only once. Retirements distinguish evidenced expenses from returned cash.
6. GrantEntries is a restricted-project cash schedule and does not automatically post journals. Assets use completed-month straight-line depreciation from depreciation_start_date plus approved opening depreciation, capped at cost less residual. Useful life is in months; disposal postings and accounting policies require manual review. PayrollChecks compares imported payroll with PriorPayroll; it computes no statutory payroll or tax.
7. Obtain manual preparer/reviewer/approver evidence before marking a source posted. ApprovalLog is editable and is not a tamper-proof audit trail. Excel cannot enforce role separation, period locks or concurrent posting. Never remove posted history by changing status back to draft or deleting rows; prepare linked reversal/credit records and approved contra journals.

## Reports and signatures

Dashboard revenue uses posted invoice lines in the selected academic session through as-of date. Treasury/receipts and payables are cumulative across sessions/periods. Budget summaries use the selected financial period. Do not compare a filtered subledger with an all-session ledger; clear the session filter for the receivables control check. Individual working schedules include draft records for review, identified by their status columns; filter to the approved scope before printing.

Ageing shows due dates, days and buckets. StudentStatement selects a student in Config B34 and lists posted invoices through as-of date; rows retain source order and can include gaps. Clearance is a finance-balance review only, not academic clearance. CashierHandover lists receipts for a manual cashier handover; grouped cashier close totals and signed handover acceptance are procedural. No public-bank balance claim is made by net settlement inflows.

Config B20–B22 set document ID, revision and selected source record ID. Receipt uses a payment ID; Statement uses an invoice ID; RefundApproval uses a refund ID; Voucher uses a supplier-payment ID; BudgetApproval uses a budget ID; AdvanceRetirement uses a retirement ID. Set named officers and review print preview. Signature lines are manual. Source status is displayed; a printout is not authenticated approval. PaymentSchedule is a proposal, never payment execution. Source print areas include all 100 prepared rows, with up to two pages across for wide schedules and more pages down as necessary. Filter the ID column to nonblank before printing a partly filled table, then clear the filter before data entry. ID columns and headings repeat across pages. Calculated helper columns are available on screen; use specialised reports for printable calculated results.

The GL is JournalHeaders/JournalLines, with source links, reversals and separate opening balances. Full suite reporting reads posted journals. There is no automatic journal generation from transaction schedules. Approved institution-specific mappings, opening subledger records and control reconciliation are required. No statutory financial statements are supplied while accounting basis/policies are unconfirmed.

## Import staging and source validation

```text
node scripts/campus-data.js validate DATA.json
node scripts/campus-data.js report DATA.json 2026-11-07
node scripts/campus-data.js import DATA.json resources/campus/student-import.csv resources/campus/student-import-mapping.json NEW_DATA.json
node scripts/campus-data.js bill DATA.json BILLING_OPTIONS.json NEW_DATA.json
node scripts/campus-data.js reverse DATA.json JOURNAL_ID REVERSAL_OPTIONS.json NEW_DATA.json
```

The import mapping maps target fields to CSV header names and supplies a batchId/table. Inputs remain unchanged. A failed import returns row/field errors and no updated dataset. Success returns a validated draft dataset; it never posts journals. Stable IDs, content hash, leading zeros, safe integer amounts, ISO dates and same-institution references are checked. Replay returns the same dataset; changed content with a reused batch ID is rejected. JSON/CSV routines are local developer/operator tools, not an Excel upload button. Review the returned preview and financial control total before generating a workbook.

Billing options: batchId, sessionId, date, dueDate. It previews fee schedules for each student/programme/level as draft invoices, checks period lock metadata and avoids repeat IDs. Journal-reversal options: id, date, reason. It creates balanced contra lines in an open period and preserves originals. This does not reverse the source subledger automatically; reconcile and prepare the corresponding authorised source corrections. Local tools do not constitute server security.

`resources/campus/import-preview.pq` supplies an optional Power Query staging function. The native finaliser embeds it as CampusImportPreview; invoke it with an explicitly selected CSV path and text/date/minor-unit column lists. It retains source fields as text, adds row errors and supplies `preview_refresh_utc` for the last successful preview evaluation. It uses legacy-compatible culture arguments and an exact ISO round trip for dates. Native testing on the recorded Windows Excel build verified successful refresh, leading zeros, invalid-row flags, formula-like text remaining inert, and a missing-file failure retaining the earlier timestamp. This does not automatically post imports or refresh financial dashboards. Do not load directly over financial tables or treat retained preview rows as fresh after an error. The delivered templates contain a dormant function, with no external-workbook connection or automatic CSV connection. PivotAnalysis uses source tables and integer kobo; recalculate, then Data > Refresh All and review the posted-status filter before using a pivot total.

## Reproduce technical acceptance

```text
node scripts/campus-acceptance-data.js
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/campus-query-acceptance.ps1
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/campus-capacity-acceptance.ps1
```

These scripts use disposable copies, record original-file hashes and write evidence under `.product-work/campus-bursary/acceptance/`. Run the capacity test without other Excel work or concurrent load when comparing timings. The fixture fills 100 rows in major revenue, purchasing, payment and advance tables, with 18 explicitly specified batch journal lines. It does not benchmark 100 separate journal postings, payroll/assets/grants, concurrency or larger datasets. An initial accepted trial measured rebuilds of 200, 193 and 195 ms, opening at 6,225 ms and filling at 2,969 ms. The final evidence run measured rebuilds of 235, 210 and 234 ms, opening at 6,226 ms and filling at 3,497 ms. These observations are not a service guarantee or general institution capacity claim. All 100 bill IDs and nine source headers were found in an eight-page supplier-bill printout; page boundaries were inspected visually.

## Close, recovery and upgrades

Reconcile source totals, ageing/control balances, cash, supplier payments and settlement exceptions before close. Save a dated immutable copy and an approved report/PDF set. Set Periods.locked and keep a manual close register; a user can still edit Excel, so restricted access and review are essential. For rollover, add new periods/sessions and fee/budget records without overwriting the prior year. Do not add carry-forward opening balances to a file that retains the prior journals: that would double-count the balances. Use approved carry-forward balances only in a new reconciled file with matching opening subledgers. No automated rollover exists.

Back up before imports and upgrades, keep at least one copy in a separately restricted location and use the institution-approved retention policy. Restore a copy into an isolated folder, open without updating external links, recalculate and compare independent source totals before resuming. Never delete records or prevent historical export at licence expiry. Upgrades use a new clean edition and validated import/reconciliation; automatic in-place migration is not implemented.

## Compatibility evidence and primary sources

Target is Microsoft 365 Excel for Windows 64-bit; native verification records installed Excel 16.0 build 13127. Generation, static OOXML inspection and native execution are distinct checks. The 100-row synthetic workload and local CSV preview function have been tested on that build. Mac, web, other builds, real customer imports and larger production capacity remain unverified. Vendor maximum row counts are not product capacity evidence.

Reviewed 7 November 2026: [Microsoft worksheet protection](https://support.microsoft.com/en-us/excel/protection-and-security-in-excel) confirms worksheet protection is not a security feature; [structured references](https://support.microsoft.com/en-us/excel/using-structured-references-with-excel-tables) explains table-reference behaviour; [Power Query data sources](https://support.microsoft.com/en-us/excel/power-query-data-sources-in-excel-versions) shows support varies by edition. These sources describe platform behaviour and do not prove acceptance of these workbooks.

Implementation references checked for this update: [legacy date parsing](https://learn.microsoft.com/en-us/powerquery-m/date-fromtext), [query refresh semantics](https://learn.microsoft.com/en-us/office/vba/api/Excel.QueryTable.Refresh), [pivot location](https://learn.microsoft.com/en-us/office/vba/api/excel.pivottable.location) and [protected-sheet filtering](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheet.protect). Compatibility beyond the recorded native tests is not inferred from these references.
