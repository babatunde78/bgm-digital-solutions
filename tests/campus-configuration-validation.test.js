'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configurationRequest, validConfiguration } = require('../campus/configuration');
const uuid = '20000000-0000-4000-8000-000000000001';
test('configuration rejects malformed upstream records and duplicate or spoofed mappings', () => {
  assert.equal(validConfiguration({ accounts: [], periods: [], policies: [] }), true);
  assert.equal(validConfiguration({ accounts: [], periods: [], policies: [], secret: 'unexpected' }), false);
  const payload = { institution_id: uuid, policy_id: uuid, basis: 'cash', effective_from: '2026-01-01', narrative: 'Synthetic policy', mappings: [{ key: 'cash', account_id: uuid }] };
  assert.equal(configurationRequest('policy', { ...payload, mappings: [...payload.mappings, ...payload.mappings] }), null);
  assert.equal(configurationRequest('policy', { ...payload, mappings: [{ key: 'cash', account_id: uuid, institution_id: uuid }] }), null);
  assert.equal(configurationRequest('policy', { ...payload, basis: 'both' }), null);
  assert.equal(validConfiguration({ accounts: [], periods: [{ id: uuid, starts_on: '2026-01-01', ends_on: '2026-12-31', locked: 'false', version: 1 }], policies: [] }), false);
});
