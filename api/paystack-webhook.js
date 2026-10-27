const crypto=require('node:crypto');
const {getOrder,markPaid,paymentMode}=require('./_orders');
const {parseMetadata}=require('./_paystack');
module.exports=async function(req,res){
 if(req.method!=='POST')return res.status(405).end();
 try{
  const key=process.env.PAYSTACK_SECRET_KEY;
  if(!key)return res.status(503).end();
  // Signature must be computed over the exact raw request body, not reserialized JSON.
  // Vercel's Node runtime provides rawBody when bodyParser is disabled.
  const parts=[];for await(const chunk of req)parts.push(Buffer.from(chunk));
  const raw=Buffer.concat(parts);
  if(!raw.length)return res.status(400).end();
  const supplied=String(req.headers['x-paystack-signature']||'');
  if(!/^[a-f0-9]{128}$/i.test(supplied))return res.status(401).end();
  const expected=crypto.createHmac('sha512',key).update(raw).digest();
  if(!crypto.timingSafeEqual(expected,Buffer.from(supplied,'hex')))return res.status(401).end();
  const event=JSON.parse(raw.toString('utf8'));
  if(event.event==='charge.success'){
   const d=event.data||{};const ref=String(d.reference||'');
   const o=await getOrder(ref);const metadata=parseMetadata(d.metadata);
   if(o&&o.payment_mode===paymentMode()&&d.status==='success'&&d.reference===o.reference&&
    Number(d.amount)===Number(o.amount)&&String(d.currency).toUpperCase()===o.currency&&
    String(d.customer?.email||'').trim().toLowerCase()===o.email&&metadata.product_id===o.product_id){
    await markPaid(ref);
   }
  }
  return res.status(200).json({received:true});
 }catch(e){console.error('Webhook error:',e.message);return res.status(503).end();}
};
module.exports.config={api:{bodyParser:false}};
