'use strict';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const key=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0;
const cohort=value=>Array.isArray(value)&&value.length>=1&&value.length<=100&&value.every(id)&&new Set(value.map(id=>id.toLowerCase())).size===value.length;
const feeLine=value=>exact(value,['fee_key','account_id','description','amount_minor','due_date'])&&key(value.fee_key)&&id(value.account_id)&&text(value.description,200)&&typeof value.amount_minor==='string'&&/^[1-9][0-9]{0,17}$/.test(value.amount_minor)&&date(value.due_date);
const feeLines=value=>Array.isArray(value)&&value.length>=1&&value.length<=1000&&value.every(feeLine)&&new Set(value.map(line=>line.fee_key)).size===value.length;

function billingRequest(action,p){
  if(!object(p)||!id(p.institution_id))return null;
  const tenant=p.institution_id;
  if(action==='billing'&&exact(p,['institution_id']))return{procedure:'billing_schedule',body:{tenant}};
  if(action==='academic_item'&&exact(p,['institution_id','item_id','kind','name'])&&id(p.item_id)&&['session','programme','level'].includes(p.kind)&&text(p.name,100)){
    return{procedure:'create_academic_item',body:{tenant,item:p.item_id,item_kind:p.kind,item_name:p.name}};
  }
  if(action==='enrolment'&&exact(p,['institution_id','student_id','session_id','programme_id','level_id'])&&['student_id','session_id','programme_id','level_id'].every(key=>id(p[key]))){
    return{procedure:'enrol_student',body:{tenant,student:p.student_id,session:p.session_id,programme:p.programme_id,level:p.level_id}};
  }
  if(action==='fees'&&exact(p,['institution_id','fee_id','session_id','programme_id','level_id','billing_code','effective_from','lines'])&&['fee_id','session_id','programme_id','level_id'].every(key=>id(p[key]))&&key(p.billing_code)&&date(p.effective_from)&&feeLines(p.lines)){
    return{procedure:'propose_fees',body:{tenant,fee:p.fee_id,session:p.session_id,programme:p.programme_id,level:p.level_id,code:p.billing_code,effective:p.effective_from,entries:p.lines}};
  }
  if(action==='approve_fees'&&exact(p,['institution_id','fee_id'])&&id(p.fee_id))return{procedure:'approve_fees',body:{tenant,fee:p.fee_id}};
  if(['billing_preview','prepare_batch'].includes(action)&&exact(p,action==='billing_preview'?['institution_id','fee_id','period_id','document_date','student_ids']:['institution_id','batch_id','fee_id','period_id','document_date','student_ids'])&&id(p.fee_id)&&id(p.period_id)&&date(p.document_date)&&cohort(p.student_ids)&&(action==='billing_preview'||id(p.batch_id))){
    return{procedure:action==='billing_preview'?'preview_billing':'prepare_billing_batch',body:{tenant,...(action==='prepare_batch'?{batch:p.batch_id}:{}),fee:p.fee_id,period:p.period_id,invoice_date:p.document_date,students:p.student_ids}};
  }
  if(action==='batch_transition'&&exact(p,['institution_id','batch_id','expected_version','target'])&&id(p.batch_id)&&version(p.expected_version)&&['submitted','reviewed','approved','generated','cancelled'].includes(p.target)){
    return{procedure:'transition_billing_batch',body:{tenant,batch:p.batch_id,expected_version:p.expected_version,target:p.target}};
  }
  return null;
}
function validBillingPreview(value){
  return exact(value,['fee_id','fee_version','academic_session','period_id','invoice_date','rows','lines','totals'])&&id(value.fee_id)&&version(value.fee_version)&&text(value.academic_session,100)&&id(value.period_id)&&date(value.invoice_date)&&feeLines(value.lines)&&
    Array.isArray(value.rows)&&value.rows.length>=1&&value.rows.length<=100&&value.rows.every(row=>exact(row,['student_id','reference','errors','total_minor'])&&id(row.student_id)&&(row.reference===null||text(row.reference,80))&&Array.isArray(row.errors)&&row.errors.every(error=>['student_unavailable','matching_enrolment_required','due_date_before_invoice','already_billed'].includes(error))&&typeof row.total_minor==='string'&&/^[1-9][0-9]{0,17}$/.test(row.total_minor))&&
    exact(value.totals,['student_count','line_count','total_minor'])&&value.totals.student_count===value.rows.length&&value.totals.line_count===value.rows.length*value.lines.length&&typeof value.totals.total_minor==='string'&&/^[1-9][0-9]{0,19}$/.test(value.totals.total_minor);
}
function validBillingSchedule(value){
  if(!exact(value,['items','enrolments','fees','batches'])||!Object.values(value).every(rows=>Array.isArray(rows)&&rows.length<=100))return false;
  return value.items.every(row=>exact(row,['id','kind','name'])&&id(row.id)&&['session','programme','level'].includes(row.kind)&&text(row.name,100))&&
    value.enrolments.every(row=>exact(row,['student_id','session_id','programme_id','level_id'])&&Object.values(row).every(id))&&
    value.fees.every(row=>exact(row,['id','session_id','programme_id','level_id','billing_code','effective_from','prepared_by','approved_by','version','lines'])&&['id','session_id','programme_id','level_id','prepared_by'].every(key=>id(row[key]))&&key(row.billing_code)&&date(row.effective_from)&&feeLines(row.lines)&&(row.approved_by===null?row.version===null:id(row.approved_by)&&version(row.version)))&&
    value.batches.every(row=>exact(row,['id','status','version','prepared_by','reviewed_by','approved_by','request','preview','invoices'])&&id(row.id)&&id(row.prepared_by)&&(row.reviewed_by===null||id(row.reviewed_by))&&(row.approved_by===null||id(row.approved_by))&&['draft','submitted','reviewed','approved','generated','cancelled'].includes(row.status)&&version(row.version)&&
      exact(row.request,['fee_id','period_id','invoice_date','students'])&&id(row.request.fee_id)&&id(row.request.period_id)&&date(row.request.invoice_date)&&cohort(row.request.students)&&validBillingPreview(row.preview)&&Array.isArray(row.invoices)&&row.invoices.length<=100&&row.invoices.every(invoice=>exact(invoice,['student_id','invoice_id'])&&id(invoice.student_id)&&id(invoice.invoice_id)));
}
module.exports={billingRequest,validBillingPreview,validBillingSchedule};
