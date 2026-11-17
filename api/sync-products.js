'use strict';
const { endpoint, equal, body, HttpError } = require('../lib/http');
const { importProducts } = require('../lib/product-import');
module.exports = endpoint('POST', async (req, res) => {
  if (!process.env.CRON_SECRET || !equal(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) throw new HttpError(401, 'Unauthorized');
  const input = body(req);
  return res.status(200).json(await importProducts(input.ids));
});
