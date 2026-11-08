'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPublicProducts } = require('../lib/catalog');

test('published Campus products receive the dated USD reference from the central price book', async () => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
  global.fetch = async () => new Response(JSON.stringify([{
    id: 'campus-bursary-package-a', name: 'Campus A', category: 'Business Software', short: 'Pilot',
    description: 'Synthetic catalogue fixture.', features: [], amounts: { NGN: 80000000 },
    status: 'published', delivery_ready: true, blob_pathnames: ['campus-bursary/v0.2.1/package-a.zip']
  }]));
  try {
    const [product] = await getPublicProducts();
    assert.equal(product.usdReference, '593.42');
    assert.equal(product.usdRateDate, '2026-11-07');
    assert.deepEqual(product.amounts, { NGN: 80000000 });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
