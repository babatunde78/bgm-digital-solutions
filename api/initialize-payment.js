'use strict';
const storage = require('../lib/storage');
const { endpoint, sameOrigin, body, email, requireSession, HttpError } = require('../lib/http');
const { rpc, query, rateLimit } = require('../lib/db');
const { getProduct } = require('../lib/catalog');
const config = require('../lib/config');
const paystack = require('../lib/paystack');

module.exports = endpoint('POST', async (req, res) => {
  sameOrigin(req);
  const sessionHash = requireSession(req);
  if (!config.ready()) throw new HttpError(503, 'Checkout is temporarily unavailable. Please contact us with questions.', 'checkout_unavailable');
  const input = body(req);
  const buyerEmail = email(input.email);
  if (typeof input.productId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.productId) ||
      typeof input.currency !== 'string' || !config.currencies().includes(input.currency) ||
      typeof input.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new HttpError(400, 'Please select a valid product and currency.');
  }
  await rateLimit(req, 'checkout', 10);
  const existing = await query(`store_orders?environment=eq.${config.mode()}&idempotency_key=eq.${input.idempotencyKey}&select=*&limit=1`);
  let order = existing[0];
  if (order) {
    if (order.session_hash !== sessionHash || order.email !== buyerEmail || order.product_id !== input.productId || order.currency !== input.currency) {
      throw new HttpError(409, 'This checkout belongs to another purchase. Please reopen checkout.');
    }
  } else {
    const product = await getProduct(input.productId);
    if (!product?.available || !Object.hasOwn(product.amounts, input.currency)) throw new HttpError(400, 'This product or currency is not available.', 'product_unavailable');
    await Promise.all(product.assets.map(async path => {
      const metadata = await storage.head(path);
      if (!new URL(metadata.url).hostname.endsWith('.private.blob.vercel-storage.com') || metadata.size <= 0) {
        throw new HttpError(503, 'Private delivery is not ready for this product.', 'delivery_unavailable');
      }
    }));
    order = await rpc('store_create_order', {
      p_key: input.idempotencyKey, p_session: sessionHash, p_email: buyerEmail, p_environment: config.mode(),
      p_product: product.id, p_name: product.name, p_amount: product.amounts[input.currency], p_currency: input.currency, p_assets: product.assets
    });
  }
  if (order.revoked_at) throw new HttpError(403, 'This order is unavailable. Please contact support.');
  if (order.status === 'paid') return res.status(200).json({ reference: order.reference, authorization_url: `${config.siteUrl()}/payment-success.html?reference=${encodeURIComponent(order.reference)}` });
  if (order.authorization_url) return res.status(200).json({ reference: order.reference, authorization_url: order.authorization_url });
  if (!await rpc('store_claim_initialization', { p_order: order.id })) {
    return res.status(202).json({ status: 'initializing', reference: order.reference, error: 'This checkout is being resolved. Wait and retry this same purchase. Contact support with this reference if it remains unavailable.' });
  }
  const data = await paystack.request('transaction/initialize', {
    method: 'POST', body: JSON.stringify({
      reference: order.reference, email: order.email, amount: String(order.amount), currency: order.currency,
      callback_url: `${config.siteUrl()}/payment-success.html`,
      metadata: { order_id: order.id, product_id: order.product_id, delivery: 'bgm-private-blob' }
    })
  });
  let url; try { url = new URL(data.authorization_url); } catch { throw new HttpError(502, 'Payment provider returned an invalid checkout link.'); }
  if (data.reference !== order.reference || url.protocol !== 'https:' || url.hostname !== 'checkout.paystack.com' || url.username || url.password) {
    throw new HttpError(502, 'Payment provider returned unexpected checkout details.');
  }
  await query(`store_orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ authorization_url: url.href }) });
  return res.status(200).json({ authorization_url: url.href, reference: order.reference });
});
