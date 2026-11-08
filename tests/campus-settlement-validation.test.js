'use strict';
const{test}=require('node:test');
const assert=require('node:assert/strict');
const{settlementRequest,validSettlementSchedule}=require('../campus/settlement');
const{createGateway}=require('../campus/server');
const uuid='70000000-0000-4000-8000-000000000001';
test('settlement requests reject invented limits and forward explicit profile-bound posting inputs',async()=>{
 const payload={institution_id:uuid,settlement_id:uuid,bank_line_id:uuid,period_id:uuid,document_date:'2026-11-10',cash_profile_id:uuid,accrual_profile_id:uuid};
 assert.equal(settlementRequest('settlement',{...payload,actor_id:uuid}),null);
 const tolerance={institution_id:uuid,tolerance_id:uuid,bank_line_id:uuid,side:'bank',event_id:null,amount_minor:'10',cash_profile_id:uuid,accrual_profile_id:uuid,reason:'Synthetic explicit difference'};
 assert.equal(settlementRequest('tolerance',{...tolerance,amount_minor:'0.5'}),null);
 assert.equal(settlementRequest('tolerance',{...tolerance,side:'source'}),null);
 const calls=[];const gateway=createGateway({url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},async(url,options)=>{calls.push({url,options});return new Response(calls.length===1?JSON.stringify({id:uuid}):'1');});
 assert.deepEqual(await gateway('Bearer synthetic','settlement',payload),{status:200,data:1});
 assert.equal(calls[1].url,'https://synthetic.supabase.co/rest/v1/rpc/prepare_settlement');
 assert.deepEqual(JSON.parse(calls[1].options.body),{tenant:uuid,settlement:uuid,bank_line:uuid,period:uuid,posting_date:'2026-11-10',cash_profile:uuid,accrual_profile:uuid});
 assert.equal(validSettlementSchedule({profiles:[],tolerances:[],settlements:[]}),true);
 assert.equal(validSettlementSchedule({profiles:[],tolerances:[],settlements:[{id:uuid}]}),false);
});
