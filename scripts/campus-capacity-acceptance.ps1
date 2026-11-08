param([string]$Template = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Get-Content -LiteralPath (Join-Path $root 'lib/campus-release.json') -Raw | ConvertFrom-Json
if ($Template -eq '') { $Template = Join-Path $root ('.product-work/campus-bursary/' + $release.directory + '/excel-clean.xlsx') }
$output = Join-Path $root '.product-work/campus-bursary/acceptance'
$fixture = Get-Content -LiteralPath (Join-Path $output 'capacity-data.json') -Raw | ConvertFrom-Json
$sourceHash = (Get-FileHash -LiteralPath $Template -Algorithm SHA256).Hash
$copy = Join-Path $output ('capacity-100-' + [guid]::NewGuid().ToString('N') + '.xlsx')
Copy-Item -LiteralPath $Template -Destination $copy
$excelApplication = $null
$workbook = $null
$checks = [System.Collections.Generic.List[object]]::new()
$report = @{ startedUtc = [datetime]::UtcNow.ToString('o'); workbook = [IO.Path]::GetFileName($copy); templateSha256 = $sourceHash.ToLowerInvariant(); checks = @(); passed = $false; sourceRowCounts = @{} }
try {
    $excelApplication = New-Object -ComObject Excel.Application
    $excelApplication.Visible = $false
    $excelApplication.DisplayAlerts = $false
    $excelApplication.AutomationSecurity = 3
    $excelApplication.AskToUpdateLinks = $false
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $workbook = $excelApplication.Workbooks.Open($copy, 0, $false)
    $report.openMs = $timer.ElapsedMilliseconds
    $report.excelVersion = $excelApplication.Version
    $report.excelBuild = $excelApplication.Build
    $report.processorCount = [Environment]::ProcessorCount
    $excelApplication.Calculation = -4135
    $timer.Restart()
    foreach ($definition in $fixture.tables.PSObject.Properties) {
        $name = $definition.Name
        $rows = @($fixture.data.$name)
        $report.sourceRowCounts[$name] = $rows.Count
        if ($rows.Count -eq 0) { continue }
        $fields = @($definition.Value.columns.PSObject.Properties.Name)
        $sheet = $workbook.Worksheets.Item($name)
        $sheet.Unprotect()
        $table = $sheet.ListObjects.Item('T_' + $name)
        if ($rows.Count -gt $table.DataBodyRange.Rows.Count) { throw ('Prepared row limit exceeded: ' + $name) }
        $matrix = [object[,]]::new($rows.Count, $fields.Count)
        for ($column = 0; $column -lt $fields.Count; $column++) {
            $field = $fields[$column]
            if ($table.ListColumns.Item($column + 1).Name -cne $field) { throw ('Workbook/schema column mismatch: ' + $name + '.' + $field) }
            $type = [string]$definition.Value.columns.$field
            for ($row = 0; $row -lt $rows.Count; $row++) {
                $value = $rows[$row].$field
                if ($null -eq $value) { $matrix[$row, $column] = '' }
                elseif ($type -eq 'integer') { $matrix[$row, $column] = [double]$value }
                elseif ($type -eq 'boolean') { $matrix[$row, $column] = [bool]$value }
                elseif ($type -eq 'date') { $matrix[$row, $column] = [double]([datetime]::ParseExact([string]$value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)).ToOADate() }
                else { $matrix[$row, $column] = [string]$value }
            }
        }
        $table.DataBodyRange.Cells.Item(1, 1).Resize($rows.Count, $fields.Count).Value2 = $matrix
        $sheet.Protect('', $true, $true, $true, $false, $false, $false, $false, $false, $false, $false, $false, $false, $false, $true, $false)
    }
    $config = $workbook.Worksheets.Item('Config')
    $config.Range('B8').Value2 = [double]([datetime]'2026-11-07').ToOADate()
    $config.Range('B11').Value2 = ''
    $config.Range('B12').Value2 = ''
    $config.Range('B23').Value2 = 'ar'
    $config.Range('B24').Value2 = 'ap'
    $config.Range('B25').Value2 = 'clearing'
    $config.Range('B22').Value2 = 'cap-payment-100'
    $report.populateMs = $timer.ElapsedMilliseconds
    $durations = [System.Collections.Generic.List[long]]::new()
    for ($iteration = 0; $iteration -lt 3; $iteration++) {
        $timer.Restart()
        $excelApplication.CalculateFullRebuild()
        $durations.Add($timer.ElapsedMilliseconds)
    }
    $report.fullRebuildMs = @($durations.ToArray())
    $dashboard = $workbook.Worksheets.Item('Dashboard')
    $readings = @{}
    for ($row = 6; $row -le 25; $row++) { $readings[[string]$dashboard.Cells.Item($row, 1).Value2] = $dashboard.Cells.Item($row, 2).Value2 }
    $expected = @{ 'Billed fees' = 1000000; 'Allocated collections' = 750000; 'Student receivables' = 250000; 'Unapplied receipts' = 0; 'Net bank settlements' = 740000; 'Approved budget' = 1000000; 'Actual expenditure' = 140000; 'Open commitments' = 50000; 'Available budget' = 810000; 'Supplier payables' = 20000; 'Outstanding advances' = 50000; 'Ledger bank balance' = 570000 }
    foreach ($label in $expected.Keys) { $checks.Add(@{ name = $label; expected = $expected[$label]; actual = $readings[$label]; passed = ($readings[$label] -eq $expected[$label]) }) }
    $controls = $workbook.Worksheets.Item('ControlAccounts')
    for ($row = 6; $row -le 9; $row++) { $checks.Add(@{ name = [string]$controls.Cells.Item($row, 1).Value2; expected = 0; actual = $controls.Cells.Item($row, 2).Value2; passed = ($controls.Cells.Item($row, 2).Value2 -eq 0) }) }
    $reference = [string]$workbook.Worksheets.Item('Students').ListObjects.Item('T_Students').ListColumns.Item('reference').DataBodyRange.Cells.Item(100, 1).Value2
    $checks.Add(@{ name = 'Last prepared row preserves reference'; expected = '0000000100'; actual = $reference; passed = ($reference -ceq '0000000100') })
    $line = $workbook.Worksheets.Item('InvoiceLines').ListObjects.Item('T_InvoiceLines').ListColumns.Item('amount_minor').DataBodyRange.Cells.Item(100, 1)
    $line.Value2 = [double]1100000
    $excelApplication.CalculateFullRebuild()
    $checks.Add(@{ name = 'Last prepared row recalculates receivables'; expected = 251000; actual = $dashboard.Range('B9').Value2; passed = ($dashboard.Range('B9').Value2 -eq 251000) })
    $checks.Add(@{ name = 'Unjournaled source edit is visible in control difference'; expected = -1000; actual = $controls.Range('B7').Value2; passed = ($controls.Range('B7').Value2 -eq -1000) })
    $line.Value2 = [double]1000000
    $excelApplication.CalculateFullRebuild()
    $pivotSheet = $workbook.Worksheets.Item('PivotAnalysis')
    foreach ($pivot in $pivotSheet.PivotTables()) { $pivot.RefreshTable() | Out-Null }
    $studentTotal = $pivotSheet.PivotTables('CampusStudentBalances').GetPivotData('Outstanding kobo').Value2
    $supplierTotal = $pivotSheet.PivotTables('CampusSupplierBalances').GetPivotData('Payable kobo').Value2
    $checks.Add(@{ name = 'Capacity student pivot'; expected = 25000000; actual = $studentTotal; passed = ($studentTotal -eq 25000000) })
    $checks.Add(@{ name = 'Capacity supplier pivot'; expected = 2000000; actual = $supplierTotal; passed = ($supplierTotal -eq 2000000) })
    $formulaErrors = [System.Collections.Generic.List[object]]::new()
    foreach ($sheet in $workbook.Worksheets) {
        $errorCells = $null
        try { $errorCells = $sheet.UsedRange.SpecialCells(-4123, 16) } catch [Runtime.InteropServices.COMException] {}
        if ($null -ne $errorCells) { foreach ($cell in $errorCells.Cells) { $formulaErrors.Add(@{ sheet = $sheet.Name; address = $cell.Address(); error = $cell.Text }) } }
    }
    $report.formulaErrors = @($formulaErrors.ToArray())
    $checks.Add(@{ name = 'Capacity formula error scan'; expected = 0; actual = $formulaErrors.Count; passed = ($formulaErrors.Count -eq 0) })
    $bills = $workbook.Worksheets.Item('SupplierBills')
    $area = $bills.Range([string]$bills.PageSetup.PrintArea)
    $lastPrintRow = $area.Row + $area.Rows.Count - 1
    $report.sourcePrintArea = [string]$bills.PageSetup.PrintArea
    $checks.Add(@{ name = 'Source print area includes the last prepared row'; expected = 106; actual = $lastPrintRow; passed = ($lastPrintRow -ge 106) })
    $bills.ExportAsFixedFormat(0, (Join-Path $output 'capacity-supplier-bills.pdf'))
    $excelApplication.Calculation = -4105
    $workbook.Save()
    $report.workbookBytes = (Get-Item -LiteralPath $copy).Length
    $report.passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
} catch {
    $report.failure = $_.Exception.Message
    $report.failureLocation = $_.InvocationInfo.PositionMessage
} finally {
    if ($null -ne $workbook) { $workbook.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
    if ($null -ne $excelApplication) { $excelApplication.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelApplication) }
    $report.checks = @($checks.ToArray())
    $report.completedUtc = [datetime]::UtcNow.ToString('o')
    $report.originalTemplateUnchanged = (Get-FileHash -LiteralPath $Template -Algorithm SHA256).Hash -ceq $sourceHash
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'capacity-acceptance.json') -Encoding UTF8
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
Write-Output ('Capacity acceptance passed: ' + $report.passed)
if (-not $report.passed -or -not $report.originalTemplateUnchanged) { exit 1 }
