const LEGACY = require('./_products');
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
function enabled(){return Boolean(URL && KEY)}
async function query(path,options={}){
 if(!enabled()) throw Error('Product database is not configured');
 const r=await fetch(URL.replace(/\/$/,'')+'/rest/v1/'+path,{...options,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(options.headers||{})}});
 const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
 if(!r.ok)throw Error('Database request failed: HTTP '+r.status);
 return data;
}
function normal(p){return {name:p.name,amounts:p.amounts||{},enabled:p.status==='published',deliveryReady:Boolean(p.delivery_ready),blobPathnames:p.blob_pathnames||[]}}
async function getProduct(id){if(enabled()) {const rows=await query('products?id=eq.'+encodeURIComponent(id)+'&select=*');if(rows.length)return normal(rows[0]);}return LEGACY[id]||null}
async function getPublicProducts(){if(!enabled())return [];
 const rows=await query('products?status=eq.published&select=id,name,category,short,description,features,amounts,delivery_ready,channels,blob_pathnames&order=created_at.desc');
 return rows.map(p=>({id:p.id,name:p.name,category:p.category,short:p.short,description:p.description,features:p.features||[],price:Object.entries(p.amounts||{}).map(([c,n])=>c==='NGN'?'₦'+(n/100).toLocaleString('en-NG'):c+' '+(n/100).toFixed(2)).join(' / '),paymentEnabled:Boolean(p.delivery_ready&&p.blob_pathnames?.length),status:'live',channels:p.channels||{}}));
}
module.exports={enabled,query,getProduct,getPublicProducts};
