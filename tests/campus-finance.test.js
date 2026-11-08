'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { moneyToMinor, validateData, analyse, importCsv, billStudents, reverseJournal } = require('../lib/campus-finance');
const { demoData, cleanData } = require('../lib/campus-fixtures');

test('decimal conversion preserves exact pennies and rejects ambiguous financial input', () => {
  assert.deepEqual(['0', '0.01', '1200.50', '1348.11'].map(moneyToMinor), [0, 1, 120050, 134811]);
  for (const value of ['1,200', '1.001', '1e3', '-1', '', '=1+1']) assert.throws(() => moneyToMinor(value));
});
test('synthetic revenue distinguishes invoicing, allocation, refund and settlement', () => {
  const report = analyse(demoData(), '2026-11-07');
  assert.deepEqual(report.revenue, { billed: 30000000, credits: 1000000, allocated: 22000000,
    receivable: 7000000, received: 26000000, refunds: 1000000, unapplied: 3000000,
    settledNet: 24800000, settlementFees: 200000, overdue: 7000000 });
  assert.deepEqual(report.controls, { journalDifference: 0, receivableDifference: 0, payableDifference: 0, clearingDifference: 0 });
  assert.deepEqual(report.expenditure, { budget: 10000000, actual: 3000000, commitment: 1000000,
    available: 6000000, payable: 1000000, advancesOutstanding: 300000 });
});
test('validation rejects duplicate IDs, broken references, over-allocation and unbalanced journals', () => {
  const duplicate = demoData(); duplicate.Students.push({ ...duplicate.Students[0] });
  assert.equal(validateData(duplicate).some(e => e.code === 'duplicate_id'), true);
  const broken = demoData(); broken.Allocations[0].payment_id = 'missing';
  assert.equal(validateData(broken).some(e => e.code === 'reference'), true);
  const over = demoData(); over.Allocations[0].amount_minor = 999999999;
  assert.equal(validateData(over).some(e => e.code === 'over_allocation'), true);
  const journal = demoData(); journal.JournalLines[0].debit_minor++;
  assert.equal(validateData(journal).some(e => e.code === 'unbalanced_journal'), true);
  assert.throws(() => analyse(journal, '2026-11-07'), /validation/);
});
test('imports preserve references, are atomic and idempotent, and report hostile or ambiguous rows', () => {
  const data = cleanData();
  const csv = 'id,reference,name\ns-001,00001234,Synthetic student\n';
  const options = { table: 'Students', batchId: 'batch-1', mapping: { id: 'id', reference: 'reference', name: 'name' } };
  const first = importCsv(data, csv, options);
  assert.equal(first.errors.length, 0); assert.equal(first.data.Students[0].reference, '00001234');
  const second = importCsv(first.data, csv, options);
  assert.deepEqual(second.data, first.data); assert.equal(second.duplicate, true);
  const bad = importCsv(data, 'id,reference,name\ns-001,00001234,"=HYPERLINK(""bad"")"\n', options);
  assert.equal(bad.errors.length > 0, true); assert.deepEqual(bad.data, data);
  const date = importCsv(data, 'id,date,amount_minor,reference,status\np1,07/11/2026,100,0001,draft\n',
    { table: 'Payments', batchId: 'bad-date', mapping: { id: 'id', date: 'date', amount_minor: 'amount_minor', reference: 'reference', status: 'status' } });
  assert.equal(date.errors.some(e => e.code === 'date'), true); assert.deepEqual(date.data, data);
});
test('billing previews are repeatable and journal reversals retain a traceable balanced link', () => {
  const data = demoData();
  const billed = billStudents(data, { batchId: 'bill-2', sessionId: 'session-2026', date: '2026-11-07', dueDate: '2026-12-01' });
  assert.equal(billed.Invoices.length - data.Invoices.length, 3);
  assert.deepEqual(billStudents(billed, { batchId: 'bill-2', sessionId: 'session-2026', date: '2026-11-07', dueDate: '2026-12-01' }), billed);
  assert.throws(() => billStudents(billed, { batchId: 'bill-2', sessionId: 'session-2026', date: '2026-11-07', dueDate: '2026-12-02' }), /different configuration/);
  const reversed = reverseJournal(data, 'j-invoice-1', { id: 'j-reverse-1', date: '2026-11-07', reason: 'Synthetic correction' });
  assert.equal(reversed.JournalHeaders.at(-1).reversal_of_id, 'j-invoice-1');
  assert.deepEqual(reversed.JournalLines.slice(-2).map(r => [r.debit_minor, r.credit_minor]), [[0, 10000000], [10000000, 0]]);
  const locked = demoData(); locked.Periods[0].locked = true;
  assert.throws(() => reverseJournal(locked, 'j-invoice-1', { id: 'r', date: '2026-11-07', reason: 'Correction' }), /locked/);
});
test('date cutoffs and approved reconciliation do not count future sources or fuzzy suggestions as settlement', () => {
  const data = demoData();
  const before = analyse(data, '2026-10-01');
  assert.deepEqual([before.revenue.billed, before.revenue.credits, before.revenue.received, before.revenue.receivable], [30000000, 0, 0, 30000000]);
  data.ReconciliationMatches[0].review_status = 'suggested';
  assert.deepEqual(validateData(data), []);
  data.Settlements[0].net_minor++;
  assert.equal(validateData(data).some(e => e.code === 'settlement_total'), true);
});
test('imports reject posted transactions and invalid foreign-institution records without modifying input', () => {
  const data = cleanData();
  const result = importCsv(data, 'id,reference,date,amount_minor,status\np-1,0000001,2026-11-07,100,posted\n', { table: 'Payments', batchId: 'posted-batch', mapping: { id: 'id', reference: 'reference', date: 'date', amount_minor: 'amount_minor', status: 'status' } });
  assert.equal(result.errors.some(e => e.code === 'import_draft_only'), true); assert.deepEqual(result.data, data);
  const other = demoData(); other.Students[0].institution_id = 'other-institution';
  assert.equal(validateData(other).some(e => e.code === 'institution'), true);
});
test('chargebacks release allocations explicitly and expose unposted control-account corrections', () => {
  const data = demoData();
  data.AllocationReleases.push({ id: 'release-1', institution_id: 'demo-campus', allocation_id: 'alloc-1', date: '2026-10-11', amount_minor: 1000000, reason: 'Chargeback allocation release', status: 'posted' });
  data.Reversals.push({ id: 'chargeback-1', institution_id: 'demo-campus', payment_id: 'p-1', date: '2026-10-11', amount_minor: 2000000, kind: 'chargeback', reason: 'Synthetic disputed collection', status: 'posted' });
  data.ReconciliationMatches[0].amount_minor = 6000000;
  data.Settlements[0].gross_minor = 23000000; data.Settlements[0].net_minor = 22800000;
  const report = analyse(data, '2026-11-07');
  assert.deepEqual([report.revenue.receivable, report.revenue.unapplied, report.controls.receivableDifference], [8000000, 2000000, -1000000]);
});
test('one receipt may match multiple grouped settlements with no duplicated settlement income', () => {
  const data = demoData();
  data.Settlements[0].gross_minor = 10000000; data.Settlements[0].fee_minor = 100000; data.Settlements[0].net_minor = 9900000;
  data.Settlements.push({ ...data.Settlements[0], id: 'settlement-2', bank_reference: '000SETTLE2', gross_minor: 15000000, net_minor: 14900000 });
  data.ReconciliationMatches[0].amount_minor = 4000000; data.ReconciliationMatches[1].amount_minor = 6000000;
  data.ReconciliationMatches[2].settlement_id = 'settlement-2';
  data.ReconciliationMatches.push({ ...data.ReconciliationMatches[0], id: 'split-1', settlement_id: 'settlement-2' });
  data.ReconciliationMatches.push({ ...data.ReconciliationMatches[1], id: 'split-2', settlement_id: 'settlement-2', amount_minor: 5000000 });
  assert.deepEqual(validateData(data), []);
  assert.deepEqual([analyse(data, '2026-11-07').revenue.billed, analyse(data, '2026-11-07').revenue.settledNet], [30000000, 24800000]);
});
test('a restored JSON backup reproduces the financial report exactly', () => {
  const data = demoData(); const restored = JSON.parse(JSON.stringify(data));
  const report = analyse(restored, '2026-11-07');
  assert.deepEqual([report.revenue.receivable, report.revenue.unapplied, report.expenditure.payable, report.controls.journalDifference], [7000000, 3000000, 1000000, 0]);
});
test('aggregate budget overflow fails explicitly instead of rounding an unsafe total', () => {
  const data = demoData(); data.Budgets[0].amount_minor = Number.MAX_SAFE_INTEGER;
  data.BudgetChanges.push({ id: 'large-revision', institution_id: 'demo-campus', budget_id: 'budget-1', date: '2026-10-01', kind: 'revision', amount_minor: 1, reason: 'Synthetic boundary', status: 'posted' });
  assert.throws(() => analyse(data, '2026-11-07'), /safe integer/);
});
