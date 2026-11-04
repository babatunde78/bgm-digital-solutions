'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
let db;
const session='a'.repeat(64), key=crypto.randomUUID();
async function create(id=key,product='guide') {
  const result=await db.query(`select public.store_create_order($1,$2,'buyer@example.com','test',$3,'Guide',750000,'NGN',array['private/v1.zip']) as o`,[id,session,product]);
  return result.rows[0].o;
}
before(async()=>{
  db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(fs.readFileSync('supabase/migrations/202611040001_store_payments.sql','utf8'));
});
after(async()=>{ await db?.close(); });
test('migration executes on real PostgreSQL and private tables deny anonymous access',async()=>{
  const rows=await db.query("select relname,relrowsecurity from pg_class where relname='store_orders'");
  assert.equal(rows.rows[0].relrowsecurity,true);
  const privileges=await db.query("select has_table_privilege('anon','public.store_orders','select') as readable, has_function_privilege('anon','public.store_confirm_order(uuid,text)','execute') as executable");
  assert.deepEqual(privileges.rows[0],{readable:false,executable:false});
});
test('repeat create preserves one immutable order and rejects changed basket',async()=>{
  const [a,b]=await Promise.all([create(),create()]);
  assert.equal(a.id,b.id);assert.equal(a.amount,750000);
  await assert.rejects(create(key,'another-product'),/Idempotency key conflict/);
  const rows=await db.query('select count(*)::integer as count from public.store_orders where idempotency_key=$1',[key]);
  assert.equal(rows.rows[0].count,1);
});
test('initialization claim permits only one provider request per order',async()=>{
  const o=await create();
  const result=await db.query('select public.store_claim_initialization($1) as claimed',[o.id]);
  const again=await db.query('select public.store_claim_initialization($1) as claimed',[o.id]);
  assert.equal(result.rows[0].claimed,true);assert.equal(again.rows[0].claimed,false);
});
test('confirmation is atomic, creates one receipt, and cannot reuse another order transaction',async()=>{
  const o=await create();
  await Promise.all([db.query('select public.store_confirm_order($1,$2)',[o.id,'123']),db.query('select public.store_confirm_order($1,$2)',[o.id,'123'])]);
  const result=await db.query('select status,assets,amount from public.store_orders where id=$1',[o.id]);
  assert.deepEqual(result.rows[0],{status:'paid',assets:['private/v1.zip'],amount:750000});
  const emails=await db.query('select count(*)::integer as count from public.store_email_outbox where order_id=$1',[o.id]);assert.equal(emails.rows[0].count,1);
  const other=await create(crypto.randomUUID());
  await assert.rejects(db.query('select public.store_confirm_order($1,$2)',[other.id,'123']),/unique constraint/);
  const pending=await db.query('select status from public.store_orders where id=$1',[other.id]);assert.equal(pending.rows[0].status,'pending');
});
test('recovery is non-enumerating, single-use, environment-bound and grants only one order session',async()=>{
  const o=await create(), tokenHash='b'.repeat(64), recoveredSession='c'.repeat(64);
  await db.query("select public.store_queue_recovery($1,'wrong@example.com','test')",[o.reference]);
  const noMatch=await db.query("select count(*)::integer as count from public.store_email_outbox where kind='recovery'");assert.equal(noMatch.rows[0].count,0);
  await db.query("insert into public.store_recovery_tokens(token_hash,order_id,expires_at) values($1,$2,now()+interval '1 day')",[tokenHash,o.id]);
  const wrong=await db.query("select public.store_exchange_recovery($1,$2,'live') as ref",[tokenHash,recoveredSession]);assert.equal(wrong.rows[0].ref,null);
  const good=await db.query("select public.store_exchange_recovery($1,$2,'test') as ref",[tokenHash,recoveredSession]);assert.equal(good.rows[0].ref,o.reference);
  const used=await db.query("select public.store_exchange_recovery($1,$2,'test') as ref",[tokenHash,recoveredSession]);assert.equal(used.rows[0].ref,null);
  const sessions=await db.query('select order_id from public.store_order_sessions where session_hash=$1',[recoveredSession]);assert.deepEqual(sessions.rows,[{order_id:o.id}]);
});
test('revocation survives late success events',async()=>{
  const o=await create();
  await db.query("update public.store_orders set revoked_at=now(),revocation_reason='refund.processed' where id=$1",[o.id]);
  await db.query('select public.store_confirm_order($1,$2)',[o.id,'123']);
  const rows=await db.query('select revoked_at from public.store_orders where id=$1',[o.id]);assert(rows.rows[0].revoked_at);
});
test('persistent rate limits and leased workers do not double-claim work',async()=>{
  const limitKey=crypto.randomUUID();
  for(const expected of [true,true,false]) {
    const result=await db.query('select public.store_rate_limit($1,2) as allowed',[limitKey]);assert.equal(result.rows[0].allowed,expected);
  }
  await db.query("insert into public.store_events(event_key,event_type,reference,environment) values('test:success:1','charge.success','bgm-test','test')");
  const first=await db.query("select public.store_claim_work('events','test',4) as jobs");assert.equal(first.rows[0].jobs.length,1);
  const next=await db.query("select public.store_claim_work('events','test',4) as jobs");assert.equal(next.rows[0].jobs.length,0);
});
test('one database keeps live and test order keys separate',async()=>{
  const sameKey=crypto.randomUUID();
  const testOrder=await create(sameKey);
  const live=await db.query("select public.store_create_order($1,$2,'buyer@example.com','live','guide','Guide',750000,'NGN',array['private/v1.zip']) as o",[sameKey,session]);
  assert.notEqual(live.rows[0].o.id,testOrder.id);
  assert.equal(live.rows[0].o.environment,'live');
});
