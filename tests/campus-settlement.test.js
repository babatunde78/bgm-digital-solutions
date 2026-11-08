'use strict';
const{test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const{PGlite}=require('@electric-sql/pglite');
const{validSettlementSchedule}=require('../campus/settlement');
const ids=Array.from({length:40},(_,n)=>`70000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`);
test('approved bank and source tolerances post exact settlement journals and require coordinated backout',async()=>{
  const db=new PGlite();
  const[tenant,admin,preparer,approver,bankAccount,clearing,feeAccount,variance,unapplied,bank,period,student,cashPolicy,accrualPolicy,cashProfile,accrualProfile,receiptA,receiptB,batch,matchA,matchB,toleranceA,toleranceB,settlementA,settlementB,reversal,invalid]=ids;
  try{
    await db.exec(`create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    for(const user of[admin,preparer,approver])await db.query('insert into auth.users values($1)',[user]);
    for(const file of fs.readdirSync('campus/migrations').filter(file=>file.endsWith('.sql')).sort())await db.exec(fs.readFileSync(`campus/migrations/${file}`,'utf8'));
    await db.query('insert into campus.institutions(id,name) values($1,$2)',[tenant,'Synthetic Campus']);
    for(const[user,role]of[[admin,'institution_administrator'],[preparer,'bursar'],[approver,'bursar']])await db.query('insert into campus.memberships values($1,$2,$3,true)',[tenant,user,role]);
    async function call(user,sql,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
    const incomeAccount=ids[27];
    const accounts=[[bankAccount,'bank','asset'],[clearing,'clearing','asset'],[feeAccount,'fee','expense'],[variance,'variance','liability'],[unapplied,'unapplied','liability'],[incomeAccount,'income','income']];
    for(const[id,name,type]of accounts)await call(admin,'select campus.create_account($1,$2,$3,$4,$5)',[tenant,id,name,`Synthetic ${name}`,type]);
    await call(admin,'select campus.create_period($1,$2,$3,$4)',[tenant,period,'2026-01-01','2026-12-31']);
    await call(admin,'select campus.create_bank_source($1,$2,$3,$4)',[tenant,bank,'Synthetic bank source',bankAccount]);
    await call(preparer,'select campus.create_student($1,$2,$3,$4)',[tenant,student,'000001','Synthetic Student']);
    for(const[id,basis,profile]of[[cashPolicy,'cash',cashProfile],[accrualPolicy,'accrual',accrualProfile]]){
      await call(admin,'select campus.propose_policy($1,$2,$3,$4,$5,$6)',[tenant,id,basis,'2026-01-01','Synthetic clearing transfer policy',JSON.stringify(accounts.map(([account_id,key])=>({key,account_id})))]);
      await call(approver,'select campus.approve_policy($1,$2)',[tenant,id]);
      await call(admin,'select campus.propose_settlement_profile($1,$2,$3,$4,$5,$6,$7)',[tenant,profile,bank,basis,id,'2026-01-01',JSON.stringify({bank_key:'bank',clearing_key:'clearing',fee_key:'fee',variance_key:'variance',limit_minor:'25'})]);
      if(basis==='cash'){
        await db.query("update campus.memberships set role='bursar' where user_id=$1",[admin]);
        await assert.rejects(call(admin,'select campus.approve_settlement_profile($1,$2)',[tenant,profile]),/independent approver required/);
        await db.query("update campus.memberships set role='institution_administrator' where user_id=$1",[admin]);
      }
      await call(approver,'select campus.approve_settlement_profile($1,$2)',[tenant,profile]);
    }
    await assert.rejects(call(admin,'select campus.propose_settlement_profile($1,$2,$3,$4,$5,$6,$7)',[tenant,invalid,bank,'cash',cashPolicy,'2026-01-01',JSON.stringify({bank_key:'bank',clearing_key:'clearing',fee_key:'income',variance_key:'variance',limit_minor:'25'})]),/eligible bank, clearing, fee and variance mappings required/);
    for(const[id,amount,reference]of[[receiptA,'100000','000-A'],[receiptB,'50010','000-B']]){
      await call(preparer,'select campus.draft_receipt($1,$2,$3,$4,$5,$6,$7)',[tenant,id,student,period,'2026-11-08',reference,amount]);
      const plans=[['cash',cashPolicy],['accrual',accrualPolicy]].map(([basis,policy_id])=>({basis,policy_id,nonrecognition_reason:'',lines:[{account_id:clearing,debit_minor:amount,credit_minor:'0'},{account_id:unapplied,debit_minor:'0',credit_minor:amount}]}));
      await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,id,1,JSON.stringify(plans)]);
      for(const[v,status]of[[2,'reviewed'],[3,'approved'],[4,'posted']])await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,v,status]);
    }
    const rows=[{transaction_id:'000-A',date:'2026-11-09',reference:'000-A',direction:'credit',currency:'NGN',gross_minor:'100010',fee_minor:'1000',net_minor:'99010'},
      {transaction_id:'000-B',date:'2026-11-09',reference:'000-B',direction:'credit',currency:'NGN',gross_minor:'50000',fee_minor:'0',net_minor:'50000'}];
    const mapping=Object.fromEntries(Object.keys(rows[0]).map(key=>[key,key]));
    await call(preparer,'select campus.stage_bank_import($1,$2,$3,$4,$5)',[tenant,batch,bank,JSON.stringify(rows),JSON.stringify(mapping)]);
    await call(approver,'select campus.accept_bank_import($1,$2,$3,$4)',[tenant,batch,1,'Synthetic independently verified bank statement']);
    const lines=(await db.query('select id from campus.bank_lines order by transaction_id')).rows;
    for(const[id,line,event,amount]of[[matchA,lines[0].id,receiptA,'100000'],[matchB,lines[1].id,receiptB,'50000']]){
      await call(preparer,'select campus.propose_reconciliation($1,$2,$3,$4)',[tenant,id,'Synthetic reviewed matching',JSON.stringify([{bank_line_id:line,event_id:event,amount_minor:amount}])]);
      for(const[v,target,note]of[[1,'submitted',''],[2,'reviewed',''],[3,'approved','Synthetic references checked']])await call(v===1?preparer:approver,'select campus.transition_reconciliation($1,$2,$3,$4,$5)',[tenant,id,v,target,note]);
    }
    const propose=(id,line,side,event,amount)=>call(preparer,'select campus.propose_tolerance($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenant,id,line,side,event,amount,cashProfile,accrualProfile,'Synthetic explicitly reviewed difference']);
    await assert.rejects(propose(invalid,lines[0].id,'bank',null,'26'),/approved tolerance limit exceeded/);
    for(const[id,line,side,event]of[[toleranceA,lines[0].id,'bank',null],[toleranceB,lines[1].id,'source',receiptB]]){
      await propose(id,line,side,event,'10');
      await call(preparer,'select campus.transition_tolerance($1,$2,$3,$4,$5)',[tenant,id,1,'submitted','']);
      await call(approver,'select campus.transition_tolerance($1,$2,$3,$4,$5)',[tenant,id,2,'reviewed','']);
      await assert.rejects(call(preparer,'select campus.transition_tolerance($1,$2,$3,$4,$5)',[tenant,id,3,'approved','Self attempt']),/independent approver required/);
      await call(approver,'select campus.transition_tolerance($1,$2,$3,$4,$5)',[tenant,id,3,'approved','Synthetic explicit amount accepted']);
    }
    async function post(id,line,inject=false,targetPeriod=period,postingDate='2026-11-10'){
      await call(preparer,'select campus.prepare_settlement($1,$2,$3,$4,$5,$6,$7)',[tenant,id,line,targetPeriod,postingDate,cashProfile,accrualProfile]);
      for(const[v,target]of[[1,'submitted'],[2,'reviewed']])await call(v===1?preparer:approver,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,id,v,target]);
      await assert.rejects(call(preparer,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,id,3,'approved']),/independent approver required/);
      await call(approver,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,id,3,'approved']);
      if(inject){
        await db.exec(`create function campus.synthetic_settlement_failure() returns trigger language plpgsql as $$begin if new.source_id='${id}' and new.basis='accrual' then raise exception 'synthetic second-basis failure';end if;return new;end$$;create trigger synthetic_settlement_failure before insert on campus.journals for each row execute function campus.synthetic_settlement_failure();`);
        await assert.rejects(call(approver,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,id,4,'posted']),/synthetic second-basis failure/);
        assert.equal((await db.query('select count(*)::int as n from campus.journals where source_id=$1',[id])).rows[0].n,0);
        assert.equal((await db.query('select count(*)::int as n from campus.treasury_consumptions where settlement_id=$1',[id])).rows[0].n,0);
        await db.exec('drop trigger synthetic_settlement_failure on campus.journals;drop function campus.synthetic_settlement_failure();');
      }
      await call(approver,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,id,4,'posted']);
      await assert.rejects(call(approver,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,id,4,'posted']),/version conflict/);
    }
    await post(settlementA,lines[0].id,true);await post(settlementB,lines[1].id);
    const balances=(await db.query(`select j.basis,l.account_id,sum(l.debit_minor-l.credit_minor)::text as balance from campus.journals j join campus.journal_lines l on l.institution_id=j.institution_id and l.journal_id=j.id where j.status='posted' group by j.basis,l.account_id`)).rows;
    for(const basis of['cash','accrual']){
      assert.equal(balances.find(row=>row.basis===basis&&row.account_id===bankAccount).balance,'149010');
      assert.equal(balances.find(row=>row.basis===basis&&row.account_id===clearing).balance,'0');
      assert.equal(balances.find(row=>row.basis===basis&&row.account_id===feeAccount).balance,'1000');
      assert.equal(balances.find(row=>row.basis===basis&&row.account_id===variance).balance,'0');
    }
    await assert.rejects(call(preparer,'select campus.transition_reconciliation($1,$2,$3,$4,$5)',[tenant,matchA,4,'void_submitted','Cannot bypass ledger']),/settlement must be cancelled or reversed/);
    const originalJournal=(await db.query("select id,version from campus.journals where source_id=$1 and basis='cash'",[settlementA])).rows[0];
    await assert.rejects(call(preparer,'select campus.reverse_journal($1,$2,$3,$4,$5,$6,$7)',[tenant,originalJournal.id,originalJournal.version,invalid,period,'2026-11-11','Standalone attempt']),/coordinated settlement reversal/);
    const newPeriod=ids[28];await call(admin,'select campus.create_period($1,$2,$3,$4)',[tenant,newPeriod,'2027-01-01','2027-12-31']);
    await call(approver,'select campus.lock_period($1,$2,$3)',[tenant,period,1]);
    await call(preparer,'select campus.prepare_settlement_reversal($1,$2,$3,$4,$5,$6)',[tenant,reversal,settlementA,newPeriod,'2027-01-11','Synthetic correction of settlement']);
    const reversalPreview=(await db.query("select snapshot->'plans'->0->'lines' as lines from campus.treasury_settlements where id=$1",[reversal])).rows[0].lines;
    assert.deepEqual(reversalPreview,[{account_id:bankAccount,debit_minor:'0',credit_minor:'99010'},{account_id:feeAccount,debit_minor:'0',credit_minor:'1000'},{account_id:clearing,debit_minor:'100000',credit_minor:'0'},{account_id:variance,debit_minor:'10',credit_minor:'0'}]);
    for(const[v,target]of[[1,'submitted'],[2,'reviewed'],[3,'approved'],[4,'posted']])await call(v===1?preparer:approver,'select campus.transition_settlement($1,$2,$3,$4)',[tenant,reversal,v,target]);
    assert.equal((await db.query('select count(*)::int as n from campus.journals where reversal_of is not null')).rows[0].n,2);
    for(const[v,target,note]of[[4,'void_submitted','Synthetic release of tolerance after backout'],[5,'void_reviewed',''],[6,'voided','']])await call(v===4?preparer:approver,'select campus.transition_tolerance($1,$2,$3,$4,$5)',[tenant,toleranceA,v,target,note]);
    for(const[v,target,note]of[[4,'void_submitted','Synthetic matching correction'],[5,'void_reviewed',''],[6,'voided','']])await call(v===4?preparer:approver,'select campus.transition_reconciliation($1,$2,$3,$4,$5)',[tenant,matchA,v,target,note]);
    assert.equal((await db.query('select count(*)::int as n from campus.treasury_settlement_claims')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from campus.journal_lines where account_id=$1',[incomeAccount])).rows[0].n,0);
    assert.equal(validSettlementSchedule((await call(preparer,'select campus.settlement_schedule($1)as data',[tenant])).rows[0].data),true);
    const[refund,refundBatch,refundMatch,refundSettlement,directReceipt,directBatch,directMatch]=ids.slice(29,36);
    await call(preparer,'select campus.draft_correction($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,refund,'refund',receiptB,newPeriod,'2027-01-12','20000','Synthetic actual refund record']);
    const refundPlans=[['cash',cashPolicy],['accrual',accrualPolicy]].map(([basis,policy_id])=>({basis,policy_id,nonrecognition_reason:'',lines:[{account_id:unapplied,debit_minor:'20000',credit_minor:'0'},{account_id:clearing,debit_minor:'0',credit_minor:'20000'}]}));
    await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,refund,1,JSON.stringify(refundPlans)]);
    for(const[v,status]of[[2,'reviewed'],[3,'approved'],[4,'posted']])await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,refund,v,status]);
    async function bankMatch(batchId,matchId,row,event){
      await call(preparer,'select campus.stage_bank_import($1,$2,$3,$4,$5)',[tenant,batchId,bank,JSON.stringify([row]),JSON.stringify(mapping)]);
      await call(approver,'select campus.accept_bank_import($1,$2,$3,$4)',[tenant,batchId,1,'Synthetic trusted-channel verification']);
      const line=(await db.query('select id from campus.bank_lines where batch_id=$1',[batchId])).rows[0].id;
      await call(preparer,'select campus.propose_reconciliation($1,$2,$3,$4)',[tenant,matchId,'Synthetic reviewed movement',JSON.stringify([{bank_line_id:line,event_id:event,amount_minor:row.gross_minor}])]);
      for(const[v,target,note]of[[1,'submitted',''],[2,'reviewed',''],[3,'approved','Synthetic movement and direction checked']])await call(v===1?preparer:approver,'select campus.transition_reconciliation($1,$2,$3,$4,$5)',[tenant,matchId,v,target,note]);
      return line;
    }
    const debitLine=await bankMatch(refundBatch,refundMatch,{transaction_id:'000-REFUND',date:'2027-01-13',reference:'000-B',direction:'debit',currency:'NGN',gross_minor:'20000',fee_minor:'200',net_minor:'20200'},refund);
    await post(refundSettlement,debitLine,false,newPeriod,'2027-01-14');
    const outgoing=(await db.query(`select j.basis,l.account_id,sum(l.debit_minor-l.credit_minor)::text as balance from campus.journals j join campus.journal_lines l on l.institution_id=j.institution_id and l.journal_id=j.id where j.status='posted'group by j.basis,l.account_id`)).rows;
    for(const basis of['cash','accrual']){
      assert.equal(outgoing.find(row=>row.basis===basis&&row.account_id===bankAccount).balance,'29800');
      assert.equal(outgoing.find(row=>row.basis===basis&&row.account_id===clearing).balance,'100000');
      assert.equal(outgoing.find(row=>row.basis===basis&&row.account_id===feeAccount).balance,'200');
    }
    await call(preparer,'select campus.draft_receipt($1,$2,$3,$4,$5,$6,$7)',[tenant,directReceipt,student,newPeriod,'2027-01-12','DIRECT-BANK','30000']);
    const directPlans=refundPlans.map(plan=>({...plan,lines:[{account_id:bankAccount,debit_minor:'30000',credit_minor:'0'},{account_id:unapplied,debit_minor:'0',credit_minor:'30000'}]}));
    await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,directReceipt,1,JSON.stringify(directPlans)]);
    for(const[v,status]of[[2,'reviewed'],[3,'approved'],[4,'posted']])await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,directReceipt,v,status]);
    const directLine=await bankMatch(directBatch,directMatch,{transaction_id:'DIRECT-BANK',date:'2027-01-13',reference:'DIRECT-BANK',direction:'credit',currency:'NGN',gross_minor:'30000',fee_minor:'0',net_minor:'30000'},directReceipt);
    await assert.rejects(call(preparer,'select campus.prepare_settlement($1,$2,$3,$4,$5,$6,$7)',[tenant,invalid,directLine,newPeriod,'2027-01-14',cashProfile,accrualProfile]),/insufficient source clearing entry/);
    assert.equal((await db.query('select count(*)::int as n from campus.treasury_posting_authority')).rows[0].n,0);
    const[otherTenant,outsider]=ids.slice(36,38);
    await db.query('insert into auth.users values($1)',[outsider]);await db.query('insert into campus.institutions(id,name)values($1,$2)',[otherTenant,'Other Synthetic Campus']);
    await db.query("insert into campus.memberships values($1,$2,'bursar',true)",[otherTenant,outsider]);
    assert.deepEqual((await call(outsider,'select id from campus.treasury_settlements')).rows,[]);
    await assert.rejects(call(outsider,'select campus.prepare_settlement($1,$2,$3,$4,$5,$6,$7)',[tenant,invalid,directLine,newPeriod,'2027-01-14',cashProfile,accrualProfile]),/permission denied/);
    await assert.rejects(call(preparer,'select * from campus.treasury_posting_authority'),/permission denied/);
  }finally{await db.close();}
});
