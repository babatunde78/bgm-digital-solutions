'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseBankCsv,treasuryRequest,validImportSummary}=require('../campus/treasury');
const uuid='60000000-0000-4000-8000-000000000001';
const mapping={transaction_id:'Txn',date:'Date',reference:'Ref',direction:'Side',currency:'Currency',gross_minor:'Gross',fee_minor:'Fee',net_minor:'Net'};
test('bank CSV mapping preserves opaque references and exact minor-unit text',()=>{
  const csv='Txn,Date,Ref,Side,Currency,Gross,Fee,Net\r\n000001,2026-11-09,"000,REF",credit,NGN,60000,1000,59000\r\n';
  const rows=parseBankCsv(csv,mapping);
  assert.deepEqual(rows,[{Txn:'000001',Date:'2026-11-09',Ref:'000,REF',Side:'credit',Currency:'NGN',Gross:'60000',Fee:'1000',Net:'59000'}]);
  const request=treasuryRequest('stage_import',{institution_id:uuid,batch_id:uuid,bank_source_id:uuid,csv,column_map:mapping});
  assert.deepEqual(request.body.rows,rows);
  assert.throws(()=>parseBankCsv('Txn,Txn\n1,2',mapping),/Duplicate CSV headers/);
  assert.throws(()=>parseBankCsv('Txn,Date,Ref,Side,Currency,Gross,Fee,Net\n1,2',mapping),/CSV row 2/);
});
test('treasury rejects actor overrides and distinguishes unavailable totals from zero',()=>{
  assert.equal(treasuryRequest('accept_import',{institution_id:uuid,batch_id:uuid,expected_version:1,verification_note:'Synthetic checked reference',actor_id:uuid}),null);
  assert.equal(validImportSummary({batch_id:uuid,status:'invalid',version:1,row_count:1,error_count:1,total_gross_minor:null,total_fee_minor:null,total_net_minor:null}),true);
  assert.equal(validImportSummary({batch_id:uuid,status:'invalid',version:1,row_count:1,error_count:1,total_gross_minor:'0',total_fee_minor:'0',total_net_minor:'0'}),false);
});
