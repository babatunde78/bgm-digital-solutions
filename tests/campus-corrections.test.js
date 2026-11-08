'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { validRevenue } = require('../campus/revenue');
const ids = Array.from({length:45},(_,n)=>`40000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`);

test('source corrections preserve originals and reconcile credits, refunds, releases, chargebacks and full reversals',async()=>{
  const db=new PGlite();
  const [tenant,other,admin,preparer,approver,outsider,student,cash,ar,income,unapplied,oldPeriod,newPeriod,cashPolicy,accrualPolicy,invoice,line,receipt,allocation,secondInvoice,secondLine,secondReceipt,release,credit,refund,chargeback,invoiceReverse,receiptReverse,invalid]=ids;
  try{
    await db.exec(`create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for(const user of [admin,preparer,approver,outsider]) await db.query('insert into auth.users values($1)',[user]);
    for(const file of ['001_ledger.sql','002_operations.sql','003_configuration.sql','004_revenue.sql','005_revenue_rules.sql','006_revenue_corrections.sql']) await db.exec(fs.readFileSync(`campus/migrations/${file}`,'utf8'));
    await db.query('insert into campus.institutions(id,name) values($1,$2),($3,$4)',[tenant,'Synthetic Campus',other,'Other Synthetic Campus']);
    for(const [institution,user,role]of[[tenant,admin,'institution_administrator'],[tenant,preparer,'bursar'],[tenant,approver,'bursar'],[other,outsider,'bursar']]) await db.query('insert into campus.memberships values($1,$2,$3,true)',[institution,user,role]);
    async function call(user,sql,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
    for(const[id,code,name,type]of[[cash,'0010','Cash','asset'],[ar,'0020','Receivables','asset'],[income,'0400','Fees','income'],[unapplied,'0200','Unapplied','liability']]) await call(admin,'select campus.create_account($1,$2,$3,$4,$5)',[tenant,id,code,name,type]);
    for(const[id,start,end]of[[oldPeriod,'2026-01-01','2026-12-31'],[newPeriod,'2027-01-01','2027-12-31']]) await call(admin,'select campus.create_period($1,$2,$3,$4)',[tenant,id,start,end]);
    for(const[id,basis]of[[cashPolicy,'cash'],[accrualPolicy,'accrual']]){
      await call(admin,'select campus.propose_policy($1,$2,$3,$4,$5,$6)',[tenant,id,basis,'2026-01-01','Synthetic clearing-account example only',JSON.stringify([cash,ar,income,unapplied].map((account_id,n)=>({key:`account_${n}`,account_id})))]);
      await call(approver,'select campus.approve_policy($1,$2)',[tenant,id]);
    }
    const entry=(account_id,debit_minor,credit_minor)=>({account_id,debit_minor,credit_minor});
    const plan=(basis,entries)=>({basis,policy_id:basis==='cash'?cashPolicy:accrualPolicy,lines:entries,nonrecognition_reason:entries.length?'':'Synthetic explicit non-recognition decision'});
    const pair=(debit,credit,amount)=>[entry(debit,amount,'0'),entry(credit,'0',amount)];
    async function finish(id,plans,injectFailure=false,ruleIds=null){
      if(ruleIds) await call(preparer,'select campus.submit_revenue_rules($1,$2,$3,$4,$5)',[tenant,id,1,...ruleIds]);
      else if(plans) await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,id,1,JSON.stringify(plans)]);
      else await call(preparer,'select campus.submit_source_reversal($1,$2,$3)',[tenant,id,1]);
      await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,2,'reviewed']);
      await assert.rejects(call(preparer,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,3,'approved']),/independent approver required/);
      await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,3,'approved']);
      if(injectFailure){
        await db.exec(`create function campus.synthetic_link_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic reversal-link failure'; end $$;
          create trigger synthetic_link_failure before update of reversal_of on campus.journals for each row execute function campus.synthetic_link_failure();`);
        await assert.rejects(call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,4,'posted']),/synthetic reversal-link failure/);
        assert.equal((await db.query('select count(*)::int as n from campus.journals where source_id=$1',[id])).rows[0].n,0);
        assert.deepEqual((await db.query('select status,version from campus.revenue_events where id=$1',[id])).rows,[{status:'approved',version:4}]);
        await db.exec('drop trigger synthetic_link_failure on campus.journals;drop function campus.synthetic_link_failure();');
      }
      await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,4,'posted']);
    }
    await call(preparer,'select campus.create_student($1,$2,$3,$4)',[tenant,student,'00001234','Synthetic Student']);
    for(const[id,lineId,amount]of[[invoice,line,'100000'],[secondInvoice,secondLine,'20000']]){
      await call(preparer,'select campus.draft_invoice($1,$2,$3,$4,$5,$6,$7)',[tenant,id,student,oldPeriod,'2026-11-08','2026/2027',JSON.stringify([{id:lineId,account_id:income,description:'Synthetic fee',amount_minor:amount,due_date:'2026-12-01'}])]);
      await finish(id,[plan('cash',[]),plan('accrual',pair(ar,income,amount))]);
    }
    for(const[id,amount,reference]of[[receipt,'120000','000-RECEIPT-A'],[secondReceipt,'20000','000-RECEIPT-B']]){
      await call(preparer,'select campus.draft_receipt($1,$2,$3,$4,$5,$6,$7)',[tenant,id,student,oldPeriod,'2026-11-09',reference,amount]);
      await finish(id,[plan('cash',pair(cash,unapplied,amount)),plan('accrual',pair(cash,unapplied,amount))]);
    }
    await call(preparer,'select campus.draft_allocation($1,$2,$3,$4,$5,$6,$7)',[tenant,allocation,receipt,line,oldPeriod,'2026-11-10','100000']);
    await finish(allocation,[plan('cash',pair(unapplied,income,'100000')),plan('accrual',pair(unapplied,ar,'100000'))]);
    await call(approver,'select campus.lock_period($1,$2,$3)',[tenant,oldPeriod,1]);
    const draft=(user,id,kind,original,amount)=>call(user,'select campus.draft_correction($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,id,kind,original,newPeriod,'2027-01-10',amount,'Synthetic controlled correction']);
    await assert.rejects(draft(outsider,invalid,'refund',receipt,'1'),/permission denied/);
    await assert.rejects(draft(preparer,invalid,'credit',line,'1'),/correction exceeds available balance/);
    await assert.rejects(draft(preparer,invalid,'refund',receipt,'20001'),/correction exceeds available balance/);
    await draft(preparer,release,'allocation_release',allocation,'30000');
    await finish(release,[plan('cash',pair(income,unapplied,'30000')),plan('accrual',pair(ar,unapplied,'30000'))]);
    await assert.rejects(call(preparer,'select campus.draft_correction($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,invalid,'credit',line,newPeriod,'2027-01-09','1','Backdated before release']),/correction exceeds available balance/);
    await draft(preparer,credit,'credit',line,'20000');await finish(credit,[plan('cash',[]),plan('accrual',pair(income,ar,'20000'))]);
    const [reservedRefund,competingRefund]=ids.slice(30,32);
    for(const id of [reservedRefund,competingRefund]){
      await draft(preparer,id,'refund',receipt,'30000');
      await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,id,1,JSON.stringify([plan('cash',pair(unapplied,cash,'30000')),plan('accrual',pair(unapplied,cash,'30000'))])]);
      await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,2,'reviewed']);
    }
    await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,reservedRefund,3,'approved']);
    await assert.rejects(call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,competingRefund,3,'approved']),/correction exceeds available balance/);
    await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,reservedRefund,4,'cancelled']);
    await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,competingRefund,3,'cancelled']);
    await draft(preparer,refund,'refund',receipt,'40000');await finish(refund,[plan('cash',pair(unapplied,cash,'40000')),plan('accrual',pair(unapplied,cash,'40000'))]);
    const ruleIds=ids.slice(33,35);
    for(const[index,basis]of ['cash','accrual'].entries()){
      await call(admin,'select campus.propose_revenue_rule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tenant,ruleIds[index],basis,basis==='cash'?cashPolicy:accrualPolicy,'chargeback','2027-01-01','journal','account_3','account_0','']);
      await call(approver,'select campus.approve_revenue_rule($1,$2)',[tenant,ruleIds[index]]);
    }
    await draft(preparer,chargeback,'chargeback',receipt,'5000');await finish(chargeback,null,false,ruleIds);
    await assert.rejects(draft(preparer,invalid,'receipt_reversal',receipt,'120000'),/correction exceeds available balance/);
    await draft(preparer,invoiceReverse,'invoice_reversal',secondInvoice,'20000');
    await assert.rejects(call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,invoiceReverse,1,JSON.stringify([plan('cash',[]),plan('accrual',[])])]),/controlled reversal submission required/);
    await finish(invoiceReverse,null);
    await draft(preparer,receiptReverse,'receipt_reversal',secondReceipt,'20000');await finish(receiptReverse,null,true);
    await assert.rejects(draft(preparer,invalid,'receipt_reversal',secondReceipt,'20000'),/correction exceeds available balance/);
    const schedule=(await call(preparer,'select campus.revenue_schedule($1) as data',[tenant])).rows[0].data;
    assert.equal(validRevenue(schedule),true);
    assert.deepEqual(schedule.totals,{billed_minor:'120000',credits_minor:'20000',invoice_reversed_minor:'20000',net_billed_minor:'80000',receipts_minor:'140000',refunded_minor:'40000',receipt_reversed_minor:'25000',net_receipts_minor:'75000',allocated_minor:'100000',released_minor:'30000',net_allocated_minor:'70000',receivable_minor:'10000',unapplied_minor:'5000'});
    const ledger=(await db.query(`select j.basis,l.account_id,sum(l.debit_minor-l.credit_minor)::text as balance from campus.journals j join campus.journal_lines l on l.institution_id=j.institution_id and l.journal_id=j.id where j.status='posted' group by j.basis,l.account_id`)).rows;
    assert.equal(ledger.find(row=>row.basis==='accrual'&&row.account_id===ar).balance,'10000');
    assert.equal(ledger.find(row=>row.basis==='accrual'&&row.account_id===income).balance,'-80000');
    assert.equal(ledger.find(row=>row.basis==='cash'&&row.account_id===income).balance,'-70000');
    assert.equal(ledger.find(row=>row.basis==='cash'&&row.account_id===unapplied).balance,'-5000');
    assert.equal((await db.query('select count(*)::int as n from campus.journals where reversal_of is not null')).rows[0].n,3);
    assert.deepEqual((await db.query('select status,version from campus.revenue_events where id=$1',[receipt])).rows,[{status:'posted',version:5}]);
    assert.deepEqual((await call(outsider,'select id from campus.student_refunds')).rows,[]);
    await assert.rejects(call(preparer,'delete from campus.student_credits'),/permission denied/);
    await assert.rejects(call(preparer,'select campus.transition_revenue_base($1,$2,$3,$4)',[tenant,refund,4,'posted']),/permission denied/);
    await assert.rejects(call(preparer,'select campus.submit_revenue_base($1,$2,$3,$4)',[tenant,invoiceReverse,1,'[]']),/permission denied/);
    await assert.rejects(call(preparer,'select campus.draft_allocation($1,$2,$3,$4,$5,$6,$7)',[tenant,invalid,secondReceipt,line,newPeriod,'2027-01-11','1']),/allocation exceeds available balance/);
    await call(approver,'select campus.lock_period($1,$2,$3)',[tenant,newPeriod,1]);
    await assert.rejects(draft(preparer,invalid,'refund',receipt,'1'),/open revenue period required/);
  }finally{await db.close();}
});
