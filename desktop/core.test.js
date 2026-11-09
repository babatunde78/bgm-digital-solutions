'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stage, statement, render, amount, configuration, parseCsv } = require('./core');
const row = { reference: '00000000000000000001', student: '00001', name: 'Synthetic Student', date: '2026-11-09', currency: 'NGN', amount: '1250.25', kind: 'payment', evidence: 'bank-ledger-001' };
test('staging preserves references and exact control totals', () => {
  const result = stage([row], 'Synthetic bank ledger', []);
  assert.equal(result.totalMinor, '125025');
  assert.equal(result.rows[0].reference, '00000000000000000001');
});
test('invalid rows expose unavailable totals and row errors', () => {
  for (const patch of [{ amount: 'NaN' }, { amount: '1.001' }, { date: '2026-02-30' }, { currency: 'XX' }, { reference: '' }, { kind: 'settlement' }]) {
    const result = stage([{ ...row, ...patch }], 'Synthetic bank ledger', []);
    assert.equal(result.totalMinor, null);
    assert.equal(result.errors.length, 1);
  }
});
test('repeated references and empty imports are blocked', () => {
  assert.equal(stage([row, row], 'Synthetic', []).errors.length, 1);
  assert.equal(stage([row], 'Synthetic', [row.reference]).errors.length, 1);
  assert.equal(stage([], 'Synthetic', []).errors.length, 1);
});
test('statement reconciles charges credits payments and opening', () => {
  assert.deepEqual(statement('10000', [
    { kind: 'charge', minor: '5000' }, { kind: 'credit', minor: '1000' }, { kind: 'payment', minor: '3000' }
  ]), { opening: '10000', charges: '5000', credits: '1000', payments: '3000', closing: '11000' });
});
test('templates escape imported text and mark drafts', () => {
  const config = configuration({ name: 'Synthetic College', currency: 'NGN' });
  const html = render({ id: 'receipt-1', kind: 'receipt', status: 'draft', revision: 1, config, records: [{ ...row, minor: '125025', name: '<script>bad()</script>' }], totalMinor: '125025', source: 'Synthetic', actor: 'Officer', created: '2026-11-09' });
  assert.equal(html.includes('<script>bad()'), false);
  assert.equal(html.includes('&lt;script&gt;bad()&lt;/script&gt;'), true);
  assert.equal(html.includes('DRAFT'), true);
});
test('money rejects unsupported precision rather than rounding silently', () => {
  assert.equal(amount('999999999999999.99'), '99999999999999999');
  assert.throws(() => amount('1e3'));
  assert.throws(() => amount('-1'));
});
test('CSV quoted values remain text and malformed quoting is rejected', () => {
  const header = 'reference,student,name,date,currency,amount,kind,evidence\r\n';
  const csv = `${header}0001,0002,"Example, Student",2026-11-09,NGN,1.20,payment,"ledger ""reviewed"""`;
  assert.deepEqual(parseCsv(csv), [{ reference: '0001', student: '0002', name: 'Example, Student', date: '2026-11-09', currency: 'NGN', amount: '1.20', kind: 'payment', evidence: 'ledger "reviewed"' }]);
  assert.throws(() => parseCsv(`${header}1,2,"unclosed`));
  assert.throws(() => parseCsv('reference,reference\n1,2'));
});
test('CSV formula text is never evaluated and PDF output escapes markup', () => {
  const input = { ...row, name: '=HYPERLINK("https://example.invalid") <img src=x>' };
  const preview = stage([input], 'Synthetic', []);
  assert.equal(preview.rows[0].name, input.name);
  const html = render({ id: 'CBD-1', kind: 'receipt', status: 'draft', revision: 1, config: { name: 'Synthetic', currency: 'NGN' }, records: preview.rows, totalMinor: '125025', source: 'Synthetic', actor: 'Officer', created: '2026-11-09' });
  assert.equal(html.includes('<img src=x>'), false);
});
