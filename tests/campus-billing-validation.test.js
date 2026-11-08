'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {billingRequest,validBillingPreview,validBillingSchedule}=require('../campus/billing');
const {createGateway}=require('../campus/server');
const uuid='50000000-0000-4000-8000-000000000001';
test('billing API rejects duplicate cohorts and actor overrides before forwarding the verified user',async()=>{
  const payload={institution_id:uuid,batch_id:uuid,fee_id:uuid,period_id:uuid,document_date:'2026-11-08',student_ids:[uuid]};
  assert.equal(billingRequest('prepare_batch',{...payload,student_ids:[uuid,uuid]}),null);
  assert.equal(billingRequest('prepare_batch',{...payload,actor_id:uuid}),null);
  const calls=[];
  const gateway=createGateway({url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},async(url,options)=>{
    calls.push({url,options});return new Response(calls.length===1?JSON.stringify({id:uuid}):'1');
  });
  assert.deepEqual(await gateway('Bearer synthetic','prepare_batch',payload),{status:200,data:1});
  assert.equal(calls[1].url,'https://synthetic.supabase.co/rest/v1/rpc/prepare_billing_batch');
  assert.deepEqual(JSON.parse(calls[1].options.body),{tenant:uuid,batch:uuid,fee:uuid,period:uuid,invoice_date:'2026-11-08',students:[uuid]});
});
test('billing responses retain row errors and reject numeric money or malformed catalogue records',()=>{
  assert.equal(validBillingSchedule({items:[],enrolments:[],fees:[],batches:[]}),true);
  assert.equal(validBillingSchedule({items:[],enrolments:[],fees:[],batches:[{id:uuid}]}),false);
  assert.equal(validBillingPreview({totals:{total_minor:9007199254740992}}),false);
});
