'use strict';
const { endpoint, equal, HttpError } = require('../lib/http');
const { run } = require('../lib/worker');
const { readiness } = require('../lib/readiness');
const { inventory } = require('../lib/inventory');
module.exports = endpoint('GET', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equal(req.headers.authorization, `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized');
  if (req.query?.check === 'readiness') return res.status(200).json(await readiness());
  if (req.query?.check === 'inventory') return res.status(200).json(await inventory());
  const counts = await run();
  console.info(JSON.stringify({ event: 'payment_worker', ...counts }));
  return res.status(200).json(counts);
});
