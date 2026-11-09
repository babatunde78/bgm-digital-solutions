'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stage, statement } = require('./core');
const { Store } = require('./store');
const fixtures = require('./pilot-fixtures');
test('pilot control totals and statement match the independent acceptance oracle', () => {
  const preview = stage(fixtures.records, 'Synthetic pilot ledger', []);
  assert.equal(preview.count, fixtures.expected.validRows);
  assert.equal(preview.totalMinor, fixtures.expected.grossControlTotalMinor);
  assert.deepEqual(statement('0', preview.rows.filter(row => row.student === '00001')), fixtures.expected.statement);
});
test('invalid pilot batch reports three errors and cannot partially accept', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  store.configure(fixtures.config, 'Demo Preparer');
  const preview = store.stage(fixtures.invalid, 'Synthetic invalid pilot');
  assert.equal(preview.count, fixtures.expected.invalidRows);
  assert.equal(preview.errors.length, fixtures.expected.invalidErrors);
  assert.equal(preview.totalMinor, fixtures.expected.invalidControlTotalMinor);
  assert.throws(() => store.accept(preview.id, 'Demo Reviewer', 'Synthetic invalid batch'));
  assert.deepEqual(store.records(), []);
});
