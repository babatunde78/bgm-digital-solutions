const crypto=require('node:crypto');
const {query,enabled}=require('./_catalog');
const allowed=['amazon','gumroad','selar','payhip'];
const validUrl=(s)=>{try{const u=new URL(s);return u.protocol==='https:'&&['amazon.com','amazon.co.uk','amazon.ca','amazon.de','amazon.fr','amazon.com.au','amazon.co.jp','gumroad.com','selar.co','payhip.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d))}catch{return false}};
function auth(req){const secret=process.env.BGM_ADMIN_SECRET||'';const supplied=(req.headers.authorization||'').replace(/^Bearer /i,'');return secret.length>=32&&supplied.length===secret.length&&crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(supplied))}
function validate(p){if(!p||typeof p!=='object')throw Error('Product required');
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id||''))throw Error('Invalid product ID');
 if(!p.name||String(p.name).length>180)throw Error('Invalid name');
 if(!['draft','published','archived'].includes(p.status))throw Error('Invalid status');
 if(!p.category||String(p.category).length>100)throw Error('Invalid category');
 if(!p.amounts||typeof p.amounts!=='object'||!Object.keys(p.amounts).every(k=>/^[A-Z]{3}$/.test(k)&&Number.isSafeInteger(p.amounts[k])&&p.amounts[k]>=100))throw Error('Prices must be positive integer currency subunits');
 if(!Array.isArray(p.blob_pathnames)||!p.blob_pathnames.every(x=>typeof x==='string'&&x.length<=400&&!x.includes('..')))throw Error('Invalid file paths');
 if(!Array.isArray(p.features)||!p.features.every(x=>typeof x==='string'))throw Error('Invalid features');
 const channels=p.channels||{};if(Object.keys(channels).some(k=>!allowed.includes(k)||!validUrl(channels[k])))throw Error('Invalid marketplace URL');
 if(p.status==='published'&&p.delivery_ready&&(!p.blob_pathnames.length||!Object.keys(p.amounts).length))throw Error('Published direct-download product needs a file and price');
 return {id:p.id,name:String(p.name),category:p.category,short:String(p.short||''),description:String(p.description||''),features:p.features,amounts:p.amounts,status:p.status,delivery_ready:Boolean(p.delivery_ready),blob_pathnames:p.blob_pathnames,channels};
}
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');if(!auth(req))return res.status(401).json({error:'Unauthorized'});if(!enabled())return res.status(503).json({error:'Configure Supabase environment variables'});
 try{if(req.method==='GET')return res.status(200).json({products:await query('products?select=*&order=created_at.desc&limit=500')});
 if(req.method==='POST'){const list=Array.isArray(req.body?.products)?req.body.products:[req.body];if(!list.length||list.length>100)return res.status(400).json({error:'Batch must contain 1–100 products'});
 const values=list.map(validate);const result=await query('products?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(values)});return res.status(200).json({saved:result.length})}
 return res.status(405).json({error:'Method not allowed'})}catch(e){console.error('Admin products error',e.message);return res.status(400).json({error:e.message.startsWith('Database')?'Database request failed':e.message})}};
