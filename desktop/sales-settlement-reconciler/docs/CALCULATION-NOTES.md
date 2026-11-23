# Matching and normalization notes

## Candidate rule

The operator maps one or more columns from the sales register to columns in the bank/settlement export. All selected keys must agree for a candidate pair. Text keys are Unicode-normalized, trimmed, internal whitespace collapsed and case-normalized; punctuation and leading zeroes are retained. Keys that are blank or cannot be normalized are reported as invalid and excluded from candidate search.

Dates in ISO `YYYY-MM-DD` are parsed directly. Slash and dash dates with day/month positions use the selected DMY (default) or MDY setting. The date setting is shown in report settings; it must reflect the source export convention. Invalid calendar dates are exceptions. Two-digit years are interpreted as 1970–1999 or 2000–2069. Excel serial dates are read only when the cell has a recognized date number format.

Amounts may contain NGN/N currency markers, commas as thousands separators, a decimal point, or parentheses/minus for negatives. Comma-decimal formats such as `1.234,56` are rejected as unclear. Amounts are rounded to two decimal places. Amount tolerance is expressed in NGN and stored as integer kobo; date tolerance is whole calendar days. When nonzero, the output explains the value difference and configured tolerance.

## Auto-match and ambiguity

A pair is auto-matched only when the left row has exactly one candidate and that right row has exactly one left-side candidate. A wider candidate set is marked ambiguous. An operator confirmation records which pair was selected; a source row cannot be confirmed twice. The tool never resolves a tie by row order, closeness, or amount alone. If multiple candidates remain after a confirmation, they remain in the ambiguity queue.

Duplicate detection groups repeated values using all selected normalized keys within each source. Duplicate rows remain in place and are not necessarily the reason a row failed to match. Equal amounts alone are not duplicates unless Amount is the only selected key.

## Report content

The output workbook contains `Summary`, `Matched`, `Unmatched_Sales`, `Unmatched_Bank`, `Ambiguous`, `Duplicates`, `Invalid_Rows`, `Processing_Log`, and `Settings`. Matched and ambiguous results keep source row numbers and original values; each processing log records the run mapping, settings, result totals and row-level outcomes, including manual confirmations. The app does not keep a persistent history after closing; save each run's exported report. Input files are read-only to this app.

## Accounting limits

The utility compares records. It does not infer accounting meaning from a debit/credit column, net settlement, split deposits, chargebacks, foreign exchange, fees, one-to-many sums, or control accounts. Map an amount field whose sign and meaning are comparable on both sources. A one-bank-item-to-many-sales reconciliation is not automatically supported; it will usually be shown as ambiguous/unmatched and should be investigated or handled with a separately documented workflow. Review results with the responsible accountant.
