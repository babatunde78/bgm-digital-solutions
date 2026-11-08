'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { validRevenue,validRules } = require('../campus/revenue');
const ids = Array.from({ length: 40 }, (_, n) => `30000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`);
test('revenue workflows reconcile partial and excess receipts without duplicate income or cross-institution allocation', async () => {
  const db = new PGlite();
  const [tenant, other, admin, preparer, approver, outsider, student, cash, receivable, income, unapplied, period, cashPolicy, accrualPolicy, invoice, line, first, second, allocationA, allocationB, excessive] = ids;
  try {
    await db.exec(`create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const user of [admin, preparer, approver, outsider]) await db.query('insert into auth.users values($1)', [user]);
    for (const file of ['001_ledger.sql','002_operations.sql','003_configuration.sql','004_revenue.sql','005_revenue_rules.sql']) await db.exec(fs.readFileSync(`campus/migrations/${file}`, 'utf8'));
    await db.query('insert into campus.institutions(id,name) values($1,$2),($3,$4)', [tenant, 'Synthetic Campus', other, 'Other Synthetic Campus']);
    for (const [institution, user, role] of [[tenant, admin, 'institution_administrator'], [tenant, preparer, 'bursar'], [tenant, approver, 'bursar'], [other, outsider, 'bursar']]) {
      await db.query('insert into campus.memberships values($1,$2,$3,true)', [institution, user, role]);
    }
    async function call(user, sql, args = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated');
      try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
    }
    for (const [id, code, name, type] of [[cash,'0010','Cash','asset'],[receivable,'0020','Receivables','asset'],[income,'0400','Fees','income'],[unapplied,'0200','Unapplied receipts','liability']]) {
      await call(admin, 'select campus.create_account($1,$2,$3,$4,$5)', [tenant,id,code,name,type]);
    }
    await call(admin, 'select campus.create_period($1,$2,$3,$4)', [tenant,period,'2026-01-01','2026-12-31']);
    for (const [id,basis] of [[cashPolicy,'cash'],[accrualPolicy,'accrual']]) {
      await call(admin, 'select campus.propose_policy($1,$2,$3,$4,$5,$6)', [tenant,id,basis,'2026-01-01','Synthetic worked example only; manual event instructions require independent review',JSON.stringify([cash,receivable,income,unapplied].map((account_id,i)=>({key:`account_${i}`,account_id})))]);
      await call(approver, 'select campus.approve_policy($1,$2)', [tenant,id]);
    }
    await call(preparer, 'select campus.create_student($1,$2,$3,$4)', [tenant,student,'00001234','Synthetic Student']);
    await call(preparer, 'select campus.draft_invoice($1,$2,$3,$4,$5,$6,$7)', [tenant,invoice,student,period,'2026-11-08','2026/2027',JSON.stringify([{id:line,account_id:income,description:'Synthetic tuition',amount_minor:'100000',due_date:'2026-12-01'}])]);
    for (const [id,amount,reference] of [[first,'40000','000-RECEIPT-A'],[second,'80000','000-RECEIPT-B']]) {
      await call(preparer,'select campus.draft_receipt($1,$2,$3,$4,$5,$6,$7)',[tenant,id,student,period,'2026-11-09',reference,amount]);
    }
    const entry = (account_id,debit_minor,credit_minor)=>({account_id,debit_minor,credit_minor});
    const plan = (basis,lines)=>({basis,policy_id:basis==='cash'?cashPolicy:accrualPolicy,lines,nonrecognition_reason:lines.length?'':'Synthetic matching/non-recognition decision, independently reviewed'});
    async function post(id, plans, injectFailure=false) {
      await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,id,1,JSON.stringify(plans)]);
      await assert.rejects(call(preparer,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,2,'reviewed']),/independent reviewer required/);
      for (const [version,status] of [[2,'reviewed'],[3,'approved']]) await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,version,status]);
      if(injectFailure) {
        await db.exec(`create function campus.synthetic_failure() returns trigger language plpgsql as $$ begin if new.basis='accrual' then raise exception 'synthetic interruption'; end if; return new; end $$;
          create trigger synthetic_failure before insert on campus.journals for each row execute function campus.synthetic_failure();`);
        await assert.rejects(call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,4,'posted']),/synthetic interruption/);
        assert.equal((await db.query('select count(*)::int as n from campus.journals where source_id=$1',[id])).rows[0].n,0);
        assert.deepEqual((await db.query('select status,version from campus.revenue_events where id=$1',[id])).rows,[{status:'approved',version:4}]);
        await db.exec('drop trigger synthetic_failure on campus.journals; drop function campus.synthetic_failure();');
      }
      await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,id,4,'posted']);
    }
    await post(invoice,[plan('cash',[]),plan('accrual',[entry(receivable,'100000','0'),entry(income,'0','100000')])]);
    await post(first,[plan('cash',[entry(cash,'40000','0'),entry(income,'0','40000')]),plan('accrual',[entry(cash,'40000','0'),entry(receivable,'0','40000')])],true);
    await post(second,[plan('cash',[entry(cash,'80000','0'),entry(income,'0','60000'),entry(unapplied,'0','20000')]),plan('accrual',[entry(cash,'80000','0'),entry(receivable,'0','60000'),entry(unapplied,'0','20000')])]);
    const allocate = (user,id,payment,amount)=>call(user,'select campus.draft_allocation($1,$2,$3,$4,$5,$6,$7)',[tenant,id,payment,line,period,'2026-11-10',amount]);
    await assert.rejects(allocate(outsider,allocationA,first,'40000'),/permission denied/);
    await allocate(preparer,allocationA,first,'40000');
    await allocate(preparer,excessive,first,'10000');
    await assert.rejects(call(approver,'select campus.lock_period($1,$2,$3)',[tenant,period,1]),/unposted revenue sources remain/);
    await post(allocationA,[plan('cash',[]),plan('accrual',[])]);
    await call(preparer,'select campus.submit_revenue($1,$2,$3,$4)',[tenant,excessive,1,JSON.stringify([plan('cash',[]),plan('accrual',[])])]);
    await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,excessive,2,'reviewed']);
    await assert.rejects(call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,excessive,3,'approved']),/allocation exceeds available balance/);
    await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,excessive,3,'cancelled']);
    await allocate(preparer,allocationB,second,'60000'); await post(allocationB,[plan('cash',[]),plan('accrual',[])]);
    await assert.rejects(allocate(preparer,excessive,second,'1'),/allocation exceeds available balance/);
    await assert.rejects(call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,allocationB,4,'posted']),/version conflict/);
    assert.deepEqual((await call(outsider,'select id from campus.students')).rows,[]);
    assert.equal((await db.query('select reference from campus.students where id=$1',[student])).rows[0].reference,'00001234');
    const balance = (await call(preparer,'select campus.revenue_schedule($1) as data',[tenant])).rows[0].data;
    assert.equal(validRevenue(balance),true);
    assert.deepEqual(balance.totals,{billed_minor:'100000',receipts_minor:'120000',allocated_minor:'100000',receivable_minor:'0',unapplied_minor:'20000'});
    const ledger = (await db.query(`select j.basis,l.account_id,sum(l.debit_minor-l.credit_minor)::text as balance from campus.journals j join campus.journal_lines l on l.institution_id=j.institution_id and l.journal_id=j.id where j.status='posted' group by j.basis,l.account_id order by j.basis,l.account_id`)).rows;
    assert.equal(ledger.find(row=>row.basis==='cash'&&row.account_id===income).balance,'-100000');
    assert.equal(ledger.find(row=>row.basis==='accrual'&&row.account_id===receivable).balance,'0');
    assert.equal((await db.query('select count(*)::int as n from campus.journals')).rows[0].n,5);
    const linked = (await db.query("select id,version from campus.journals where source_id=$1 and basis='accrual'",[invoice])).rows[0];
    await assert.rejects(call(preparer,'select campus.reverse_journal($1,$2,$3,$4,$5,$6,$7)',[tenant,linked.id,linked.version,ids[25],period,'2026-11-10','Blocked standalone correction']),/source-linked journal requires source correction/);
    await assert.rejects(call(preparer,'select campus.create_journal($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,ids[26],'accrual',accrualPolicy,period,invoice,'2026-11-08',JSON.stringify([entry(receivable,'100000','0'),entry(income,'0','100000')])]),/source journal requires controlled posting/);
    assert.equal((await db.query('select count(*)::int as n from campus.revenue_posting_authority')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int as n from campus.journals')).rows[0].n,5);
    const [ruleCash,ruleAccrual,autoInvoice,autoLine]=ids.slice(30,34);
    await call(admin,'select campus.propose_revenue_rule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tenant,ruleCash,'cash',cashPolicy,'invoice','2026-01-01','nonrecognition',null,null,'Synthetic invoice not recognised on this cash-policy event']);
    await call(admin,'select campus.propose_revenue_rule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tenant,ruleAccrual,'accrual',accrualPolicy,'invoice','2026-01-01','journal','account_1','account_2','']);
    await call(preparer,'select campus.draft_invoice($1,$2,$3,$4,$5,$6,$7)',[tenant,autoInvoice,student,period,'2026-11-11','2026/2027',JSON.stringify([{id:autoLine,account_id:income,description:'Synthetic rule-driven bill',amount_minor:'2000',due_date:'2026-12-01'}])]);
    const autoArgs=[tenant,autoInvoice,1,ruleCash,ruleAccrual];
    await assert.rejects(call(preparer,'select campus.submit_revenue_rules($1,$2,$3,$4,$5)',autoArgs),/approved matching rule required/);
    for (const id of [ruleCash,ruleAccrual]) await call(approver,'select campus.approve_revenue_rule($1,$2)',[tenant,id]);
    await call(preparer,'select campus.submit_revenue_rules($1,$2,$3,$4,$5)',autoArgs);
    for(const [version,status] of [[2,'reviewed'],[3,'approved'],[4,'posted']]) await call(approver,'select campus.transition_revenue($1,$2,$3,$4)',[tenant,autoInvoice,version,status]);
    assert.equal((await db.query('select count(*)::int as n from campus.revenue_rule_usage')).rows[0].n,2);
    assert.equal(validRules((await call(preparer,'select campus.revenue_rule_schedule($1) as data',[tenant])).rows[0].data),true);
    assert.deepEqual((await db.query('select account_id,debit_minor::text,credit_minor::text from campus.journal_lines where journal_id in(select id from campus.journals where source_id=$1) order by account_id',[autoInvoice])).rows,[{account_id:receivable,debit_minor:'2000',credit_minor:'0'},{account_id:income,debit_minor:'0',credit_minor:'2000'}]);
    await call(approver,'select campus.lock_period($1,$2,$3)',[tenant,period,1]);
    await assert.rejects(call(preparer,'select campus.draft_receipt($1,$2,$3,$4,$5,$6,$7)',[tenant,excessive,student,period,'2026-11-10','CLOSED','100']),/open revenue period required/);
  } finally { await db.close(); }
});
