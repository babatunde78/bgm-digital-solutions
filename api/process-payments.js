'use strict';
const { endpoint, equal, HttpError } = require('../lib/http');
const { run } = require('../lib/worker');
module.exports = endpoint('GET', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equal(req.headers.authorization, `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized');
  const counts = await run();
  console.info(JSON.stringify({ event: 'payment_worker', ...counts }));
  return res.status(200).json(counts);
});
