'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('school-fee definition remains draft with the approved NGN amount and immutable private package', () => {
  const product = require('../lib/product-import.json').find(row => row.id === 'school-fee-reconciliation');
  assert.ok(product);
  assert.deepEqual({ amounts: product.amounts, status: product.status, ready: product.delivery_ready, files: product.blob_pathnames }, {
    amounts: { NGN: 1000000 }, status: 'draft', ready: false,
    files: ['school-fee-reconciliation/v1.0.0/school-fee-reconciliation-v1.0.0-customer.zip']
  });
});

test('school-fee page explains tested compatibility and keeps USD out of checkout', () => {
  const product = { id: 'school-fee-reconciliation', name: 'School Fee Reconciliation Workbook', category: 'Business Software', short: 'Track school fees.', description: 'Offline workbook.', features: ['Sibling allocation'], amounts: { NGN: 1000000 }, price: 'NGN 10,000.00', paymentEnabled: true, status: 'live' };
  const dom = new JSDOM(fs.readFileSync('product.html','utf8'), { url: 'https://store.example/product.html?id=school-fee-reconciliation', runScripts: 'outside-only' });
  dom.window.PRODUCTS = [product];
  dom.window.eval(fs.readFileSync('app.js','utf8'));
  const text = dom.window.document.querySelector('#product-detail').textContent;
  assert.match(text, /16\.0.*13127/);
  assert.match(text, /worksheet protection.*not data security/i);
  assert.match(text, /manual.*print|print.*manual/i);
  assert.match(text, /US\$7\.39/);
  assert.equal(dom.window.document.querySelector('#product-detail img').getAttribute('src'), 'assets/school-fee-reconciliation.jpg');
  dom.window.document.querySelector('.buy').click();
  assert.deepEqual([...dom.window.document.querySelectorAll('#checkout-currency option')].map(option => option.value), ['NGN']);
  dom.window.close();
});

test('school-fee public build allows the mockup and excludes buyer workbook files', () => {
  const source = fs.readFileSync('scripts/build.js','utf8');
  assert.match(source, /school-fee-reconciliation/);
  assert.doesNotMatch(source, /school-fees-clean\.xlsx|school-fees-demo\.xlsx|customer\.zip/);
});
