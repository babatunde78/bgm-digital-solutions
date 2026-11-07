'use strict';
const { rpc, query, orderByReference } = require('./db');
const paystack = require('./paystack');
const { mode, emailEnabled } = require('./config');
const { sign } = require('./tokens');
const { HttpError } = require('./http');

async function confirm(order) {
  if (order.environment !== mode()) throw new HttpError(409, 'Payment belongs to a different store environment.');
  if (order.status === 'paid' || order.revoked_at) return order;
  const data = await paystack.verify(order.reference);
  if (data.status !== 'success') {
    if (data.reference !== order.reference || data.domain !== order.environment) throw new HttpError(409, 'Payment details do not match this order.', 'payment_mismatch');
    return order;
  }
  if (!paystack.matches(order, data)) throw new HttpError(409, 'Payment details do not match this order. Contact support.', 'payment_mismatch');
  return rpc('store_confirm_order', { p_order: order.id, p_transaction: String(data.id) });
}
async function authorizedOrder(reference, sessionHash) {
  const order = await orderByReference(reference);
  if (!order || order.environment !== mode()) throw new HttpError(404, 'Purchase not found.');
  if (order.session_hash !== sessionHash || Date.now() - new Date(order.created_at).getTime() > 30 * 86400000) {
    const rows = await query(`store_order_sessions?order_id=eq.${order.id}&session_hash=eq.${sessionHash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=order_id&limit=1`);
    if (!rows.length) throw new HttpError(401, 'Reopen your purchase in the original browser or contact BGM support to recover access.', 'recovery_required');
  }
  return order;
}
function publicOrder(order) {
  if (order.revoked_at) throw new HttpError(403, 'Access to this order is suspended. Please contact support.', 'access_revoked');
  if (order.status !== 'paid') return { verified: false, status: 'pending', reference: order.reference, emailEnabled: emailEnabled() };
  const now = Math.floor(Date.now() / 1000);
  return {
    verified: true, status: 'paid', reference: order.reference, emailEnabled: emailEnabled(),
    product: { id: order.product_id, name: order.product_name }, expiresInSeconds: 600,
    downloads: order.assets.map((path, file) => ({
      name: path.split('/').pop(),
      url: `/api/download?token=${encodeURIComponent(sign({ v: 1, purpose: 'download', order: order.id, file, iat: now, exp: now + 600 }))}`
    }))
  };
}
module.exports = { confirm, authorizedOrder, publicOrder };
