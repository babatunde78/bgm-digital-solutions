'use strict';
const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {hash}=require('../lib/http');
const {confirm,publicOrder}=require('../lib/orders');
const originalFetch=global.fetch;
const token=crypto.randomBytes(32).toString('base64url');
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(data){this.data=data;return this},end(){},destroy(){this.destroyed=true}}}
function reply(value){return {ok:true,status:200,text:async()=>JSON.stringify(value),json:async()=>value}}
beforeEach(()=>{
  Object.assign(process.env,{SITE_URL:'https://store.example',PAYSTACK_MODE:'test',PAYSTACK_SECRET_KEY:'sk_test_synthetic',PAYSTACK_WEBHOOK_MODE:'legacy',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic',DELIVERY_SECRET:'synthetic-secret-at-least-32-characters'});
  global.fetch=async()=>{throw Error('Unexpected network call')};
});
afterEach(()=>{global.fetch=originalFetch});
test('session requires same-origin POST and uses secure HttpOnly cookie',async()=>{
  const handler=require('../api/session'),res=response();
  await handler({method:'POST',headers:{origin:'https://store.example'}},res);
  assert.equal(res.statusCode,200);assert.match(res.headers['Set-Cookie'],/HttpOnly/);assert.match(res.headers['Set-Cookie'],/; Secure/);
  const rejected=response();await handler({method:'POST',headers:{origin:'https://evil.example'}},rejected);assert.equal(rejected.statusCode,403);
});
test('verification requires possession of the purchase session, not just a reference',async()=>{
  const handler=require('../api/verify-payment');
  let res=response();await handler({method:'GET',headers:{},query:{reference:'bgm-reference'}},res);assert.equal(res.statusCode,401);
  global.fetch=async url=>String(url).includes('/rpc/store_rate_limit')?reply(true):reply([{id:crypto.randomUUID(),reference:'bgm-reference',environment:'test',session_hash:hash('another'),created_at:new Date().toISOString()}]);
  // No matching recovered session.
  const prior=global.fetch;global.fetch=async(url,...rest)=>String(url).includes('store_order_sessions')?reply([]):prior(url,...rest);
  res=response();await handler({method:'GET',headers:{cookie:`bgm_session=${token}`},query:{reference:'bgm-reference'}},res);assert.equal(res.statusCode,401);
});
test('webhook rejects short signatures without crashing and acknowledges only after persistence',async()=>{
  const handler=require('../api/paystack-webhook');
  const raw=Buffer.from(JSON.stringify({event:'charge.success',data:{id:1,reference:'bgm-reference',domain:'test'}}));
  let res=response();await handler({method:'POST',body:raw,headers:{'x-paystack-signature':'abc'}},res);assert.equal(res.statusCode,401);
  const signature=crypto.createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  const calls=[];global.fetch=async(url,options)=>{calls.push([url,options]);return reply(null)};
  res=response();await handler({method:'POST',body:raw,headers:{'x-paystack-signature':signature}},res);
  assert.equal(res.statusCode,200);assert.equal(calls.length,1);assert.match(calls[0][0],/store_events/);assert.equal(calls[0][1].headers.Prefer,'resolution=ignore-duplicates');
  global.fetch=async()=>({ok:false});res=response();await handler({method:'POST',body:raw,headers:{'x-paystack-signature':signature}},res);assert.equal(res.statusCode,503);
});
test('paid downloads are issued from the snapshot without another Paystack request or buyer email',async()=>{
  const order={id:crypto.randomUUID(),status:'paid',reference:'bgm-reference',environment:'test',product_id:'guide',product_name:'Guide v1',assets:['private/v1.zip','private/bonus.zip']};
  assert.equal(await confirm(order),order);
  const output=publicOrder(order);assert.equal(output.downloads.length,2);assert.equal(output.product.name,'Guide v1');assert.equal(output.customerEmail,undefined);
});
test('worker endpoint requires a constant-time checked bearer secret',async()=>{
  process.env.CRON_SECRET='synthetic-worker-secret';
  const res=response();await require('../api/process-payments')({method:'GET',headers:{authorization:'Bearer wrong'}},res);assert.equal(res.statusCode,401);
});
test('deployment readiness checks are protected by the worker credential',async()=>{
  process.env.CRON_SECRET='synthetic-worker-secret';
  const res=response();await require('../api/process-payments')({method:'GET',headers:{},query:{check:'readiness'}},res);assert.equal(res.statusCode,401);
});
test('invalid download tokens never fetch storage or payment data',async()=>{
  const res=response();await require('../api/download')({method:'GET',headers:{},query:{token:'invalid'}},res);assert.equal(res.statusCode,401);
});
test('paused email disables recovery without touching the email provider',async()=>{
  process.env.EMAIL_ENABLED='false';
  const res=response();await require('../api/recover-purchase')({method:'POST',headers:{origin:'https://store.example','content-type':'application/json'},body:{email:'buyer@example.com',reference:'bgm-reference'}},res);
  assert.equal(res.statusCode,503);assert.equal(res.data.code,'email_paused');
});
test('published catalogue selects status and enables checkout without exposing private asset paths',async()=>{
  Object.assign(process.env,{CHECKOUT_ENABLED:'true',BLOB_STORE_ID:'store_synthetic',CRON_SECRET:'synthetic',PAYSTACK_CURRENCIES:'NGN'});
  const product={id:'guide',name:'Guide',category:'Resources',short:'Guide',description:'Guide',features:[],amounts:{NGN:750000},status:'published',delivery_ready:true,blob_pathnames:['private/v1.zip']};
  global.fetch=async address=>{
    const selected=new URL(address).searchParams.get('select').split(',');
    return reply([Object.fromEntries(selected.map(field=>[field,product[field]]))]);
  };
  const res=response();await require('../api/catalog')({method:'GET',headers:{}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.data.products[0].paymentEnabled,true);
  assert.equal(res.data.products[0].assets,undefined);
  assert.equal(res.data.products[0].blob_pathnames,undefined);
});
module.exports={response,reply};
