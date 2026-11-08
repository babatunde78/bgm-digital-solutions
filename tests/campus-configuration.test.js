'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const ids = Array.from({ length: 18 }, (_, n) => `20000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`);
test('configuration requires independent policy approval, mapped accounts and controlled financial periods', async () => {
  const db = new PGlite();
  const [tenant, other, admin, bursar, preparer, outsider, cash, income, unmapped, period, policy, journal, source, overlapping, secondPolicy] = ids;
  try {
    await db.exec(`create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const user of [admin, bursar, preparer, outsider]) await db.query('insert into auth.users values($1)', [user]);
    for (const file of ['001_ledger.sql', '002_operations.sql', '003_configuration.sql']) await db.exec(fs.readFileSync(`campus/migrations/${file}`, 'utf8'));
    await db.query('insert into campus.institutions(id,name) values($1,$2),($3,$4)', [tenant, 'Synthetic Campus', other, 'Other Synthetic Campus']);
    for (const [institution, user, role] of [[tenant, admin, 'institution_administrator'], [tenant, bursar, 'bursar'], [tenant, preparer, 'student_accounts'], [other, outsider, 'bursar']]) {
      await db.query('insert into campus.memberships values($1,$2,$3,true)', [institution, user, role]);
    }
    async function call(user, sql, args = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated');
      try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
    }
    for (const [id, code, name, type] of [[cash, '0010', 'Synthetic cash', 'asset'], [income, '0400', 'Synthetic income', 'income'], [unmapped, '0990', 'Unmapped account', 'asset']]) {
      await call(admin, 'select campus.create_account($1,$2,$3,$4,$5)', [tenant, id, code, name, type]);
    }
    await assert.rejects(call(bursar, 'select campus.create_account($1,$2,$3,$4,$5)', [tenant, overlapping, '0100', 'Denied', 'asset']), /permission denied/);
    await call(admin, 'select campus.create_period($1,$2,$3,$4)', [tenant, period, '2026-01-01', '2026-12-31']);
    await assert.rejects(call(admin, 'select campus.create_period($1,$2,$3,$4)', [tenant, overlapping, '2026-12-31', '2027-12-31']), /overlapping period/);
    const mappings = [{ key: 'cash_control', account_id: cash }, { key: 'fee_income', account_id: income }];
    const propose = 'select campus.propose_policy($1,$2,$3,$4,$5,$6)';
    await assert.rejects(call(admin, propose, [tenant, policy, 'cash', '2026-01-01', 'Synthetic narrative only', JSON.stringify([{ key: 'invalid', account_id: outsider }])]), /mapped account unavailable/);
    await call(admin, propose, [tenant, policy, 'cash', '2026-01-01', 'Synthetic narrative; not a customer accounting default', JSON.stringify(mappings)]);
    const entries = [{ account_id: cash, debit_minor: '12500', credit_minor: '0' }, { account_id: income, debit_minor: '0', credit_minor: '12500' }];
    const create = (lines = entries) => call(preparer, 'select campus.create_journal($1,$2,$3,$4,$5,$6,$7,$8)', [tenant, journal, 'cash', policy, period, source, '2026-11-08', JSON.stringify(lines)]);
    await assert.rejects(create(), /approved effective policy required/);
    await assert.rejects(call(outsider, 'select campus.approve_policy($1,$2)', [tenant, policy]), /permission denied/);
    await db.query("update campus.memberships set role='bursar' where user_id=$1", [admin]);
    await assert.rejects(call(admin, 'select campus.approve_policy($1,$2)', [tenant, policy]), /independent approver required/);
    await db.query("update campus.memberships set role='institution_administrator' where user_id=$1", [admin]);
    await call(bursar, 'select campus.approve_policy($1,$2)', [tenant, policy]);
    await assert.rejects(call(bursar, 'select campus.approve_policy($1,$2)', [tenant, policy]), /already approved/);
    await assert.rejects(create([{ ...entries[0], account_id: unmapped }, entries[1]]), /unmapped journal account/);
    assert.equal((await db.query('select count(*)::int as n from campus.journals')).rows[0].n, 0);
    await create();
    await assert.rejects(call(bursar, 'select campus.lock_period($1,$2,$3)', [tenant, period, 1]), /unposted journals remain/);
    for (const [user, version, status] of [[preparer, 1, 'submitted'], [bursar, 2, 'reviewed'], [bursar, 3, 'approved'], [bursar, 4, 'posted']]) {
      await call(user, 'select campus.transition_journal($1,$2,$3,$4)', [tenant, journal, version, status]);
    }
    const reversal = ids[15];
    await call(preparer, 'select campus.reverse_journal($1,$2,$3,$4,$5,$6,$7)', [tenant, journal, 5, reversal, period, '2026-11-09', 'Synthetic mapped reversal']);
    for (const [user, version, status] of [[preparer, 1, 'submitted'], [bursar, 2, 'reviewed'], [bursar, 3, 'approved'], [bursar, 4, 'posted']]) {
      await call(user, 'select campus.transition_journal($1,$2,$3,$4)', [tenant, reversal, version, status]);
    }
    await call(admin, propose, [tenant, secondPolicy, 'cash', '2027-01-01', 'Synthetic next revision', JSON.stringify(mappings)]);
    await call(bursar, 'select campus.approve_policy($1,$2)', [tenant, secondPolicy]);
    assert.deepEqual((await db.query('select version from campus.policies order by version')).rows, [{ version: 1 }, { version: 2 }]);
    await assert.rejects(call(admin, 'update campus.policy_proposals set narrative=$1', ['Changed']), /permission denied/);
    await assert.rejects(call(outsider, 'select campus.lock_period($1,$2,$3)', [tenant, period, 1]), /permission denied/);
    await call(bursar, 'select campus.lock_period($1,$2,$3)', [tenant, period, 1]);
    await assert.rejects(call(bursar, 'select campus.lock_period($1,$2,$3)', [tenant, period, 1]), /version conflict/);
    assert.deepEqual((await db.query('select locked,version from campus.periods')).rows, [{ locked: true, version: 2 }]);
    await assert.rejects(call(preparer, 'select campus.create_journal($1,$2,$3,$4,$5,$6,$7,$8)', [tenant, ids[16], 'cash', policy, period, ids[17], '2026-11-10', JSON.stringify(entries)]), /open journal period required/);
    assert.equal((await db.query('select code from campus.accounts where id=$1', [cash])).rows[0].code, '0010');
    const configuration = (await call(admin, 'select campus.configuration($1) as config', [tenant])).rows[0].config;
    assert.equal(configuration.accounts.length, 3);
    assert.equal(configuration.policies.length, 2);
    assert.equal(configuration.periods[0].locked, true);
    await assert.rejects(call(outsider, 'select campus.configuration($1)', [tenant]), /permission denied/);
    assert.equal((await db.query('select count(*)::int as n from campus.administration_events')).rows[0].n, 9);
  } finally { await db.close(); }
});
