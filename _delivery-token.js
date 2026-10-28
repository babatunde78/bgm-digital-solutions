const crypto = require('crypto');
function secret(){
  if (!process.env.DELIVERY_SECRET || process.env.DELIVERY_SECRET.length < 32) throw new Error('DELIVERY_SECRET is not configured.');
  return process.env.DELIVERY_SECRET;
}
function b64url(v){ return Buffer.from(v).toString('base64url'); }
function sign(payload){
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token){
  const [body,sig] = String(token||'').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
  let payload; try { payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
module.exports={sign,verify};
