$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Get-Content -LiteralPath (Join-Path $root 'lib/campus-release.json') -Raw | ConvertFrom-Json
$output = Join-Path $root '.product-work/campus-bursary/acceptance'
$template = Join-Path $root ('.product-work/campus-bursary/' + $release.directory + '/excel-clean.xlsx')
$sourceHash = (Get-FileHash -LiteralPath $template -Algorithm SHA256).Hash
$copy = Join-Path $output ('query-' + [guid]::NewGuid().ToString('N') + '.xlsx')
Copy-Item -LiteralPath $template -Destination $copy
$excelApplication = $null
$workbook = $null
$checks = [System.Collections.Generic.List[object]]::new()
$report = @{ startedUtc = [datetime]::UtcNow.ToString('o'); workbook = [IO.Path]::GetFileName($copy); templateSha256 = $sourceHash.ToLowerInvariant(); checks = @(); passed = $false }
function Refresh-Preview($queryTable) {
    $started = [Diagnostics.Stopwatch]::StartNew()
    $accepted = $queryTable.Refresh($true)
    while ($queryTable.Refreshing -and $started.Elapsed.TotalSeconds -lt 45) { Start-Sleep -Milliseconds 200 }
    if ($queryTable.Refreshing) { $queryTable.CancelRefresh(); throw 'Power Query refresh exceeded the 45-second acceptance timeout' }
    return @{ accepted = $accepted; elapsedMs = $started.ElapsedMilliseconds }
}
try {
    $excelApplication = New-Object -ComObject Excel.Application
    $excelApplication.Visible = $false
    $excelApplication.DisplayAlerts = $false
    $excelApplication.AutomationSecurity = 3
    $excelApplication.AskToUpdateLinks = $false
    $workbook = $excelApplication.Workbooks.Open($copy, 0, $false)
    $report.excelVersion = $excelApplication.Version
    $report.excelBuild = $excelApplication.Build
    $function = $workbook.Queries.Item('CampusImportPreview')
    $expectedSource = Get-Content -LiteralPath (Join-Path $root 'resources/campus/import-preview.pq') -Raw
    $sameSource = ([string]$function.Formula).Replace("`r`n", "`n").Trim() -ceq $expectedSource.Replace("`r`n", "`n").Trim()
    if (-not $sameSource) { throw 'The workbook query function differs from the shared source; verify the intended release first' }
    $sheet = $workbook.Worksheets.Add()
    $sheet.Name = 'ImportAcceptance'
    $sheet.Range('A1').Value2 = 'Synthetic import staging acceptance only'
    $sheet.Range('A2').Value2 = 'This query does not post to any financial table.'
    $csvPath = (Join-Path $output 'query-source.csv').Replace('"', '""')
    $invocation = 'CampusImportPreview("' + $csvPath + '", {"id","reference","name"}, {"date"}, {"amount_minor"})'
    $query = $workbook.Queries.Add('CampusAcceptancePreview', $invocation)
    $connection = 'OLEDB;Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=CampusAcceptancePreview;Extended Properties=""'
    $table = $sheet.QueryTables.Add($connection, $sheet.Range('A6'))
    $table.CommandType = 2
    $table.CommandText = 'SELECT * FROM [CampusAcceptancePreview]'
    $table.RefreshOnFileOpen = $false
    $table.BackgroundQuery = $true
    $refresh = Refresh-Preview $table
    $range = $table.ResultRange
    $checks.Add(@{ name = 'Refresh loaded two synthetic rows'; expected = 3; actual = $range.Rows.Count; passed = ($range.Rows.Count -eq 3) })
    $reference = [string]$range.Cells.Item(2, 2).Value2
    $checks.Add(@{ name = 'Refresh preserves leading zeros'; expected = '00000999'; actual = $reference; passed = ($reference -ceq '00000999') })
    $errorsValid = [string]$range.Cells.Item(2, 7).Value2
    $errorsInvalid = [string]$range.Cells.Item(3, 7).Value2
    $checks.Add(@{ name = 'Valid ISO row has no validation error'; expected = ''; actual = $errorsValid; passed = ($errorsValid -ceq '') })
    $checks.Add(@{ name = 'Invalid row reports text, date and minor-unit problems'; actual = $errorsInvalid; passed = ($errorsInvalid.Contains('unsafe text') -and $errorsInvalid.Contains('ISO date') -and $errorsInvalid.Contains('integer kobo')) })
    $formulaCell = $range.Cells.Item(3, 3)
    $checks.Add(@{ name = 'Imported formula-like text is not executed'; expected = '=1+1'; actual = $formulaCell.Value2; passed = ([string]$formulaCell.Value2 -ceq '=1+1' -and -not $formulaCell.HasFormula) })
    $report.successfulRefreshMs = $refresh.elapsedMs
    $previousDate = [double]$range.Cells.Item(2, 8).Value2
    $report.lastSuccessfulRefreshUtc = [datetime]::SpecifyKind([datetime]::FromOADate($previousDate), [DateTimeKind]::Utc).ToString('o')
    $missing = (Join-Path $output 'deliberately-missing-source.csv').Replace('"', '""')
    $query.Formula = 'CampusImportPreview("' + $missing + '", {"id","reference","name"}, {"date"}, {"amount_minor"})'
    $failureObserved = $false
    try { $failedRefresh = Refresh-Preview $table; $failureObserved = -not $failedRefresh.accepted -or ([double]$table.ResultRange.Cells.Item(2, 8).Value2 -eq $previousDate) }
    catch { $failureObserved = $true; $report.expectedRefreshFailure = $_.Exception.Message }
    $checks.Add(@{ name = 'Missing file cannot produce a successful fresh preview'; passed = $failureObserved })
    $checks.Add(@{ name = 'Failed refresh retains last successful timestamp'; expected = $previousDate; actual = $table.ResultRange.Cells.Item(2, 8).Value2; passed = ([double]$table.ResultRange.Cells.Item(2, 8).Value2 -eq $previousDate) })
    $postedRows = $excelApplication.WorksheetFunction.CountA($workbook.Worksheets.Item('Invoices').ListObjects.Item('T_Invoices').ListColumns.Item('id').DataBodyRange)
    $checks.Add(@{ name = 'Staging refresh did not create invoices'; expected = 0; actual = $postedRows; passed = ($postedRows -eq 0) })
    $sheet.Range('A3').Value2 = 'Failed-refresh scenario: retained preview is stale and must not be posted.'
    $query.Formula = $invocation
    $workbook.Save()
    $report.passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
} catch {
    $report.failure = $_.Exception.Message
    $report.failureLocation = $_.InvocationInfo.PositionMessage
} finally {
    if ($null -ne $workbook) { $workbook.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
    if ($null -ne $excelApplication) { $excelApplication.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelApplication) }
    $report.checks = @($checks.ToArray())
    $report.completedUtc = [datetime]::UtcNow.ToString('o')
    $report.originalTemplateUnchanged = (Get-FileHash -LiteralPath $template -Algorithm SHA256).Hash -ceq $sourceHash
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'query-acceptance.json') -Encoding UTF8
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
Write-Output ('Power Query acceptance passed: ' + $report.passed)
if (-not $report.passed -or -not $report.originalTemplateUnchanged) { exit 1 }
