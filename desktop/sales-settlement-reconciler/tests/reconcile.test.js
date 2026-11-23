'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core');

const keys = [
  { id: 'reference', label: 'Reference', type: 'text' },
  { id: 'date', label: 'Date', type: 'date' },
  { id: 'amount', label: 'Amount', type: 'amount' }
];
const row = (reference, date, amount, sourceRow) => ({ sourceRow, values: { reference, date, amount } });

test('duplicates in amounts alone do not create false matches when other keys distinguish records', () => {
  const left = [row('A1', '17/11/2026', '45,000.00', 2), row('A2', '17/11/2026', '45,000.00', 3)];
  const right = [row('A2', '2026-11-17', '45000', 9), row('A1', '17-11-2026', '45000.00', 8)];
  const result = core.reconcile(left, right, keys, { dateOrder: 'DMY' });
  assert.deepEqual(result.matched.map(pair => pair.leftIndex), [0, 1]);
  assert.equal(result.ambiguous.length, 0);
});

test('repeated references remain ambiguous and are never auto-merged', () => {
  const key = [{ id: 'reference', label: 'Reference', type: 'text' }];
  const result = core.reconcile([row('PAY-8', '', '', 2), row('PAY-8', '', '', 3)], [row('PAY-8', '', '', 7), row('PAY-8', '', '', 8)], key);
  assert.equal(result.matched.length, 0);
  assert.equal(result.ambiguous.length, 2);
  assert.equal(result.leftDuplicates.length, 1);
  assert.equal(result.rightDuplicates.length, 1);
});

test('leading-zero identifiers remain distinct text keys', () => {
  const key = [{ id: 'reference', label: 'Reference', type: 'text' }];
  const result = core.reconcile([row('000041', '', '', 2)], [row('41', '', '', 2)], key);
  assert.equal(result.matched.length, 0);
  assert.deepEqual(result.unmatchedLeft, [0]);
  assert.deepEqual(result.unmatchedRight, [0]);
});

test('mixed DMY and ISO dates normalize; impossible dates are exceptions', () => {
  const result = core.reconcile([row('R1','17/11/2026','10',2), row('R2','31/02/2026','20',3)], [row('R1','2026-11-17','10',8)], keys, { dateOrder: 'DMY' });
  assert.equal(result.matched.length, 1);
  assert.equal(result.invalidLeft.length, 1);
  assert.equal(result.invalidLeft[0].sourceRow, 3);
});

test('negative amounts match only the same sign and cent tolerance is explicit', () => {
  const first = core.reconcile([row('NEG','2026-11-17','(2,500.00)',2)], [row('NEG','2026-11-17','-2500',2)], keys);
  assert.equal(first.matched.length, 1);
  const second = core.reconcile([row('R','2026-11-17','100.00',2)], [row('R','2026-11-17','100.02',2)], keys, { amountToleranceCents: 1 });
  assert.equal(second.matched.length, 0);
  const tolerated = core.reconcile([row('R','2026-11-17','100.00',2)], [row('R','2026-11-17','100.01',2)], keys, { amountToleranceCents: 1 });
  assert.match(tolerated.matched[0].explanation, /difference ₦0\.01; allowed ₦0\.01/u);
});

test('multiple candidates require human confirmation and a bank row cannot be reused', () => {
  const onlyRef = [{ id: 'reference', label: 'Reference', type: 'text' }];
  const result = core.reconcile([row('DUP','','',2), row('DUP','','',3)], [row('DUP','','',8)], onlyRef);
  assert.equal(result.matched.length, 0);
  core.confirmPair(result, 0, 0);
  assert.equal(result.matched[0].decision, 'Manually confirmed by operator');
  assert.deepEqual(result.unmatchedLeft, [1]);
  assert.throws(() => core.confirmPair(result, 1, 0), /not an available candidate|cannot be used twice/u);
});

test('amount/date parsing rejects unclear formats and preserves exact originals outside normalization', () => {
  assert.equal(core.parseAmount('₦1,234.56').value, 123456);
  assert.equal(core.parseAmount('NGN 1.005').value, 101);
  assert.equal(core.parseAmount('1.234,56').ok, false);
  assert.equal(core.parseDate('03/04/2026', 'DMY').value, '2026-04-03');
  assert.equal(core.parseDate('2026-02-30').ok, false);
  const source = row(' 000005 ', '2026-11-17', '1,000.00', 4);
  const before = structuredClone(source);
  core.reconcile([source], [row('000005','2026-11-17','1000',9)], [{ id:'reference',label:'Reference',type:'text' },keys[1],keys[2]]);
  assert.deepEqual(source, before);
});

test('large all-to-all ambiguity aborts rather than returning a partial match set', () => {
  const duplicateRows = Array.from({ length: 502 }, (_, index) => row('SAME','','',index + 2));
  assert.throws(() => core.reconcile(duplicateRows, duplicateRows, [{ id:'reference',label:'Reference',type:'text' }]), /250,000 possible pairs/u);
});

test('dashboard summary counts imported rows and keeps the sales match-rate denominator explicit', () => {
  const reference = [{ id: 'reference', label: 'Reference', type: 'text' }];
  const result = core.reconcile(
    [row('A', '', '', 2), row('D', '', '', 3), row('B', '', '', 4), row('', '', '', 5)],
    [row('A', '', '', 2), row('D', '', '', 8), row('D', '', '', 9), row('Z', '', '', 10), row('', '', '', 11)],
    reference
  );
  assert.deepEqual(core.summarize(result), {
    salesRows: 4,
    bankRows: 5,
    matchedRows: 1,
    matchRatePercent: 25,
    ambiguousSalesRows: 1,
    ambiguousBankRows: 2,
    unmatchedSalesRows: 1,
    unmatchedBankRows: 1,
    invalidSalesRows: 1,
    invalidBankRows: 1,
    duplicateSalesGroups: 0,
    duplicateBankGroups: 1
  });
});
