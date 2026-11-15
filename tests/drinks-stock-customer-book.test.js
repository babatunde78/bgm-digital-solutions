'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('drinks product keeps the selected NGN price and private package draft mapping', () => {
  const product = require('../lib/product-import.json').find(row => row.id === 'drinks-stock-customer-book');
  assert.ok(product);
  assert.deepEqual({ amounts: product.amounts, status: product.status, ready: product.delivery_ready, paths: product.blob_pathnames }, {
    amounts: { NGN: 1250000 }, status: 'draft', ready: false,
    paths: ['drinks-stock-customer-book/v1.0.0/drinks-stock-customer-book-v1.0.0-customer.zip']
  });
  assert.match(product.description, /one-time NGN 12,500/i);
  assert.match(product.description, /US\$9\.24/);
  assert.match(product.description, /not.*accounting\/tax compliance/i);
});

test('drinks detail explains limitations and keeps USD reference out of checkout', () => {
  const product = { id: 'drinks-stock-customer-book', name: 'BGM Drinks Stock & Customer Book', category: 'Business Software', short: 'Track beverage stock.', description: 'Offline workbook.', features: ['Separate container balances'], price: 'NGN 12,500.00', amounts: { NGN: 1250000 }, paymentEnabled: true, status: 'live' };
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), { url: 'https://store.example/product.html?id=drinks-stock-customer-book', runScripts: 'outside-only' });
  dom.window.PRODUCTS = [product];
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  const detail = dom.window.document.querySelector('#product-detail');
  assert.match(detail.textContent, /one user at one depot/i);
  assert.match(detail.textContent, /not data security/i);
  assert.match(detail.textContent, /manual/i);
  assert.match(detail.textContent, /US\$9\.24/);
  assert.equal(detail.querySelector('img').getAttribute('src'), 'assets/drinks-stock-customer-book-mockup.png');
  detail.querySelector('.buy').click();
  assert.deepEqual([...dom.window.document.querySelectorAll('#checkout-currency option')].map(option => option.value), ['NGN']);
  dom.window.close();
});

test('public build includes the mockup and does not place customer workbooks in static output', () => {
  const source = fs.readFileSync('scripts/build.js', 'utf8');
  assert.match(source, /drinks-stock-customer-book-mockup\.png/);
  assert.doesNotMatch(source, /drinks-stock-customer-book-v1\.0\.0-customer\.zip|wholesaler-stock-credit-containers-(?:clean|demo)\.xlsx/);
});
