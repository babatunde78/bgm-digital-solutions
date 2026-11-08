'use strict';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const positive = value => typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value);
const minor = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(value);
const basis = value => ['cash', 'accrual'].includes(value);
const version = value => Number.isSafeInteger(value) && value > 0;
const correctionKinds = ['credit','refund','allocation_release','chargeback','invoice_reversal','receipt_reversal'];
const line = value => exact(value, ['account_id', 'debit_minor', 'credit_minor']) && id(value.account_id) && minor(value.debit_minor) && minor(value.credit_minor);
const invoiceLine = value => exact(value, ['id','account_id','description','amount_minor','due_date']) && id(value.id) && id(value.account_id) && text(value.description,200) && positive(value.amount_minor) && date(value.due_date);
const plans = value => Array.isArray(value) && value.length === 2 && new Set(value.map(row=>row?.basis)).size === 2 && value.every(row=>exact(row,['basis','policy_id','lines','nonrecognition_reason']) && basis(row.basis) && id(row.policy_id) &&
  Array.isArray(row.lines) && row.lines.length <= 1000 && (row.lines.length === 0 ? text(row.nonrecognition_reason,500) : row.lines.length >= 2 && row.lines.every(line) && row.nonrecognition_reason === ''));

function revenueRequest(action, p) {
  if (!object(p) || !id(p.institution_id)) return null;
  const tenant = p.institution_id;
  if (['revenue','rules'].includes(action) && exact(p,['institution_id'])) return { procedure: action==='revenue'?'revenue_schedule':'revenue_rule_schedule', body: { tenant } };
  if(action==='correction' && exact(p,['institution_id','event_id','kind','original_id','period_id','document_date','amount_minor','reason']) && ['event_id','original_id','period_id'].every(key=>id(p[key])) && correctionKinds.includes(p.kind) && date(p.document_date) && positive(p.amount_minor) && text(p.reason,500)) return {procedure:'draft_correction',body:{tenant,correction:p.event_id,kind:p.kind,original:p.original_id,period:p.period_id,correction_date:p.document_date,amount:p.amount_minor,reason:p.reason}};
  if(action==='submit_reversal' && exact(p,['institution_id','event_id','expected_version']) && id(p.event_id) && version(p.expected_version)) return {procedure:'submit_source_reversal',body:{tenant,event:p.event_id,expected_version:p.expected_version}};
  if (action==='student' && exact(p,['institution_id','student_id','reference','name']) && id(p.student_id) && text(p.reference,80) && text(p.name,200)) return { procedure:'create_student', body:{tenant,student:p.student_id,student_reference:p.reference,student_name:p.name} };
  if (action==='invoice' && exact(p,['institution_id','event_id','student_id','period_id','document_date','academic_session','lines']) && id(p.event_id) && id(p.student_id) && id(p.period_id) && date(p.document_date) && text(p.academic_session,80) && Array.isArray(p.lines) && p.lines.length>=1 && p.lines.length<=1000 && p.lines.every(invoiceLine)) return { procedure:'draft_invoice',body:{tenant,invoice:p.event_id,student:p.student_id,period:p.period_id,invoice_date:p.document_date,session_name:p.academic_session,entries:p.lines} };
  if (action==='receipt' && exact(p,['institution_id','event_id','student_id','period_id','document_date','reference','amount_minor']) && id(p.event_id) && (p.student_id===null||id(p.student_id)) && id(p.period_id) && date(p.document_date) && text(p.reference,80) && positive(p.amount_minor)) return {procedure:'draft_receipt',body:{tenant,receipt:p.event_id,student:p.student_id,period:p.period_id,receipt_date:p.document_date,payment_reference:p.reference,amount:p.amount_minor}};
  if (action==='allocation' && exact(p,['institution_id','event_id','receipt_id','invoice_line_id','period_id','document_date','amount_minor']) && ['event_id','receipt_id','invoice_line_id','period_id'].every(key=>id(p[key])) && date(p.document_date) && positive(p.amount_minor)) return {procedure:'draft_allocation',body:{tenant,allocation:p.event_id,receipt:p.receipt_id,invoice_line:p.invoice_line_id,period:p.period_id,allocation_date:p.document_date,amount:p.amount_minor}};
  if (action==='submit_revenue' && exact(p,['institution_id','event_id','expected_version','plans']) && id(p.event_id) && version(p.expected_version) && plans(p.plans)) return {procedure:'submit_revenue',body:{tenant,event:p.event_id,expected_version:p.expected_version,plans:p.plans}};
  if (action==='revenue_transition' && exact(p,['institution_id','event_id','expected_version','target']) && id(p.event_id) && version(p.expected_version) && ['reviewed','approved','posted','cancelled'].includes(p.target)) return {procedure:'transition_revenue',body:{tenant,event:p.event_id,expected_version:p.expected_version,target:p.target}};
  if (action==='submit_rules' && exact(p,['institution_id','event_id','expected_version','cash_rule_id','accrual_rule_id']) && ['event_id','cash_rule_id','accrual_rule_id'].every(key=>id(p[key])) && version(p.expected_version)) return {procedure:'submit_revenue_rules',body:{tenant,event:p.event_id,expected_version:p.expected_version,cash_rule:p.cash_rule_id,accrual_rule:p.accrual_rule_id}};
  if (action==='approve_rule' && exact(p,['institution_id','rule_id']) && id(p.rule_id)) return {procedure:'approve_revenue_rule',body:{tenant,rule:p.rule_id}};
  if (action==='rule' && exact(p,['institution_id','rule_id','basis','policy_id','event_kind','effective_from','mode','debit_key','credit_key','explanation']) && id(p.rule_id) && basis(p.basis) && id(p.policy_id) && ['invoice','receipt','allocation','credit','refund','allocation_release','chargeback'].includes(p.event_kind) && date(p.effective_from) &&
    (p.mode==='journal' ? typeof p.debit_key==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(p.debit_key) && typeof p.credit_key==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(p.credit_key) && p.debit_key!==p.credit_key && p.explanation==='' : p.mode==='nonrecognition' && p.debit_key===null && p.credit_key===null && text(p.explanation,500))) return {procedure:'propose_revenue_rule',body:{tenant,rule:p.rule_id,accounting_basis:p.basis,policy:p.policy_id,kind:p.event_kind,effective:p.effective_from,treatment:p.mode,debit_mapping:p.debit_key,credit_mapping:p.credit_key,reason:p.explanation}};
  return null;
}
function validRevenue(value) {
  const legacy=exact(value,['totals','events','students']);
  const current=exact(value,['schema_version','totals','events','students'])&&value.schema_version===2;
  const totalKeys=legacy?['billed_minor','receipts_minor','allocated_minor','receivable_minor','unapplied_minor']:
    ['billed_minor','credits_minor','invoice_reversed_minor','net_billed_minor','receipts_minor','refunded_minor','receipt_reversed_minor','net_receipts_minor','allocated_minor','released_minor','net_allocated_minor','receivable_minor','unapplied_minor'];
  if ((!legacy&&!current) || !exact(value.totals,totalKeys) || !Object.values(value.totals).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)) ||
    !Array.isArray(value.students) || value.students.length>100 || !value.students.every(row=>exact(row,['id','reference','name'])&&id(row.id)&&text(row.reference,80)&&text(row.name,200)) || !Array.isArray(value.events) || value.events.length>100) return false;
  return value.events.every(row=> exact(row,['id','kind','document_date','amount_minor','status','version','prepared_by','reviewed_by','approved_by','posting_plan','details']) && id(row.id) && date(row.document_date) && positive(row.amount_minor) && ['draft','submitted','reviewed','approved','posted','cancelled'].includes(row.status) && version(row.version) && id(row.prepared_by) && (row.reviewed_by===null||id(row.reviewed_by)) && (row.approved_by===null||id(row.approved_by)) && (row.posting_plan===null||plans(row.posting_plan)) && (
    row.kind==='invoice' ? exact(row.details,['student_id','academic_session','lines'])&&id(row.details.student_id)&&text(row.details.academic_session,80)&&Array.isArray(row.details.lines)&&row.details.lines.length>=1&&row.details.lines.length<=1000&&row.details.lines.every(invoiceLine) :
      row.kind==='receipt' ? exact(row.details,['student_id','reference'])&&(row.details.student_id===null||id(row.details.student_id))&&text(row.details.reference,80) :
        row.kind==='allocation' ? exact(row.details,['receipt_id','invoice_line_id'])&&id(row.details.receipt_id)&&id(row.details.invoice_line_id) : current&&correctionKinds.includes(row.kind)&&exact(row.details,['original_id','reason'])&&id(row.details.original_id)&&text(row.details.reason,500)));
}
function validRules(value) {
  return Array.isArray(value)&&value.length<=100&&value.every(row=>exact(row,['id','basis','policy_id','event_kind','effective_from','mode','debit_key','credit_key','explanation','prepared_by','approved_by','version'])&&id(row.id)&&id(row.prepared_by)&&
    revenueRequest('rule',{institution_id:row.id,rule_id:row.id,basis:row.basis,policy_id:row.policy_id,event_kind:row.event_kind,effective_from:row.effective_from,mode:row.mode,debit_key:row.debit_key,credit_key:row.credit_key,explanation:row.explanation})!==null&&
    (row.approved_by===null?row.version===null:id(row.approved_by)&&version(row.version)));
}
module.exports={revenueRequest,validRevenue,validRules};
