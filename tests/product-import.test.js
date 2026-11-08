'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
const { importProducts } = require('../lib/product-import');
const originalFetch = global.fetch;
beforeEach(() => { process.env.PAYSTACK_CURRENCIES = 'NGN'; });
afterEach(() => { global.fetch = originalFetch; });
function reply(value) { return new Response(JSON.stringify(value)); }
function mockStorage(t) {
  t.mock.method(storage, 'head', async path => ({ url: `https://test.private.blob.vercel-storage.com/${path}`, size: 100 }));
  t.mock.method(storage, 'get', async () => ({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([80, 75])); controller.close(); } }) }));
}
test('import preserves existing product edits and uses the current guide asset in the bundle', async t => {
  process.env.SUPABASE_URL = 'https://db.example'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
  mockStorage(t);
  const first = { id: '500-business-prompts', name: 'Edited title', status: 'published', amounts: { NGN: 800000 }, delivery_ready: true, blob_pathnames: ['current/prompts-v2.zip'] };
  let written;
  global.fetch = async (address, options) => {
    if (options.method === 'POST') { written = JSON.parse(options.body); return reply(written); }
    return reply([first]);
  };
  const ids = require('../lib/product-import.json').map(product => product.id);
  const result = await importProducts(ids);
  assert.equal(result.imported.length, 9);
  assert.equal(written.some(product => product.id === first.id), false);
  const bundle = written.find(product => product.id === 'five-guide-bundle');
  assert.equal(bundle.blob_pathnames.length, 5); assert.equal(bundle.blob_pathnames[0], 'current/prompts-v2.zip');
  assert.equal(result.checkedFiles, 9);
  assert.equal(written.find(product => product.id === 'ai-side-hustles').amounts.NGN, 1200000);
  const campusA = written.find(product => product.id === 'campus-bursary-package-a');
  const campusB = written.find(product => product.id === 'campus-bursary-package-b');
  const fullExcel = written.find(product => product.id === 'campus-bursary-full-excel');
  assert.equal(campusA.status, 'draft');
  assert.equal(campusA.amounts.NGN, 80000000);
  assert.equal(campusB.amounts.NGN, 120000000);
  assert.equal(fullExcel.amounts.NGN, 160000000);
  assert.equal(campusA.campusPackage, undefined);
});
test('missing private file prevents all catalogue writes', async t => {
  let writes = 0;
  global.fetch = async (address, options) => { if (options.method === 'POST') writes++; return reply([]); };
  t.mock.method(storage, 'head', async () => { throw new Error('File missing'); });
  await assert.rejects(importProducts(['ai-side-hustles']), /File missing/);
  assert.equal(writes, 0);
});
test('invalid IDs and missing bundle constituents fail safely', async () => {
  await assert.rejects(importProducts(['unknown']), /known product IDs/);
  global.fetch = async () => reply([]);
  await assert.rejects(importProducts(['five-guide-bundle']), /all five/);
});
test('repeated import leaves existing drafts and prices unchanged', async () => {
  let writes = 0;
  global.fetch = async (address, options) => { if (options.method === 'POST') writes++; return reply([{ id: 'ai-side-hustles', status: 'draft', amounts: { NGN: 2500000 } }]); };
  const result = await importProducts(['ai-side-hustles']);
  assert.equal(writes, 0); assert.equal(result.preserved[0].status, 'draft');
});
test('Campus product copy explains practical differences without unsupported superiority claims', () => {
  const products = require('../lib/product-import.json');
  const a = products.find(product => product.id === 'campus-bursary-package-a');
  const b = products.find(product => product.id === 'campus-bursary-package-b');
  const full = products.find(product => product.id === 'campus-bursary-full-excel');
  assert.match(a.name, /Student Fees & Treasury Control/);
  assert.match(a.description, /separate linked schedules/i);
  assert.match(a.description, /does not connect to a bank/i);
  assert.match(b.name, /Budget-to-Payment Control/);
  assert.match(b.description, /commitment/i);
  assert.match(b.description, /not a statutory payroll engine/i);
  assert.match(full.name, /Complete Bursary Control Suite/);
  assert.match(full.description, /manual journal/i);
  assert.match(full.description, /does not automatically post all operational schedules/i);
  for (const product of [a, b, full]) {
    assert.equal(product.status, 'draft');
    assert.doesNotMatch(`${product.name} ${product.short} ${product.description}`, /market-leading|better than competitors|number one/i);
  }
});
test('product synchronization requires the operator credential', async () => {
  process.env.CRON_SECRET = 'synthetic';
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.data = value; } };
  await require('../api/sync-products')({ method: 'POST', headers: {}, body: {} }, response);
  assert.equal(response.code, 401);
});
