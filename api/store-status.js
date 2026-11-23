'use strict';

const { randomUUID } = require('node:crypto');
const { body, endpoint, HttpError, sameOrigin } = require('../lib/http');
const { emailEnabled, storefrontAnalytics } = require('../lib/config');

const captureEvent = endpoint('POST', async (req, res) => {
  sameOrigin(req);
  const { event, productId } = body(req);
  const productEvent = event === 'checkout_started' || event === 'product_viewed';
  const payrollSample = event === 'payroll_sample_opened' && productId === 'nigeria-small-employer-payroll';
  if (typeof productId !== 'string' || !/^[a-z0-9-]{1,100}$/.test(productId) ||
      (!productEvent && !payrollSample)) {
    throw new HttpError(400, 'Invalid storefront event.', 'invalid_storefront_event');
  }

  const analytics = storefrontAnalytics();
  if (!analytics) return res.status(204).end();

  const response = await fetch(analytics.host + '/i/v0/e/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: analytics.token,
      event,
      distinct_id: randomUUID(),
      properties: { product_id: productId, $process_person_profile: false }
    }),
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new HttpError(502, 'Could not record the storefront event.', 'analytics_unavailable');
  return res.status(204).end();
});

const getStatus = endpoint('GET', async (req, res) => res.status(200).json({ emailEnabled: emailEnabled() }));
module.exports = (req, res) => req.method === 'POST' ? captureEvent(req, res) : getStatus(req, res);
