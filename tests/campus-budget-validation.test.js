'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');
const{budgetRequest,validBudgetSchedule,validBudgetFunds}=require('../campus/budget');
const{createGateway}=require('../campus/server');
const uuid='80000000-0000-4000-8000-000000000001';
test('budget boundary preserves integer strings and rejects ambiguous event details',()=>{
 const payload={institution_id:uuid,event_id:uuid,budget_id:uuid,kind:'actual',document_date:'2026-11-10',amount_minor:'20000',details:{journal_id:uuid,line_no:1,commitment_id:null,description:'Synthetic actual'}};
 assert.deepEqual(budgetRequest('budget_event',payload),{procedure:'draft_budget_event',body:{tenant:uuid,event:uuid,budget:uuid,event_kind:'actual',event_date:'2026-11-10',amount:'20000',event_details:payload.details}});
 for(const patch of[{amount_minor:20000},{amount_minor:'0'},{document_date:'2026-02-30'},{details:{...payload.details,line_no:'1'}},{details:{...payload.details,extra:true}},{kind:'virement'}])assert.equal(budgetRequest('budget_event',{...payload,...patch}),null);
 assert.equal(budgetRequest('budget_event',{...payload,kind:'actual_release',details:{original_id:uuid,reason:''}}),null);
});
test('budget report validation requires explicit filters and visible attribution exceptions',()=>{
 const report={period_id:uuid,basis:'accrual',as_of:'2026-11-10',refreshed_at:'2026-11-10T10:00:00Z',lines:[],events:[],unattributed_lines:[]};
 assert.equal(validBudgetSchedule(report),true);
 assert.equal(validBudgetSchedule({...report,unattributed_lines:null}),false);
 assert.equal(validBudgetSchedule({...report,basis:'both'}),false);
 assert.equal(validBudgetFunds([{institution_id:uuid,id:uuid,name:'Synthetic fund',restricted:true}]),true);
 assert.equal(validBudgetFunds([{institution_id:uuid,id:uuid,name:'Synthetic fund',restricted:'true'}]),false);
});
test('budget gateway forwards verified user scope and rejects malformed upstream positions',async()=>{
 const calls=[];let malformed=false;
 const gateway=createGateway({url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},async(url,options)=>{
  calls.push({url,options});
  return new Response(JSON.stringify(url.endsWith('/auth/v1/user')?{id:uuid}:malformed?{}:{period_id:uuid,basis:'accrual',as_of:'2026-11-10',refreshed_at:'2026-11-10T10:00:00Z',lines:[],events:[],unattributed_lines:[]}));
 });
 const payload={institution_id:uuid,period_id:uuid,basis:'accrual',as_of:'2026-11-10'};
 assert.equal((await gateway('Bearer synthetic','budgets',payload)).status,200);
 assert.equal(calls[1].url,'https://synthetic.supabase.co/rest/v1/rpc/budget_schedule');
 assert.equal(calls[1].options.headers.Authorization,'Bearer synthetic');
 assert.deepEqual(JSON.parse(calls[1].options.body),{tenant:uuid,period:uuid,accounting_basis:'accrual',as_of:'2026-11-10'});
 malformed=true;
 assert.deepEqual(await gateway('Bearer synthetic','budgets',payload),{status:502,error:'Invalid service response'});
});
