param([string]$OutputDirectory = '', [ValidateSet('', 'a', 'b', 'excel')][string]$PackageId = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Get-Content -LiteralPath (Join-Path $root 'lib/campus-release.json') -Raw | ConvertFrom-Json
if ($OutputDirectory -eq '') { $OutputDirectory = Join-Path $root ('.product-work/campus-bursary/' + $release.directory) }
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $resolvedOutput 'manifest.json') -Raw | ConvertFrom-Json
if ($PackageId -ne '') { $manifest = @($manifest | Where-Object { $_.packageId -eq $PackageId }) }
$results = [System.Collections.Generic.List[object]]::new()
$excelApplication = $null
function Protect-Inputs($sheet) {
    $sheet.Protect('', $true, $true, $true, $false, $false, $false, $false, $false, $false, $false, $false, $false, $false, $true, $false)
}
try {
    foreach ($entry in $manifest) {
        $workbook = $null
        try {
            $excelApplication = New-Object -ComObject Excel.Application
            $excelApplication.Visible = $false
            $excelApplication.DisplayAlerts = $false
            $excelApplication.AskToUpdateLinks = $false
            $excelApplication.AutomationSecurity = 3
            $filePath = Join-Path $resolvedOutput $entry.file
            $workbook = $excelApplication.Workbooks.Open($filePath, 0, $false)
            foreach ($versionSheet in $workbook.Worksheets) {
                $versionSheet.Unprotect()
                $note = [string]$versionSheet.Range('A3').Value2
                if ($note.Contains('0.2.0')) { $versionSheet.Range('A3').Value2 = $note.Replace('0.2.0', [string]$release.version) }
                $versionSheet.PageSetup.LeftFooter = [string]$workbook.Worksheets.Item('Config').Range('B5').Value2 + ' ' + [string]$release.version + ' ' + [string]$release.status
                if (@($entry.sheets | Where-Object { $_.name -eq $versionSheet.Name -and $null -ne $_.fields }).Count -eq 1) {
                    $sourceSpec = @($entry.sheets | Where-Object { $_.name -eq $versionSheet.Name })[0]
                    $lastColumn = $versionSheet.Cells.Item(1, [int]$sourceSpec.rawCount).Address($false, $false).TrimEnd('1')
                    $versionSheet.PageSetup.PrintArea = 'A1:' + $lastColumn + [string](6 + [int]$release.preparedRows)
                }
                Protect-Inputs $versionSheet
            }
            $documentOverrides = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../lib/campus-documents.json') -Raw | ConvertFrom-Json
            foreach ($document in $documentOverrides.PSObject.Properties) {
                $documentSheet = $null
                try { $documentSheet = $workbook.Worksheets.Item($document.Name) } catch [System.Runtime.InteropServices.COMException] {}
                if ($null -ne $documentSheet) {
                    $documentSheet.Unprotect()
                    foreach ($cell in $document.Value.PSObject.Properties) {
                        if ($cell.Value.formula) { $documentSheet.Range($cell.Name).Formula = [string]$cell.Value.formula }
                        else { $documentSheet.Range($cell.Name).Value2 = [string]$cell.Value.value }
                        if ($cell.Value.format) { $documentSheet.Range($cell.Name).NumberFormat = [string]$cell.Value.format }
                    }
                    $documentSheet.Protect()
                }
            }
            foreach ($layoutName in @('Config', 'ReadMe')) {
                $layoutSheet = $workbook.Worksheets.Item($layoutName)
                $layoutSheet.Unprotect()
                $layoutSheet.Range('A2:H2').UnMerge()
                $layoutSheet.Range('A2:B2').Merge()
                $layoutSheet.Range('A3:H3').UnMerge()
                $layoutSheet.Range('A3:B3').Merge()
                $layoutSheet.Protect()
            }
            $dashboard = $workbook.Worksheets.Item('Dashboard')
            $dashboard.Unprotect()
            for ($row = 6; $row -le 30; $row++) {
                $formula = [string]$dashboard.Cells.Item($row, 2).Formula
                if ($formula.Contains('COUNTIF(T_Budgets[status],"posted")=0')) {
                    $dashboard.Cells.Item($row, 2).Formula = $formula.Replace('COUNTIF(T_Budgets[status],"posted")=0', 'COUNTIFS(T_Budgets[status],"posted",T_Budgets[period_id],IF(Config!$B$12="","*",Config!$B$12))=0')
                }
            }
            $dashboard.Protect()
            foreach ($layoutName in @('GrantReport', 'AssetReport', 'TrialBalance')) {
                $layoutSheet = $null
                try { $layoutSheet = $workbook.Worksheets.Item($layoutName) } catch [System.Runtime.InteropServices.COMException] {}
                if ($null -ne $layoutSheet) {
                    $layoutSheet.Unprotect()
                    $layoutSheet.Range('C:C').ColumnWidth = 32
                    $layoutSheet.Protect()
                }
            }
            $readmeSheet = $workbook.Worksheets.Item('ReadMe')
            $readmeSheet.Unprotect()
            for ($row = 6; $row -le 30; $row++) {
                if ($readmeSheet.Cells.Item($row, 1).Value2 -eq 'Printing') {
                    $readmeSheet.Cells.Item($row, 2).Value2 = 'Source print areas include all prepared rows. Filter blank IDs before printing and clear filters before data entry. Review all pages of wide schedules.'
                }
                if ($readmeSheet.Cells.Item($row, 1).Value2 -eq 'Release') {
                    $readmeSheet.Cells.Item($row, 2).Value2 = [string]$release.version + ' pilot; Excel acceptance and institution policy approval required before sale.'
                }
            }
            $readmeSheet.Protect()
            if ($entry.packageId -eq 'excel') {
                $controlSheet = $workbook.Worksheets.Item('ControlAccounts')
                $controlSheet.Unprotect()
                $controlSheet.Range('B6:B9').NumberFormat = '#,##0.00;(#,##0.00);0.00'
                $controlSheet.Protect()
            }
            $excelApplication.CalculateFullRebuild()
            $pivotSheet = $null
            try { $pivotSheet = $workbook.Worksheets.Item('PivotAnalysis') } catch [System.Runtime.InteropServices.COMException] {}
            if ($null -eq $pivotSheet) {
                $pivotSheet = $workbook.Worksheets.Add()
                $pivotSheet.Name = 'PivotAnalysis'
                $pivotSheet.Cells.Font.Name = 'Arial'
                $pivotSheet.Cells.Font.Size = 10
                $pivotSheet.Range('A1').Value2 = [string]$workbook.Worksheets.Item('Config').Range('B5').Value2 + ' pivot analysis'
                $pivotSheet.Range('A2').Value2 = 'Values in integer kobo. Recalculate, then Data > Refresh All. Review the posted-status filter.'
                $pivotSheet.Range('A2:F2').Merge()
                $pivotSheet.Range('A2:F2').WrapText = $true
                $pivotSheet.Rows.Item(2).RowHeight = 32
                $pivotSheet.Range('A:F').ColumnWidth = 23
                if ($entry.packageId -ne 'b') {
                    $cache = $workbook.PivotCaches().Create(1, 'T_InvoiceLines')
                    $pivot = $cache.CreatePivotTable($pivotSheet.Range('A5'), 'CampusStudentBalances')
                    $pivot.PivotFields('student_id').Orientation = 1
                    $pivot.PivotFields('invoice_status').Orientation = 3
                    [void]$pivot.AddDataField($pivot.PivotFields('balance_minor'), 'Outstanding kobo', -4157)
                    if ($entry.mode -eq 'demo') { $pivot.PivotFields('invoice_status').CurrentPage = 'posted' }
                    $pivot.RefreshTable() | Out-Null
                }
                if ($entry.packageId -ne 'a') {
                    $cache = $workbook.PivotCaches().Create(1, 'T_SupplierBills')
                    $pivot = $cache.CreatePivotTable($pivotSheet.Range('D5'), 'CampusSupplierBalances')
                    $pivot.PivotFields('supplier_id').Orientation = 1
                    $pivot.PivotFields('status').Orientation = 3
                    [void]$pivot.AddDataField($pivot.PivotFields('balance_minor'), 'Payable kobo', -4157)
                    if ($entry.mode -eq 'demo') { $pivot.PivotFields('status').CurrentPage = 'posted' }
                    $pivot.RefreshTable() | Out-Null
                }
                $pivotSheet.PageSetup.PrintArea = '$A$1:$F$112'
                $pivotSheet.PageSetup.Orientation = 2
                $pivotSheet.PageSetup.Zoom = $false
                $pivotSheet.PageSetup.FitToPagesWide = 1
                $pivotSheet.PageSetup.FitToPagesTall = $false
            }
            $pivotSheet.Unprotect()
            if ($entry.packageId -ne 'a') { $pivotSheet.PivotTables('CampusSupplierBalances').Location = "'PivotAnalysis'!`$D`$5" }
            $pivotSheet.PageSetup.PrintArea = '$A$1:$F$112'
            $pivotSheet.PageSetup.FitToPagesTall = $false
            $queryExists = $false
            $querySource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../resources/campus/import-preview.pq') -Raw
            foreach ($query in $workbook.Queries) { if ($query.Name -eq 'CampusImportPreview') { $queryExists = $true } }
            if (-not $queryExists) {
                [void]$workbook.Queries.Add('CampusImportPreview', $querySource)
            } else { $workbook.Queries.Item('CampusImportPreview').Formula = [string]$querySource }
            $errors = [System.Collections.Generic.List[object]]::new()
            foreach ($sheet in $workbook.Worksheets) {
                $errorCells = $null
                try { $errorCells = $sheet.UsedRange.SpecialCells(-4123, 16) } catch [System.Runtime.InteropServices.COMException] {}
                if ($null -ne $errorCells) {
                    foreach ($cell in $errorCells.Cells) { $errors.Add(@{ sheet = $sheet.Name; address = $cell.Address(); error = $cell.Text }) }
                }
            }
            $dashboard = $workbook.Worksheets.Item('Dashboard')
            $readings = [ordered]@{}
            for ($row = 6; $row -le 30; $row++) {
                $label = [string]$dashboard.Cells.Item($row, 1).Value2
                if ($label -ne '') { $readings[$label] = $dashboard.Cells.Item($row, 2).Value2 }
            }
            $checks = [System.Collections.Generic.List[object]]::new()
            if ($entry.mode -eq 'demo') {
                $expected = if ($entry.packageId -eq 'a') { @{ 'Billed fees' = 300000; 'Allocated collections' = 220000; 'Student receivables' = 70000; 'Unapplied receipts' = 30000 } }
                elseif ($entry.packageId -eq 'b') { @{ 'Approved budget' = 100000; 'Actual expenditure' = 30000; 'Open commitments' = 10000; 'Supplier payables' = 10000 } }
                else { @{ 'Billed fees' = 300000; 'Student receivables' = 70000; 'Approved budget' = 100000; 'Actual expenditure' = 30000; 'Ledger bank balance' = 225000 } }
                foreach ($label in $expected.Keys) { $checks.Add(@{ name = $label; expected = $expected[$label]; actual = $readings[$label]; passed = ($readings[$label] -eq $expected[$label]) }) }
                if ($entry.packageId -ne 'b') {
                    $studentPivot = $pivotSheet.PivotTables('CampusStudentBalances')
                    $studentPivot.RefreshTable() | Out-Null
                    $pivotBalance = $studentPivot.GetPivotData('Outstanding kobo').Value2
                    $checks.Add(@{ name = 'Student pivot agrees with source'; expected = 7000000; actual = $pivotBalance; passed = ($pivotBalance -eq 7000000) })
                }
                if ($entry.packageId -ne 'a') {
                    $supplierPivot = $pivotSheet.PivotTables('CampusSupplierBalances')
                    $supplierPivot.RefreshTable() | Out-Null
                    $pivotBalance = $supplierPivot.GetPivotData('Payable kobo').Value2
                    $checks.Add(@{ name = 'Supplier pivot agrees with source'; expected = 1000000; actual = $pivotBalance; passed = ($pivotBalance -eq 1000000) })
                }
                if ($entry.packageId -eq 'excel') {
                    $controls = $workbook.Worksheets.Item('ControlAccounts')
                    for ($row = 6; $row -le 9; $row++) { $checks.Add(@{ name = [string]$controls.Cells.Item($row, 1).Value2; expected = 0; actual = $controls.Cells.Item($row, 2).Value2; passed = ($controls.Cells.Item($row, 2).Value2 -eq 0) }) }
                }
                if ($entry.packageId -ne 'b') {
                    $config = $workbook.Worksheets.Item('Config')
                    $originalDate = $config.Range('B8').Value2
                    $config.Range('B8').Value2 = [double]([datetime]'2026-10-01').ToOADate()
                    $excelApplication.CalculateFullRebuild()
                    $checks.Add(@{ name = 'As-of edit recalculates receivables'; expected = 300000; actual = $dashboard.Range('B9').Value2; passed = ($dashboard.Range('B9').Value2 -eq 300000) })
                    $config.Range('B8').Value2 = [double]$originalDate
                    $paymentTable = $workbook.Worksheets.Item('Payments').ListObjects.Item('T_Payments')
                    $amountCell = $paymentTable.ListColumns.Item('amount_minor').DataBodyRange.Cells.Item(1, 1)
                    $originalAmount = $amountCell.Value2
                    $amountCell.Value2 = [double]($originalAmount + 100000)
                    $excelApplication.CalculateFullRebuild()
                    $checks.Add(@{ name = 'Receipt edit recalculates unapplied amount'; expected = 31000; actual = $dashboard.Range('B13').Value2; passed = ($dashboard.Range('B13').Value2 -eq 31000) })
                    $amountCell.Value2 = [double]$originalAmount
                    $config.Range('B22').Value2 = 'p-1'
                    $excelApplication.CalculateFullRebuild()
                    $receipt = $workbook.Worksheets.Item('Receipt')
                    $checks.Add(@{ name = 'Receipt selected amount'; expected = 80000; actual = $receipt.Range('B11').Value2; passed = ($receipt.Range('B11').Value2 -eq 80000) })
                    $checks.Add(@{ name = 'Leading-zero receipt reference'; expected = '000PAY1'; actual = $receipt.Range('B18').Value2; passed = ($receipt.Range('B18').Value2 -ceq '000PAY1') })
                    $studentReference = $workbook.Worksheets.Item('Clearance').Range('C6').Value2
                    $checks.Add(@{ name = 'Leading-zero student reference'; expected = '000001'; actual = $studentReference; passed = ([string]$studentReference -ceq '000001') })
                }
                if ($entry.packageId -ne 'a') {
                    $asset = $workbook.Worksheets.Item('Assets').ListObjects.Item('T_Assets')
                    $value = $asset.ListColumns.Item('net_book_minor').DataBodyRange.Cells.Item(1, 1).Value2
                    $checks.Add(@{ name = 'Completed-month depreciation'; expected = 1000000; actual = $value; passed = ($value -eq 1000000) })
                    $config = $workbook.Worksheets.Item('Config')
                    $originalPeriod = [string]$config.Range('B12').Value2
                    $config.Range('B12').Value2 = 'missing-period'
                    $excelApplication.CalculateFullRebuild()
                    $budgetRow = if ($entry.packageId -eq 'b') { 6 } else { 17 }
                    $value = $dashboard.Cells.Item($budgetRow, 2).Value2
                    $checks.Add(@{ name = 'Missing budget period is unavailable'; expected = 'No matching posted source'; actual = $value; passed = ([string]$value -ceq 'No matching posted source') })
                    $config.Range('B12').Value2 = [string]$originalPeriod
                    $excelApplication.CalculateFullRebuild()
                }
                $documentCases = @()
                if ($entry.packageId -ne 'b') { $documentCases += @(@('Receipt', 'p-1', 80000), @('Statement', 'inv-1', 20000), @('RefundApproval', 'refund-1', 10000)) }
                if ($entry.packageId -ne 'a') { $documentCases += @(@('Voucher', 'sp-1', 20000), @('BudgetApproval', 'budget-1', 100000), @('AdvanceRetirement', 'retire-1', 2000)) }
                $config = $workbook.Worksheets.Item('Config')
                $originalSourceId = [string]$config.Range('B22').Value2
                foreach ($documentCase in $documentCases) {
                    $config.Range('B22').Value2 = [string]$documentCase[1]
                    $excelApplication.CalculateFullRebuild()
                    $value = $workbook.Worksheets.Item([string]$documentCase[0]).Range('B11').Value2
                    $checks.Add(@{ name = ([string]$documentCase[0] + ' selected document amount'); expected = $documentCase[2]; actual = $value; passed = ($value -eq $documentCase[2]) })
                }
                $config.Range('B22').Value2 = [string]$originalSourceId
                $excelApplication.CalculateFullRebuild()
            }
            $workbook.Save()
            if ($entry.packageId -eq 'excel' -and $entry.mode -eq 'demo') {
                $restorePath = Join-Path $resolvedOutput ('restore-check-' + [guid]::NewGuid().ToString('N') + '.disposable.xlsx')
                $workbook.SaveCopyAs($restorePath)
                $restoredWorkbook = $null
                try {
                    $restoredWorkbook = $excelApplication.Workbooks.Open($restorePath, 0, $true)
                    $excelApplication.CalculateFullRebuild()
                    $restoredBalance = $restoredWorkbook.Worksheets.Item('Dashboard').Range('B9').Value2
                    $checks.Add(@{ name = 'Reopened workbook backup receivables'; expected = 70000; actual = $restoredBalance; passed = ($restoredBalance -eq 70000) })
                } finally {
                    if ($null -ne $restoredWorkbook) { $restoredWorkbook.Close($false); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($restoredWorkbook) }
                }
            }
            $dashboard.Unprotect()
                $dashboard.PageSetup.Zoom = $false
                $dashboard.PageSetup.FitToPagesWide = 1
                $dashboard.PageSetup.FitToPagesTall = $false
                for ($row = 15; $row -le 40; $row++) {
                    if ($dashboard.Cells.Item($row, 1).Value2 -eq 'Measure') {
                        [void]$dashboard.HPageBreaks.Add($dashboard.Cells.Item($row, 1))
                        break
                    }
                }
                $dashboard.Protect()
            if ($entry.mode -eq 'demo') {
                $pdfName = Join-Path $resolvedOutput ($entry.packageId + '-Dashboard.pdf')
                $dashboard.ExportAsFixedFormat(0, $pdfName)
                $formName = if ($entry.packageId -eq 'b') { 'Voucher' } else { 'Receipt' }
                $workbook.Worksheets.Item($formName).ExportAsFixedFormat(0, (Join-Path $resolvedOutput ($entry.packageId + '-' + $formName + '.pdf')))
            }
            $workbook.Save()
            $results.Add(@{ file = $entry.file; excelVersion = $excelApplication.Version; excelBuild = $excelApplication.Build; formulaErrors = @($errors.ToArray()); readings = $readings; checks = @($checks.ToArray()); nativePivotTables = $pivotSheet.PivotTables().Count; queryFunctionEmbedded = $true; queryRefreshTested = $false; savedAfterNativeRecalculation = $true })
        } catch {
            $results.Add(@{ file = $entry.file; openOrVerificationFailure = $_.Exception.Message; failureLocation = $_.InvocationInfo.PositionMessage; failureStack = $_.ScriptStackTrace; formulaErrors = @(@{ error = $_.Exception.Message }); checks = @(); savedAfterNativeRecalculation = $false })
        } finally {
            if ($null -ne $workbook) { $workbook.Close($false); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
            if ($null -ne $excelApplication) { $excelApplication.Quit(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelApplication); $excelApplication = $null }
        }
        if ($results.Count -gt 0 -and $results[$results.Count - 1].savedAfterNativeRecalculation) {
            $results[$results.Count - 1].sha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
} finally {
    if ($null -ne $excelApplication) { $excelApplication.Quit(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelApplication) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
$reportName = if ($PackageId -eq '') { 'excel-verification.json' } else { 'excel-verification-' + $PackageId + '.json' }
$results.ToArray() | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $resolvedOutput $reportName) -Encoding UTF8
$failures = @($results | Where-Object { $_.formulaErrors.Count -gt 0 -or @($_.checks | Where-Object { -not $_.passed }).Count -gt 0 })
Write-Output ('Native Excel checked {0} workbooks; {1} failed.' -f $results.Count, $failures.Count)
if ($failures.Count -gt 0) { exit 1 }
