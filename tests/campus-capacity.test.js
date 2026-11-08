'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { capacityData } = require('../lib/campus-capacity-fixture');
const { analyse, validateData } = require('../lib/campus-finance');

test('capacity fixture fills the prepared transaction rows and reconciles to independent totals', () => {
  const data = capacityData(100);
  assert.deepEqual(validateData(data), []);
  for (const table of ['Students', 'Invoices', 'InvoiceLines', 'Payments', 'Allocations', 'Settlements', 'ReconciliationMatches', 'SupplierBills', 'SupplierPayments', 'Advances', 'Retirements']) assert.equal(data[table].length, 100);
  const report = analyse(data, '2026-11-07');
  assert.deepEqual(report.revenue, { billed: 100000000, credits: 0, allocated: 75000000, receivable: 25000000, received: 75000000, refunds: 0, unapplied: 0, settledNet: 74000000, settlementFees: 1000000, overdue: 25000000 });
  assert.deepEqual(report.expenditure, { budget: 100000000, actual: 14000000, commitment: 5000000, available: 81000000, payable: 2000000, advancesOutstanding: 5000000 });
  assert.deepEqual(report.controls, { journalDifference: 0, receivableDifference: 0, payableDifference: 0, clearingDifference: 0 });
});
test('capacity references remain text and workload boundaries reject invalid row counts', () => {
  const data = capacityData(100);
  assert.deepEqual([data.Students[0].reference, data.Students.at(-1).reference], ['0000000001', '0000000100']);
  for (const count of [0, -1, 101, 1.5]) assert.throws(() => capacityData(count), /1 to 100/);
});
