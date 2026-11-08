'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const{PGlite}=require('@electric-sql/pglite');
const{validBudgetSchedule}=require('../campus/budget');
const ids=Array.from({length:30},(_,n)=>`80000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`);
test('budget commitments convert to journal-backed actuals without double counting and require traceable releases',async()=>{
 const db=new PGlite();const[tenant,other,admin,preparer,approver,outsider,fund,expense,cash,period,line,authorisation,commitment,actual,releaseActual,releaseCommitment,policy,journal,journalSource,invalid]=ids;
 try{
  await db.exec(`create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const user of[admin,preparer,approver,outsider])await db.query('insert into auth.users values($1)',[user]);
  for(const file of fs.readdirSync('campus/migrations').filter(file=>file.endsWith('.sql')).sort())await db.exec(fs.readFileSync(`campus/migrations/${file}`,'utf8'));
  await db.query('insert into campus.institutions(id,name)values($1,$2),($3,$4)',[tenant,'Synthetic Campus',other,'Other Campus']);
  for(const[institution,user,role]of[[tenant,admin,'institution_administrator'],[tenant,preparer,'bursar'],[tenant,approver,'bursar'],[other,outsider,'bursar']])await db.query('insert into campus.memberships values($1,$2,$3,true)',[institution,user,role]);
  async function call(user,sql,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
  for(const[id,code,name,type]of[[expense,'0600','Synthetic expense','expense'],[cash,'0010','Synthetic bank','asset']])await call(admin,'select campus.create_account($1,$2,$3,$4,$5)',[tenant,id,code,name,type]);
  await call(admin,'select campus.create_period($1,$2,$3,$4)',[tenant,period,'2026-01-01','2026-12-31']);
  await call(admin,'select campus.create_budget_fund($1,$2,$3,$4)',[tenant,fund,'Synthetic restricted fund',true]);
  await call(preparer,'select campus.create_budget_line($1,$2,$3,$4,$5,$6)',[tenant,line,expense,period,fund,'accrual']);
  const draft=(id,kind,amount,details)=>call(preparer,'select campus.draft_budget_event($1,$2,$3,$4,$5,$6,$7)',[tenant,id,line,kind,'2026-11-10',amount,JSON.stringify(details)]);
  async function finish(id){
   await call(preparer,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,id,1,'submitted']);
   await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,id,2,'reviewed']);
   await assert.rejects(call(preparer,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,id,3,'approved']),/independent approver required/);
   await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,id,3,'approved']);
   await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,id,4,'posted']);
  }
  await draft(authorisation,'budget','100000',{description:'Synthetic authorised budget'});await finish(authorisation);
  await draft(commitment,'commitment','60000',{description:'Synthetic obligation'});await finish(commitment);
  for(const competing of[ids[21],ids[22]]){
   await draft(competing,'commitment','40000',{description:'Synthetic competing reservation'});
   await call(preparer,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,competing,1,'submitted']);
   await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,competing,2,'reviewed']);
  }
  await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,ids[21],3,'approved']);
  await assert.rejects(call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,ids[22],3,'approved']),/budget availability exceeded/);
  await assert.rejects(call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,ids[21],3,'posted']),/version conflict/);
  await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,ids[21],4,'cancelled']);
  await call(approver,'select campus.transition_budget_event($1,$2,$3,$4)',[tenant,ids[22],3,'cancelled']);
  await assert.rejects(draft(invalid,'commitment','40001',{description:'Over budget'}),/budget availability exceeded/);
  await assert.rejects(call(approver,'select campus.lock_period($1,$2,$3)',[tenant,period,1]),/open commitments require retirement/);
  await call(admin,'select campus.propose_policy($1,$2,$3,$4,$5,$6)',[tenant,policy,'accrual','2026-01-01','Synthetic manual expense policy',JSON.stringify([{key:'expense',account_id:expense},{key:'cash',account_id:cash}])]);
  await call(approver,'select campus.approve_policy($1,$2)',[tenant,policy]);
  await call(preparer,'select campus.create_journal($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,journal,'accrual',policy,period,journalSource,'2026-11-09',JSON.stringify([{account_id:expense,debit_minor:'20000',credit_minor:'0'},{account_id:cash,debit_minor:'0',credit_minor:'20000'}])]);
  for(const[v,target]of[[1,'submitted'],[2,'reviewed'],[3,'approved'],[4,'posted']])await call(v===1?preparer:approver,'select campus.transition_journal($1,$2,$3,$4)',[tenant,journal,v,target]);
  await assert.rejects(draft(invalid,'commitment','100',{description:'Unattributed expense exists'}),/unattributed expenditure requires review/);
  await draft(actual,'actual','20000',{journal_id:journal,line_no:1,commitment_id:commitment,description:'Synthetic actual attribution'});await finish(actual);
  let schedule=(await call(preparer,'select campus.budget_schedule($1,$2,$3,$4)as data',[tenant,period,'accrual','2026-11-10'])).rows[0].data;
  assert.equal(validBudgetSchedule(schedule),true);
  assert.deepEqual(schedule.lines[0].position,{authorised_minor:'100000',posted_actual_minor:'20000',reserved_actual_minor:'0',open_commitment_minor:'40000',available_minor:'40000'});
  assert.equal(schedule.unattributed_lines.length,0);
  await assert.rejects(draft(invalid,'actual','1',{journal_id:journal,line_no:1,commitment_id:null,description:'Duplicate expense attribution'}),/journal debit already attributed/);
  await assert.rejects(call(preparer,'select campus.reverse_journal($1,$2,$3,$4,$5,$6,$7)',[tenant,journal,5,ids[20],period,'2026-11-11','Cannot skip budget release']),/release budget actuals before journal reversal/);
  await draft(releaseActual,'actual_release','20000',{original_id:actual,reason:'Synthetic accounting correction'});await finish(releaseActual);
  await draft(releaseCommitment,'commitment_release','60000',{original_id:commitment,reason:'Synthetic obligation cancelled'});await finish(releaseCommitment);
  await call(preparer,'select campus.reverse_journal($1,$2,$3,$4,$5,$6,$7)',[tenant,journal,5,ids[20],period,'2026-11-11','Synthetic corrected expense']);
  for(const[v,target]of[[1,'submitted'],[2,'reviewed'],[3,'approved'],[4,'posted']])await call(v===1?preparer:approver,'select campus.transition_journal($1,$2,$3,$4)',[tenant,ids[20],v,target]);
  schedule=(await call(preparer,'select campus.budget_schedule($1,$2,$3,$4)as data',[tenant,period,'accrual','2026-11-12'])).rows[0].data;
  assert.deepEqual(schedule.lines[0].position,{authorised_minor:'100000',posted_actual_minor:'0',reserved_actual_minor:'0',open_commitment_minor:'0',available_minor:'100000'});
  assert.deepEqual((await call(outsider,'select id from campus.budget_lines')).rows,[]);
  await assert.rejects(call(admin,'select campus.budget_schedule($1,$2,$3,$4)',[tenant,period,'accrual','2026-11-12']),/permission denied/);
  await assert.rejects(call(outsider,'update campus.budget_events set amount_minor=1'),/permission denied/);
  await assert.rejects(call(preparer,'select campus.budget_position($1,$2,$3)',[tenant,line,'2026-11-12']),/permission denied/);
  await assert.rejects(call(preparer,'select campus.budget_schedule($1,$2,$3,$4)',[tenant,period,'both','2026-11-12']),/explicit period/);
  await assert.rejects(call(outsider,'select campus.budget_schedule($1,$2,$3,$4)',[tenant,period,'accrual','2026-11-12']),/permission denied/);
  assert.deepEqual((await db.query("select count(*)::int as count from campus.administration_events where institution_id=$1 and subject_id=$2 and action='budget_posted'",[tenant,actual])).rows,[{count:1}]);
  await call(approver,'select campus.lock_period($1,$2,$3)',[tenant,period,1]);
  await assert.rejects(draft(invalid,'commitment','1',{description:'Closed period'}),/open revenue period required/);
 }finally{await db.close();}
});
