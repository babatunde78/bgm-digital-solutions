'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const ids = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
test('connected ledger enforces separate bases, tenant boundaries, approval and immutable posting', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
    await db.exec(fs.readFileSync('campus/migrations/001_ledger.sql', 'utf8'));
    const [institution, other, preparer, reviewer, bursar, outsider, debit, credit, period, accrual, cash, journal, cashJournal, source, badJournal] = ids;
    await db.query('insert into campus.institutions(id,name) values ($1,$2),($3,$4)', [institution, 'Synthetic Campus', other, 'Second Synthetic Campus']);
    for (const [user, role, tenant] of [[preparer, 'student_accounts', institution], [reviewer, 'reviewer', institution], [bursar, 'bursar', institution], [outsider, 'bursar', other]]) {
      await db.query('insert into campus.memberships values ($1,$2,$3,true)', [tenant, user, role]);
    }
    await db.query('insert into campus.accounts values ($1,$2,$3),($1,$4,$5)', [institution, debit, 'Cash', credit, 'Fee income']);
    await db.query('insert into campus.periods values ($1,$2,$3,$4,false)', [institution, period, '2026-01-01', '2026-12-31']);
    for (const [id, basis] of [[accrual, 'accrual'], [cash, 'cash']]) {
      await db.query('insert into campus.policies values ($1,$2,$3,1,$4,$5,$6)', [institution, id, basis, '2026-01-01', reviewer, bursar]);
    }
    async function asUser(user, sql, args = []) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
      try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
    }
    const lines = [{ account_id: debit, debit_minor: '10000', credit_minor: '0' }, { account_id: credit, debit_minor: '0', credit_minor: '10000' }];
    async function create(user, id, basis, policy, entries = lines, tenant = institution) {
      return asUser(user, 'select campus.create_journal($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [tenant, id, basis, policy, period, source, '2026-11-08', JSON.stringify(entries)]);
    }
    async function move(user, id, version, action) {
      return asUser(user, 'select campus.transition_journal($1,$2,$3,$4)', [institution, id, version, action]);
    }
    await assert.rejects(create(outsider, journal, 'accrual', accrual), /permission denied/);
    await assert.rejects(create(preparer, badJournal, 'accrual', accrual, [lines[0]]), /unbalanced/);
    assert.equal((await db.query('select count(*)::int as n from campus.journals')).rows[0].n, 0);
    await create(preparer, journal, 'accrual', accrual);
    await assert.rejects(create(preparer, badJournal, 'cash', accrual), /approved effective policy required/);
    await assert.rejects(create(preparer, badJournal, 'cash', cash, [{ ...lines[0], debit_minor: '1.5' }, lines[1]]), /invalid journal line/);
    await assert.rejects(create(preparer, badJournal, 'cash', cash, lines, other), /permission denied/);
    await create(preparer, cashJournal, 'cash', cash);
    await assert.rejects(create(preparer, badJournal, 'accrual', accrual), /unique/);
    await assert.rejects(move(preparer, journal, 1, 'reviewed'), /invalid transition/);
    await move(preparer, journal, 1, 'submitted');
    await assert.rejects(move(reviewer, journal, 1, 'reviewed'), /version conflict/);
    await assert.rejects(move(preparer, journal, 2, 'reviewed'), /permission denied/);
    await move(reviewer, journal, 2, 'reviewed');
    await move(bursar, journal, 3, 'approved');
    await db.query('update campus.periods set locked=true where id=$1', [period]);
    await assert.rejects(move(bursar, journal, 4, 'posted'), /period locked/);
    await db.query('update campus.periods set locked=false where id=$1', [period]);
    await move(bursar, journal, 4, 'posted');
    await db.query("update campus.memberships set role='bursar' where user_id=$1", [preparer]);
    await move(preparer, cashJournal, 1, 'submitted');
    await assert.rejects(move(preparer, cashJournal, 2, 'reviewed'), /permission denied/);
    await move(reviewer, cashJournal, 2, 'reviewed');
    await assert.rejects(move(preparer, cashJournal, 3, 'approved'), /permission denied/);
    await assert.rejects(move(bursar, journal, 5, 'draft'), /invalid transition/);
    assert.deepEqual((await asUser(outsider, 'select id from campus.journals')).rows, []);
    assert.equal((await asUser(bursar, 'select id from campus.journals')).rows.length, 2);
    await assert.rejects(asUser(bursar, 'delete from campus.audit_events'), /permission denied/);
    await assert.rejects(asUser(bursar, "update campus.journals set status='posted'"), /permission denied/);
    assert.deepEqual((await db.query('select basis,status,version from campus.journals order by basis')).rows, [
      { basis: 'accrual', status: 'posted', version: 5 }, { basis: 'cash', status: 'reviewed', version: 3 }
    ]);
    await db.query('update campus.memberships set active=false where user_id=$1', [bursar]);
    assert.deepEqual((await asUser(bursar, 'select id from campus.journals')).rows, []);
    await assert.rejects(move(bursar, cashJournal, 3, 'approved'), /permission denied/);
    assert.equal((await db.query('select count(*)::int as n from campus.audit_events')).rows[0].n, 8);
  } finally { await db.close(); }
});
