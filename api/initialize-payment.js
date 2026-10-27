const {getProduct}=require('./_catalog');
const {createOrder,paymentMode}=require('./_orders');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const {email,productId,currency='NGN'}=req.body||{};
  const cleanEmail=String(email||'').trim().toLowerCase();
  const c=String(currency).toUpperCase();
  if(!/^\S+@\S+\.\S+$/.test(cleanEmail)||cleanEmail.length>254)return res.status(400).json({error:'Valid email required'});
  if(typeof productId!=='string'||!/^[a-z0-9-]{1,120}$/.test(productId))return res.status(400).json({error:'Invalid product'});
  const p=await getProduct(productId);
  if(!p||!p.enabled)return res.status(400).json({error:'Product is not available.'});
  if(!p.deliveryReady||!Array.isArray(p.blobPathnames)||!p.blobPathnames.length)return res.status(400).json({error:'Product delivery is not ready.'});
  const amount=p.amounts?.[c];
  if(!Number.isSafeInteger(amount)||amount<100)return res.status(400).json({error:'Currency unavailable.'});
  const mode=paymentMode();
  // Preview must never use a live Paystack key.
  if(process.env.VERCEL_ENV==='preview'&&mode!=='test')return res.status(503).json({error:'Preview payment is disabled until a test key is configured.'});
  const configured=process.env.SITE_URL||`https://${req.headers.host}`;
  const u=new URL(configured);
  if(u.protocol!=='https:')throw Error('SITE_URL must use HTTPS');
  // Callback is bound to the current deployment's host to avoid cross-environment verification.
  const host=String(req.headers.host||'');
  if(!/^[a-z0-9.-]+(?::\d+)?$/i.test(host))throw Error('Invalid host');
  const callback=`https://${host}/payment-success.html`;
  const response=await fetch('https://api.paystack.co/transaction/initialize',{
   method:'POST',headers:{Authorization:'Bearer '+process.env.PAYSTACK_SECRET_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({email:cleanEmail,amount:String(amount),currency:c,callback_url:callback,
    metadata:{product_id:productId,product_name:p.name,delivery:'bgm-private-blob'}})
  });
  const data=await response.json();
  if(!response.ok||!data.status||!data.data?.authorization_url||!data.data?.reference)return res.status(502).json({error:'Payment initialization failed.'});
  await createOrder({reference:data.data.reference,product_id:productId,product_name:p.name,email:cleanEmail,
   amount,currency:c,blob_pathnames:[...p.blobPathnames],payment_mode:mode,status:'pending'});
  return res.status(200).json({authorization_url:data.data.authorization_url,reference:data.data.reference});
 }catch(e){console.error('Initialize error:',e.message);return res.status(503).json({error:'Checkout is temporarily unavailable. Please try again.'});}
};
