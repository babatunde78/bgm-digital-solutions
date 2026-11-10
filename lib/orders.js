'use strict';
const { rpc, query, orderByReference } = require('./db');
const paystack = require('./paystack');
const { mode, emailEnabled } = require('./config');
const { sign } = require('./tokens');
const { HttpError } = require('./http');
const { getProduct } = require('./catalog');
const CAMPUS_EXCEL_PRODUCTS = new Set(['campus-bursary-package-a', 'campus-bursary-package-b', 'campus-bursary-full-excel']);
const CAMPUS_DESKTOP_PRODUCT = 'campus-bursary-documents';
const CAMPUS_DESKTOP_ASSET = 'campus-bursary-documents/v0.1.1/campus-bursary-documents-setup-0.1.1.exe';

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
async function publicOrder(order) {
  if (order.revoked_at) throw new HttpError(403, 'Access to this order is suspended. Please contact support.', 'access_revoked');
  if (order.status !== 'paid') return { verified: false, status: 'pending', reference: order.reference, emailEnabled: emailEnabled() };
  const now = Math.floor(Date.now() / 1000);
  const downloads = order.assets.map((path, file) => ({
    name: path.split('/').pop(),
    url: `/api/download?token=${encodeURIComponent(sign({ v: 1, purpose: 'download', order: order.id, file, iat: now, exp: now + 600 }))}`
  }));
  if (CAMPUS_EXCEL_PRODUCTS.has(order.product_id)) {
    const desktop = await getProduct(CAMPUS_DESKTOP_PRODUCT);
    if (desktop?.available && desktop.assets.includes(CAMPUS_DESKTOP_ASSET)) {
      downloads.push({
        name: CAMPUS_DESKTOP_ASSET.split('/').pop(),
        url: `/api/download?token=${encodeURIComponent(sign({ v: 1, purpose: 'campus-desktop-upgrade', order: order.id, iat: now, exp: now + 600 }))}`
      });
    }
  }
  return {
    verified: true, status: 'paid', reference: order.reference, emailEnabled: emailEnabled(),
    product: { id: order.product_id, name: order.product_name }, expiresInSeconds: 600,
    downloads
  };
}
module.exports = { confirm, authorizedOrder, publicOrder };
