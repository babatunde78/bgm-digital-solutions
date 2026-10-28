const {getOrder,markPaid,paymentMode}=require('./_orders');
function parseMetadata(v){if(!v)return {};if(typeof v==='object'&&!Array.isArray(v))return v;try{return JSON.parse(v)||{}}catch{return {}}}
async function verifyTransaction(reference){
 const order=await getOrder(reference);
 if(!order)return {valid:false,order:null};
 const mode=paymentMode();
 if(order.payment_mode!==mode)return {valid:false,order};
 const response=await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(reference),{
  headers:{Authorization:'Bearer '+process.env.PAYSTACK_SECRET_KEY}
 });
 const result=await response.json();const data=result.data||{};
 const metadata=parseMetadata(data.metadata);
 const email=String(data.customer?.email||'').trim().toLowerCase();
 const valid=Boolean(response.ok&&result.status&&data.status==='success'&&
  data.reference===reference&&data.reference===order.reference&&
  Number(data.amount)===Number(order.amount)&&String(data.currency).toUpperCase()===order.currency&&
  email===order.email&&metadata.product_id===order.product_id&&
  order.blob_pathnames?.length>0);
 if(valid)await markPaid(reference);
 return {valid,order,data,metadata};
}
module.exports={verifyTransaction,parseMetadata};
