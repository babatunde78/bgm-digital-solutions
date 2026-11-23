# Quick start

## Install and open

On Windows 10/11, install Node.js 22.12 or newer for the source release. In PowerShell, open this product folder and run `npm install`, then `npm start`. Dependency setup needs an internet connection; after it is complete, the application performs its work locally. No signed installer is included.

## Use the sample data first

Use `Sample-Sales-Register.xlsx` as the left side and `Sample-Bank-Export.xlsx` as the right side. Both are fictional. The completed example is `Sample-Completed-Reconciliation.xlsx`.

1. Select a file, worksheet, and the row containing its column headings.
2. Confirm the Reference, Date, and Amount column mappings. The mapping dropdowns allow different headings on each side.
3. Check date convention and tolerance. Start at zero. Any tolerance widens candidate search and never hides the numerical difference.
4. Click **Run reconciliation**.
5. Start on the dashboard overview. It shows imported row counts, matched sales rows, the sales match rate, and separate outcome bars for sales and bank rows. Select a bar or the navigation to open a result section; use search to find values in the open table.
6. Review Matched, Ambiguous review, unmatched, duplicates, invalid rows, and the processing log. Duplicate groups can overlap other outcomes.
7. For each ambiguous row, choose one candidate and click **Confirm selected pair**. The app will not auto-select when either side has more than one candidate.
8. Export a fresh report workbook and review it before using it as a workpaper. Its Summary sheet includes dashboard counts and states the match-rate denominator.

## Read the results

- **Matched:** one candidate on each side, or a pair explicitly confirmed by a person. The match explanation lists normalized values and any date/amount difference.
- **Ambiguous:** two or more plausible pairs. No automatic pairing is made.
- **Unmatched:** no candidate under the selected keys and tolerances.
- **Duplicates:** repeated normalized selected-key combinations within either source; duplicates are not deleted.
- **Invalid rows:** missing/unreadable selected key values. Fix the upstream data or mapping and rerun.
- **Processing log:** source filenames, mapping, settings, totals, and every manual confirmation in the current run.

## Safe handling

Save the reconciliation report to a new file. The program refuses to overwrite either source workbook and refuses an existing output path. It does not alter the source files. Use secure local storage for the report because it contains a copy of selected workbook values.
