# Validation results — v0.2.0

## Automated checks

`npm.cmd test` passed **12 tests, 0 failed**. Checks cover matching rules, ambiguous candidate review, leading-zero identifiers, date and amount normalization, limits, source preservation, dashboard counts and the sales match-rate denominator, XLSX report generation, and safe XLSX parsing.

`node --check` passed for `main.js`, `preload.js`, `core.js`, `xlsx.js`, `xlsx-client.js`, and `renderer.js`.

## Dashboard

The overview shows imported sales and bank rows, matched sales rows, and the sales match rate. Outcome bars and side navigation open result sections; search filters the active table. The Summary worksheet uses the same computed counts and defines the match-rate denominator as imported sales rows. Electron was not available for a visual desktop run in this environment.

## Fictional demonstration data

The included fictional workbooks cover automatically matched rows, ambiguous candidates that require a person, unmatched rows and duplicate keys. They do not contain customer or real financial data.

The app reads `.xlsx` files locally, does not modify source files, and does not upload workbook contents. It is a review aid, not an accounting opinion or compliance filing.
