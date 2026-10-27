const {verifyTransaction}=require('./_paystack');
const {sign}=require('./_delivery-token');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const reference=String(req.query.reference||'');
 if(!/^[A-Za-z0-9.=-]{4,160}$/.test(reference))return res.status(400).json({error:'Invalid reference'});
 try{
  const v=await verifyTransaction(reference);
  if(!v.valid)return res.status(400).json({verified:false,error:'Payment has not been verified.'});
  const o=v.order;
  const token=sign({reference:o.reference,productId:o.product_id,email:o.email,exp:Date.now()+10*60*1000});
  const downloads=o.blob_pathnames.map((path,i)=>({name:path.split('/').pop().replace(/[_-]+/g,' '),url:'/api/download?token='+encodeURIComponent(token)+'&file='+i}));
  return res.status(200).json({verified:true,reference:o.reference,product:{id:o.product_id,name:o.product_name},
   customerEmail:o.email,downloadUrl:downloads[0].url,downloads,expiresInSeconds:600});
 }catch(e){console.error('Verify error:',e.message);return res.status(503).json({verified:false,error:'Verification is temporarily unavailable.'});}
};
