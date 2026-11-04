'use strict';
const { query, rpc, orderByReference } = require('./db');
const { confirm } = require('./orders');
const { request } = require('./paystack');
const { mode, siteUrl, emailEnabled } = require('./config');
const { sign } = require('./tokens');
const { hash } = require('./http');

async function processEvent(event) {
  let ref = event.reference;
  if (ref.startsWith('transaction:')) {
    const transaction = await request(`transaction/${encodeURIComponent(ref.slice(12))}`);
    if (transaction.domain !== event.environment) throw new Error('Event environment mismatch');
    ref = transaction.reference;
  }
  const order = await orderByReference(ref);
  if (!order || order.environment !== event.environment) throw new Error('Unknown transaction requires review');
  if (event.event_type === 'charge.success') {
    const updated = await confirm(order);
    if (updated.status !== 'paid' && !updated.revoked_at) throw new Error('Payment still pending');
  } else if (event.event_type === 'charge.dispute.resolve') {
    // Resolution must be reviewed: not every outcome permits restored access.
    await query(`store_events?id=eq.${event.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'review', last_error: 'dispute_resolution_requires_review' }) });
    return;
  } else {
    await query(`store_orders?id=eq.${order.id}&revoked_at=is.null`, { method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString(), revocation_reason: event.event_type }) });
  }
  await query(`store_events?id=eq.${event.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'done', last_error: null }) });
}

async function sendEmail(job) {
  const rows = await query(`store_orders?id=eq.${job.order_id}&select=*&limit=1`);
  const order = rows[0];
  if (!order || order.environment !== mode() || order.status !== 'paid' || order.revoked_at) {
    await query(`store_email_outbox?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'review', last_error: 'order_unavailable' }) });
    return;
  }
  // Stable claims make retried email requests identical for the provider's idempotency key.
  const issuedAt = Math.floor(new Date(job.access_issued_at || job.created_at).getTime() / 1000);
  const token = sign({ v: 1, purpose: 'recovery', order: order.id, jti: job.id, iat: issuedAt, exp: issuedAt + 604800 });
  if (issuedAt + 604800 <= Date.now() / 1000) throw new Error('Email access token expired; review required');
  await query('store_recovery_tokens?on_conflict=token_hash', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ token_hash: hash(token), order_id: order.id, expires_at: new Date((issuedAt + 604800) * 1000).toISOString() })
  });
  const url = `${siteUrl()}/payment-success.html#access=${encodeURIComponent(token)}`;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Email not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `store/${job.id}` },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM, to: [order.email],
      subject: job.kind === 'receipt' ? 'Your BGM purchase is ready' : 'Access your BGM purchase',
      text: `Thank you for purchasing ${order.product_name}.\n\nPayment reference: ${order.reference}\n\nAccess your files: ${url}\n\nThis access link expires in 7 days and can be used once to open a purchase session. Request a new link from ${siteUrl()}/payment-success.html if needed.\n\nQuestions? Contact ${process.env.SUPPORT_EMAIL || 'badmurs0@gmail.com'} or WhatsApp +234 903 192 1294. Never send card details or passwords.`
    })
  });
  if (!response.ok) throw new Error('Email provider unavailable');
  await query(`store_email_outbox?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'sent', sent_at: new Date().toISOString(), last_error: null }) });
}

async function retry(table, job) {
  const review = job.attempts >= 12;
  await query(`${table}?id=eq.${job.id}`, {
    method: 'PATCH', body: JSON.stringify({ state: review ? 'review' : 'pending', last_error: 'processing_failed', next_attempt: new Date(Date.now() + Math.min(86400000, 60000 * 2 ** Math.min(job.attempts, 10))).toISOString() })
  });
}

async function run() {
  const deadline = Date.now() + 135000;
  const environment = mode();
  const counts = { events: 0, orders: 0, emails: 0, errors: 0 };
  // Bound work to fit the function deadline; each external request also has its own timeout.
  const events = await rpc('store_claim_work', { p_kind: 'events', p_environment: environment, p_limit: 4 });
  await Promise.all(events.map(async job => {
    try { await processEvent(job); counts.events++; } catch { counts.errors++; await retry('store_events', job); }
  }));
  const orders = await rpc('store_claim_work', { p_kind: 'orders', p_environment: environment, p_limit: 4 });
  await Promise.all(orders.map(async order => {
    try { await confirm(order); counts.orders++; } catch { counts.errors++; }
  }));
  const emails = emailEnabled() ? await rpc('store_claim_work', { p_kind: 'emails', p_environment: environment, p_limit: 4 }) : [];
  // Resend's default rate limit is low; send sequentially and let retries handle throttling.
  for (const job of emails) {
    if (Date.now() > deadline - 45000) break; // Unprocessed leases become available on the next scheduled run.
    try { await sendEmail(job); counts.emails++; } catch { counts.errors++; await retry('store_email_outbox', job); }
  }
  await rpc('store_maintenance', {});
  return counts;
}
module.exports = { run, processEvent, sendEmail };
