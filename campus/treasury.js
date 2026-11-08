'use strict';
const {parseCsv}=require('../lib/campus-finance');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableId=value=>value===null||id(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const version=value=>Number.isSafeInteger(value)&&value>0;
const money=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,21})$/.test(value);
const positive=value=>typeof value==='string'&&/^[1-9][0-9]{0,17}$/.test(value);
const fields=['transaction_id','date','reference','direction','currency','gross_minor','fee_minor','net_minor'];
const mapping=value=>exact(value,fields)&&Object.values(value).every(header=>text(header,80))&&new Set(Object.values(value)).size===8;
const pair=value=>exact(value,['bank_line_id','event_id','amount_minor'])&&id(value.bank_line_id)&&id(value.event_id)&&positive(value.amount_minor);
const states=['draft','submitted','reviewed','approved','cancelled','void_submitted','void_reviewed','voided'];
function parseBankCsv(csv,columnMap){
  if(typeof csv!=='string'||Buffer.byteLength(csv,'utf8')>120000)throw new RangeError('CSV must be text up to 120000 bytes');
  const records=parseCsv(csv);const header=records.shift()||[];
  if(new Set(header).size!==header.length)throw new RangeError('Duplicate CSV headers');
  if(header.length>20||header.some(name=>!text(name,80)||/[\x00-\x1f]|^\s*[=+@-]/.test(name)))throw new RangeError('Invalid CSV headers');
  if(!mapping(columnMap)||!Object.values(columnMap).every(name=>header.includes(name)))throw new RangeError('Invalid bank column mapping');
  if(records.length<1||records.length>100)throw new RangeError('CSV requires one to 100 data rows');
  return records.map((cells,index)=>{
    if(cells.length!==header.length)throw new RangeError(`CSV row ${index+2} has an incorrect column count`);
    return Object.fromEntries(header.map((name,column)=>[name,cells[column]]));
  });
}
function treasuryRequest(action,p){
  if(!object(p)||!id(p.institution_id))return null;
  const tenant=p.institution_id;
  if(action==='treasury'&&exact(p,['institution_id']))return{procedure:'treasury_schedule',body:{tenant}};
  if(action==='bank_source'&&exact(p,['institution_id','bank_source_id','name','account_id'])&&id(p.bank_source_id)&&id(p.account_id)&&text(p.name,100))return{procedure:'create_bank_source',body:{tenant,bank:p.bank_source_id,source_name:p.name,ledger_account:p.account_id}};
  if(action==='stage_import'&&exact(p,['institution_id','batch_id','bank_source_id','csv','column_map'])&&id(p.batch_id)&&id(p.bank_source_id)&&mapping(p.column_map)){
    try{return{procedure:'stage_bank_import',body:{tenant,batch:p.batch_id,bank:p.bank_source_id,rows:parseBankCsv(p.csv,p.column_map),mapping:p.column_map}};}
    catch(error){return{error:error instanceof RangeError?error.message:'Invalid bank CSV'};}
  }
  if(action==='accept_import'&&exact(p,['institution_id','batch_id','expected_version','verification_note'])&&id(p.batch_id)&&version(p.expected_version)&&text(p.verification_note,200))return{procedure:'accept_bank_import',body:{tenant,batch:p.batch_id,expected_version:p.expected_version,verification:p.verification_note}};
  if(action==='reconciliation'&&exact(p,['institution_id','match_id','description','pairs'])&&id(p.match_id)&&text(p.description,500)&&Array.isArray(p.pairs)&&p.pairs.length>=1&&p.pairs.length<=100&&p.pairs.every(pair)&&new Set(p.pairs.map(row=>`${row.bank_line_id.toLowerCase()}:${row.event_id.toLowerCase()}`)).size===p.pairs.length)return{procedure:'propose_reconciliation',body:{tenant,reconciliation:p.match_id,description:p.description,pairs:p.pairs}};
  if(action==='reconciliation_transition'&&exact(p,['institution_id','match_id','expected_version','target','note'])&&id(p.match_id)&&version(p.expected_version)&&states.filter(state=>state!=='draft').includes(p.target)&&typeof p.note==='string'&&p.note.length<=500&&(!['approved','void_submitted'].includes(p.target)||p.note.trim().length>0))return{procedure:'transition_reconciliation',body:{tenant,reconciliation:p.match_id,expected_version:p.expected_version,target:p.target,note:p.note}};
  if(action==='candidates'&&exact(p,['institution_id','bank_line_id'])&&id(p.bank_line_id))return{procedure:'reconciliation_candidates',body:{tenant,bank_line:p.bank_line_id}};
  return null;
}
function validImportSummary(value){
  return exact(value,['batch_id','status','version','row_count','error_count','total_gross_minor','total_fee_minor','total_net_minor'])&&id(value.batch_id)&&['staged','invalid','accepted'].includes(value.status)&&version(value.version)&&Number.isInteger(value.row_count)&&value.row_count>=1&&value.row_count<=100&&Number.isInteger(value.error_count)&&value.error_count>=0&&value.error_count<=value.row_count&&
    (value.status==='invalid'?value.error_count>0&&['total_gross_minor','total_fee_minor','total_net_minor'].every(key=>value[key]===null):value.error_count===0&&['total_gross_minor','total_fee_minor','total_net_minor'].every(key=>money(value[key])));
}
function validCandidates(value){
  return Array.isArray(value)&&value.length<=100&&value.every(row=>exact(row,['id','kind','document_date','reference','available_minor','suggestion'])&&id(row.id)&&['receipt','refund','chargeback'].includes(row.kind)&&date(row.document_date)&&typeof row.reference==='string'&&row.reference.length<=80&&positive(row.available_minor)&&['exact_reference_and_amount','amount_only_review','partial_review'].includes(row.suggestion));
}
function validTreasurySchedule(value){
  if(!exact(value,['financial_access','totals','sources','imports','lines','reconciliations'])||typeof value.financial_access!=='boolean'||!['sources','imports','lines','reconciliations'].every(key=>Array.isArray(value[key])&&value[key].length<=100))return false;
  if(value.financial_access){
    if(!exact(value.totals,['credit_gross_minor','credit_fee_minor','credit_net_minor','debit_gross_minor','debit_fee_minor','debit_net_minor','matched_gross_minor','unmatched_gross_minor'])||!Object.values(value.totals).every(money))return false;
  }else if(value.totals!==null||value.imports.length||value.lines.length||value.reconciliations.length)return false;
  return value.sources.every(row=>exact(row,['id','name','account_id','currency'])&&id(row.id)&&text(row.name,100)&&id(row.account_id)&&typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency))&&
    value.imports.every(row=>exact(row,['id','bank_source_id','status','version','row_count','error_count','total_gross_minor','total_fee_minor','total_net_minor','prepared_by','verified_by','verification_note','rows'])&&id(row.id)&&id(row.bank_source_id)&&id(row.prepared_by)&&nullableId(row.verified_by)&&(row.verification_note===null||text(row.verification_note,200))&&
      validImportSummary({batch_id:row.id,status:row.status,version:row.version,row_count:row.row_count,error_count:row.error_count,total_gross_minor:row.total_gross_minor,total_fee_minor:row.total_fee_minor,total_net_minor:row.total_net_minor})&&
      Array.isArray(row.rows)&&row.rows.length===row.row_count&&row.rows.every(entry=>exact(entry,['id','row_number','raw','normalised'])&&id(entry.id)&&Number.isInteger(entry.row_number)&&entry.row_number>=1&&object(entry.raw)&&Object.keys(entry.raw).length<=20&&Object.values(entry.raw).every(v=>typeof v==='string'&&v.length<=120000)&&
        exact(entry.normalised,[...fields,'errors'])&&fields.every(key=>entry.normalised[key]===null||typeof entry.normalised[key]==='string')&&Array.isArray(entry.normalised.errors)&&entry.normalised.errors.every(code=>text(code,100))))&&
    value.lines.every(row=>exact(row,['id','batch_id','bank_source_id','transaction_id','bank_date','reference','direction','currency','gross_minor','fee_minor','net_minor'])&&['id','batch_id','bank_source_id'].every(key=>id(row[key]))&&text(row.transaction_id,80)&&date(row.bank_date)&&typeof row.reference==='string'&&row.reference.length<=200&&['credit','debit'].includes(row.direction)&&typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency)&&positive(row.gross_minor)&&money(row.fee_minor)&&money(row.net_minor))&&
    value.reconciliations.every(row=>exact(row,['id','description','status','version','prepared_by','reviewed_by','approved_by','approval_note','void_prepared_by','void_reviewed_by','void_approved_by','void_reason','pairs'])&&id(row.id)&&text(row.description,500)&&states.includes(row.status)&&version(row.version)&&id(row.prepared_by)&&['reviewed_by','approved_by','void_prepared_by','void_reviewed_by','void_approved_by'].every(key=>nullableId(row[key]))&&['approval_note','void_reason'].every(key=>row[key]===null||text(row[key],500))&&Array.isArray(row.pairs)&&row.pairs.length>=1&&row.pairs.length<=100&&row.pairs.every(pair));
}
module.exports={parseBankCsv,treasuryRequest,validImportSummary,validCandidates,validTreasurySchedule};
