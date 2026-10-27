const {get}=require('@vercel/blob');
const {Readable}=require('node:stream');
const {verify}=require('./_delivery-token');
const {verifyTransaction}=require('./_paystack');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).end('Method not allowed');
 try{
  const payload=verify(req.query.token);
  if(!payload)return res.status(401).end('Download link invalid or expired. Verify your purchase again.');
  const v=await verifyTransaction(payload.reference);
  if(!v.valid||v.order.product_id!==payload.productId||v.order.email!==payload.email)return res.status(403).end('Purchase verification failed.');
  const i=Number(req.query.file??0);
  if(!Number.isSafeInteger(i)||i<0||i>=v.order.blob_pathnames.length)return res.status(404).end('File not found.');
  const pathname=v.order.blob_pathnames[i];
  const result=await get(pathname,{access:'private'});
  if(!result||result.statusCode!==200)return res.status(404).end('File not found.');
  const filename=pathname.split('/').pop().replace(/["\r\n\\]/g,'');
  res.setHeader('Content-Type',result.blob.contentType||'application/octet-stream');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  Readable.fromWeb(result.stream).on('error',e=>{console.error('Blob stream error',e.message);res.destroy(e)}).pipe(res);
 }catch(e){console.error('Download error:',e.message);if(!res.headersSent)res.status(503).end('Download temporarily unavailable.');}
};
