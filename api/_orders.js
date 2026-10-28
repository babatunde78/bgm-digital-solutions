const { query } = require('./_catalog');
const fields = 'reference,product_id,product_name,email,amount,currency,blob_pathnames,status,payment_mode,created_at';
function paymentMode() {
 const key = process.env.PAYSTACK_SECRET_KEY || '';
 if (key.startsWith('sk_test_')) return 'test';
 if (key.startsWith('sk_live_')) return 'live';
 throw Error('Paystack key missing or unrecognized');
}
async function getOrder(reference) {
 const rows = await query('bgm_orders?reference=eq.' + encodeURIComponent(reference) + '&select=' + fields + '&limit=1');
 return rows[0] || null;
}
async function createOrder(o) {
 const rows = await query('bgm_orders', { method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(o) });
 return rows[0];
}
async function markPaid(reference) {
 // Conditional, idempotent transition. The record is immutable except for status.
 await query('bgm_orders?reference=eq.' + encodeURIComponent(reference) + '&status=eq.pending', {
  method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'paid'})
 });
}
module.exports={getOrder,createOrder,markPaid,paymentMode};
