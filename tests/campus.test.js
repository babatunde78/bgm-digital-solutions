'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priceBook, quote, usdEquivalent } = require('../lib/campus-pricing');
const { tables, workbookDefinition } = require('../lib/campus-model');

test('quotes preserve authoritative NGN totals and a historical price snapshot', () => {
  assert.deepEqual(['a', 'b', 'excel', 'connected'].map(id => quote(id).firstYearKobo), [80000000, 120000000, 160000000, 510000000]);
  const saved = quote('a'); saved.annualKobo = 1;
  assert.equal(quote('a').annualKobo, 60000000);
  assert.equal(quote('connected').startingFrom, true);
  assert.equal(priceBook.publication, 'published');
  assert.equal(priceBook.effectiveFrom, '2026-11-08');
});
test('suite annual discount is twenty percent and total USD rounds only after addition', () => {
  assert.equal(quote('excel').annualKobo * 100 / (quote('a').annualKobo + quote('b').annualKobo), 80);
  assert.equal(usdEquivalent(quote('a').firstYearKobo), '593.42');
  assert.equal(usdEquivalent(quote('a').annualKobo), '445.07');
  assert.throws(() => quote('unknown'), /Unknown package/);
  assert.throws(() => usdEquivalent(-1), /kobo/);
});
test('workbook packages share financial schemas and exclude unrelated modules', () => {
  const a = workbookDefinition('a'); const b = workbookDefinition('b'); const full = workbookDefinition('excel');
  assert.equal(a.sheets.some(s => s.name === 'InvoiceLines'), true);
  assert.equal(a.sheets.some(s => s.name === 'SupplierBills'), false);
  assert.equal(b.sheets.some(s => s.name === 'SupplierBills'), true);
  assert.equal(full.sheets.some(s => s.name === 'JournalLines'), true);
  assert.deepEqual(full.sheets.find(s => s.name === 'Payments').columns, tables.Payments.columns);
  assert.equal(Object.values(tables).every(t => t.columns.institution_id === 'text'), true);
  assert.throws(() => workbookDefinition('connected'), /Excel package/);
});
