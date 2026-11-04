'use strict';
const { endpoint, sameOrigin, body, email, reference, HttpError } = require('../lib/http');
const { rpc, rateLimit } = require('../lib/db');
const { mode, emailEnabled } = require('../lib/config');
module.exports = endpoint('POST', async (req, res) => {
  sameOrigin(req);
  if (!emailEnabled()) throw new HttpError(503, 'Email recovery is paused. Please contact us on WhatsApp with your payment reference.', 'email_paused');
  const input = body(req);
  const buyerEmail = email(input.email), ref = reference(input.reference);
  await rateLimit(req, 'recovery', 3);
  await rpc('store_queue_recovery', { p_reference: ref, p_email: buyerEmail, p_environment: mode() });
  return res.status(202).json({ message: 'If these details match a completed purchase, an access email will arrive shortly. Check your spam folder too.' });
});
