'use strict';
let accessToken = ''; let institutions = []; let expiryTimer; let configuredAccounts = [];
const get = id => document.getElementById(id);
function message(text) { get('message').textContent = text; }
function clearSession() {
  accessToken = ''; institutions = []; clearTimeout(expiryTimer);
  message('Session cleared. Sign in again.');
  get('workspace').hidden = true; get('signed-out').hidden = false;
  get('institution').replaceChildren(new Option('Select an institution', ''));
  for (const form of document.querySelectorAll('form')) { form.reset(); delete form.dataset.recordId; }
  get('invoice-lines').replaceChildren();
  for(const container of document.querySelectorAll('[data-plan-lines]')) container.replaceChildren();
  get('membership').textContent = '';
  get('journals').replaceChildren();
  get('configuration-output').replaceChildren(); get('mapping-rows').replaceChildren(); configuredAccounts = [];
  get('revenue-output').replaceChildren(); get('rules-output').replaceChildren();
  get('billing-output').replaceChildren(); get('billing-preview-output').replaceChildren(); get('fee-lines').replaceChildren();
  get('treasury-output').replaceChildren();get('candidate-output').replaceChildren();get('matching-pairs').replaceChildren();
  get('settlement-output').replaceChildren();
  get('budget-output').replaceChildren();get('budget-funds-output').replaceChildren();
}
async function request(path, body) {
  const token=accessToken;
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && token===accessToken) clearSession();
    throw new Error(result.error || 'Request failed');
  }
  return result.data;
}
async function context() {
  const data = await request('/api/action', { action: 'context', payload: {} });
  institutions = data.institutions;
  get('institution').replaceChildren(new Option('Select an institution', ''), ...institutions.map(item => new Option(item.name, item.id)));
  get('provision-section').hidden = !data.platform_administrator;
  get('workspace').hidden = false; get('signed-out').hidden = true;
  selectInstitution();
}
function selectInstitution() {
  const institution = institutions.find(item => item.id === get('institution').value);
  get('membership').textContent = institution ? `${institution.role.replaceAll('_', ' ')} · ${institution.currency}` : '';
  get('member-section').hidden = institution?.role !== 'institution_administrator';
  get('journal-section').hidden = !institution || ['institution_administrator', 'auditor'].includes(institution.role);
  get('schedule-section').hidden = !institution || institution.role === 'institution_administrator';
  get('journals').replaceChildren();
  get('configuration-section').hidden = !institution;
  get('configuration-admin').hidden = institution?.role !== 'institution_administrator';
  get('configuration-bursar').hidden = institution?.role !== 'bursar';
  get('configuration-output').replaceChildren(); get('mapping-rows').replaceChildren(); configuredAccounts = [];
  get('revenue-output').replaceChildren(); get('rules-output').replaceChildren();
  get('rule-section').hidden = !institution;
  get('rule-admin').hidden = institution?.role !== 'institution_administrator';
  get('rule-bursar').hidden = institution?.role !== 'bursar';
  get('revenue-section').hidden = !institution || !['bursar','cashier','student_accounts','reviewer','auditor'].includes(institution.role);
  get('revenue-entry').hidden = !institution || !['bursar','cashier','student_accounts'].includes(institution.role);
  get('revenue_transition').hidden = institution?.role === 'auditor';
  get('student').hidden = !['bursar','student_accounts'].includes(institution?.role);
  get('invoice').hidden = !['bursar','student_accounts'].includes(institution?.role);
  get('receipt').hidden = !['bursar','cashier'].includes(institution?.role);
  get('correction-entry').hidden = !['bursar','cashier','student_accounts'].includes(institution?.role);
  get('billing-section').hidden = !institution;
  get('billing-admin').hidden = institution?.role !== 'institution_administrator';
  get('billing-bursar').hidden = institution?.role !== 'bursar';
  get('billing-entry').hidden = !['bursar','student_accounts'].includes(institution?.role);
  get('billing-workflow').hidden = !['bursar','student_accounts','reviewer'].includes(institution?.role);
  get('billing-output').replaceChildren(); get('billing-preview-output').replaceChildren();
  get('treasury-section').hidden=!institution;
  get('treasury-admin').hidden=institution?.role!=='institution_administrator';
  get('treasury-entry').hidden=!['bursar','cashier','student_accounts'].includes(institution?.role);
  get('treasury-verify').hidden=institution?.role!=='bursar';
  get('treasury-finance').hidden=!['bursar','cashier','student_accounts','reviewer','auditor'].includes(institution?.role);
  get('treasury-workflow').hidden=!['bursar','cashier','student_accounts','reviewer'].includes(institution?.role);
  get('treasury-output').replaceChildren();get('candidate-output').replaceChildren();
  get('settlement-section').hidden=!institution;
  get('settlement-admin').hidden=institution?.role!=='institution_administrator';
  get('settlement-bursar').hidden=institution?.role!=='bursar';
  get('settlement-entry').hidden=!['bursar','student_accounts'].includes(institution?.role);
  get('settlement-workflow').hidden=!['bursar','student_accounts','reviewer'].includes(institution?.role);
  get('settlement-output').replaceChildren();
  get('budget-section').hidden=!institution;
  get('budget-admin').hidden=institution?.role!=='institution_administrator';
  get('budget-configure').hidden=!['bursar','budget_officer'].includes(institution?.role);
  get('budget-finance').hidden=!['bursar','budget_officer','payables_officer','reviewer','auditor'].includes(institution?.role);
  get('budget-entry').hidden=!['bursar','budget_officer','payables_officer'].includes(institution?.role);
  get('budget-workflow').hidden=!['bursar','budget_officer','payables_officer','reviewer'].includes(institution?.role);
  get('budget-output').replaceChildren();get('budget-funds-output').replaceChildren();
}
function appendRevenueDetails(parent, value) {
  const list = document.createElement('dl');
  for (const [key, item] of Object.entries(value)) {
    const term = document.createElement('dt'); term.textContent = key.replaceAll('_',' ');
    const definition = document.createElement('dd');
    if (item !== null && typeof item === 'object') {
      if (Array.isArray(item)) item.forEach(record => appendRevenueDetails(definition, record));
      else appendRevenueDetails(definition, item);
    } else definition.textContent = item === null ? 'Not assigned' : String(item);
    list.append(term,definition);
  }
  parent.append(list);
}
for (const [button,action,output] of [['refresh-revenue','revenue','revenue-output'],['refresh-rules','rules','rules-output'],['refresh-billing','billing','billing-output'],['refresh-treasury','treasury','treasury-output'],['refresh-settlements','settlements','settlement-output']]) {
  get(button).addEventListener('click', async () => {
    const tenant = get('institution').value; const token = accessToken;
    try {
      const data = await request('/api/action',{action,payload:{institution_id:tenant}});
      if (!accessToken || accessToken!==token || get('institution').value!==tenant) return;
      get(output).replaceChildren();
      appendRevenueDetails(get(output),action==='rules'?{rules:data}:data);
      message(action==='settlements'?'Profiles, explicit differences and both journal previews refreshed. Inspect before approval; no bank transaction was executed.':action==='treasury'?(data.financial_access?'Statement gross/fees/net and reviewed matches shown; these are not cash balances or income posting.':'Bank source configuration shown; financial schedules require a finance role.'):'Schedule refreshed. Source totals include posted records only; lists show up to 100 records. Billing snapshots describe draft generation, not posted income.');
    } catch(error) { message(error.message); }
  });
}
function addRevenueRow(container, fields) {
  const row = document.createElement('div'); row.className='entry-row';
  for (const field of fields) {
    const label = document.createElement('label'); label.textContent=field.replaceAll('_',' ');
    const input = document.createElement('input'); input.dataset.revenueField=field; input.required=true;
    if (field==='due_date') input.type='date';
    if (field.endsWith('_minor')) { input.pattern='(0|[1-9][0-9]{0,17})'; input.inputMode='numeric'; if (field!=='amount_minor') input.value='0'; }
    if(field==='description') input.maxLength=200;
    label.append(input); row.append(label);
  }
  const remove = document.createElement('button'); remove.type='button'; remove.textContent='Remove line'; remove.addEventListener('click',()=>row.remove()); row.append(remove); container.append(row);
}
get('add-invoice-line').addEventListener('click',()=>addRevenueRow(get('invoice-lines'),['account_id','description','amount_minor','due_date']));
get('add-fee-line').addEventListener('click',()=>addRevenueRow(get('fee-lines'),['fee_key','account_id','description','amount_minor','due_date']));
get('add-matching-pair').addEventListener('click',()=>addRevenueRow(get('matching-pairs'),['bank_line_id','event_id','amount_minor']));
get('bank-csv-file').addEventListener('change',async event=>{
  const file=event.target.files[0];const token=accessToken;const tenant=get('institution').value;
  if(!file)return;
  if(file.size>120000){message('CSV exceeds the 120000-byte limit.');return;}
  try{const csv=await file.text();if(accessToken&&accessToken===token&&get('institution').value===tenant)get('stage_import').elements.namedItem('csv').value=csv;}
  catch{message('CSV could not be read.');}
});
get('candidate_lookup').addEventListener('submit',async event=>{
  event.preventDefault();const token=accessToken;const tenant=get('institution').value;const line=get('candidate_lookup').elements.namedItem('bank_line_id').value;
  try{
    const data=await request('/api/action',{action:'candidates',payload:{institution_id:tenant,bank_line_id:line}});
    if(!accessToken||accessToken!==token||get('institution').value!==tenant||get('candidate_lookup').elements.namedItem('bank_line_id').value!==line)return;
    get('candidate-output').replaceChildren();appendRevenueDetails(get('candidate-output'),{candidates:data});message('Every candidate requires explicit selection, independent review and approval. Nothing was matched automatically.');
  }catch(error){message(error.message);}
});
function billingPreviewPayload(){
  const fields=Object.fromEntries(new FormData(get('prepare_batch')));
  return{institution_id:get('institution').value,...fields,student_ids:fields.student_ids.trim().split(/[\s,]+/).filter(Boolean)};
}
get('prepare_batch').addEventListener('input',()=>get('billing-preview-output').replaceChildren());
get('preview-billing').addEventListener('click',async()=>{
  if(!get('prepare_batch').reportValidity())return;
  const payload=billingPreviewPayload();const token=accessToken;
  try{
    const data=await request('/api/action',{action:'billing_preview',payload});
    if(!accessToken||accessToken!==token||JSON.stringify(payload)!==JSON.stringify(billingPreviewPayload()))return;
    get('billing-preview-output').replaceChildren();appendRevenueDetails(get('billing-preview-output'),data);
    message('Proposed batch totals shown. All eligibility errors must be resolved before preparation; no invoice has been created by this preview.');
  }catch(error){message(error.message);}
});
for(const fieldset of document.querySelectorAll('[data-plan-basis]')) {
  fieldset.querySelector('[data-add-plan-line]').addEventListener('click',()=>addRevenueRow(fieldset.querySelector('[data-plan-lines]'),['account_id','debit_minor','credit_minor']));
  fieldset.querySelector('[data-plan-treatment]').addEventListener('change',event=>{
    const noEntry=event.target.value==='nonrecognition';
    for(const input of fieldset.querySelectorAll('[data-plan-lines] input')) input.disabled=noEntry;
    fieldset.querySelector('[data-plan-reason]').required=noEntry;
    fieldset.querySelector('[data-add-plan-line]').disabled=noEntry;
  });
}
function addMapping() {
  const row = document.createElement('div'); row.className = 'mapping-row';
  const keyLabel = document.createElement('label'); keyLabel.textContent = 'Mapping name';
  const key = document.createElement('input'); key.required = true; key.pattern = '[a-z][a-z0-9_]{0,63}'; key.dataset.mappingKey = ''; keyLabel.append(key);
  const accountLabel = document.createElement('label'); accountLabel.textContent = 'Account';
  const account = document.createElement('select'); account.required = true; account.dataset.mappingAccount = '';
  account.append(new Option('Select account', ''), ...configuredAccounts.filter(item => item.code && item.account_type).map(item => new Option(`${item.code} · ${item.name}`, item.id))); accountLabel.append(account);
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove mapping'; remove.addEventListener('click', () => row.remove());
  row.append(keyLabel, accountLabel, remove); get('mapping-rows').append(row);
}
get('add-mapping').addEventListener('click', addMapping);
get('refresh-configuration').addEventListener('click', async () => {
  const tenant = get('institution').value; const token = accessToken;
  try {
    const configuration = await request('/api/action', { action: 'configuration', payload: { institution_id: tenant } });
    if (!accessToken || accessToken !== token || get('institution').value !== tenant) return;
    configuredAccounts = configuration.accounts;
    get('configuration-output').replaceChildren();
    for (const [name, records] of Object.entries(configuration)) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `${name} (${records.length})`;
      details.append(summary);
      for (const record of records) {
        const list = document.createElement('dl');
        for (const [key, value] of Object.entries(record)) {
          const term = document.createElement('dt'); term.textContent = key.replaceAll('_', ' ');
          const definition = document.createElement('dd');
          definition.textContent = key === 'mappings' ? value.map(mapping => {
            const account = configuredAccounts.find(item => item.id === mapping.account_id);
            return `${mapping.key}: ${account ? `${account.code} · ${account.name}` : 'Account unavailable'} (${mapping.account_id})`;
          }).join('\n') : value === null ? 'Not assigned' : String(value);
          list.append(term, definition);
        }
        details.append(list);
      }
      get('configuration-output').append(details);
    }
    for (const select of get('mapping-rows').querySelectorAll('[data-mapping-account]')) {
      const selected = select.value; select.replaceChildren(new Option('Select account', ''), ...configuredAccounts.filter(item => item.code && item.account_type).map(item => new Option(`${item.code} · ${item.name}`, item.id))); select.value = selected;
    }
    if (!get('mapping-rows').children.length) addMapping();
    message('Configuration refreshed. Review policy guidance and mappings before approval.');
  } catch (error) { message(error.message); }
});
async function refreshSchedule() {
  const tenant = get('institution').value; const basis = get('basis').value; const token = accessToken;
  get('journals').replaceChildren();
  try {
    const rows = await request('/api/action', { action: 'schedule', payload: { institution_id: tenant, basis } });
    if (!accessToken || accessToken !== token || get('institution').value !== tenant || get('basis').value !== basis) return;
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.id, row.posted_on, row.status, row.version, row.reversal_of || '—']) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      get('journals').append(tr);
    }
    message(`Refreshed ${rows.length} ${basis} journal(s).`);
  } catch (error) { message(error.message); }
}
get('refresh').addEventListener('click', refreshSchedule);
get('basis').addEventListener('change', () => get('journals').replaceChildren());
get('institution').addEventListener('change', selectInstitution);
document.querySelector('#revenue_rule [name="event_kind"]').append(...['credit','refund','allocation_release','chargeback'].map(kind=>new Option(kind.replaceAll('_',' '),kind)));
const recordFields={student:'student_id',invoice:'event_id',receipt:'event_id',allocation:'event_id',revenue_rule:'rule_id',correction:'event_id',academic_item:'item_id',fees:'fee_id',prepare_batch:'batch_id',bank_source:'bank_source_id',stage_import:'batch_id',reconciliation:'match_id',settlement_profile:'profile_id',tolerance:'tolerance_id',settlement:'settlement_id',settlement_reversal:'settlement_id',budget_fund:'fund_id',budget_line:'budget_id',budget_event:'event_id'};
for (const action of ['login', 'provision', 'member', 'transition', 'reverse', 'account', 'period', 'policy', 'approve_policy', 'lock_period','student','invoice','receipt','allocation','revenue_manual','revenue_automatic','revenue_transition','revenue_rule','approve_rule','correction','submit_reversal','academic_item','fees','enrolment','prepare_batch','approve_fees','batch_transition','bank_source','stage_import','accept_import','reconciliation','reconciliation_transition','settlement_profile','approve_settlement_profile','tolerance','tolerance_transition','settlement','settlement_reversal','settlement_transition','budget_fund','budget_line','budget_event','budget_transition']) {
  get(action).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button:not([type="button"])'); button.disabled = true;
    const payload = Object.fromEntries(new FormData(form));
    const submissionToken=accessToken;const submissionTenant=get('institution').value;
    try {
      if (action === 'login') {
        const data = await request('/api/login', payload); form.reset();
        accessToken = data.access_token;
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => { clearSession(); message('Session expired. Sign in again.'); }, data.expires_in * 1000);
        await context(); message('Signed in. Select an institution to continue.');
      } else {
        if (action === 'provision') payload.institution_id = crypto.randomUUID();
        else {
          payload.institution_id = get('institution').value;
          if (!payload.institution_id) throw new Error('Select an institution first');
        }
        if (action === 'member') payload.active = payload.active === 'true';
        if(action==='budget_fund')payload.restricted=payload.restricted==='true';
        if(action==='budget_event'){
          payload.details=payload.kind==='actual'?{journal_id:payload.journal_id,line_no:Number(payload.line_no),commitment_id:payload.commitment_id||null,description:payload.description}:payload.kind.endsWith('_release')?{original_id:payload.original_id,reason:payload.reason}:{description:payload.description};
          for(const key of ['journal_id','line_no','commitment_id','original_id','reason','description'])delete payload[key];
        }
        if (['transition', 'reverse', 'lock_period','revenue_manual','revenue_automatic','revenue_transition','submit_reversal','batch_transition','accept_import','reconciliation_transition','tolerance_transition','settlement_transition','budget_transition'].includes(action)) payload.expected_version = Number(payload.expected_version);
        if (Object.hasOwn(recordFields,action)) {
          form.dataset.recordId ||= crypto.randomUUID();
          payload[recordFields[action]]=form.dataset.recordId;
        }
        if(action==='prepare_batch')payload.student_ids=payload.student_ids.trim().split(/[\s,]+/).filter(Boolean);
        if(action==='fees')payload.lines=[...get('fee-lines').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-revenue-field]')].map(input=>[input.dataset.revenueField,input.value])));
        if(action==='stage_import'){
          payload.column_map={};
          for(const field of ['transaction_id','date','reference','direction','currency','gross_minor','fee_minor','net_minor']){payload.column_map[field]=payload[`map_${field}`];delete payload[`map_${field}`];}
        }
        if(action==='reconciliation')payload.pairs=[...get('matching-pairs').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-revenue-field]')].map(input=>[input.dataset.revenueField,input.value])));
        if(action==='settlement_profile'){
          payload.settings={};for(const key of ['bank_key','clearing_key','fee_key','variance_key','limit_minor']){payload.settings[key]=payload[key];delete payload[key];}
        }
        if(action==='tolerance'&&!payload.event_id)payload.event_id=null;
        if(action==='receipt' && !payload.student_id) payload.student_id=null;
        if(action==='invoice') {
          payload.lines=[...get('invoice-lines').children].map(row=>{
            row.dataset.recordId ||= crypto.randomUUID();
            return {id:row.dataset.recordId,...Object.fromEntries([...row.querySelectorAll('[data-revenue-field]')].map(input=>[input.dataset.revenueField,input.value]))};
          });
        }
        if(action==='revenue_manual') {
          payload.plans=[...document.querySelectorAll('[data-plan-basis]')].map(fieldset=>{
            const method=fieldset.querySelector('[data-plan-treatment]').value;
            if(!['journal','nonrecognition'].includes(method)) throw new Error('Choose a treatment for each accounting basis');
            return {basis:fieldset.dataset.planBasis,policy_id:fieldset.querySelector('[data-plan-policy]').value,
              lines:method==='nonrecognition'?[]:[...fieldset.querySelector('[data-plan-lines]').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-revenue-field]')].map(input=>[input.dataset.revenueField,input.value]))),
              nonrecognition_reason:method==='journal'?'':fieldset.querySelector('[data-plan-reason]').value};
          });
        }
        if(action==='revenue_rule') { payload.debit_key ||= null; payload.credit_key ||= null; }
        if (action === 'account') payload.account_id = crypto.randomUUID();
        if (action === 'period') payload.period_id = crypto.randomUUID();
        if (action === 'policy') {
          payload.policy_id = crypto.randomUUID();
          payload.mappings = [...get('mapping-rows').children].map(row => ({ key: row.querySelector('[data-mapping-key]').value, account_id: row.querySelector('[data-mapping-account]').value }));
        }
        if (action === 'reverse') payload.journal_id = crypto.randomUUID();
        const requestAction={revenue_manual:'submit_revenue',revenue_automatic:'submit_rules',revenue_transition:'revenue_transition',revenue_rule:'rule'}[action]||action;
        const version = await request('/api/action', { action:requestAction, payload });
        if(accessToken!==submissionToken||get('institution').value!==submissionTenant)return;
        const createdId = payload.event_id || payload.budget_id || payload.fund_id || payload.settlement_id || payload.tolerance_id || payload.profile_id || payload.batch_id || payload.match_id || payload.bank_source_id || payload.fee_id || payload.item_id || payload.student_id || payload.rule_id || payload.account_id || (action === 'period' ? payload.period_id : action === 'policy' ? payload.policy_id : '');
        message(action==='stage_import'?`Batch ${version.batch_id}: ${version.status}; ${version.row_count} rows, ${version.error_count} rows with errors. Refresh treasury schedules to inspect every row and control total. No journals were posted.`:
          action === 'reverse' ? `Reversal draft ${payload.journal_id} created at version ${version}; fresh approval required.` : `Request completed. Result/version: ${version}.${createdId ? ` Record ID: ${createdId}. Refresh the relevant schedule to review.` : ''}`);
        if (action === 'provision') await context();
        if (Object.hasOwn(recordFields,action)) { form.reset(); delete form.dataset.recordId; if(action==='invoice') get('invoice-lines').replaceChildren(); if(action==='fees')get('fee-lines').replaceChildren();if(action==='reconciliation')get('matching-pairs').replaceChildren(); }
      }
    } catch (error) {
      if(action!=='login'&&(accessToken!==submissionToken||get('institution').value!==submissionTenant))return;
      const recordId = payload.event_id || payload.budget_id || payload.fund_id || payload.settlement_id || payload.tolerance_id || payload.profile_id || payload.batch_id || payload.match_id || payload.bank_source_id || payload.fee_id || payload.item_id || payload.rule_id || payload.student_id || payload.journal_id || payload.account_id || payload.policy_id || payload.period_id;
      message(`${error.message || 'Connection failed. Check the record before retrying.'}${recordId ? ` Check record ID ${recordId} before retrying.` : ''}`);
    }
    finally { button.disabled = false; }
  });
}
get('refresh-budget-funds').addEventListener('click',async()=>{
 const tenant=get('institution').value;const token=accessToken;
 try{const funds=await request('/api/action',{action:'budget_funds',payload:{institution_id:tenant}});if(!accessToken||accessToken!==token||get('institution').value!==tenant)return;get('budget-funds-output').replaceChildren();appendRevenueDetails(get('budget-funds-output'),{funds});message('Fund classifications refreshed.');}catch(error){if(accessToken===token&&get('institution').value===tenant)message(error.message);}
});
get('budget_view').addEventListener('submit',async event=>{
 event.preventDefault();const tenant=get('institution').value;const token=accessToken;
 const payload={...Object.fromEntries(new FormData(event.currentTarget)),institution_id:tenant};
 try{const data=await request('/api/action',{action:'budgets',payload});if(!accessToken||accessToken!==token||get('institution').value!==tenant)return;get('budget-output').replaceChildren();appendRevenueDetails(get('budget-output'),data);message('Budget position refreshed. Inspect attribution exceptions and refresh timestamp before decisions.');}catch(error){if(accessToken===token&&get('institution').value===tenant)message(error.message);}
});
get('logout').addEventListener('click', async () => {
  const token = accessToken; clearSession(); message('Local session cleared.');
  try {
    const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
    if (!response.ok) message('Local session cleared; provider sign-out unconfirmed.');
  } catch { message('Local session cleared; provider sign-out unconfirmed.'); }
});
fetch('/api/config').then(response => response.json()).then(config => { get('product-name').textContent = config.productName; document.title = `${config.productName} · Staff workspace`; }).catch(() => message('Product configuration unavailable.'));
