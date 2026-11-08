# Bank import staging and reviewed reconciliation

This is a local pilot for generic bank/provider statement CSVs, independent import acceptance, reviewed matching and traceable match voiding. It is not a live bank/provider integration, payment executor, proof from screenshots, complete bank balance, or automatic ledger settlement. Configure and test a dedicated project before using live information. Existing storefront subscription billing is unrelated and unchanged.

Apply `008_bank_imports.sql` then `009_reconciliation.sql` after 001–007, following DEPLOYMENT.md backup/review procedures. No bank accounts, provider credentials or customer rows are seeded. Statement sources reference configured institution asset accounts and inherit the institution currency. Multiple-currency conversion is not implemented.

## Map and stage a CSV

An institution administrator creates a named statement source linked to a configured asset account. Cashiers, student accounts officers and bursars can stage rows. Select that source, read a UTF-8 CSV or paste its text, and map these eight target fields to exact source column names:

```csv
transaction_id,date,reference,direction,currency,gross_minor,fee_minor,net_minor
000001,2026-11-09,GROUP-A,credit,NGN,60000,1000,59000
000002,2026-11-10,000-RECEIPT-B,credit,NGN,40000,0,40000
```

Amounts are integer minor units, not decimal naira. Dates must be exact ISO `YYYY-MM-DD` and valid calendar dates. Direction is explicitly `credit` or `debit`; provider-specific labels or decimal amounts must be transformed through a separately reviewed process, not guessed by this importer. Credit gross − fee must equal net; debit gross + fee must equal net. Transaction IDs/references remain text, including leading zeros. Blank references can remain unidentified; transaction IDs must be nonblank.

The shared CSV parser handles quoting/escaped quotes and preserves text. Structural errors such as duplicate headers, malformed quotes, incorrect column counts or invalid mappings reject the request before staging. The parser identifies a logical CSV record for width errors, not necessarily a physical line when quoted newlines exist. Data validation preserves raw cells and mapped values with per-row errors for ambiguous/impossible dates, currency mismatch, unsafe formula/control text, invalid integer amounts, inconsistent control totals and duplicates. Unsafe text is stored as literal diagnostic content and never executed; CSV export is not provided yet.

Limits are 100 data rows, 20 columns and 120000 CSV bytes, plus the application request envelope limit. These are input guards, not measured production capacity. When any row has errors, the batch is `invalid` and its aggregate amounts are unavailable (`null`), not zero. Correct the data and stage a new batch; staged rows cannot be edited in place.

The server fingerprints canonical raw cells, mapping and source. Reusing a batch ID with changed content is rejected; an identical import under a new ID returns the existing batch ID/status. Accepted rows additionally have a source/transaction-ID uniqueness constraint. This does not deduplicate arbitrary aliases for the same real bank account or detect deliberately changed transaction IDs.

## Independently verify and accept

Uploading or staging is not bank verification and creates no accepted statement lines, income, allocations or journals. A bursar other than the uploader must inspect errors/control totals, independently verify the statement through the trusted bank/provider channel and record that reference/note. This is an authenticated human verification record, not a claim that the application called a bank API.

Acceptance requires an error-free staged batch and current version. The server rechecks accepted transaction IDs under a source lock; a collision or interrupted insertion rolls back the whole acceptance. An accepted batch contains immutable statement lines and a verifier/time/note. Replaying the same successful acceptance with the same note returns its existing result. Changing that historical note is not an edit workflow. Correcting/voiding accepted imports and replacement statements remain pending; do not delete bank rows or change uniqueness guards.

Institution administrators can see source configuration but have no implicit finance access: financial totals are unavailable rather than misleading zeros. Finance roles and auditors see their institution's staged data/accepted lines only. Public pages contain none of this information.

## Review split/grouped matches

Choose an accepted bank-line ID to request suggestions. Suggestions distinguish exact reference plus available amount, available amount alone, and partial matching candidates. They are not confirmations. Every candidate requires explicit selection and independent review; there is no auto-match, fuzzy approval or implicit tolerance.

Create a proposal containing one or more `bank line / posted source / gross amount` pairs. One line can link multiple sources and one source can link multiple lines. Incoming credits can match posted receipts. Outgoing debits can match posted refunds/chargebacks. Ordinary bookkeeping receipt reversals are not bank outflows. Bank dates must not precede the source posting date; earlier-bank timing cases need a later explicit treatment rather than a silent date override.

The preparer submits, a different reviewer/bursar reviews, and a bursar other than the preparer approves with an explicit verification note. The same independent bursar may review/approve in this pilot. Available bank/source gross amounts are rechecked under sorted row locks at approval; drafts do not reserve amounts. Reusing already matched capacity is refused. Partial approvals leave unmatched amounts visible. Approved groups confirm those matching allocations only, not that an entire statement, institution cash balance or ledger reconciliation is complete.

Statement fees/net stay separate from matched gross. Matching creates no journals and never counts settlement as new income. Clearing-to-bank transfers, fee expense journals, approved nonzero tolerance adjustments and general-ledger control-account reconciliation remain manual/pending integration. Do not interpret zero unmatched gross as proof that fee accounting and all control accounts reconcile.

## Void a mistaken approved match

A bursar submits a void request with a reason, another reviewer/bursar reviews it, and a bursar other than the void preparer approves the void. Original pairs/approval metadata remain intact; audit history records the new actors/reason/status. Amounts remain reserved during `void_submitted`/`void_reviewed` and are freed only at `voided`. Unapproved proposals can be cancelled with the checked permissions. There is no deletion or financial reversal from a match void.

A receipt with an active approved/void-pending bank match cannot be approved/posted as a bookkeeping receipt reversal. Use the proper reviewed refund/chargeback workflow for actual bank movement, or first resolve an erroneous match through the void process. The original bank line remains as an outstanding item after voiding; it is not erased.

## Interpret schedules and acceptance

Schedules list accepted credit/debit gross, fees and net separately, plus matched/unmatched gross. They cover all imported accepted rows, not an opening-balance-complete bank statement or financial-year cash dashboard. Invalid/staged batches do not contribute. Panels show at most 100 records; complete pagination, filters, secure source-file storage, statement-opening balances and exports are pending.

The synthetic fixture verifies two credit rows with gross 100000, fees 1000 and net 99000, matched through three allocations to two pre-posted receipt fixtures. It tests a split/grouped match, capacity reuse refusal and a separately approved void that restores 100000 unmatched gross. A debit fixture verifies gross 10000, fees 100 and net 10100 against a posted refund fixture. These pre-posted source fixtures isolate matching; the separate revenue tests cover financial posting.

Checks also cover quoted CSV/leading zeros, ambiguous and impossible dates, formula-like text, wrong currency, fractional amounts, unavailable totals, duplicate IDs/files, changed batch content, a forced second-row acceptance failure, self-verification/review denial, exact/amount/partial suggestions, direction errors, source-reversal guarding, tenant isolation, direct-write denial, late-response protection and sign-out clearing. Local PostgreSQL/jsdom/mock HTTP checks do not establish native browser/mobile, actual provider-channel verification, simultaneous-connection behaviour, managed restoration or production capacity. Those remain launch acceptance work.
