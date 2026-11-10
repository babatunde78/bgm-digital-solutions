'use strict';
const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Writable}=require('node:stream');
const {PGlite}=require('@electric-sql/pglite');
const storage=require('../lib/storage');
const {hash}=require('../lib/http');
const {rpc}=require('../lib/db');
const {publicOrder}=require('../lib/orders');
const {sign}=require('../lib/tokens');

test('checkout -> webhook -> durable fulfillment -> download -> email recovery -> refund revocation',async t=>{
  const db=new PGlite();
  const originalFetch=global.fetch;
  t.after(async()=>{global.fetch=originalFetch;mock.restoreAll();await db.close()});
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(fs.readFileSync('supabase/migrations/202611040001_store_payments.sql','utf8'));
  await db.query("insert into public.products(id,name,status,delivery_ready,amounts,blob_pathnames) values('guide','Original guide','published',true,'{\"NGN\":750000}',array['private/v1.zip','private/bonus.zip'])");
  Object.assign(process.env,{SITE_URL:'https://store.example',PAYSTACK_MODE:'test',PAYSTACK_SECRET_KEY:'sk_test_synthetic',PAYSTACK_WEBHOOK_MODE:'legacy',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic',DELIVERY_SECRET:'synthetic-secret-longer-than-32-characters',CHECKOUT_ENABLED:'true',BLOB_READ_WRITE_TOKEN:'synthetic',EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic',EMAIL_FROM:'Store <store@example.com>',CRON_SECRET:'synthetic',PAYSTACK_CURRENCIES:'NGN'});
  mock.method(storage,'head',async path=>({url:`https://test.private.blob.vercel-storage.com/${path}`,size:100}));
  mock.method(storage,'get',async()=>({statusCode:200,blob:{contentType:'application/zip'},stream:new ReadableStream({start(controller){controller.enqueue(Buffer.from('private ZIP bytes'));controller.close()}})}));
  const transactions=new Map(),sent=[];let initializes=0,verifications=0;
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  // Real SQL under the application's existing PostgREST boundary; providers stay synthetic.
  global.fetch=async(address,options={})=>{
    const url=new URL(address),data=options.body?JSON.parse(options.body):null;
    if(url.hostname==='api.paystack.co'){
      if(url.pathname==='/transaction/initialize'){
        initializes++;transactions.set(data.reference,{id:123,reference:data.reference,status:'pending',amount:Number(data.amount),currency:data.currency,domain:'test',customer:{email:data.email},metadata:data.metadata});
        return json({status:true,data:{reference:data.reference,authorization_url:'https://checkout.paystack.com/synthetic'}});
      }
      verifications++;return json({status:true,data:transactions.get(decodeURIComponent(url.pathname.split('/').pop()))});
    }
    if(url.hostname==='api.resend.com'){sent.push(data);return json({id:'synthetic-email'})}
    assert.equal(url.hostname,'db.example','no unexpected external requests');
    const route=url.pathname.replace('/rest/v1/','');
    if(route.startsWith('rpc/')){
      const name=route.slice(4);assert.match(name,/^store_[a-z_]+$/);
      const entries=Object.entries(data||{});
      const sql=`select public.${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) as result`;
      return json((await db.query(sql,entries.map(([,v])=>v))).rows[0].result);
    }
    assert.match(route,/^(products|store_[a-z_]+)$/);
    const values=[],conditions=[];
    for(const [field,expression] of url.searchParams){
      if(['select','order','limit','on_conflict'].includes(field))continue;
      assert.match(field,/^[a-z_]+$/);
      if(expression==='is.null'){conditions.push(`${field} is null`);continue}
      const index=expression.indexOf('.'),op=expression.slice(0,index),value=expression.slice(index+1);
      assert(['eq','gt'].includes(op));values.push(value);conditions.push(`${field}${op==='eq'?'=':'>'}$${values.length}`);
    }
    const where=conditions.length?` where ${conditions.join(' and ')}`:'';
    if(options.method==='POST'){
      const entries=Object.entries(data);const conflict=url.searchParams.get('on_conflict');
      await db.query(`insert into public.${route}(${entries.map(([k])=>k).join(',')}) values(${entries.map((_,i)=>'$'+(i+1)).join(',')})${conflict?` on conflict(${conflict}) do nothing`:''}`,entries.map(([,v])=>v));
      return json(null);
    }
    if(options.method==='PATCH'){
      const entries=Object.entries(data);const count=values.length;
      await db.query(`update public.${route} set ${entries.map(([k],i)=>`${k}=$${count+i+1}`).join(',')}${where}`,[...values,...entries.map(([,v])=>v)]);
      return json(null);
    }
    const selected=url.searchParams.get('select')||'*';
    assert(selected==='*'||selected.split(',').every(field=>/^[a-z_]+$/.test(field)));
    return json((await db.query(`select ${selected} from public.${route}${where}${url.searchParams.has('limit')?' limit '+Number(url.searchParams.get('limit')):''}`,values)).rows);
  };
  function res(){const chunks=[];const r=new Writable({write(chunk,encoding,cb){chunks.push(Buffer.from(chunk));cb()}});r.statusCode=200;r.headers={};r.setHeader=(k,v)=>{r.headers[k]=v};r.status=n=>{r.statusCode=n;return r};r.json=data=>{r.data=data;r.end();return r};r.bytes=()=>Buffer.concat(chunks).toString();return r}
  const cookie=crypto.randomBytes(32).toString('base64url');
  const headers={origin:'https://store.example',cookie:`bgm_session=${cookie}`,'content-type':'application/json'};
  async function invoke(name,method,body,query={},customHeaders=headers){const r=res();await require(`../api/${name}`)({method,headers:customHeaders,body,query},r);return r}
  const catalogue=await invoke('catalog','GET');
  assert.equal(catalogue.statusCode,200);assert.equal(catalogue.data.products[0].paymentEnabled,true);
  const input={email:'buyer@example.com',productId:'guide',currency:'NGN',amount:1,idempotencyKey:crypto.randomUUID()};
  const initialized=await invoke('initialize-payment','POST',input);
  assert.equal(initialized.statusCode,200);assert(initialized.data.reference);
  const reference=initialized.data.reference;
  const repeated=await invoke('initialize-payment','POST',input);
  assert.equal(repeated.data.reference,reference);assert.equal(initializes,1);assert.equal(transactions.get(reference).amount,750000);
  const transaction=transactions.get(reference);transaction.status='success';
  async function webhook(event){const raw=Buffer.from(JSON.stringify(event));const signature=crypto.createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');return invoke('paystack-webhook','POST',raw,{}, {'x-paystack-signature':signature})}
  assert.equal((await webhook({event:'charge.success',data:transaction})).statusCode,200);
  assert.equal((await webhook({event:'charge.success',data:transaction})).statusCode,200);
  const {run}=require('../lib/worker');await run();
  assert.equal(sent.length,1,'duplicate webhook sends only one receipt');
  let order=(await db.query('select * from public.store_orders where reference=$1',[reference])).rows[0];assert.equal(order.status,'paid');
  // A new catalogue version must not change the customer's purchase.
  await db.exec("update public.products set amounts='{\"NGN\":900000}',blob_pathnames=array['private/v2.zip'],status='draft'");
  const checked=await invoke('verify-payment','GET',undefined,{reference});
  assert.equal(checked.statusCode,200);assert.equal(checked.data.downloads.length,2);assert.equal(checked.data.customerEmail,undefined);
  const url=new URL(checked.data.downloads[0].url,'https://store.example');
  const beforeDownload=verifications;
  const downloaded=await invoke('download','GET',undefined,{token:url.searchParams.get('token')});
  assert.equal(downloaded.bytes(),'private ZIP bytes');assert.equal(verifications,beforeDownload,'download does not depend on Paystack');
  assert.equal(storage.get.mock.calls[0].arguments[0],'private/v1.zip');
  const recovery=await invoke('recover-purchase','POST',{email:input.email,reference});assert.equal(recovery.statusCode,202);
  await run();assert.equal(sent.length,2);
  const emailUrl=sent[1].text.match(/https:\/\/store\.example\/payment-success\.html#access=\S+/)[0];
  const access=new URLSearchParams(new URL(emailUrl).hash.slice(1)).get('access');
  const exchanged=await invoke('exchange-recovery','POST',{token:access},{},{origin:'https://store.example','content-type':'application/json'});
  assert.equal(exchanged.statusCode,200);assert.equal(exchanged.data.reference,reference);
  const newCookie=exchanged.headers['Set-Cookie'].split(';')[0];
  const recovered=await invoke('verify-payment','GET',undefined,{reference},{cookie:newCookie});assert.equal(recovered.statusCode,200);
  const replay=await invoke('exchange-recovery','POST',{token:access});assert.equal(replay.statusCode,401);
  await webhook({event:'refund.processed',data:{id:555,domain:'test',transaction_reference:reference}});await run();
  const revoked=await invoke('download','GET',undefined,{token:url.searchParams.get('token')});assert.equal(revoked.statusCode,403);
  order=(await db.query('select * from public.store_orders where reference=$1',[reference])).rows[0];assert(order.revoked_at);

  const desktopPath='campus-bursary-documents/v0.1.1/campus-bursary-documents-setup-0.1.1.exe';
  await db.query("insert into public.products(id,name,category,amounts,status,delivery_ready,blob_pathnames) values('campus-bursary-package-a','Campus Package A','Business Software','{\"NGN\":80000000}','published',true,array['campus-bursary/v0.2.1/package-a.zip']),('campus-bursary-documents','Campus Bursary Documents','Business Software','{\"NGN\":20000000}','draft',false,array[$1])",[desktopPath]);
  const campusOrder=await rpc('store_create_order',{p_key:crypto.randomUUID(),p_session:hash(cookie),p_email:'synthetic-campus-buyer@example.test',p_environment:'test',p_product:'campus-bursary-package-a',p_name:'Campus Package A',p_amount:80000000,p_currency:'NGN',p_assets:['campus-bursary/v0.2.1/package-a.zip']});
  const paidCampusOrder=await rpc('store_confirm_order',{p_order:campusOrder.id,p_transaction:'synthetic-campus-transaction'});
  assert.equal((await publicOrder(paidCampusOrder)).downloads.length,1,'draft desktop release grants no upgrade link');
  await db.query("update public.products set status='published',delivery_ready=true where id='campus-bursary-documents'");
  const campusDownloads=(await publicOrder(paidCampusOrder)).downloads;
  assert.equal(campusDownloads.length,2,'published desktop release is included for an existing paid Campus buyer');
  const upgradeToken=new URL(campusDownloads[1].url,'https://store.example').searchParams.get('token');
  const upgraded=await invoke('download','GET',undefined,{token:upgradeToken});
  assert.equal(upgraded.bytes(),'private ZIP bytes');
  assert.equal(storage.get.mock.calls.at(-1).arguments[0],desktopPath);
  assert.deepEqual((await db.query('select assets from public.store_orders where id=$1',[campusOrder.id])).rows[0].assets,['campus-bursary/v0.2.1/package-a.zip']);
  const forged=sign({v:1,purpose:'campus-desktop-upgrade',order:order.id,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});
  assert.equal((await invoke('download','GET',undefined,{token:forged})).statusCode,403,'unrelated paid order cannot redeem the Campus upgrade');
  await db.query('update public.store_orders set revoked_at=now(),revocation_reason=$1 where id=$2',['synthetic refund',campusOrder.id]);
  assert.equal((await invoke('download','GET',undefined,{token:upgradeToken})).statusCode,403,'revoked Campus order loses upgrade download access');
});
