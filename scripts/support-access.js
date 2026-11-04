'use strict';
// Operator-only: run locally with .env.local after verifying the customer's identity.
const crypto = require('node:crypto');
const { orderByReference, query } = require('../lib/db');
const { reference, hash } = require('../lib/http');
const { mode, siteUrl } = require('../lib/config');
const { sign } = require('../lib/tokens');
async function main() {
  const ref = reference(process.argv[2]);
  const order = await orderByReference(ref);
  if (!order || order.environment !== mode() || order.status !== 'paid' || order.revoked_at) throw new Error('A paid, active order in this environment is required.');
  const now = Math.floor(Date.now()/1000);
  const token = sign({ v:1, purpose:'recovery', order:order.id, jti:crypto.randomUUID(), iat:now, exp:now+3600 });
  await query('store_recovery_tokens', { method:'POST', body:JSON.stringify({ token_hash:hash(token), order_id:order.id, expires_at:new Date((now+3600)*1000).toISOString() }) });
  console.log('Share this single-use, one-hour access link privately with the verified buyer only. It is a bearer credential:');
  console.log(`${siteUrl()}/payment-success.html#access=${encodeURIComponent(token)}`);
}
main().catch(()=>{ console.error('Could not create support access. Check the order, configuration and environment.');process.exitCode=1 });
