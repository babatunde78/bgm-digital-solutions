const PRODUCTS = require('./_products');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const reference = String(req.query.reference || '');
  if (!/^[A-Za-z0-9.=-]+$/.test(reference)) return res.status(400).json({error:'Invalid reference.'});
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});
    const result = await response.json();
    const d = result.data || {};
    let metadata = d.metadata || {};
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch {} }
    const product = PRODUCTS[metadata.product_id];
    const valid = Boolean(response.ok && result.status && d.status === 'success' && product && d.amount === product.amount && d.currency === product.currency);
    if (!valid) return res.status(400).json({verified:false,error:'Payment could not be verified for this product.'});
    // Add idempotent fulfillment (database/email/signed download) here before production digital delivery.
    return res.status(200).json({verified:true,reference:d.reference,product:{id:metadata.product_id,name:product.name},customerEmail:d.customer?.email || ''});
  } catch(e) { return res.status(500).json({verified:false,error:'Verification service unavailable.'}); }
}
