const PRODUCTS = require('./_products');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const { email, productId } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'A valid email address is required.'});
    const product = PRODUCTS[productId];
    if (!product || !product.enabled || !Number.isInteger(product.amount) || product.amount < 100) return res.status(400).json({error:'This product is not available for payment yet.'});
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({error:'Payment service is not configured.'});
    const origin = process.env.SITE_URL || `https://${req.headers.host}`;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method:'POST',
      headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({email,amount:String(product.amount),currency:product.currency,callback_url:`${origin}/payment-success.html`,metadata:JSON.stringify({product_id:productId,product_name:product.name})})
    });
    const data = await response.json();
    if (!response.ok || !data.status) return res.status(502).json({error:data.message || 'Unable to initialize payment.'});
    return res.status(200).json({authorization_url:data.data.authorization_url,reference:data.data.reference});
  } catch (e) { return res.status(500).json({error:'Unable to initialize payment.'}); }
}
