'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('aluminium product has the authorised NGN price and immutable draft delivery mapping', () => {
  const product = require('../lib/product-import.json').find(row => row.id === 'aluminium-job-costing');
  assert.ok(product);
  assert.deepEqual({ amounts: product.amounts, status: product.status, ready: product.delivery_ready, paths: product.blob_pathnames }, {
    amounts: { NGN: 2500000 }, status: 'draft', ready: false,
    paths: ['aluminium-job-costing/v1.0.0/aluminium-job-costing-v1.0.0-customer.zip']
  });
});

test('aluminium product page states engineering limits and keeps checkout NGN only', () => {
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), { url: 'https://store.example/product.html?id=aluminium-job-costing', runScripts: 'outside-only' });
  dom.window.PRODUCTS = [{ id: 'aluminium-job-costing', name: 'Aluminium Job Costing Workbook', category: 'Business Software', short: 'Cost jobs.', description: 'Workbook.', features: ['Quotation snapshots'], price: 'NGN 25,000.00', amounts: { NGN: 2500000 }, paymentEnabled: true, status: 'live' }];
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  const detail = dom.window.document.querySelector('#product-detail');
  assert.match(detail.textContent, /16\.0.*13127/);
  assert.match(detail.textContent, /fabricator review/i);
  assert.match(detail.textContent, /not.*cutting|no.*cutting/i);
  assert.match(detail.textContent, /US\$18\.49/);
  assert.equal(detail.querySelector('img').getAttribute('src'), 'assets/aluminium-job-costing.jpg');
  detail.querySelector('.buy').click();
  assert.deepEqual([...dom.window.document.querySelectorAll('#checkout-currency option')].map(option => option.value), ['NGN']);
  dom.window.close();
});

test('aluminium public build includes artwork and excludes buyer workbook paths', () => {
  const source = fs.readFileSync('scripts/build.js', 'utf8');
  assert.match(source, /aluminium-job-costing/);
  assert.doesNotMatch(source, /aluminium-job-costing-(?:clean|demo)\.xlsx|aluminium-job-costing-v1\.0\.0-customer\.zip/);
});
