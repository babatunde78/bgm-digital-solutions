'use strict';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const kind = value => ['asset', 'liability', 'equity', 'income', 'expense'].includes(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const mappings = value => Array.isArray(value) && value.length >= 1 && value.length <= 1000 && value.every(row =>
  exact(row, ['key', 'account_id']) && typeof row.key === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(row.key) && id(row.account_id)) && new Set(value.map(row => row.key)).size === value.length;

function configurationRequest(action, payload) {
  if (!object(payload) || !id(payload.institution_id)) return null;
  const tenant = payload.institution_id;
  if (action === 'configuration' && exact(payload, ['institution_id'])) return { procedure: 'configuration', body: { tenant } };
  if (action === 'account' && exact(payload, ['institution_id', 'account_id', 'code', 'name', 'account_type']) && id(payload.account_id) &&
    typeof payload.code === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(payload.code) && text(payload.name, 200) && kind(payload.account_type)) {
    return { procedure: 'create_account', body: { tenant, account: payload.account_id, account_code: payload.code, account_name: payload.name, kind: payload.account_type } };
  }
  if (action === 'period' && exact(payload, ['institution_id', 'period_id', 'starts_on', 'ends_on']) && id(payload.period_id) && date(payload.starts_on) && date(payload.ends_on)) {
    return { procedure: 'create_period', body: { tenant, period: payload.period_id, starts: payload.starts_on, ends: payload.ends_on } };
  }
  if (action === 'policy' && exact(payload, ['institution_id', 'policy_id', 'basis', 'effective_from', 'narrative', 'mappings']) &&
    id(payload.policy_id) && ['cash', 'accrual'].includes(payload.basis) && date(payload.effective_from) && text(payload.narrative, 4000) && mappings(payload.mappings)) {
    return { procedure: 'propose_policy', body: { tenant, proposal: payload.policy_id, accounting_basis: payload.basis, effective: payload.effective_from, description: payload.narrative, mappings: payload.mappings } };
  }
  if (action === 'approve_policy' && exact(payload, ['institution_id', 'policy_id']) && id(payload.policy_id)) {
    return { procedure: 'approve_policy', body: { tenant, proposal: payload.policy_id } };
  }
  if (action === 'lock_period' && exact(payload, ['institution_id', 'period_id', 'expected_version']) && id(payload.period_id) && Number.isSafeInteger(payload.expected_version) && payload.expected_version > 0) {
    return { procedure: 'lock_period', body: { tenant, period: payload.period_id, expected_version: payload.expected_version } };
  }
  return null;
}
function validConfiguration(value) {
  return exact(value, ['accounts', 'periods', 'policies']) &&
    Array.isArray(value.accounts) && value.accounts.every(row => exact(row, ['id', 'name', 'code', 'account_type']) && id(row.id) && text(row.name, 200) &&
      (row.code === null || typeof row.code === 'string') && (row.account_type === null || kind(row.account_type))) &&
    Array.isArray(value.periods) && value.periods.every(row => exact(row, ['id', 'starts_on', 'ends_on', 'locked', 'version']) && id(row.id) && date(row.starts_on) && date(row.ends_on) &&
      typeof row.locked === 'boolean' && Number.isSafeInteger(row.version) && row.version > 0) &&
    Array.isArray(value.policies) && value.policies.every(row => exact(row, ['id', 'basis', 'effective_from', 'narrative', 'mappings', 'prepared_by', 'approved_by', 'version']) &&
      id(row.id) && ['cash', 'accrual'].includes(row.basis) && date(row.effective_from) && text(row.narrative, 4000) && mappings(row.mappings) && id(row.prepared_by) &&
      (row.approved_by === null ? row.version === null : id(row.approved_by) && Number.isSafeInteger(row.version) && row.version > 0));
}
module.exports = { configurationRequest, validConfiguration };
