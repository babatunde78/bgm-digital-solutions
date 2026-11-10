'use strict';
const { endpoint, requireSession, reference } = require('../lib/http');
const { rateLimit } = require('../lib/db');
const { authorizedOrder, confirm, publicOrder } = require('../lib/orders');
module.exports = endpoint('GET', async (req, res) => {
  const sessionHash = requireSession(req), ref = reference(req.query.reference);
  await rateLimit(req, 'verify', 30);
  const order = await authorizedOrder(ref, sessionHash);
  return res.status(200).json(await publicOrder(await confirm(order)));
});
