'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./http');

async function rawBody(req) {
  // Vercel exposes body as a lazy JSON getter and restores the original byte stream.
  // Never invoke that getter: inspecting its data descriptor is safe for local adapters/tests.
  const supplied = Object.getOwnPropertyDescriptor(req, 'body');
  const value = supplied && Object.hasOwn(supplied, 'value') ? supplied.value : undefined;
  if (Buffer.isBuffer(value)) {
    if (value.length > 262144) throw new HttpError(413, 'Webhook too large');
    return value;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 262144) throw new HttpError(413, 'Webhook too large');
    return Buffer.from(value);
  }
  if (value !== undefined && value !== null) throw new HttpError(400, 'Raw webhook body required');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > 262144) throw new HttpError(413, 'Webhook too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function validSignature(raw, headers, now = Math.floor(Date.now() / 1000)) {
  const matches = (expected, signature) => typeof signature === 'string' && /^[0-9a-f]{128}$/.test(signature) &&
    crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  if (process.env.PAYSTACK_WEBHOOK_MODE === 'modern') {
    const header = headers['paystack-signature'];
    if (typeof header !== 'string' || header.length > 4096) return false;
    let timestamp; const signatures = [];
    for (const part of header.split(',')) {
      const i = part.indexOf('='); if (i < 0) continue;
      const key = part.slice(0, i).trim(), value = part.slice(i + 1).trim();
      if (key === 't') { if (timestamp !== undefined || !/^\d+$/.test(value)) return false; timestamp = Number(value); }
      if (key === 'v1') { const colon = value.indexOf(':'); if (colon > 0) signatures.push(value.slice(colon + 1)); }
    }
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
    const secrets = (process.env.PAYSTACK_WEBHOOK_SECRETS || '').split(',').map(s => s.trim()).filter(s => s.startsWith('whsec_'));
    return secrets.some(secret => {
      const expected = crypto.createHmac('sha512', secret).update(`${timestamp}.`).update(raw).digest();
      return signatures.some(signature => matches(expected, signature));
    });
  }
  if (process.env.PAYSTACK_WEBHOOK_MODE !== 'legacy' || !process.env.PAYSTACK_SECRET_KEY) return false;
  return matches(crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest(), headers['x-paystack-signature']);
}
function eventRecord(event) {
  if (!event || typeof event.event !== 'string' || !event.data || typeof event.data !== 'object') throw new HttpError(400, 'Invalid event');
  const type = event.event, d = event.data;
  if (type !== 'charge.success' && !['refund.processed','charge.dispute.create','charge.dispute.resolve'].includes(type)) return null;
  const transaction = d.transaction;
  const ref = type === 'charge.success' ? d.reference : typeof transaction === 'object' ? transaction?.reference : d.transaction_reference;
  const transactionId = type === 'charge.success' ? d.id : typeof transaction === 'object' ? transaction?.id : transaction;
  if (!ref && !transactionId) throw new HttpError(400, 'Missing event transaction');
  if (!['test','live'].includes(d.domain)) throw new HttpError(400, 'Missing event environment');
  const id = d.id ?? d.refund_reference ?? ref ?? transactionId;
  return { event_key: `${d.domain}:${type}:${id}`, event_type: type, reference: String(ref || `transaction:${transactionId}`), environment: d.domain };
}
module.exports = { rawBody, validSignature, eventRecord };
