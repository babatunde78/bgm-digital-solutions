import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { tables, workbookDefinition } = require('../lib/campus-model');
const { cleanData, demoData } = require('../lib/campus-fixtures');
const { validateData, analyse } = require('../lib/campus-finance');
const { priceBook } = require('../lib/campus-pricing');
const documentOverrides = require('../lib/campus-documents.json');
const release = require('../lib/campus-release.json');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetArgument = process.argv.includes('--dataset') ? process.argv[process.argv.indexOf('--dataset') + 1] : null;
const suppliedData = datasetArgument ? JSON.parse(await fs.readFile(datasetArgument, 'utf8')) : null;
const outputDir = path.join(root, '.product-work/campus-bursary', suppliedData ? `${release.directory}-imported-${Date.now()}` : release.directory);
const runtimeDir = path.join(outputDir, 'runtime');
const dependencyDir = process.argv.includes('--artifact-modules') ? process.argv[process.argv.indexOf('--artifact-modules') + 1] : path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
await fs.mkdir(runtimeDir, { recursive: true });
try { await fs.lstat(path.join(runtimeDir, 'node_modules')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await fs.symlink(dependencyDir, path.join(runtimeDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}
const runtimeRequire = createRequire(path.join(runtimeDir, 'loader.cjs'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
const limit = release.preparedRows;
const start = 7;
const end = start + limit - 1;
const palette = { ink: '#203C31', sage: '#E7EFE8', amber: '#FFF3CF', muted: '#65756C', error: '#FBE4E1' };
const currencyFormat = '#,##0.00;(#,##0.00);"-"';
const dateValue = value => new Date(`${value}T00:00:00Z`);
const col = index => { let result = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; };
const q = name => `'${name}'`;
const ref = (table, field) => `T_${table}[${field}]`;
const sumif = (table, field, ...criteria) => `SUMIFS(${ref(table, field)},${criteria.join(',')})`;
const c = (table, field, criterion) => [ref(table, field), criterion];
const cutoff = table => c(table, 'date', '"<="&Config!$B$8');
const posted = table => c(table, 'status', '"posted"');
const total = (table, field) => sumif(table, field, ...posted(table), ...cutoff(table));
const lookup = (table, field, key) => `IF(COUNTIF(${ref(table, 'id')},${key})=1,INDEX(${ref(table, field)},MATCH(${key},${ref(table, 'id')},0)),"Unknown ID")`;

function calculatedColumns(name, packageId) {
  const has = module => packageId === module || packageId === 'excel';
  const configSession = 'IF(Config!$B$11="","*",Config!$B$11)';
  const defs = {};
  if (name === 'InvoiceLines') Object.assign(defs, {
    invoice_status: r => lookup('Invoices', 'status', r('invoice_id')),
    invoice_date: r => lookup('Invoices', 'date', r('invoice_id')),
    student_id: r => lookup('Invoices', 'student_id', r('invoice_id')),
    session_id: r => lookup('Invoices', 'session_id', r('invoice_id')),
    credits_minor: r => sumif('Credits', 'amount_minor', ...c('Credits', 'invoice_line_id', r('id')), ...posted('Credits'), ...cutoff('Credits')),
    allocated_minor: r => sumif('Allocations', 'amount_minor', ...c('Allocations', 'invoice_line_id', r('id')), ...posted('Allocations'), ...cutoff('Allocations')),
    released_minor: r => sumif('AllocationReleases', 'amount_minor', ...c('AllocationReleases', 'invoice_line_id_calc', r('id')), ...posted('AllocationReleases'), ...cutoff('AllocationReleases')),
    balance_minor: r => `${r('amount_minor')}-${r('credits_minor')}-${r('allocated_minor')}+${r('released_minor')}`,
    overdue_days: r => `MAX(0,Config!$B$8-${r('due_date')})`,
    ageing_bucket: r => `IF(${r('balance_minor')}=0,"Cleared",IF(${r('overdue_days')}=0,"Not overdue",IF(${r('overdue_days')}<=30,"1-30 days",IF(${r('overdue_days')}<=60,"31-60 days",IF(${r('overdue_days')}<=90,"61-90 days","Over 90 days")))))`,
    eligible: r => `IF(AND(${r('invoice_status')}="posted",${r('invoice_date')}<=Config!$B$8,OR(Config!$B$11="",${r('session_id')}=${configSession})),1,0)`
  });
  if (name === 'Allocations') Object.assign(defs, { student_id_calc: r => lookup('InvoiceLines', 'student_id', r('invoice_line_id')) });
  if (name === 'AllocationReleases') Object.assign(defs, { invoice_line_id_calc: r => lookup('Allocations', 'invoice_line_id', r('allocation_id')) });
  if (name === 'Payments') Object.assign(defs, {
    allocated_minor: r => sumif('Allocations', 'amount_minor', ...c('Allocations', 'payment_id', r('id')), ...posted('Allocations'), ...cutoff('Allocations')),
    released_minor: r => sumif('AllocationReleases', 'amount_minor', ...c('AllocationReleases', 'payment_id_calc', r('id')), ...posted('AllocationReleases'), ...cutoff('AllocationReleases')),
    returned_minor: r => `${sumif('Refunds', 'amount_minor', ...c('Refunds', 'payment_id', r('id')), ...posted('Refunds'), ...cutoff('Refunds'))}+${sumif('Reversals', 'amount_minor', ...c('Reversals', 'payment_id', r('id')), ...posted('Reversals'), ...cutoff('Reversals'))}`,
    unapplied_minor: r => `${r('amount_minor')}-${r('allocated_minor')}+${r('released_minor')}-${r('returned_minor')}`,
    matched_minor: r => sumif('ReconciliationMatches', 'amount_minor', ...c('ReconciliationMatches', 'payment_id', r('id')), ...c('ReconciliationMatches', 'review_status', '"approved"'))
  });
  if (name === 'AllocationReleases') defs.payment_id_calc = r => lookup('Allocations', 'payment_id', r('allocation_id'));
  if (name === 'Settlements') Object.assign(defs, {
    approved_minor: r => sumif('ReconciliationMatches', 'amount_minor', ...c('ReconciliationMatches', 'settlement_id', r('id')), ...c('ReconciliationMatches', 'review_status', '"approved"')),
    unmatched_minor: r => `${r('gross_minor')}-${r('approved_minor')}`,
    net_difference_minor: r => `${r('gross_minor')}-${r('fee_minor')}-${r('net_minor')}`
  });
  if (name === 'Invoices') Object.assign(defs, {
    billed_minor: r => sumif('InvoiceLines', 'amount_minor', ...c('InvoiceLines', 'invoice_id', r('id'))),
    credits_minor: r => sumif('InvoiceLines', 'credits_minor', ...c('InvoiceLines', 'invoice_id', r('id'))),
    net_allocated_minor: r => `${sumif('InvoiceLines', 'allocated_minor', ...c('InvoiceLines', 'invoice_id', r('id')))}-${sumif('InvoiceLines', 'released_minor', ...c('InvoiceLines', 'invoice_id', r('id')))}`,
    balance_minor: r => sumif('InvoiceLines', 'balance_minor', ...c('InvoiceLines', 'invoice_id', r('id')))
  });
  if (name === 'Budgets') Object.assign(defs, {
    changes_minor: r => sumif('BudgetChanges', 'amount_minor', ...c('BudgetChanges', 'budget_id', r('id')), ...posted('BudgetChanges'), ...cutoff('BudgetChanges')),
    transfers_minor: r => `${sumif('Virements', 'amount_minor', ...c('Virements', 'to_budget_id', r('id')), ...posted('Virements'), ...cutoff('Virements'))}-${sumif('Virements', 'amount_minor', ...c('Virements', 'from_budget_id', r('id')), ...posted('Virements'), ...cutoff('Virements'))}`,
    actual_minor: r => `${sumif('SupplierBills', 'amount_minor', ...c('SupplierBills', 'budget_id', r('id')), ...posted('SupplierBills'), ...cutoff('SupplierBills'))}+${sumif('Expenses', 'amount_minor', ...c('Expenses', 'budget_id', r('id')), ...posted('Expenses'), ...cutoff('Expenses'))}+${sumif('Retirements', 'amount_minor', ...c('Retirements', 'budget_id', r('id')), ...posted('Retirements'), ...cutoff('Retirements'))}`,
    open_commitment_minor: r => sumif('Commitments', 'open_minor', ...c('Commitments', 'budget_id', r('id')), ...posted('Commitments'), ...cutoff('Commitments')),
    available_minor: r => `${r('amount_minor')}+${r('changes_minor')}+${r('transfers_minor')}-${r('actual_minor')}-${r('open_commitment_minor')}`
  });
  if (name === 'Commitments') Object.assign(defs, {
    liquidated_minor: r => sumif('SupplierBills', 'amount_minor', ...c('SupplierBills', 'commitment_id', r('id')), ...posted('SupplierBills'), ...cutoff('SupplierBills')),
    open_minor: r => `${r('amount_minor')}-${r('liquidated_minor')}`
  });
  if (name === 'SupplierBills') Object.assign(defs, {
    paid_minor: r => sumif('SupplierPayments', 'amount_minor', ...c('SupplierPayments', 'supplier_bill_id', r('id')), ...posted('SupplierPayments'), ...cutoff('SupplierPayments')),
    balance_minor: r => `${r('amount_minor')}-${r('paid_minor')}`
  });
  if (name === 'Advances') Object.assign(defs, {
    retired_minor: r => sumif('Retirements', 'amount_minor', ...c('Retirements', 'advance_id', r('id')), ...posted('Retirements'), ...cutoff('Retirements')),
    cash_return_minor: r => sumif('Retirements', 'cash_return_minor', ...c('Retirements', 'advance_id', r('id')), ...posted('Retirements'), ...cutoff('Retirements')),
    outstanding_minor: r => `${r('amount_minor')}-${r('retired_minor')}-${r('cash_return_minor')}`
  });
  if (name === 'Projects') Object.assign(defs, {
    receipts_minor: r => sumif('GrantEntries', 'amount_minor', ...c('GrantEntries', 'project_id', r('id')), ...c('GrantEntries', 'kind', '"receipt"'), ...posted('GrantEntries'), ...cutoff('GrantEntries')),
    spent_minor: r => sumif('GrantEntries', 'amount_minor', ...c('GrantEntries', 'project_id', r('id')), ...c('GrantEntries', 'kind', '"expenditure"'), ...posted('GrantEntries'), ...cutoff('GrantEntries')),
    balance_minor: r => `${r('receipts_minor')}-${r('spent_minor')}`
  });
  if (name === 'Assets') Object.assign(defs, {
    elapsed_months: r => `MAX(0,(YEAR(Config!$B$8)-YEAR(${r('depreciation_start_date')}))*12+MONTH(Config!$B$8)-MONTH(${r('depreciation_start_date')})-IF(DAY(Config!$B$8)<DAY(${r('depreciation_start_date')}),1,0))`,
    depreciation_minor: r => `MIN(${r('cost_minor')}-${r('residual_minor')},${r('opening_depreciation_minor')}+ROUND((${r('cost_minor')}-${r('residual_minor')})/${r('life_months')}*MIN(${r('life_months')},${r('elapsed_months')}),0))`,
    net_book_minor: r => `${r('cost_minor')}-${r('depreciation_minor')}`
  });
  if (name === 'PayrollChecks') Object.assign(defs, {
    prior_gross_minor: r => `IF(COUNTIF(${ref('PriorPayroll', 'staff_reference')},${r('staff_reference')})=1,${sumif('PriorPayroll', 'gross_minor', ...c('PriorPayroll', 'staff_reference', r('staff_reference')))},"Missing or duplicate prior")`,
    gross_change_minor: r => `IF(ISNUMBER(${r('prior_gross_minor')}),${r('gross_minor')}-${r('prior_gross_minor')},"Review prior record")`
  });
  if (name === 'ApprovalLog') defs.separation_check = r => `IF(OR(${r('preparer')}=${r('approver')},${r('preparer')}=${r('reviewer')}),"Review separation","Manual review required")`;
  if (name === 'JournalLines') Object.assign(defs, {
    status_calc: r => lookup('JournalHeaders', 'status', r('journal_id')),
    date_calc: r => lookup('JournalHeaders', 'date', r('journal_id')),
    signed_minor: r => `${r('debit_minor')}-${r('credit_minor')}`
  });
  if (name === 'JournalHeaders') defs.difference_minor = r => `${sumif('JournalLines', 'debit_minor', ...c('JournalLines', 'journal_id', r('id')))}-${sumif('JournalLines', 'credit_minor', ...c('JournalLines', 'journal_id', r('id')))}`;
  if (name === 'Accounts' && has('excel')) Object.assign(defs, {
    opening_minor: r => `${sumif('OpeningBalances', 'debit_minor', ...c('OpeningBalances', 'account_id', r('id')), ...cutoff('OpeningBalances'))}-${sumif('OpeningBalances', 'credit_minor', ...c('OpeningBalances', 'account_id', r('id')), ...cutoff('OpeningBalances'))}`,
    debit_minor: r => sumif('JournalLines', 'debit_minor', ...c('JournalLines', 'account_id', r('id')), ...c('JournalLines', 'status_calc', '"posted"'), ...c('JournalLines', 'date_calc', '"<="&Config!$B$8')),
    credit_minor: r => sumif('JournalLines', 'credit_minor', ...c('JournalLines', 'account_id', r('id')), ...c('JournalLines', 'status_calc', '"posted"'), ...c('JournalLines', 'date_calc', '"<="&Config!$B$8')),
    closing_minor: r => `${r('opening_minor')}+${r('debit_minor')}-${r('credit_minor')}`
  });
  return defs;
}

function baseSheet(workbook, name, title, note) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRange('A1:H32').format.font = { name: 'Arial', size: 10, color: palette.ink };
  sheet.getRange('A1:H32').format.rowHeight = 21;
  sheet.getRange('A:A').format.columnWidth = 40;
  sheet.getRange('B:B').format.columnWidth = 24;
  sheet.getRange('C:H').format.columnWidth = 18;
  sheet.getRange('A2:H2').merge(); sheet.getRange('A2').values = [[title]];
  sheet.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: palette.ink };
  sheet.getRange('A2:H2').format.rowHeight = 28;
  sheet.getRange('A3:H3').merge(); sheet.getRange('A3').values = [[note]];
  sheet.getRange('A3:H3').format = { rowHeight: 36, wrapText: true, font: { name: 'Arial', size: 10, color: palette.muted } };
  return sheet;
}
function outputTable(sheet, headers, rows) {
  sheet.getRange(`A5:${col(headers.length - 1)}5`).values = [headers];
  sheet.getRange(`A5:${col(headers.length - 1)}5`).format = { fill: palette.ink, font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, rowHeight: 24 };
  for (let j = 0; j < headers.length; j++) {
    const values = rows.map(row => [row[j]]);
    const range = sheet.getRange(`${col(j)}6:${col(j)}${rows.length + 5}`);
    if (values.every(([value]) => typeof value === 'string' && value.startsWith('='))) range.formulas = values;
    else if (values.every(([value]) => typeof value !== 'string' || !value.startsWith('='))) range.values = values;
    else values.forEach(([value], i) => {
      const cell = sheet.getRange(`${col(j)}${i + 6}`);
      if (typeof value === 'string' && value.startsWith('=')) cell.formulas = [[value]]; else cell.values = [[value]];
    });
  }
  sheet.getRange(`B6:B${rows.length + 5}`).setNumberFormat(currencyFormat);
}

const manifest = [];
const packages = process.argv.includes('--package') ? [process.argv[process.argv.indexOf('--package') + 1]] : ['a', 'b', 'excel'];
for (const packageId of packages) for (const mode of suppliedData ? ['imported'] : ['clean', 'demo']) {
  const definition = workbookDefinition(packageId);
  const data = suppliedData || (mode === 'demo' ? demoData() : cleanData());
  const issues = validateData(data); if (issues.length) throw new Error(JSON.stringify(issues));
  for (const sheet of definition.sheets) if (data[sheet.name].length > limit) throw new RangeError(`${sheet.name} exceeds ${limit} prepared rows; expand and revalidate before generation`);
  for (const sheet of definition.sheets) for (const record of data[sheet.name]) for (const [field, type] of Object.entries(sheet.columns)) {
    if (type === 'integer' && field.endsWith('_minor') && Math.abs(record[field]) > release.monetaryInputLimitMinor) throw new RangeError(`${sheet.name}.${field} exceeds the workbook monetary input limit of ${release.monetaryInputLimitMinor} kobo`);
  }
  const wb = Workbook.create();
  const hasA = packageId !== 'b'; const hasB = packageId !== 'a'; const full = packageId === 'excel';
  const packageName = { a: 'Student Revenue and Treasury', b: 'Bursary Operations and Control', excel: 'Full Excel Suite' }[packageId];
  const dashboard = baseSheet(wb, 'Dashboard', `${priceBook.productName} — ${packageName}`, `${mode === 'demo' ? 'Synthetic demonstration' : mode === 'imported' ? 'Imported dataset' : 'Clean customer template'} • Pilot ${release.version} • NGN • As-of balances; review exceptions before use.`);
  dashboard.tabColor = palette.ink;
  const config = baseSheet(wb, 'Config', 'Institution configuration', 'Amber cells are editable. Manual approvals and one authorised writer. No strong worksheet security.');
  config.tabColor = '#749783';
  const views = {};
  for (const name of [...(hasA ? ['Ageing', 'Clearance', 'StudentStatement', 'CashierHandover', 'Reconciliation', 'Receipt', 'Statement', 'RefundApproval'] : []),
    ...(hasB ? ['BudgetControl', 'Payables', 'AdvancesReport', 'GrantReport', 'AssetReport', 'PayrollReview', 'Voucher', 'PaymentSchedule', 'BudgetApproval', 'AdvanceRetirement'] : []), ...(full ? ['TrialBalance', 'ControlAccounts'] : []), 'Exceptions']) {
    views[name] = baseSheet(wb, name, name.replace(/([a-z])([A-Z])/g, '$1 $2'), `Pilot ${release.version} • NGN • Formula results depend on posted inputs and Config as-of date.`);
  }
  const modelSheets = new Map();
  for (const { name } of definition.sheets) {
    const sheet = baseSheet(wb, name, name.replace(/([a-z])([A-Z])/g, '$1 $2'), 'Blue text / amber input. Monetary inputs are integer kobo (NGN × 100). Green text is calculated. 100 prepared input rows.');
    modelSheets.set(name, sheet);
  }
  const readme = baseSheet(wb, 'ReadMe', 'Getting started', 'Pilot workbook. Financial statements and accounting policies require institution approval.');
  readme.tabColor = '#9BA69D';
  const configRows = [
    ['Setting', 'Value'], ['Product name', priceBook.productName], ['Institution name', '=Institutions!C7'], ['Currency', 'NGN'],
    ['As-of date', dateValue('2026-11-07')], ['Report generated UTC', new Date()], ['Stale after days', 1],
    ['Academic session filter (blank = all)', mode === 'demo' ? 'session-2026' : ''], ['Financial period filter (blank = all)', mode === 'demo' ? 'fy-2026' : ''],
    ['Address', ''], ['Timezone', 'Africa/Lagos'], ['Date format', 'yyyy-mm-dd'], ['Accounting basis', 'Unconfirmed; no statutory statements'],
    ['Preparer name', mode === 'demo' ? 'Demo preparer' : ''], ['Approver name', mode === 'demo' ? 'Demo Bursar' : ''], ['Approver title', mode === 'demo' ? 'Bursar' : ''], ['Document ID', mode === 'demo' ? 'DEMO-001' : ''], ['Document revision', 1],
    ['Selected document source record ID', mode === 'demo' ? hasA ? 'p-1' : 'sp-1' : ''], ['AR control account ID', mode === 'demo' ? 'ar' : ''], ['AP control account ID', mode === 'demo' ? 'ap' : ''],
    ['Clearing control account ID', mode === 'demo' ? 'clearing' : ''], ['Contact', ''], ['Primary colour', palette.ink],
    ['Receipt numbering format', 'Institution-approved prefix + sequence'], ['Signature policy', 'Blank manual signature lines only'],
    ['Licence / support', 'Draft commercial terms; not activated'], ['Logo', 'Use Excel Insert > Pictures; retain aspect ratio'],
    ['Rounding', 'Integer kobo; half-up on currency conversion'], ['Scope', 'One authorised writer; no concurrent editing'],
    ['Student statement ID', mode === 'demo' ? 's-1' : '']
  ];
  configRows.forEach((row, i) => row.forEach((value, j) => {
    const cell = config.getRange(`${col(j)}${i + 4}`); if (typeof value === 'string' && value.startsWith('=')) cell.formulas = [[value]]; else cell.values = [[value]];
  }));
  config.getRange('B5:B34').format.fill = palette.amber; config.getRange('B5:B34').format.font.color = '#174EA6';
  config.getRange('B8:B9').setNumberFormat('yyyy-mm-dd hh:mm');
  config.getRange('B6').format.font.color = '#287244';
  config.getRange('B:B').format.columnWidth = 62;
  config.getRange('A4:B4').format.fill = palette.sage;
  const sheetSpecs = [];
  for (const { name, columns } of definition.sheets) {
    const sheet = modelSheets.get(name);
    const calculated = calculatedColumns(name, packageId);
    calculated.duplicate_flag = r => `IF(COUNTIF(${ref(name, 'id')},${r('id')})>1,1,0)`;
    for (const [field, target] of Object.entries(tables[name].references)) if (modelSheets.has(target)) calculated[`${field}_missing`] = r => `IF(${r(field)}="",0,IF(COUNTIFS(${ref(target, 'id')},${r(field)},${ref(target, 'institution_id')},${r('institution_id')})=1,0,1))`;
    calculated.input_status = r => {
      const conditions = [`COUNTIF(${ref(name, 'id')},${r('id')})=1`, `${r('institution_id')}=Institutions!$A$7`];
      for (const [field, type] of Object.entries(columns)) {
        if (type.endsWith('?')) continue;
        const cell = r(field);
        conditions.push(type === 'integer' ? `AND(ISNUMBER(${cell}),${cell}=INT(${cell}),${name === 'BudgetChanges' ? 'TRUE' : `${cell}>=0`})` :
          type === 'date' ? `AND(ISNUMBER(${cell}),${cell}>0)` : type === 'boolean' ? `OR(${cell}=TRUE,${cell}=FALSE)` : type === 'posting-state' ? `OR(${['draft', 'submitted', 'reviewed', 'approved', 'posted', 'reversed'].map(value => `${cell}="${value}"`).join(',')})` : `AND(ISTEXT(${cell}),LEN(${cell})>0)`);
      }
      for (const [field, target] of Object.entries(tables[name].references)) if (modelSheets.has(target)) {
        const test = `COUNTIFS(${ref(target, 'id')},${r(field)},${ref(target, 'institution_id')},${r('institution_id')})=1`;
        conditions.push(columns[field].endsWith('?') ? `OR(${r(field)}="",${test})` : test);
      }
      if (name === 'Invoices') conditions.push(`OR(${r('status')}<>"posted",COUNTIF(T_InvoiceLines[invoice_id],${r('id')})>0)`);
      if (name === 'JournalHeaders') conditions.push(`OR(${r('status')}<>"posted",${r('difference_minor')}=0)`);
      if (name === 'JournalLines') conditions.push(`OR(AND(${r('debit_minor')}>0,${r('credit_minor')}=0),AND(${r('credit_minor')}>0,${r('debit_minor')}=0))`);
      return `IF(AND(${conditions.join(',')}),"OK","Review input")`;
    };
    const fields = [...Object.keys(columns), ...Object.keys(calculated)];
    const fieldMap = Object.fromEntries(fields.map((field, i) => [field, i]));
    sheet.getRange(`A6:${col(fields.length - 1)}6`).values = [fields];
    sheet.getRange(`A6:${col(fields.length - 1)}${end}`).format = { rowHeight: 23, font: { name: 'Arial', size: 10 }, verticalAlignment: 'center' };
    sheet.getRange(`A6:${col(fields.length - 1)}6`).format = { fill: palette.ink, font: { name: 'Arial', color: '#FFFFFF', bold: true }, wrapText: true, rowHeight: 42 };
    const rawCount = Object.keys(columns).length;
    sheet.getRange(`A${start}:${col(rawCount - 1)}${end}`).format.fill = palette.amber;
    sheet.getRange(`A${start}:${col(rawCount - 1)}${end}`).format.font.color = '#174EA6';
    for (const [field, type] of Object.entries(columns)) {
      const letter = col(fieldMap[field]); const range = sheet.getRange(`${letter}${start}:${letter}${end}`);
      sheet.getRange(`${letter}:${letter}`).format.columnWidth = field === 'configuration_json' ? 45 : field === 'description' || field === 'name' || field === 'reason' ? 32 : 23;
      if (type === 'text' || type === 'text?' || type === 'json') range.setNumberFormat('@');
      if (type === 'integer') {
        range.setNumberFormat('#,##0;(#,##0);"-"');
        range.dataValidation = { rule: { type: 'whole', operator: 'between', formula1: name === 'BudgetChanges' ? -999999999999 : 0, formula2: 999999999999 } };
      }
      if (type === 'date') range.setNumberFormat('yyyy-mm-dd');
      if (type === 'posting-state') range.dataValidation = { rule: { type: 'list', values: ['draft', 'submitted', 'reviewed', 'approved', 'posted', 'reversed'] } };
      if (type === 'boolean') range.dataValidation = { rule: { type: 'list', values: ['TRUE', 'FALSE'] } };
    }
    if (data[name].length) sheet.getRange(`A${start}:${col(rawCount - 1)}${start + data[name].length - 1}`).values = data[name].map(row => Object.entries(columns).map(([field, type]) => type === 'date' ? dateValue(row[field]) : row[field] ?? ''));
    sheet.tables.add(`A6:${col(fields.length - 1)}${end}`, true, `T_${name}`);
    const allExpressions = Array.from({ length: limit }, (_, i) => Object.entries(calculated).map(([field, formula]) => {
      const rowNumber = start + i; const r = key => `${col(fieldMap[key])}${rowNumber}`;
      return field === 'input_status' ? `=IF(COUNTA(A${rowNumber}:${col(rawCount - 1)}${rowNumber})=0,"",${formula(r)})` : `=IF(A${rowNumber}="","",${formula(r)})`;
    }));
    sheet.getRange(`${col(rawCount)}${start}:${col(fields.length - 1)}${end}`).formulas = allExpressions;
    for (const field of Object.keys(calculated)) {
      const index = fieldMap[field]; const letter = col(index);
      sheet.getRange(`${letter}:${letter}`).format.columnWidth = 23;
      sheet.getRange(`${letter}${start}:${letter}${end}`).format = { fill: palette.sage, font: { name: 'Arial', size: 10, color: '#287244' } };
      if (field.endsWith('_minor')) sheet.getRange(`${letter}${start}:${letter}${end}`).setNumberFormat('#,##0;(#,##0);"-"');
      if (field.endsWith('_date') || field === 'date_calc') sheet.getRange(`${letter}${start}:${letter}${end}`).setNumberFormat('yyyy-mm-dd');
    }
    sheet.freezePanes.freezeRows(6); sheet.freezePanes.freezeColumns(2);
    sheetSpecs.push({ name, rawCount, fields, print: `A1:${col(rawCount - 1)}${end}` });
  }

  dashboard.getRange('A2').formulas = [[`=Config!B5&" — ${packageName}"`]];
  dashboard.getRange('A4').formulas = [['=Config!B6']];
  const metrics = [];
  const lineSum = field => sumif('InvoiceLines', field, ...c('InvoiceLines', 'eligible', '1'));
  if (hasA) metrics.push(
    ['Billed fees', `=${lineSum('amount_minor')}/100`, 'Posted invoices in selected session through as-of date'],
    ['Credits / waivers', `=${lineSum('credits_minor')}/100`, 'Posted line credits through as-of date'],
    ['Allocated collections', `=(${lineSum('allocated_minor')}-${lineSum('released_minor')})/100`, 'Allocations less approved posted releases'],
    ['Student receivables', `=${lineSum('balance_minor')}/100`, 'Billed less credits and net allocations'],
    ['Overdue receivables', `=${sumif('InvoiceLines', 'balance_minor', ...c('InvoiceLines', 'eligible', '1'), ...c('InvoiceLines', 'due_date', '"<"&Config!$B$8'))}/100`, 'Due before as-of date; see Ageing'],
    ['Receipts (all sessions)', `=${total('Payments', 'amount_minor')}/100`, 'Gross posted receipts; not additional fee revenue'],
    ['Refunds / chargebacks', `=(${total('Refunds', 'amount_minor')}+${total('Reversals', 'amount_minor')})/100`, 'Posted refunds and receipt reversals, all sessions'],
    ['Unapplied receipts', `=${sumif('Payments', 'unapplied_minor', ...posted('Payments'), ...cutoff('Payments'))}/100`, 'Receipts less returns and net allocations, all sessions'],
    ['Net bank settlements', `=${total('Settlements', 'net_minor')}/100`, 'Settlement net inflows only; not total bank cash'],
    ['Settlement fees', `=${total('Settlements', 'fee_minor')}/100`, 'Charges retained by providers'],
    ['Unmatched settlements', `=${sumif('Settlements', 'unmatched_minor', ...posted('Settlements'), ...cutoff('Settlements'))}/100`, 'Gross settlement less approved match allocations']
  );
  const period = 'IF(Config!$B$12="","*",Config!$B$12)';
  if (hasB) metrics.push(
    ['Approved budget', `=(${sumif('Budgets', 'amount_minor', ...posted('Budgets'), ...c('Budgets', 'period_id', period))}+${sumif('Budgets', 'changes_minor', ...posted('Budgets'), ...c('Budgets', 'period_id', period))}+${sumif('Budgets', 'transfers_minor', ...posted('Budgets'), ...c('Budgets', 'period_id', period))})/100`, 'Selected financial-period budgets and posted amendments'],
    ['Actual expenditure', `=${sumif('Budgets', 'actual_minor', ...posted('Budgets'), ...c('Budgets', 'period_id', period))}/100`, 'Posted supplier bills + expenses + expense retirements'],
    ['Open commitments', `=${sumif('Budgets', 'open_commitment_minor', ...posted('Budgets'), ...c('Budgets', 'period_id', period))}/100`, 'Committed less supplier bills liquidating commitments'],
    ['Available budget', `=${sumif('Budgets', 'available_minor', ...posted('Budgets'), ...c('Budgets', 'period_id', period))}/100`, 'Budget + revisions + transfers less actuals and open commitments'],
    ['Supplier payables', `=${sumif('SupplierBills', 'balance_minor', ...posted('SupplierBills'), ...cutoff('SupplierBills'))}/100`, 'Posted bills less posted payments, all financial periods'],
    ['Outstanding advances', `=${sumif('Advances', 'outstanding_minor', ...posted('Advances'), ...cutoff('Advances'))}/100`, 'Issued less expense retirement and cash return']
  );
  if (full) metrics.push(['Ledger bank balance', `=${sumif('Accounts', 'closing_minor', ...c('Accounts', 'account_type', '"bank"'))}/100`, 'Only accounts mapped to bank; see trial balance']);
  metrics.push(['Pending approvals', `=${definition.sheets.filter(s => Object.hasOwn(s.columns, 'status')).map(s => `COUNTIF(${ref(s.name, 'status')},"submitted")+COUNTIF(${ref(s.name, 'status')},"reviewed")`).join('+')}`, 'Record count, not NGN; manual workflow log'],
    ['Data / refresh status', '=IF(COUNTA(T_Students[id])=0,"Setup or no student data",IF(NOW()-Config!B9>Config!B10,"Stale snapshot: verify sources","Verify latest source entry"))'.replace('COUNTA(T_Students[id])=0', hasA ? 'COUNTA(T_Students[id])=0' : 'COUNTA(T_Budgets[id])=0'), 'Calculated from generation timestamp; does not confirm source completeness']);
  for (const metric of metrics) {
    if (['Pending approvals', 'Data / refresh status'].includes(metric[0])) continue;
    const anchor = ['Approved budget', 'Actual expenditure', 'Open commitments', 'Available budget'].includes(metric[0]) ? 'Budgets' :
      metric[0] === 'Supplier payables' ? 'SupplierBills' : metric[0] === 'Outstanding advances' ? 'Advances' : metric[0] === 'Ledger bank balance' ? 'JournalHeaders' :
        ['Billed fees', 'Credits / waivers', 'Allocated collections', 'Student receivables', 'Overdue receivables'].includes(metric[0]) ? 'Invoices' : 'Payments';
    const invalid = definition.sheets.map(s => `COUNTIF(${ref(s.name, 'input_status')},"Review input")`).join('+');
    const sourceCount = anchor === 'Invoices' ? 'COUNTIF(T_InvoiceLines[eligible],1)' : anchor === 'Budgets' ? `COUNTIFS(T_Budgets[status],"posted",T_Budgets[period_id],${period})` : `COUNTIF(${ref(anchor, 'status')},"posted")`;
    metric[1] = `=IF((${invalid})>0,"Review input tables",IF(${sourceCount}=0,"No matching posted source",${metric[1].slice(1)}))`;
  }
  outputTable(dashboard, ['Measure', 'NGN / status', 'Definition and source rule'], metrics);
  dashboard.getRange('C5:H5').merge();
  dashboard.getRange(`C6:H${metrics.length + 5}`).merge(true);
  dashboard.getRange(`C6:H${metrics.length + 5}`).format.wrapText = true;
  dashboard.getRange(`A6:H${metrics.length + 5}`).format.rowHeight = 30;
  dashboard.getRange(`B${metrics.length + 4}`).setNumberFormat('0');
  dashboard.getRange('B:B').format.columnWidth = 27;

  const reportRows = (source, columns) => Array.from({ length: limit }, (_, i) => {
    const key = `INDEX(${ref(source, 'id')},${i + 1})`;
    return columns.map(field => `=IF(${key}="","",INDEX(${ref(source, field)},${i + 1})${field.endsWith('_minor') ? '/100' : ''})`);
  });
  if (hasA) {
    outputTable(views.Ageing, ['Invoice line', 'Balance NGN', 'Student', 'Due date', 'Days overdue', 'Bucket', 'Invoice status'], reportRows('InvoiceLines', ['id', 'balance_minor', 'student_id', 'due_date', 'overdue_days', 'ageing_bucket', 'invoice_status']));
    views.Ageing.getRange('D6:D105').setNumberFormat('yyyy-mm-dd');
    outputTable(views.Reconciliation, ['Settlement', 'Unmatched NGN', 'Bank reference', 'Gross NGN', 'Fees NGN', 'Net NGN', 'Net difference NGN'], reportRows('Settlements', ['id', 'unmatched_minor', 'bank_reference', 'gross_minor', 'fee_minor', 'net_minor', 'net_difference_minor']));
    outputTable(views.CashierHandover, ['Receipt ID', 'Gross NGN', 'Cashier', 'Reference', 'Status'], reportRows('Payments', ['id', 'amount_minor', 'cashier', 'reference', 'status']));
    outputTable(views.StudentStatement, ['Invoice', 'Billed NGN', 'Credits NGN', 'Allocated NGN', 'Balance NGN', 'Invoice date'], Array.from({ length: limit }, (_, i) =>
      ['id', 'billed_minor', 'credits_minor', 'net_allocated_minor', 'balance_minor', 'date'].map(field => `=IF(AND(Config!B34<>"",INDEX(T_Invoices[id],${i + 1})<>"",INDEX(T_Invoices[student_id],${i + 1})=Config!B34,INDEX(T_Invoices[status],${i + 1})="posted",INDEX(T_Invoices[date],${i + 1})<=Config!B8),INDEX(${ref('Invoices', field)},${i + 1})${field.endsWith('_minor') ? '/100' : ''},"")`)));
    views.StudentStatement.getRange('A4').formulas = [['=IF(Config!B34="","Select student in Config",Config!B34)']];
    views.StudentStatement.getRange('B6:E105').setNumberFormat(currencyFormat);
    views.StudentStatement.getRange('F6:F105').setNumberFormat('yyyy-mm-dd');
    outputTable(views.Clearance, ['Student ID', 'Balance NGN', 'Reference', 'Clearance review'], Array.from({ length: limit }, (_, i) => {
      const key = `INDEX(T_Students[id],${i + 1})`;
      const balance = `${sumif('InvoiceLines', 'balance_minor', ...c('InvoiceLines', 'student_id', key), ...c('InvoiceLines', 'eligible', '1'))}/100`;
      return [`=IF(${key}="","",${key})`, `=IF(${key}="","",${balance})`, `=IF(${key}="","",INDEX(T_Students[reference],${i + 1}))`,
        `=IF(${key}="","",IF(COUNTIFS(T_Invoices[student_id],${key},T_Invoices[status],"posted")=0,"No posted billing",IF(${balance}=0,"Finance balance clear; approve manually","Outstanding balance")))`];
    }));
  }
  if (hasB) {
    for (const [name, source, fields, headers] of [
      ['BudgetControl', 'Budgets', ['id', 'available_minor', 'amount_minor', 'changes_minor', 'actual_minor', 'open_commitment_minor'], ['Budget', 'Available NGN', 'Original NGN', 'Changes NGN', 'Actual NGN', 'Commitment NGN']],
      ['Payables', 'SupplierBills', ['id', 'balance_minor', 'supplier_id', 'amount_minor', 'paid_minor', 'status'], ['Bill', 'Payable NGN', 'Supplier', 'Billed NGN', 'Paid NGN', 'Status']],
      ['AdvancesReport', 'Advances', ['id', 'outstanding_minor', 'staff_reference', 'amount_minor', 'retired_minor', 'cash_return_minor'], ['Advance', 'Outstanding NGN', 'Staff', 'Issued NGN', 'Retired NGN', 'Cash returned NGN']],
      ['GrantReport', 'Projects', ['id', 'balance_minor', 'name', 'award_minor', 'receipts_minor', 'spent_minor'], ['Project', 'Cash schedule NGN', 'Name', 'Award NGN', 'Receipts NGN', 'Expenditure NGN']],
      ['AssetReport', 'Assets', ['id', 'net_book_minor', 'description', 'cost_minor', 'depreciation_minor', 'elapsed_months'], ['Asset', 'Net book NGN', 'Description', 'Cost NGN', 'Depreciation NGN', 'Elapsed months']],
      ['PayrollReview', 'PayrollChecks', ['id', 'gross_minor', 'staff_reference', 'net_minor', 'prior_gross_minor', 'gross_change_minor'], ['Row', 'Gross NGN', 'Staff', 'Net NGN', 'Prior gross NGN', 'Gross change NGN']],
      ['PaymentSchedule', 'SupplierBills', ['id', 'balance_minor', 'supplier_id', 'status'], ['Bill', 'Proposed maximum NGN', 'Supplier', 'Status']]
    ]) {
      outputTable(views[name], headers, reportRows(source, fields));
      for (let j = 0; j < fields.length; j++) if (fields[j].endsWith('_minor')) views[name].getRange(`${col(j)}6:${col(j)}105`).setNumberFormat(currencyFormat);
    }
    views.AssetReport.getRange('A3').values = [['Illustrative straight-line using completed months after depreciation_start_date plus approved opening depreciation. Disposal accounting is a manual reviewed schedule.']];
  }
  if (full) {
    outputTable(views.TrialBalance, ['Account ID', 'Closing NGN', 'Account name', 'Opening NGN', 'Debits NGN', 'Credits NGN'], reportRows('Accounts', ['id', 'closing_minor', 'name', 'opening_minor', 'debit_minor', 'credit_minor']));
    for (const letter of ['D', 'E', 'F']) views.TrialBalance.getRange(`${letter}6:${letter}105`).setNumberFormat(currencyFormat);
    const control = (configCell, expected) => `=IF(COUNTIF(T_Accounts[id],Config!${configCell})<>1,"Map account ID",${sumif('Accounts', 'closing_minor', ...c('Accounts', 'id', `Config!${configCell}`))}/100-(${expected}))`;
    outputTable(views.ControlAccounts, ['Control', 'Difference NGN', 'Expected result'], [
      ['Journal / opening balance', '=SUM(T_Accounts[closing_minor])/100', '0.00 required'],
      ['Receivables', control('B23', `${lineSum('balance_minor')}/100`), '0.00; clear academic session filter for ledger comparison'],
      ['Payables', control('B24', `-${sumif('SupplierBills', 'balance_minor', ...posted('SupplierBills'), ...cutoff('SupplierBills'))}/100`), '0.00 required'],
      ['Receipt clearing', control('B25', `(${total('Payments', 'amount_minor')}-${total('Refunds', 'amount_minor')}-${total('Reversals', 'amount_minor')}-${total('Settlements', 'gross_minor')})/100`), '0.00 required']
    ]);
    views.ControlAccounts.getRange('B6:B9').setNumberFormat('#,##0.00;(#,##0.00);0.00');
  }

  const docDefinitions = { Receipt: ['Payments', 'amount_minor', 'Receipt'], Statement: ['Invoices', 'balance_minor', 'Invoice statement'], RefundApproval: ['Refunds', 'amount_minor', 'Refund approval'],
    Voucher: ['SupplierPayments', 'amount_minor', 'Payment voucher'], BudgetApproval: ['Budgets', 'amount_minor', 'Budget approval'], AdvanceRetirement: ['Retirements', 'amount_minor', 'Advance retirement'] };
  for (const [name, [source, amount, label]] of Object.entries(docDefinitions)) if (views[name]) {
    const sheet = views[name];
    sheet.getRange('A2:H2').unmerge(); sheet.getRange('A2:B2').merge(); sheet.getRange('A2').values = [[label]];
    sheet.getRange('A3:H3').unmerge(); sheet.getRange('A3:B3').merge(); sheet.getRange('A3').formulas = [['=Config!B6']];
    outputTable(sheet, ['Document field', 'Value'], [
      ['Document ID', '=IF(Config!B20="","Enter document ID",Config!B20)'], ['Revision', '=Config!B21'], ['Source record ID', '=IF(Config!B22="","Select source record ID",Config!B22)'],
      ['Currency', '=Config!B7'], ['Status', `=IF(Config!B22="","Select source record ID",${lookup(source, 'status', 'Config!B22')})`],
      ['Amount NGN', `=IF(COUNTIF(${ref(source, 'id')},Config!B22)=1,${sumif(source, amount, ...c(source, 'id', 'Config!B22'))}/100,"Select valid record ID")`],
      ['Document date', Object.hasOwn(tables[source].columns, 'date') ? `=IF(Config!B22="","Select source record ID",${lookup(source, 'date', 'Config!B22')})` : '=Config!B8'],
      ['Prepared by', '=IF(Config!B17="","Enter preparer",Config!B17)'], ['Authorised officer', '=IF(Config!B18="","Enter officer",Config!B18)'], ['Officer title', '=IF(Config!B19="","Enter title",Config!B19)'],
      ['Manual signature', '________________________________'], ['Signature date', '________________________________']
    ]);
    sheet.getRange('B:B').format.columnWidth = 52; sheet.getRange('B6:B17').setNumberFormat('General');
    sheet.getRange('B11').setNumberFormat(currencyFormat); sheet.getRange('B12').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('A20:B21').merge(); sheet.getRange('A20').values = [['Manual signature required. This worksheet is editable and is not an authenticated approval or cryptographic digital signature.']]; sheet.getRange('A20:B21').format.wrapText = true;
    if (source === 'Payments') {
      sheet.getRange('A18').values = [['Payment reference']]; sheet.getRange('B18').formulas = [[`=IF(Config!B22="","Select source record ID",${lookup('Payments', 'reference', 'Config!B22')})`]];
      sheet.getRange('A19').values = [['Student ID']]; sheet.getRange('B19').formulas = [[`=IF(Config!B22="","Select source record ID",${lookup('Payments', 'student_id', 'Config!B22')})`]];
    }
    for (const [address, specification] of Object.entries(documentOverrides[name] || {})) {
      const cell = sheet.getRange(address);
      if (specification.formula) cell.formulas = [[specification.formula]]; else cell.values = [[specification.value]];
      if (specification.format) cell.setNumberFormat(specification.format);
    }
  }

  const exceptionRows = [];
  for (const { name } of definition.sheets) {
    exceptionRows.push([`${name}: invalid inputs`, `=COUNTIF(${ref(name, 'input_status')},"Review input")`, 'Review required types, IDs, institution and references']);
    const duplicate = `SUM(${ref(name, 'duplicate_flag')})`;
    exceptionRows.push([`${name}: duplicate IDs`, `=${duplicate}`, 'Must be zero; includes all duplicate rows']);
    for (const [field, target] of Object.entries(tables[name].references)) if (modelSheets.has(target)) exceptionRows.push([`${name}.${field}: missing ID`, `=SUM(${ref(name, `${field}_missing`)})`, `Referenced table: ${target}`]);
  }
  if (hasA) exceptionRows.push(['Negative student balances', '=COUNTIF(T_InvoiceLines[balance_minor],"<0")', 'Review credits and allocations'], ['Overused receipts', '=COUNTIF(T_Payments[unapplied_minor],"<0")', 'Review allocations/refunds/releases']);
  if (hasB) exceptionRows.push(['Budget overspend', '=COUNTIF(T_Budgets[available_minor],"<0")', 'Review approved revisions or commitments'], ['Advance over-retirement', '=COUNTIF(T_Advances[outstanding_minor],"<0")', 'Review retirement amounts']);
  if (full) exceptionRows.push(['Unbalanced journals', '=COUNTIF(T_JournalHeaders[difference_minor],">0")+COUNTIF(T_JournalHeaders[difference_minor],"<0")', 'Review header and line totals']);
  outputTable(views.Exceptions, ['Exception', 'Count', 'Review instruction'], exceptionRows);
  views.Exceptions.getRange(`B6:B${exceptionRows.length + 5}`).setNumberFormat('0');
  views.Exceptions.getRange(`B6:B${exceptionRows.length + 5}`).conditionalFormats.add('cellIs', { operator: 'greaterThan', formula: 0, format: { fill: palette.error, font: { bold: true, color: '#9C2929' } } });
  views.Exceptions.getRange('A:A').format.columnWidth = 66; views.Exceptions.getRange('C:C').format.columnWidth = 60;
  const instructions = [
    ['Release', `${release.version} pilot; Excel acceptance and institution policy approval required before sale.`],
    ['1. Save a copy', 'Clean template has no transactions. Demo records are fictional and must not be imported into live records.'],
    ['2. Configure', 'Set Institutions and Config, academic sessions/structures, accounts, funds, officers and numbering. Confirm accounting basis.'],
    ['3. Enter data', 'Amber cells are inputs. Preserve IDs as text. Enter monetary values as integer kobo. Dates are real Excel dates.'],
    ['4. Review', 'Draft first; review references and exception schedules; obtain manual approval before marking posted. No secure approval enforcement in Excel.'],
    ['5. Recalculate', 'Use Automatic calculation, then Ctrl+Alt+F9. Review Exceptions and controls. Reconcile with independent bank/subledger records.'],
    ['6. Documents', 'Set Config document ID/revision/source ID and officer names; print the selected form; sign manually. Never paste sensitive signatures into shared files.'],
    ['7. Backup', 'Use one writer. Save a dated immutable copy before imports, close and upgrades; test opening and reconciliation of restored copies.'],
    ['Imports', 'CLI validates CSV against the shared schema with previews and no partial return. Do not paste untrusted formula text. Excel copy/paste can bypass validation.'],
    ['Reconciliation', 'Enter split/grouped matches as separate rows. Only approved reviewed matches affect settlement totals. Never auto-approve suggestions.'],
    ['Academic / financial scope', 'Session filter affects student metrics; period filter affects budgets. Treasury and payables are cumulative through as-of date.'],
    ['Accounting', 'Journals and openings are manually reviewed inputs. No automatic posting from schedules. Full suite control accounts require explicit mappings.'],
    ['Assets', 'Illustrative completed-month straight-line schedule only; no automatic disposal or depreciation posting. Confirm policy before using.'],
    ['Printing', 'Source print areas include all prepared rows. Filter blank IDs before printing and clear filters before data entry. Review all pages of wide schedules.'],
    ['Compatibility', 'Target Microsoft 365 Excel for Windows 64-bit. Mac, web and older Excel are untested. No performance/capacity certification.'],
    ['Protection', 'Formula protection prevents accidental edits only. Workbook passwords, hidden views and editable logs are not secure access boundaries.'],
    ['Updates', 'Retain original file; validate and reconcile data before migration to a new version. Never overwrite the only copy.'],
    ['Sensitive information', 'Keep payroll and private staff information in separately restricted copies as required. Use only fictional records in demonstrations.']
  ];
  outputTable(readme, ['Step / policy', 'Instruction'], instructions);
  readme.getRange('B:B').format.columnWidth = 110;
  readme.getRange(`B6:B${instructions.length + 5}`).format.wrapText = true;
  readme.getRange(`A6:B${instructions.length + 5}`).format.rowHeight = 36;
  const chartRows = metrics.filter(row => ['Billed fees', 'Allocated collections', 'Student receivables', 'Approved budget', 'Actual expenditure', 'Available budget'].includes(row[0]));
  const chartStart = metrics.length + 9;
  dashboard.getRange(`A${chartStart}:B${chartStart}`).values = [['Measure', 'NGN']];
  chartRows.forEach((row, i) => {
    const index = metrics.findIndex(metric => metric[0] === row[0]) + 6;
    dashboard.getRange(`A${chartStart + i + 1}:B${chartStart + i + 1}`).formulas = [[`=A${index}`, `=B${index}`]];
  });
  const chart = dashboard.charts.add('bar', dashboard.getRange(`A${chartStart}:B${chartStart + chartRows.length}`));
  chart.title = 'Selected financial measures (NGN)'; chart.hasLegend = false;
  chart.yAxis = { numberFormatCode: '#,##0', numberFormatSourceLinked: false };
  chart.setPosition(`D${chartStart}`, `H${chartStart + 14}`);
  wb.recalculate();
  const inspected = await wb.inspect({ kind: 'table', range: 'Dashboard!A5:C24', include: 'values,formulas', tableMaxRows: 20, tableMaxCols: 3, maxChars: 1800 });
  await fs.writeFile(path.join(outputDir, `${packageId}-${mode}-inspection.ndjson`), inspected.ndjson);
  const file = `${packageId}-${mode}.xlsx`;
  await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(outputDir, file));
  const viewsSpec = Object.entries(views).map(([name]) => ({ name, rawCount: 0, print: `A1:${Object.hasOwn(docDefinitions, name) ? 'B' : name === 'Exceptions' ? 'C' : 'H'}${name === 'Exceptions' ? exceptionRows.length + 5 : Object.hasOwn(docDefinitions, name) ? 23 : 105}` }));
  manifest.push({ file, packageId, mode, generatedUtc: new Date().toISOString(), sheets: [{ name: 'Dashboard', rawCount: 0, print: `A1:H${chartStart + 15}` },
    { name: 'Config', rawCount: 2, print: 'A1:B34', editableRange: 'B5:B34' }, ...viewsSpec, ...sheetSpecs, { name: 'ReadMe', rawCount: 0, print: `A1:B${instructions.length + 5}` }] });
  if (mode === 'demo') {
    try {
      const sheetNames = packageId === 'excel' ? manifest.at(-1).sheets.map(s => s.name) : ['Dashboard', hasA ? 'Receipt' : 'Voucher'];
      for (const sheetName of sheetNames) {
        const preview = await wb.render({ sheetName, range: Object.hasOwn(docDefinitions, sheetName) ? 'A1:B23' : sheetName === 'Config' || sheetName === 'ReadMe' ? 'A1:B16' : 'A1:H16', scale: 1, format: 'png' });
        await fs.writeFile(path.join(outputDir, `${packageId}-${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
      }
    } catch (error) { process.stderr.write(`Preview unavailable for ${packageId}: ${error.message}\n`); }
  }
  process.stdout.write(`Generated ${file} (${definition.sheets.length} shared data tables)\n`);
}
await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(outputDir, 'demo-data.json'), JSON.stringify(demoData(), null, 2));
await fs.writeFile(path.join(outputDir, 'clean-data.json'), JSON.stringify(cleanData(), null, 2));
await fs.writeFile(path.join(outputDir, 'expected-demo-report.json'), JSON.stringify(analyse(demoData(), '2026-11-07'), null, 2));
