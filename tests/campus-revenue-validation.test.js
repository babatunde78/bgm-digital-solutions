'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {revenueRequest,validRevenue,validRules}=require('../campus/revenue');
const {createGateway}=require('../campus/server');
const uuid='30000000-0000-4000-8000-000000000001';
test('revenue requests preserve text references and reject fractional money and actor overrides',async()=>{
  const payload={institution_id:uuid,event_id:uuid,student_id:uuid,period_id:uuid,document_date:'2026-11-09',reference:'00001234',amount_minor:'40000'};
  assert.equal(revenueRequest('receipt',payload).body.payment_reference,'00001234');
  assert.equal(revenueRequest('receipt',{...payload,amount_minor:'1.5'}),null);
  assert.equal(revenueRequest('receipt',{...payload,actor_id:uuid}),null);
  assert.equal(revenueRequest('submit_rules',{institution_id:uuid,event_id:uuid,expected_version:1,cash_rule_id:uuid,accrual_rule_id:'invalid'}),null);
  const calls=[];
  const gateway=createGateway({url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},async(url,options)=>{
    calls.push({url,options});return new Response(calls.length===1?JSON.stringify({id:uuid}):'1');
  });
  assert.deepEqual(await gateway('Bearer synthetic','receipt',payload),{status:200,data:1});
  assert.equal(calls[1].url,'https://synthetic.supabase.co/rest/v1/rpc/draft_receipt');
  assert.equal(calls[1].options.headers.Authorization,'Bearer synthetic');
});
test('revenue responses reject unsafe monetary representations and malformed rules',()=>{
  const data={totals:{billed_minor:'0',receipts_minor:'0',allocated_minor:'0',receivable_minor:'0',unapplied_minor:'0'},events:[],students:[]};
  assert.equal(validRevenue(data),true);
  assert.equal(validRevenue({...data,totals:{...data.totals,receipts_minor:9007199254740992}}),false);
  assert.equal(validRevenue({...data,totals:{...data.totals,receivable_minor:'-1'}}),false);
  assert.equal(validRules([{id:uuid}]),false);
});
test('correction APIs reject spoofing and forward full reversals to the controlled generator',async()=>{
  const payload={institution_id:uuid,event_id:uuid,kind:'refund',original_id:uuid,period_id:uuid,document_date:'2027-01-10',amount_minor:'100',reason:'Synthetic correction'};
  assert.equal(revenueRequest('correction',{...payload,actor_id:uuid}),null);
  assert.equal(revenueRequest('correction',{...payload,amount_minor:'-1'}),null);
  assert.equal(revenueRequest('correction',{...payload,kind:'unknown'}),null);
  const calls=[];
  const gateway=createGateway({url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},async(url)=>{
    calls.push(url);return new Response(calls.length%2===1?JSON.stringify({id:uuid}):'1');
  });
  assert.deepEqual(await gateway('Bearer synthetic','correction',payload),{status:200,data:1});
  assert.equal(calls[1],'https://synthetic.supabase.co/rest/v1/rpc/draft_correction');
  assert.deepEqual(await gateway('Bearer synthetic','submit_reversal',{institution_id:uuid,event_id:uuid,expected_version:1}),{status:200,data:1});
  assert.equal(calls[3],'https://synthetic.supabase.co/rest/v1/rpc/submit_source_reversal');
});
