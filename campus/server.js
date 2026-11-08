'use strict';
const { configurationRequest, validConfiguration } = require('./configuration');
const { revenueRequest, validRevenue, validRules } = require('./revenue');
const { billingRequest, validBillingPreview, validBillingSchedule } = require('./billing');
const {treasuryRequest,validImportSummary,validCandidates,validTreasurySchedule}=require('./treasury');
const {settlementRequest,validSettlementSchedule}=require('./settlement');
const {budgetRequest,validBudgetSchedule,validBudgetFunds}=require('./budget');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const minor = /^(0|[1-9][0-9]{0,17})$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && uuid.test(value);

function validateConfig(config) {
  if (!exact(config, ['url', 'publishableKey']) || typeof config.url !== 'string' ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url) ||
    typeof config.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
    throw new TypeError('Dedicated Supabase URL and publishable key required');
  }
}
function createGateway(config, fetcher = fetch) {
  validateConfig(config);
  // Network failure is not retried: a lost RPC response may follow a committed transaction.
  return async function execute(authorization, action, payload) {
    let procedure; let body;
    const configuration = configurationRequest(action, payload) || revenueRequest(action, payload) || billingRequest(action,payload) || treasuryRequest(action,payload) || settlementRequest(action,payload) || budgetRequest(action,payload);
    if(configuration?.error)return{status:400,error:configuration.error};
    if (configuration) {
      ({ procedure, body } = configuration);
    } else if (action === 'context' && exact(payload, [])) {
      procedure = 'my_context'; body = {};
    } else if (action === 'schedule' && exact(payload, ['institution_id', 'basis']) && id(payload.institution_id) && ['cash', 'accrual'].includes(payload.basis)) {
      procedure = 'journal_schedule'; body = { tenant: payload.institution_id, accounting_basis: payload.basis };
    } else if (action === 'provision' && exact(payload, ['institution_id', 'legal_name', 'currency', 'administrator_id']) &&
      id(payload.institution_id) && id(payload.administrator_id) && typeof payload.legal_name === 'string' &&
      payload.legal_name.trim().length >= 1 && payload.legal_name.length <= 200 && typeof payload.currency === 'string' && /^[A-Z]{3}$/.test(payload.currency)) {
      procedure = 'provision_institution'; body = { tenant: payload.institution_id, legal_name: payload.legal_name, currency_code: payload.currency, administrator: payload.administrator_id };
    } else if (action === 'member' && exact(payload, ['institution_id', 'user_id', 'role', 'active']) &&
      id(payload.institution_id) && id(payload.user_id) && typeof payload.active === 'boolean' &&
      ['bursar', 'cashier', 'student_accounts', 'budget_officer', 'payables_officer', 'reviewer', 'auditor'].includes(payload.role)) {
      procedure = 'set_member'; body = { tenant: payload.institution_id, member: payload.user_id, member_role: payload.role, enabled: payload.active };
    } else if (action === 'reverse' && exact(payload, ['institution_id', 'original_id', 'expected_version', 'journal_id', 'period_id', 'document_date', 'reason']) &&
      ['institution_id', 'original_id', 'journal_id', 'period_id'].every(key => id(payload[key])) &&
      Number.isSafeInteger(payload.expected_version) && payload.expected_version > 0 && typeof payload.document_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.document_date) &&
      typeof payload.reason === 'string' && payload.reason.trim().length >= 1 && payload.reason.length <= 500) {
      procedure = 'reverse_journal'; body = { tenant: payload.institution_id, original: payload.original_id, expected_version: payload.expected_version,
        reversal: payload.journal_id, reversal_period: payload.period_id, reversal_date: payload.document_date, reason: payload.reason };
    } else if (action === 'transition' && exact(payload, ['institution_id', 'journal_id', 'expected_version', 'target']) &&
      id(payload.institution_id) && id(payload.journal_id) && Number.isSafeInteger(payload.expected_version) && payload.expected_version > 0 &&
      ['submitted', 'reviewed', 'approved', 'posted'].includes(payload.target)) {
      procedure = 'transition_journal';
      body = { tenant: payload.institution_id, journal: payload.journal_id, expected_version: payload.expected_version, target: payload.target };
    } else if (action === 'create' && exact(payload, ['institution_id', 'journal_id', 'basis', 'policy_id', 'period_id', 'source_id', 'document_date', 'lines']) &&
      ['institution_id', 'journal_id', 'policy_id', 'period_id', 'source_id'].every(key => id(payload[key])) &&
      ['cash', 'accrual'].includes(payload.basis) && typeof payload.document_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(payload.document_date) && Array.isArray(payload.lines) && payload.lines.length >= 2 && payload.lines.length <= 1000 &&
      payload.lines.every(line => exact(line, ['account_id', 'debit_minor', 'credit_minor']) && id(line.account_id) &&
        ['debit_minor', 'credit_minor'].every(key => typeof line[key] === 'string' && minor.test(line[key])))) {
      procedure = 'create_journal';
      body = { tenant: payload.institution_id, journal: payload.journal_id, accounting_basis: payload.basis,
        policy: payload.policy_id, period: payload.period_id, source: payload.source_id, document_date: payload.document_date, entries: payload.lines };
    } else { return { status: 400, error: 'Invalid request' }; }
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]{1,8192}$/.test(authorization)) {
      return { status: 401, error: 'Authentication required' };
    }
    try {
      const headers = { apikey: config.publishableKey, Authorization: authorization };
      const identity = await fetcher(`${config.url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) });
      if (!identity.ok) return { status: identity.status >= 500 ? 503 : 401, error: 'Authentication required' };
      const user = await identity.json();
      if (!object(user) || !id(user.id)) return { status: 401, error: 'Authentication required' };
      const response = await fetcher(`${config.url}/rest/v1/rpc/${procedure}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Profile': 'campus', 'Accept-Profile': 'campus' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) return { status: 401, error: 'Authentication required' };
        if (response.status >= 500) return { status: 503, error: 'Service unavailable; verify journal state before retrying' };
        if (!object(result) || typeof result.code !== 'string') return { status: 502, error: 'Invalid service response' };
        return { status: result.code === '42501' ? 403 : ['40001', '23505'].includes(result.code) ? 409 : 422, error: 'Journal request rejected' };
      }
      if(action==='budgets'||action==='budget_funds'){
        if(!(action==='budgets'?validBudgetSchedule(result):validBudgetFunds(result)))return{status:502,error:'Invalid service response'};
      } else if(action==='settlements'){
        if(!validSettlementSchedule(result))return{status:502,error:'Invalid service response'};
      } else if(['treasury','stage_import','candidates'].includes(action)){
        const valid=action==='treasury'?validTreasurySchedule(result):action==='stage_import'?validImportSummary(result):validCandidates(result);
        if(!valid)return{status:502,error:'Invalid service response'};
      } else if(action==='billing'||action==='billing_preview'){
        if(!(action==='billing'?validBillingSchedule(result):validBillingPreview(result)))return{status:502,error:'Invalid service response'};
      } else if (action === 'revenue' || action === 'rules') {
        if (!(action === 'revenue' ? validRevenue(result) : validRules(result))) return { status: 502, error: 'Invalid service response' };
      } else if (action === 'configuration') {
        if (!validConfiguration(result)) return { status: 502, error: 'Invalid service response' };
      } else if (action === 'context') {
        if (!exact(result, ['platform_administrator', 'institutions']) || typeof result.platform_administrator !== 'boolean' ||
          !Array.isArray(result.institutions) || !result.institutions.every(row => exact(row, ['id', 'name', 'currency', 'role']) &&
            id(row.id) && typeof row.name === 'string' && typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) &&
            ['institution_administrator', 'bursar', 'cashier', 'student_accounts', 'budget_officer', 'payables_officer', 'reviewer', 'auditor'].includes(row.role))) {
          return { status: 502, error: 'Invalid service response' };
        }
      } else if (action === 'schedule') {
        if (!Array.isArray(result) || result.length > 100 || !result.every(row => exact(row, ['id', 'basis', 'posted_on', 'status', 'version', 'reversal_of']) && id(row.id) &&
          row.basis === payload.basis && typeof row.posted_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.posted_on) &&
          ['draft', 'submitted', 'reviewed', 'approved', 'posted'].includes(row.status) && Number.isSafeInteger(row.version) && row.version > 0 && (row.reversal_of === null || id(row.reversal_of)))) {
          return { status: 502, error: 'Invalid service response' };
        }
      } else if (!Number.isSafeInteger(result) || result < 1) return { status: 502, error: 'Invalid service response' };
      return { status: 200, data: result };
    } catch {
      return { status: 503, error: 'Service unavailable; verify journal state before retrying' };
    }
  };
}
function createAuthAdapter(config, fetcher = fetch) {
  validateConfig(config);
  return {
    // Auth rejection has no application writes; do not retry credential requests automatically.
    async login(credentials) {
      if (!exact(credentials, ['email', 'password']) || typeof credentials.email !== 'string' || credentials.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email) || typeof credentials.password !== 'string' || !credentials.password.length || credentials.password.length > 1024) {
        return { status: 400, error: 'Invalid sign-in request' };
      }
      try {
        const response = await fetcher(`${config.url}/auth/v1/token?grant_type=password`, {
          method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials), signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return { status: response.status === 429 ? 429 : response.status >= 500 ? 503 : 401, error: 'Sign-in failed' };
        const session = await response.json();
        if (!object(session) || !object(session.user) || !id(session.user.id) || typeof session.access_token !== 'string' ||
          !/^[A-Za-z0-9._-]{1,8192}$/.test(session.access_token) || !Number.isSafeInteger(session.expires_in) || session.expires_in < 1 || session.expires_in > 86400) {
          return { status: 502, error: 'Invalid authentication response' };
        }
        return { status: 200, data: { access_token: session.access_token, expires_in: session.expires_in } };
      } catch { return { status: 503, error: 'Sign-in unavailable' }; }
    },
    // Provider logout revokes refresh capability; issued access JWTs may survive until expiry.
    async logout(authorization) {
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]{1,8192}$/.test(authorization)) return { status: 401, error: 'Authentication required' };
      try {
        const response = await fetcher(`${config.url}/auth/v1/logout?scope=local`, {
          method: 'POST', headers: { apikey: config.publishableKey, Authorization: authorization }, signal: AbortSignal.timeout(10000)
        });
        return response.ok ? { status: 200, data: 1 } : { status: 503, error: 'Provider sign-out unconfirmed; local session cleared' };
      } catch { return { status: 503, error: 'Provider sign-out unconfirmed; local session cleared' }; }
    }
  };
}
module.exports = { createGateway, createAuthAdapter };
