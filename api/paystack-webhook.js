'use strict';
const { endpoint, HttpError } = require('../lib/http');
const { query } = require('../lib/db');
const { mode } = require('../lib/config');
const { rawBody, validSignature, eventRecord } = require('../lib/webhooks');
module.exports = endpoint('POST', async (req, res) => {
  const raw = await rawBody(req);
  if (!validSignature(raw, req.headers)) throw new HttpError(401, 'Invalid signature');
  let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
  const record = eventRecord(event);
  if (record) {
    if (record.environment !== mode()) throw new HttpError(400, 'Wrong payment environment');
    await query('store_events?on_conflict=event_key', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(record)
    });
  }
  return res.status(200).json({ received: true });
});
