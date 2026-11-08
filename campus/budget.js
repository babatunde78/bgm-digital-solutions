'use strict';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableId=value=>value===null||id(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const version=value=>Number.isSafeInteger(value)&&value>0;
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const positive=value=>typeof value==='string'&&/^[1-9][0-9]{0,17}$/.test(value);
const basis=value=>['cash','accrual'].includes(value);
const states=['draft','submitted','reviewed','approved','posted','cancelled'];
function details(kind,value){
 if(kind==='budget'||kind==='commitment')return exact(value,['description'])&&text(value.description,500);
 if(kind==='revision')return exact(value,['description','direction'])&&text(value.description,500)&&['increase','decrease'].includes(value.direction);
 if(kind==='actual')return exact(value,['journal_id','line_no','commitment_id','description'])&&id(value.journal_id)&&version(value.line_no)&&value.line_no<=999999999&&nullableId(value.commitment_id)&&text(value.description,500);
 return ['actual_release','commitment_release'].includes(kind)&&exact(value,['original_id','reason'])&&id(value.original_id)&&text(value.reason,500);
}
function budgetRequest(action,p){
 if(!object(p)||!id(p.institution_id))return null;const tenant=p.institution_id;
 if(action==='budget_funds'&&exact(p,['institution_id']))return{procedure:'budget_fund_schedule',body:{tenant}};
 if(action==='budgets'&&exact(p,['institution_id','period_id','basis','as_of'])&&id(p.period_id)&&basis(p.basis)&&date(p.as_of))return{procedure:'budget_schedule',body:{tenant,period:p.period_id,accounting_basis:p.basis,as_of:p.as_of}};
 if(action==='budget_fund'&&exact(p,['institution_id','fund_id','name','restricted'])&&id(p.fund_id)&&text(p.name,200)&&typeof p.restricted==='boolean')return{procedure:'create_budget_fund',body:{tenant,fund:p.fund_id,fund_name:p.name,is_restricted:p.restricted}};
 if(action==='budget_line'&&exact(p,['institution_id','budget_id','account_id','period_id','fund_id','basis'])&&['budget_id','account_id','period_id','fund_id'].every(key=>id(p[key]))&&basis(p.basis))return{procedure:'create_budget_line',body:{tenant,budget:p.budget_id,account:p.account_id,period:p.period_id,fund:p.fund_id,accounting_basis:p.basis}};
 if(action==='budget_event'&&exact(p,['institution_id','event_id','budget_id','kind','document_date','amount_minor','details'])&&id(p.event_id)&&id(p.budget_id)&&date(p.document_date)&&positive(p.amount_minor)&&details(p.kind,p.details))return{procedure:'draft_budget_event',body:{tenant,event:p.event_id,budget:p.budget_id,event_kind:p.kind,event_date:p.document_date,amount:p.amount_minor,event_details:p.details}};
 if(action==='budget_transition'&&exact(p,['institution_id','event_id','expected_version','target'])&&id(p.event_id)&&version(p.expected_version)&&states.slice(1).includes(p.target))return{procedure:'transition_budget_event',body:{tenant,event:p.event_id,expected_version:p.expected_version,target:p.target}};
 return null;
}
const validBudgetFunds=value=>Array.isArray(value)&&value.every(row=>exact(row,['institution_id','id','name','restricted'])&&id(row.institution_id)&&id(row.id)&&text(row.name,200)&&typeof row.restricted==='boolean');
function validBudgetSchedule(value){
 if(!exact(value,['period_id','basis','as_of','refreshed_at','lines','events','unattributed_lines'])||!id(value.period_id)||!basis(value.basis)||!date(value.as_of)||typeof value.refreshed_at!=='string'||!Number.isFinite(Date.parse(value.refreshed_at))||!['lines','events','unattributed_lines'].every(key=>Array.isArray(value[key])))return false;
 return value.lines.every(row=>exact(row,['institution_id','id','account_id','period_id','fund_id','basis','fund_name','restricted','position'])&&['institution_id','id','account_id','period_id','fund_id'].every(key=>id(row[key]))&&basis(row.basis)&&text(row.fund_name,200)&&typeof row.restricted==='boolean'&&exact(row.position,['authorised_minor','posted_actual_minor','reserved_actual_minor','open_commitment_minor','available_minor'])&&Object.values(row.position).every(amount=>typeof amount==='string'&&/^-?(0|[1-9][0-9]{0,37})$/.test(amount)))&&
 value.events.every(row=>exact(row,['institution_id','id','budget_id','kind','document_date','amount_minor','details','original_id','journal_id','line_no','commitment_id','status','version','prepared_by','reviewed_by','approved_by'])&&['institution_id','id','budget_id','prepared_by'].every(key=>id(row[key]))&&date(row.document_date)&&positive(row.amount_minor)&&details(row.kind,row.details)&&['original_id','journal_id','commitment_id','reviewed_by','approved_by'].every(key=>nullableId(row[key]))&&(row.line_no===null||version(row.line_no))&&states.includes(row.status)&&version(row.version))&&
 value.unattributed_lines.every(row=>exact(row,['journal_id','line_no','account_id','unattributed_minor'])&&id(row.journal_id)&&version(row.line_no)&&id(row.account_id)&&typeof row.unattributed_minor==='string'&&/^[1-9][0-9]{0,19}$/.test(row.unattributed_minor));
}
module.exports={budgetRequest,validBudgetSchedule,validBudgetFunds};
