'use strict';
const { createHash } = require('node:crypto');
const { tables } = require('./campus-model');
const states = ['draft', 'submitted', 'reviewed', 'approved', 'posted', 'reversed'];
class CampusValidationError extends Error {
  constructor(issues) { super('Campus financial validation failed'); this.name = 'CampusValidationError'; this.issues = issues; }
}
function moneyToMinor(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) throw new RangeError('Use a nonnegative decimal with at most two places');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount exceeds safe integer range');
  return Number(minor);
}
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function sum(rows, field) {
  const total = rows.reduce((value, row) => value + BigInt(row[field]), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Financial total exceeds safe integer range');
  return Number(total);
}
function addMinor(...values) {
  return sum(values.map(amount_minor => ({ amount_minor })), 'amount_minor');
}
function active(data, table, asOf = '9999-12-31') {
  return data[table].filter(row => (!Object.hasOwn(row, 'status') || row.status === 'posted') && (!row.date || row.date <= asOf));
}
function validateData(data) {
  const issues = [];
  const issue = (table, row, field, code) => issues.push({ table, row, field, code });
  if (!data || typeof data !== 'object') return [{ table: '', row: 0, field: '', code: 'dataset' }];
  for (const [table, schema] of Object.entries(tables)) {
    if (!Array.isArray(data[table])) { issue(table, 0, '', 'missing_table'); continue; }
    const ids = new Set();
    data[table].forEach((row, index) => {
      if (!row || typeof row !== 'object') { issue(table, index + 1, '', 'record'); return; }
      if (ids.has(row.id)) issue(table, index + 1, 'id', 'duplicate_id'); ids.add(row.id);
      for (const [field, type] of Object.entries(schema.columns)) {
        const value = row[field];
        if (type.endsWith('?') && (value === '' || value === undefined || value === null)) continue;
        if (type === 'integer' && (!Number.isSafeInteger(value) || (value < 0 && !(table === 'BudgetChanges' && field === 'amount_minor')))) issue(table, index + 1, field, 'integer');
        if (type === 'boolean' && typeof value !== 'boolean') issue(table, index + 1, field, 'boolean');
        if (type === 'date' && !isDate(value)) issue(table, index + 1, field, 'date');
        if (type === 'posting-state' && !states.includes(value)) issue(table, index + 1, field, 'status');
        if ((type === 'text' || type === 'text?') && (typeof value !== 'string' || !value.trim() || /^[\s]*[=+@\-\t\r]/.test(value))) issue(table, index + 1, field, 'text');
        if (type === 'json') { try { const parsed = JSON.parse(value); if (!parsed || typeof parsed !== 'object') issue(table, index + 1, field, 'json'); } catch { issue(table, index + 1, field, 'json'); } }
      }
      for (const field of Object.keys(row)) if (!Object.hasOwn(schema.columns, field)) issue(table, index + 1, field, 'unknown_column');
      for (const [field, target] of Object.entries(schema.references)) {
        if (!row[field] && schema.columns[field].endsWith('?')) continue;
        if (!Array.isArray(data[target]) || !data[target].some(other => other.id === row[field] && other.institution_id === row.institution_id)) issue(table, index + 1, field, 'reference');
      }
      if (!data.Institutions?.some(inst => inst.id === row.institution_id && inst.institution_id === row.institution_id)) issue(table, index + 1, 'institution_id', 'institution');
    });
  }
  if (issues.length) return issues;
  if (data.Institutions.length !== 1) issue('Institutions', 0, 'id', 'single_institution');
  if (data.Institutions.some(row => JSON.parse(row.configuration_json).currency !== 'NGN')) issue('Institutions', 0, 'configuration_json', 'unsupported_currency');
  for (const [table, parentTable, field] of [
    ['Credits', 'Invoices', 'invoice_id'], ['Refunds', 'Payments', 'payment_id'], ['Reversals', 'Payments', 'payment_id'],
    ['AllocationReleases', 'Allocations', 'allocation_id'], ['SupplierPayments', 'SupplierBills', 'supplier_bill_id'], ['Retirements', 'Advances', 'advance_id']
  ]) for (const record of active(data, table)) {
    const parent = data[parentTable].find(row => row.id === record[field]);
    if (parent.status !== 'posted' || record.date < parent.date) issue(table, 0, record.id, 'unposted_or_future_source');
  }
  if (sum(data.OpeningBalances, 'debit_minor') !== sum(data.OpeningBalances, 'credit_minor')) issue('OpeningBalances', 0, '', 'unbalanced_opening');
  const budgetKeys = new Set();
  for (const budget of data.Budgets) {
    const key = `${budget.account_id}|${budget.period_id}|${budget.fund_id}`;
    if (budgetKeys.has(key)) issue('Budgets', 0, budget.id, 'duplicate_budget'); budgetKeys.add(key);
  }
  for (const [table, field] of [['SupplierBills', 'budget_id'], ['Expenses', 'budget_id'], ['Retirements', 'budget_id'], ['Commitments', 'budget_id'], ['BudgetChanges', 'budget_id']]) {
    for (const record of active(data, table)) {
      const budget = data.Budgets.find(row => row.id === record[field]); const period = data.Periods.find(p => p.id === budget.period_id);
      if (budget.status !== 'posted' || record.date < period.start_date || record.date > period.end_date) issue(table, 0, record.id, 'budget_period');
    }
  }
  const lineInvoice = Object.fromEntries(data.InvoiceLines.map(line => [line.id, line.invoice_id]));
  for (const invoice of active(data, 'Invoices')) if (!data.InvoiceLines.some(line => line.invoice_id === invoice.id)) issue('Invoices', 0, invoice.id, 'missing_lines');
  for (const credit of active(data, 'Credits')) if (lineInvoice[credit.invoice_line_id] !== credit.invoice_id) issue('Credits', 0, credit.id, 'invoice_mismatch');
  for (const line of data.InvoiceLines) {
    const used = sum(active(data, 'Allocations').filter(a => a.invoice_line_id === line.id), 'amount_minor') -
      sum(active(data, 'AllocationReleases').filter(r => data.Allocations.some(a => a.id === r.allocation_id && a.invoice_line_id === line.id)), 'amount_minor');
    const credits = sum(active(data, 'Credits').filter(c => c.invoice_line_id === line.id), 'amount_minor');
    if (used < 0 || used + credits > line.amount_minor) issue('InvoiceLines', 0, line.id, 'over_allocation');
  }
  for (const payment of data.Payments) {
    const allocated = sum(active(data, 'Allocations').filter(a => a.payment_id === payment.id), 'amount_minor');
    const releases = sum(active(data, 'AllocationReleases').filter(r => data.Allocations.some(a => a.id === r.allocation_id && a.payment_id === payment.id)), 'amount_minor');
    const returned = sum(active(data, 'Refunds').filter(r => r.payment_id === payment.id), 'amount_minor') + sum(active(data, 'Reversals').filter(r => r.payment_id === payment.id), 'amount_minor');
    if (allocated - releases + returned > payment.amount_minor || releases > allocated) issue('Payments', 0, payment.id, 'over_allocation');
    const approved = sum(data.ReconciliationMatches.filter(m => m.payment_id === payment.id && m.review_status === 'approved'), 'amount_minor');
    if (approved > payment.amount_minor - returned) issue('Payments', 0, payment.id, 'over_reconciliation');
  }
  for (const allocation of active(data, 'Allocations')) {
    const payment = data.Payments.find(p => p.id === allocation.payment_id);
    const line = data.InvoiceLines.find(l => l.id === allocation.invoice_line_id);
    const invoice = data.Invoices.find(i => i.id === line.invoice_id);
    if (payment.status !== 'posted' || invoice.status !== 'posted' || allocation.date < payment.date || allocation.date < invoice.date) issue('Allocations', 0, allocation.id, 'unposted_or_future_source');
    if (payment.student_id && payment.student_id !== invoice.student_id) issue('Allocations', 0, allocation.id, 'student_mismatch');
    if (sum(active(data, 'AllocationReleases').filter(r => r.allocation_id === allocation.id), 'amount_minor') > allocation.amount_minor) issue('AllocationReleases', 0, allocation.id, 'over_release');
  }
  for (const settlement of data.Settlements) {
    if (settlement.gross_minor - settlement.fee_minor !== settlement.net_minor) issue('Settlements', 0, settlement.id, 'settlement_total');
    if (sum(data.ReconciliationMatches.filter(m => m.settlement_id === settlement.id && m.review_status === 'approved'), 'amount_minor') > settlement.gross_minor) issue('ReconciliationMatches', 0, settlement.id, 'over_reconciliation');
  }
  for (const match of data.ReconciliationMatches) {
    if (!['suggested', 'approved', 'rejected'].includes(match.review_status)) issue('ReconciliationMatches', 0, match.id, 'review_status');
    if (match.review_status === 'approved') {
      const payment = data.Payments.find(p => p.id === match.payment_id); const settlement = data.Settlements.find(s => s.id === match.settlement_id);
      if (payment.status !== 'posted' || settlement.status !== 'posted' || settlement.date < payment.date) issue('ReconciliationMatches', 0, match.id, 'unposted_or_future_source');
    }
  }
  for (const header of data.JournalHeaders) {
    const lines = data.JournalLines.filter(l => l.journal_id === header.id);
    if (header.status === 'posted' && (lines.length < 2 || sum(lines, 'debit_minor') !== sum(lines, 'credit_minor'))) issue('JournalHeaders', 0, header.id, 'unbalanced_journal');
    const period = data.Periods.find(p => p.id === header.period_id);
    if (header.date < period.start_date || header.date > period.end_date) issue('JournalHeaders', 0, header.id, 'period_date');
  }
  for (const line of data.JournalLines) if ((line.debit_minor > 0) === (line.credit_minor > 0)) issue('JournalLines', 0, line.id, 'journal_side');
  for (const bill of data.SupplierBills) if (sum(active(data, 'SupplierPayments').filter(p => p.supplier_bill_id === bill.id), 'amount_minor') > bill.amount_minor) issue('SupplierPayments', 0, bill.id, 'over_payment');
  for (const commitment of data.Commitments) if (sum(active(data, 'SupplierBills').filter(b => b.commitment_id === commitment.id), 'amount_minor') > commitment.amount_minor) issue('SupplierBills', 0, commitment.id, 'over_commitment');
  for (const advance of data.Advances) if (sum(active(data, 'Retirements').filter(r => r.advance_id === advance.id), 'amount_minor') + sum(active(data, 'Retirements').filter(r => r.advance_id === advance.id), 'cash_return_minor') > advance.amount_minor) issue('Retirements', 0, advance.id, 'over_retirement');
  for (const asset of data.Assets) if (asset.residual_minor > asset.cost_minor || asset.life_months < 1 || asset.opening_depreciation_minor > asset.cost_minor - asset.residual_minor || asset.depreciation_start_date < asset.in_service_date || asset.in_service_date < asset.acquisition_date) issue('Assets', 0, asset.id, 'asset_policy');
  const references = new Set();
  for (const payment of data.Payments) { if (references.has(payment.reference)) issue('Payments', 0, payment.id, 'duplicate_reference'); references.add(payment.reference); }
  return issues;
}
function analyse(data, asOf) {
  if (!isDate(asOf)) throw new RangeError('Use an ISO as-of date');
  const issues = validateData(data); if (issues.length) throw new CampusValidationError(issues);
  const posted = table => active(data, table, asOf);
  const invoiceIds = new Set(posted('Invoices').map(row => row.id));
  const lines = data.InvoiceLines.filter(row => invoiceIds.has(row.invoice_id));
  const credits = sum(posted('Credits'), 'amount_minor');
  const allocated = addMinor(sum(posted('Allocations'), 'amount_minor'), -sum(posted('AllocationReleases'), 'amount_minor'));
  const received = sum(posted('Payments'), 'amount_minor');
  const refunds = addMinor(sum(posted('Refunds'), 'amount_minor'), sum(posted('Reversals'), 'amount_minor'));
  const balances = lines.map(line => ({ id: line.id, student_id: data.Invoices.find(i => i.id === line.invoice_id).student_id, due_date: line.due_date,
    balance: addMinor(line.amount_minor, -sum(posted('Credits').filter(c => c.invoice_line_id === line.id), 'amount_minor'), -sum(posted('Allocations').filter(a => a.invoice_line_id === line.id), 'amount_minor'), sum(posted('AllocationReleases').filter(r => data.Allocations.some(a => a.id === r.allocation_id && a.invoice_line_id === line.id)), 'amount_minor')) }));
  const billed = sum(lines, 'amount_minor');
  const revenue = { billed, credits, allocated, receivable: addMinor(billed, -credits, -allocated), received, refunds,
    unapplied: addMinor(received, -refunds, -allocated), settledNet: sum(posted('Settlements'), 'net_minor'), settlementFees: sum(posted('Settlements'), 'fee_minor'),
    overdue: sum(balances.filter(line => line.due_date < asOf), 'balance') };
  const budget = addMinor(sum(posted('Budgets'), 'amount_minor'), sum(posted('BudgetChanges'), 'amount_minor'));
  const actual = addMinor(sum(posted('SupplierBills'), 'amount_minor'), sum(posted('Expenses'), 'amount_minor'), sum(posted('Retirements'), 'amount_minor'));
  const commitment = addMinor(sum(posted('Commitments'), 'amount_minor'), -sum(posted('SupplierBills').filter(bill => bill.commitment_id), 'amount_minor'));
  const expenditure = { budget, actual, commitment, available: addMinor(budget, -actual, -commitment),
    payable: addMinor(sum(posted('SupplierBills'), 'amount_minor'), -sum(posted('SupplierPayments'), 'amount_minor')),
    advancesOutstanding: addMinor(sum(posted('Advances'), 'amount_minor'), -sum(posted('Retirements'), 'amount_minor'), -sum(posted('Retirements'), 'cash_return_minor')) };
  const journalIds = new Set(posted('JournalHeaders').map(row => row.id));
  const journalLines = data.JournalLines.filter(row => journalIds.has(row.journal_id));
  const trialBalance = data.Accounts.map(account => {
    const entries = journalLines.filter(row => row.account_id === account.id);
    const openings = data.OpeningBalances.filter(row => row.account_id === account.id && row.date <= asOf);
    return { id: account.id, debit: addMinor(sum(entries, 'debit_minor'), sum(openings, 'debit_minor')), credit: addMinor(sum(entries, 'credit_minor'), sum(openings, 'credit_minor')) };
  });
  const balance = id => { const entry = trialBalance.find(row => row.id === id); return entry ? entry.debit - entry.credit : null; };
  const mapping = JSON.parse(data.Institutions[0].configuration_json).controlAccounts || {};
  const controls = { journalDifference: sum(trialBalance, 'debit') - sum(trialBalance, 'credit'),
    receivableDifference: balance(mapping.receivable) === null ? null : balance(mapping.receivable) - revenue.receivable,
    payableDifference: balance(mapping.payable) === null ? null : -balance(mapping.payable) - expenditure.payable,
    clearingDifference: balance(mapping.clearing) === null ? null : balance(mapping.clearing) - (received - refunds - sum(posted('Settlements'), 'gross_minor')) };
  return { asOf, revenue, expenditure, balances, trialBalance, controls };
}
function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else if (quoted) { quoted = false; closed = true; } else if (value === '' && !closed) quoted = true; else throw new RangeError('Unexpected CSV quote'); }
    else if (ch === ',' && !quoted) { row.push(value); value = ''; closed = false; }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(v => v !== '')) rows.push(row); row = []; value = ''; closed = false; }
    else if (closed) throw new RangeError('Unexpected text after CSV quote');
    else value += ch;
  }
  if (quoted) throw new RangeError('Unclosed CSV quote');
  if (value !== '' || row.length) { row.push(value); rows.push(row); }
  return rows;
}
function importCsv(data, csv, options) {
  const { table, batchId, mapping } = options;
  if (!Object.hasOwn(tables, table) || ['Institutions', 'ImportBatches', 'ImportRows', 'JournalHeaders', 'JournalLines'].includes(table)) throw new RangeError('Unsupported import table');
  if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(batchId)) throw new RangeError('Invalid batch ID');
  if (!mapping || typeof mapping !== 'object' || !Object.hasOwn(mapping, 'id')) throw new RangeError('Map the stable ID column');
  const digest = createHash('sha256').update(JSON.stringify({ table, mapping, csv })).digest('hex');
  const existing = data.ImportBatches.find(b => b.id === batchId || b.content_hash === digest);
  if (existing) {
    if (existing.content_hash !== digest) throw new RangeError('Batch ID already used for different content');
    return { data: structuredClone(data), errors: [], duplicate: true, preview: [] };
  }
  const rows = parseCsv(csv); const header = rows.shift() || [];
  if (new Set(header).size !== header.length) throw new RangeError('Duplicate CSV headers');
  for (const [field, source] of Object.entries(mapping)) if (!Object.hasOwn(tables[table].columns, field) || !header.includes(source) || field === 'institution_id') throw new RangeError('Invalid column mapping');
  const candidate = structuredClone(data); const institutionId = data.Institutions[0].id;
  const errors = []; const preview = [];
  rows.forEach((cells, index) => {
    const record = { institution_id: institutionId };
    if (cells.length !== header.length) errors.push({ table, row: index + 2, field: '', code: 'column_count' });
    for (const [field, source] of Object.entries(mapping)) {
      const raw = cells[header.indexOf(source)] ?? ''; const type = tables[table].columns[field];
      record[field] = type === 'integer' && /^-?\d+$/.test(raw) ? Number(raw) : type === 'boolean' && ['true', 'false'].includes(raw) ? raw === 'true' : raw;
      if (typeof record[field] === 'string' && /^[\s]*[=+@\-\t\r]/.test(raw)) errors.push({ table, row: index + 2, field, code: 'formula_injection' });
    }
    if (Object.hasOwn(record, 'status') && record.status !== 'draft') errors.push({ table, row: index + 2, field: 'status', code: 'import_draft_only' });
    preview.push(record); candidate[table].push(record);
  });
  errors.push(...validateData(candidate).map(error => error.table === table && error.row > data[table].length ? { ...error, row: error.row - data[table].length + 1 } : error));
  if (errors.length) return { data: structuredClone(data), errors, duplicate: false, preview };
  candidate.ImportBatches.push({ id: batchId, institution_id: institutionId, content_hash: digest, source: table, status: 'validated', row_count: rows.length,
    total_minor: preview.every(r => Number.isSafeInteger(r.amount_minor)) ? sum(preview, 'amount_minor') : 0 });
  preview.forEach((record, i) => candidate.ImportRows.push({ id: `${batchId}-${i + 1}`, institution_id: institutionId, batch_id: batchId, row_number: i + 2, raw_json: JSON.stringify(record), errors_json: '[]' }));
  return { data: candidate, errors: [], duplicate: false, preview };
}
function billStudents(data, { batchId, sessionId, date, dueDate }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(batchId) || !isDate(date) || !isDate(dueDate) || dueDate < date) throw new RangeError('Invalid billing batch or dates');
  const output = structuredClone(data);
  const contentHash = createHash('sha256').update(JSON.stringify({ batchId, sessionId, date, dueDate, students: data.Students, fees: data.FeeSchedules })).digest('hex');
  const previous = data.ImportBatches.find(batch => batch.id === batchId);
  if (previous) {
    if (previous.content_hash !== contentHash) throw new RangeError('Billing batch ID already used with different configuration');
    return output;
  }
  const period = data.Periods.find(p => p.start_date <= date && p.end_date >= date);
  if (!period || period.locked) throw new RangeError('Billing period missing or locked');
  for (const student of data.Students) {
    const fees = data.FeeSchedules.filter(f => f.session_id === sessionId && f.programme_id === student.programme_id && f.level_id === student.level_id);
    if (!fees.length) throw new RangeError(`Missing fee mapping for ${student.id}`);
    const invoiceId = `${batchId}-${student.id}`;
    if (output.Invoices.some(i => i.id === invoiceId)) throw new RangeError('Billing invoice ID already exists');
    output.Invoices.push({ id: invoiceId, institution_id: student.institution_id, student_id: student.id, session_id: sessionId, date, status: 'draft' });
    fees.forEach(f => output.InvoiceLines.push({ id: `${invoiceId}-${f.id}`, institution_id: student.institution_id, invoice_id: invoiceId, account_id: f.account_id, amount_minor: f.amount_minor, due_date: dueDate }));
  }
  output.ImportBatches.push({ id: batchId, institution_id: data.Institutions[0].id, content_hash: contentHash, source: 'billing', status: 'draft', row_count: output.Invoices.length - data.Invoices.length,
    total_minor: sum(output.InvoiceLines.slice(data.InvoiceLines.length), 'amount_minor') });
  const issues = validateData(output); if (issues.length) throw new CampusValidationError(issues);
  return output;
}
function reverseJournal(data, journalId, { id, date, reason }) {
  const original = data.JournalHeaders.find(j => j.id === journalId && j.status === 'posted');
  const period = data.Periods.find(p => p.start_date <= date && p.end_date >= date);
  if (!original || !id || !reason || !isDate(date) || date < original.date) throw new RangeError('Invalid journal reversal');
  if (!period || period.locked) throw new RangeError('Reversal period missing or locked');
  if (data.JournalHeaders.some(j => j.reversal_of_id === journalId)) throw new RangeError('Journal already reversed');
  const output = structuredClone(data);
  output.JournalHeaders.push({ ...original, id, date, period_id: period.id, reversal_of_id: original.id, reason, source_type: 'JournalHeaders', source_id: journalId });
  data.JournalLines.filter(l => l.journal_id === journalId).forEach((line, i) => output.JournalLines.push({ ...line, id: `${id}-${i + 1}`, journal_id: id, debit_minor: line.credit_minor, credit_minor: line.debit_minor }));
  const issues = validateData(output); if (issues.length) throw new CampusValidationError(issues);
  return output;
}
module.exports = { CampusValidationError, moneyToMinor, validateData, analyse, importCsv, billStudents, reverseJournal, parseCsv };
