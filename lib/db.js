'use strict';
const { HttpError } = require('./http');

async function query(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Database configuration missing');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers }
  });
  if (!response.ok) throw new HttpError(503, 'Order service temporarily unavailable.', 'database_unavailable');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function rpc(name, parameters) { return query(`rpc/${name}`, { method: 'POST', body: JSON.stringify(parameters) }); }
async function orderByReference(reference) {
  const rows = await query(`store_orders?reference=eq.${encodeURIComponent(reference)}&select=*&limit=1`);
  return rows[0] || null;
}
async function rateLimit(req, scope, limit = 12) {
  const crypto = require('node:crypto');
  if (!process.env.DELIVERY_SECRET) throw new Error('Rate limit key missing');
  // Vercel overwrites x-vercel-forwarded-for; do not trust arbitrary x-forwarded-for.
  const ip = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
  const key = crypto.createHmac('sha256', process.env.DELIVERY_SECRET).update(`${scope}:${ip || 'unknown'}`).digest('hex');
  if (!await rpc('store_rate_limit', { p_key: key, p_limit: limit })) throw new HttpError(429, 'Too many requests. Please try again shortly.', 'rate_limited');
}
module.exports = { query, rpc, orderByReference, rateLimit };
