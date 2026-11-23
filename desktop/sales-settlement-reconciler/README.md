# BGM Sales & Settlement Reconciler

Version 0.2.0 adds an interactive reconciliation dashboard with row outcome counts, a clearly defined sales match rate, clickable outcome navigation, and table search. The exported Summary sheet carries the same counts and match-rate definition.

Standalone Windows desktop utility for reviewing sales-register records against bank or payment-settlement exports. It is **not an Excel add-in**. The app reads `.xlsx` files on the computer, proposes only unambiguous one-to-one matches, keeps uncertain candidates for operator review, and exports a new report workbook. It does not connect to a bank, post accounting entries, or change source files.

## Run from source

Requirements: Windows 10/11 64-bit, Node.js 22.12+ and npm for source setup. Install the dependencies once while online, then run locally without a service or network connection:

```powershell
npm install
npm start
```

For the source tests:

```powershell
npm test
npm run samples -- --output .\sample-data
```

The generated fictional sample files are written into the ignored `.product-work/sales-settlement-reconciler/v0.2.0/samples` folder at the repository root. After setup, the reconciliation process itself uses local files only. No installer is included; a signed or installed Windows package was not built and verified in this environment.

## First run

1. Open the sample sales register and sample bank export, or choose your own `.xlsx` files.
2. Select each worksheet and its header row.
3. Review the suggested reference/date/amount mappings. Choose at least one common key. Add an extra text key when a repeated reference needs an additional discriminator.
4. Keep tolerances at zero unless you have a documented reason to allow a difference. Dates use DMY slash order by default; ISO dates such as `2026-11-17` are read directly.
5. Run the comparison, inspect the candidate explanations, and manually confirm ambiguous pairs.
6. Export the report to a new `.xlsx` file. The report cannot replace either source file and it will not overwrite an existing report.

Text identifiers are never coerced into numbers. Leading zeroes are retained when stored as text and can be recovered for numeric cells that carry an all-zero display format. If an upstream export already removed those zeroes without a display mask, the original identifier cannot be reconstructed.

## Supported files and limits

- Input and output: `.xlsx` OOXML workbooks only. `.xls`, `.xlsm`, encrypted files, macro execution, external links, bank PDFs and CSV files are not supported in this release.
- Up to 40 MB per input file, 100 MB expanded workbook package, 5,000 populated transaction rows per source, and 250,000 possible candidate pairs per run. If a duplicate-heavy input exceeds the candidate cap, the app stops without partial results; add a discriminating key or reconcile smaller periods.
- Single-user, one-computer workflow. There is no shared workspace, bank feed, permission model, multi-user review or cloud sync.
- A report is a workpaper to review, not an accounting opinion, statutory filing, or guarantee that an underlying entry is correct. The app does not retain prior run histories; save each exported report to preserve that run's processing log.
- Worksheet passwords, if present in a source, are not a supported security feature. Do not use workbook protection as data security.

## Security and data handling

Input bytes are opened through a file picker and parsed locally. The app never evaluates formulas; formula cells are preserved as literal formula text. Reports store user values as text cells, so imported strings beginning with `=`, `+`, `-` or `@` are not converted to formulas. The app does not send files to an external service. The app's window blocks navigation and web content and exposes only file selection/report saving through a narrow preload API. Protect your computer and exported report according to your organisation's normal access policy.

## Compatibility status

The utility targets Windows 10/11 x64 and standalone `.xlsx` files. Microsoft Excel is not installed in this build environment, so native Excel opening, printing and add-in hosting could not be acceptance-tested. The generated report round-tripped through the bundled OOXML reader and writer; that is not a substitute for opening the report in Excel. See `docs/COMPATIBILITY.md` for the researched host/add-in distinction.
