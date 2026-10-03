const crypto = require('crypto');
const PRODUCTS = require('./_products');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(500).end();
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const hash = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  const signature = req.headers['x-paystack-signature'];
  if (!signature || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(signature)))) return res.status(401).end();
  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (event.event === 'charge.success') {
    const d = event.data || {};
    let metadata = d.metadata || {};
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch {} }
    const product = PRODUCTS[metadata.product_id];
    if (product && d.status === 'success' && d.amount === product.amount && d.currency === product.currency) {
      // PRODUCTION TODO: write reference to a database with a UNIQUE constraint, then fulfill once.
      // Never expose a permanent private download URL here.
    }
  }
  return res.status(200).json({received:true});
}
