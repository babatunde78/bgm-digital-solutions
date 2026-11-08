'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const ids = Array.from({ length: 20 }, (_, n) => `10000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`);

test('provisioning separates platform powers from tenant administration and reversals require fresh approval', async () => {
  const db = new PGlite();
  const [platform, admin, preparer, reviewer, bursar, tenant, other, accountA, accountB, period, policy, journal, source, reversal, otherAdmin] = ids;
  try {
    await db.exec(`create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const user of [platform, admin, preparer, reviewer, bursar, otherAdmin]) await db.query('insert into auth.users values ($1)', [user]);
    for (const file of ['001_ledger.sql', '002_operations.sql']) await db.exec(fs.readFileSync(`campus/migrations/${file}`, 'utf8'));
    await db.query('insert into campus.platform_administrators values ($1)', [platform]);
    async function call(user, sql, args = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
      try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
    }
    const provision = 'select campus.provision_institution($1,$2,$3,$4)';
    await assert.rejects(call(admin, provision, [tenant, 'Synthetic University', 'NGN', admin]), /permission denied/);
    await call(platform, provision, [tenant, 'Synthetic University', 'NGN', admin]);
    await call(platform, provision, [other, 'Second Synthetic University', 'NGN', otherAdmin]);
    await assert.rejects(call(platform, 'select campus.set_member($1,$2,$3,$4)', [tenant, preparer, 'bursar', true]), /permission denied/);
    for (const [user, role] of [[preparer, 'student_accounts'], [reviewer, 'reviewer'], [bursar, 'bursar']]) {
      await call(admin, 'select campus.set_member($1,$2,$3,$4)', [tenant, user, role, true]);
    }
    await assert.rejects(call(otherAdmin, 'select campus.set_member($1,$2,$3,$4)', [tenant, preparer, 'bursar', true]), /permission denied/);
    await assert.rejects(call(admin, 'select campus.set_member($1,$2,$3,$4)', [tenant, admin, 'bursar', true]), /administrator membership is fixed/);
    assert.deepEqual((await call(platform, 'select id from campus.institutions')).rows, []);
    assert.deepEqual((await call(platform, 'select campus.my_context() as context')).rows[0].context, { platform_administrator: true, institutions: [] });
    assert.deepEqual((await call(admin, 'select campus.my_context() as context')).rows[0].context, { platform_administrator: false, institutions: [{ id: tenant, name: 'Synthetic University', currency: 'NGN', role: 'institution_administrator' }] });
    await db.query('insert into campus.accounts values ($1,$2,$3),($1,$4,$5)', [tenant, accountA, 'Synthetic cash', accountB, 'Synthetic fees']);
    await db.query('insert into campus.periods values ($1,$2,$3,$4,false)', [tenant, period, '2026-01-01', '2026-12-31']);
    await db.query('insert into campus.policies values ($1,$2,$3,1,$4,$5,$6)', [tenant, policy, 'cash', '2026-01-01', admin, bursar]);
    const lines = [{ account_id: accountA, debit_minor: '12500', credit_minor: '0' }, { account_id: accountB, debit_minor: '0', credit_minor: '12500' }];
    await call(preparer, 'select campus.create_journal($1,$2,$3,$4,$5,$6,$7,$8)', [tenant, journal, 'cash', policy, period, source, '2026-11-08', JSON.stringify(lines)]);
    async function post(id) {
      for (const [user, version, status] of [[preparer, 1, 'submitted'], [reviewer, 2, 'reviewed'], [bursar, 3, 'approved'], [bursar, 4, 'posted']]) {
        await call(user, 'select campus.transition_journal($1,$2,$3,$4)', [tenant, id, version, status]);
      }
    }
    const reverse = 'select campus.reverse_journal($1,$2,$3,$4,$5,$6,$7)';
    const args = [tenant, journal, 5, reversal, period, '2026-11-09', 'Synthetic correction'];
    await assert.rejects(call(preparer, reverse, args), /posted original required/);
    await post(journal);
    await assert.rejects(call(otherAdmin, reverse, args), /permission denied/);
    await db.query('update campus.periods set locked=true where id=$1', [period]);
    await assert.rejects(call(preparer, reverse, args), /open reversal period required/);
    await db.query('update campus.periods set locked=false where id=$1', [period]);
    await assert.rejects(call(preparer, reverse, [...args.slice(0, 2), 4, ...args.slice(3)]), /version conflict/);
    await call(preparer, reverse, args);
    await assert.rejects(call(preparer, reverse, args), /already has a reversal/);
    assert.deepEqual((await db.query('select status,version from campus.journals where id=$1', [reversal])).rows, [{ status: 'draft', version: 1 }]);
    await post(reversal);
    const schedule = (await call(bursar, 'select campus.journal_schedule($1,$2) as schedule', [tenant, 'cash'])).rows[0].schedule;
    assert.deepEqual(schedule.map(row => [row.id, row.status, row.version, row.reversal_of]), [[reversal, 'posted', 5, journal], [journal, 'posted', 5, null]]);
    assert.deepEqual((await call(bursar, 'select campus.journal_schedule($1,$2) as schedule', [tenant, 'accrual'])).rows[0].schedule, []);
    await assert.rejects(call(otherAdmin, 'select campus.journal_schedule($1,$2)', [tenant, 'cash']), /permission denied/);
    await assert.rejects(call(bursar, 'select campus.journal_schedule($1,$2)', [tenant, 'both']), /one accounting basis required/);
    assert.deepEqual((await db.query(`select account_id, sum(debit_minor-credit_minor)::text as balance from campus.journal_lines group by account_id order by account_id`)).rows,
      [{ account_id: accountA, balance: '0' }, { account_id: accountB, balance: '0' }]);
    assert.equal((await db.query('select status from campus.journals where id=$1', [journal])).rows[0].status, 'posted');
    assert.equal((await db.query('select count(*)::int as n from campus.administration_events')).rows[0].n, 5);
    await assert.rejects(call(admin, 'delete from campus.administration_events'), /permission denied/);
  } finally { await db.close(); }
});
