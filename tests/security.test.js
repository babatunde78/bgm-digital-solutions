'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sign, verify } = require('../lib/tokens');
const { validSignature, rawBody, eventRecord } = require('../lib/webhooks');
const { matches } = require('../lib/paystack');
const { normalize } = require('../lib/catalog');
const { session, hash } = require('../lib/http');
const order = { id: crypto.randomUUID(), reference: 'bgm-reference', environment: 'test', currency: 'NGN', amount: 750000, email: 'buyer@example.com', product_id: 'guide' };
beforeEach(() => {
  process.env.DELIVERY_SECRET = 'synthetic-test-secret-at-least-32-characters';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_synthetic';
  process.env.PAYSTACK_MODE = 'test';
  process.env.PAYSTACK_WEBHOOK_MODE = 'legacy';
  process.env.PAYSTACK_CURRENCIES = 'NGN';
});
test('download claims reject tampering, extra segments, expiry, wrong purpose and excessive TTL', () => {
  const now = Math.floor(Date.now()/1000);
  const claims = { v:1, purpose:'download', order:order.id, file:0, iat:now, exp:now+600 };
  const token = sign(claims);
  assert.equal(verify(token,'download').order,order.id);
  for(const value of [token+'.extra',token+'x',token.replace(/^./,'x'),sign({...claims,exp:now}),sign({...claims,file:-1}),sign({...claims,exp:now+601}),sign({...claims,iat:now+90,exp:now+600})]) assert.equal(verify(value,'download'),null);
  assert.equal(verify(token,'recovery'),null);
});
test('legacy webhook validation uses exact bytes and safely rejects malformed signatures', async () => {
  const raw = Buffer.from('{ "event": "charge.success", "value": 1.50 }');
  const signature = crypto.createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  assert.equal(validSignature(raw,{'x-paystack-signature':signature}),true);
  for(const sig of ['', 'abc','z'.repeat(128),[],signature+'x']) assert.equal(validSignature(raw,{'x-paystack-signature':sig}),false);
  assert.equal(validSignature(Buffer.from(JSON.stringify(JSON.parse(raw))),{'x-paystack-signature':signature}),false);
  assert.deepEqual(await rawBody({body:raw}),raw);
  await assert.rejects(rawBody({body:JSON.parse(raw)}),/Raw webhook body/);
  await assert.rejects(rawBody({body:Buffer.alloc(262145)}),/too large/);
  const {Readable}=require('node:stream');
  const lazy=Readable.from([raw]);
  Object.defineProperty(lazy,'body',{get(){throw Error('JSON getter must not run')}});
  assert.deepEqual(await rawBody(lazy),raw);
});
test('modern signature validates timestamps and rotating secrets without legacy downgrade', () => {
  process.env.PAYSTACK_WEBHOOK_MODE='modern';
  process.env.PAYSTACK_WEBHOOK_SECRETS='whsec_old,whsec_new';
  const raw=Buffer.from('{}'), now=Math.floor(Date.now()/1000);
  const sig=crypto.createHmac('sha512','whsec_new').update(`${now}.`).update(raw).digest('hex');
  assert.equal(validSignature(raw,{'paystack-signature':`t=${now},v1=whk_old:${'0'.repeat(128)},v1=whk_new:${sig}`},now),true);
  assert.equal(validSignature(raw,{'paystack-signature':`t=${now},v1=whk_new:${sig}`},now+301),false);
  assert.equal(validSignature(raw,{'paystack-signature':`t=${now},t=${now},v1=whk_new:${sig}`}),false);
  const legacy=crypto.createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  assert.equal(validSignature(raw,{'x-paystack-signature':legacy}),false);
});
test('confirmation matches immutable amount, identity, reference and payment environment', () => {
  const data={...order,status:'success',id:123,domain:'test',customer:{email:order.email},metadata:{order_id:order.id,product_id:order.product_id}};
  assert.equal(matches(order,data),true);
  for(const patch of [{amount:1},{currency:'USD'},{reference:'another-ref'},{domain:'live'},{status:'pending'},{customer:{email:'other@example.com'}},{metadata:{order_id:'wrong',product_id:'guide'}},{id:null}]) assert.equal(matches(order,{...data,...patch}),false);
});
test('catalogue excludes unsupported currency and malformed asset mappings', () => {
  const base={id:'guide',status:'published',delivery_ready:true,blob_pathnames:['private/guide.zip'],amounts:{NGN:750000,USD:900}};
  assert.deepEqual(normalize(base).amounts,{NGN:750000});
  assert.equal(normalize(base).available,true);
  for(const patch of [{status:'draft'},{delivery_ready:false},{blob_pathnames:[]},{blob_pathnames:['https://public/file.zip']},{amounts:{NGN:0}},{amounts:{NGN:1.5}}]) assert.equal(normalize({...base,...patch}).available,false);
});
test('session cookie parser and hashed credentials are stable', () => {
  const value=crypto.randomBytes(32).toString('base64url');
  assert.equal(session({headers:{cookie:`a=1; bgm_session=${value}; b=2`}}),value);
  assert.equal(session({headers:{cookie:'bgm_session=short'}}),null);
  assert.match(hash(value),/^[a-f0-9]{64}$/);
});
test('connected Blob authentication does not require the unrelated VERCEL flag or email', () => {
  const {checkoutChecks,ready}=require('../lib/config');
  Object.assign(process.env,{SITE_URL:'https://store.example',CHECKOUT_ENABLED:'true',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic',BLOB_STORE_ID:'store_synthetic',CRON_SECRET:'synthetic',EMAIL_ENABLED:'false'});
  delete process.env.VERCEL;delete process.env.BLOB_READ_WRITE_TOKEN;
  assert.equal(checkoutChecks().storage,true);
  assert.equal(ready(),true);
  process.env.CHECKOUT_ENABLED='false';assert.equal(ready(),false);
});
test('refund and success event keys are stable across webhook retries', () => {
  const charge={event:'charge.success',data:{id:1,reference:'bgm-ref',domain:'test'}};
  assert.equal(eventRecord(charge).event_key,'test:charge.success:1');
  assert.equal(eventRecord({event:'refund.processed',data:{transaction_reference:'bgm-ref',domain:'test'}}).reference,'bgm-ref');
  assert.equal(eventRecord({event:'charge.dispute.create',data:{id:55,transaction:1,domain:'test'}}).reference,'transaction:1');
  assert.equal(eventRecord({event:'unrelated',data:{}}),null);
});
