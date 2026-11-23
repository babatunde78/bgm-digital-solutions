# Product listing draft

## Title

Sales & Settlement Reconciler — Local Excel Matching Utility for Accountants

## Short description

Compare a sales-register `.xlsx` file with a bank or payment-settlement `.xlsx` export. Map different column headings, inspect the evidence behind proposed matches, manually confirm ambiguous pairs, and export a new reconciliation report without editing your source workbooks.

## What is included

- Windows-first standalone desktop application source.
- Exact matching with optional, visible date and amount tolerances.
- Separate matched, unmatched, ambiguous, duplicate and invalid-row views.
- Original cell values and source row references in the exported report.
- A processing log and settings record, including manually confirmed pairs.
- Two fictional sample workbooks and a completed example report.
- Installation, quick-start, calculation, compatibility and validation notes.
- Current suggested one-time price: **₦15,000 (about US$11.07)**. USD is an indicative reference only.

## Requirements

Windows 10/11 64-bit. The source release requires Node.js 22.12+ and npm for setup. Dependencies are installed once; subsequent processing is local. Accepts `.xlsx` only. No Excel add-in or installer is included in this release.

## Limits

This is a single-user matching and review aid. It does not connect to a bank, import PDFs, post accounting entries, automatically split one bank line across multiple sales, or certify accounting records. It supports up to 5,000 rows per source and stops safely if a run creates more than 250,000 possible candidate pairs. Do not claim statutory/accounting compliance from its reports.

## Price note

The ₦15,000 recommendation is a launch hypothesis informed by public spreadsheet-listing prices, not a validated Nigerian willingness-to-pay finding. US$11.07 uses an indicative ₦1,355.30/USD reference checked 17 November 2026. It is not a USD checkout price.
