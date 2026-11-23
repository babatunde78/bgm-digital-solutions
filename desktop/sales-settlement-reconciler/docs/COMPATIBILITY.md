# Compatibility and host assessment

## Delivered architecture

The release is a standalone local Windows desktop application. It is **not** an Excel add-in, and it does not require Excel to execute the matching logic. It reads and exports `.xlsx` OOXML files. The process does not connect to a bank, payment provider or cloud service.

This is the smallest architecture in the current environment that meets the local-file requirement. Excel is present in the device's app inventory, but it was not opened for a native workbook acceptance test. The project source, matching tests, XLSX package round-trip, and the app's visible setup screen were tested; file-picker interaction and an installed Windows executable were not acceptance-tested. The expected `.xlsx` targets are Excel 2016+, Excel 2021/2024/Microsoft 365 and LibreOffice, but those hosts still need an open-and-inspect check before a commercial Windows installer is made.

## Excel add-in feasibility (researched, not built)

Microsoft's Office.js task-pane add-ins can interact with workbook tables, ranges and ribbon commands, with Excel hosts across Windows, Mac, web and iPad depending on the required API set. A task-pane add-in is web technology and its page/assets are normally served from a web server; Microsoft advises HTTPS for production/public Marketplace distribution. Although localhost is used during development, this creates extra hosting, manifest, host-version and network/office-runtime requirements. No Excel host was available to test one. It is not the chosen architecture for this local first release.

Excel Power Query is available in Excel 2016 and later standalone Windows editions, and current Microsoft 365 Excel. Microsoft's fuzzy matching applies to merge operations over text columns; it is not a general amount/date tolerance engine. Power Query remains a viable alternative for an accountant already comfortable building queries, but it does not by itself satisfy this product's reviewed ambiguous-pair workflow in a user-friendly desktop surface. Ablebits' product page currently lists Excel for Microsoft 365, Excel 2024, 2021, 2019 and 2016 (32- and 64-bit) for its add-ins; that compatibility statement applies to Ablebits, not this Electron app.

## Research sources

- [Microsoft: Excel add-ins overview](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-overview) — Office.js add-ins use web technologies and differ from COM/VSTO add-ins.
- [Microsoft: Office add-in requirements](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/add-in-requirements?view=excel-js-preview) — desktop host and web-server requirements, including Office 2016+ on Windows.
- [Microsoft: Excel Power Query availability](https://support.microsoft.com/en-us/excel/about-power-query-in-excel.) — Power Query experience in Excel 2016/2019 for Windows and supported Microsoft 365 capabilities.
- [Microsoft: Power Query source/version matrix](https://support.microsoft.com/en-us/excel/power-query-data-sources-in-excel-versions?preview=true) — lists Excel 2016 or later Windows standalone versions and Microsoft 365 plans.
- [Microsoft: Power Query fuzzy match](https://support.microsoft.com/en-gb/excel/create-a-fuzzy-match-power-query) — fuzzy matching is a merge operation on text columns and exposes a similarity threshold.
- [Ablebits add-ins](https://www.ablebits.com/addins.php) — vendor-listed Excel versions for its add-ins.

## Windows packaging

No installer or signed executable is included. The source can be started with Node.js/npm using the README instructions. Building and testing an installer requires a Windows packaging/acceptance environment and is a separate verified release step; a successful source test does not establish installed-app behaviour.
