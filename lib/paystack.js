'use strict';
const { mode } = require('./config');
const { HttpError } = require('./http');

async function request(path, options = {}) {
  mode();
  const response = await fetch(`https://api.paystack.co/${path}`, {
    ...options, signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }
  });
  let result;
  try { result = await response.json(); } catch { throw new HttpError(502, 'Payment provider returned an invalid response.', 'provider_invalid'); }
  if (!response.ok || result.status !== true) throw new HttpError(502, 'Payment provider is temporarily unavailable. Please retry this same checkout.', 'provider_unavailable');
  return result.data;
}
function metadata(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function matches(order, data) {
  const meta = metadata(data.metadata);
  return data.status === 'success' && data.reference === order.reference && data.currency === order.currency &&
    data.amount === order.amount && data.domain === order.environment &&
    String(data.customer?.email || '').toLowerCase() === order.email &&
    meta.order_id === order.id && meta.product_id === order.product_id &&
    (typeof data.id === 'number' && Number.isSafeInteger(data.id) || typeof data.id === 'string' && /^\d+$/.test(data.id));
}
async function verify(reference) { return request(`transaction/verify/${encodeURIComponent(reference)}`); }
module.exports = { request, verify, matches, metadata };
