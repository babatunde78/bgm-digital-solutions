'use strict';
const { endpoint, sameOrigin, body, setSession, hash, HttpError } = require('../lib/http');
const { rpc, rateLimit, orderByReference } = require('../lib/db');
const { verify } = require('../lib/tokens');
const { mode } = require('../lib/config');
module.exports = endpoint('POST', async (req, res) => {
  sameOrigin(req);
  const input = body(req);
  const claims = verify(input.token, 'recovery');
  if (!claims) throw new HttpError(401, 'This access link is invalid or expired. Request a new email.');
  await rateLimit(req, 'exchange', 8);
  const sessionHash = hash(setSession(req, res));
  const ref = await rpc('store_exchange_recovery', { p_hash: hash(input.token), p_session: sessionHash, p_environment: mode() });
  if (!ref) throw new HttpError(401, 'This access link has already been used or expired. Request a new email.');
  const order = await orderByReference(ref);
  if (order.environment !== mode()) throw new HttpError(403, 'Wrong store environment.');
  return res.status(200).json({ reference: ref });
});
