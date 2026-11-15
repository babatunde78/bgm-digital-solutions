'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('rental ledger release uses the selected price and private customer package', () => {
  const product = require('../lib/product-import.json').find(row => row.id === 'rental-income-arrears-ledger');
  assert.ok(product);
  assert.deepEqual({ amount: product.amounts.NGN, status: product.status, ready: product.delivery_ready, path: product.blob_pathnames[0] }, {
    amount: 1250000, status: 'published', ready: true,
    path: 'rental-income-arrears-ledger/v1.0.0/rental-income-arrears-ledger-v1.0.0-customer.zip'
  });
  assert.match(product.description, /refundable deposits separately/i);
  assert.match(product.description, /legal late-fee or tenancy rules/i);
});

test('rental product detail states operating limits and displays dated USD reference without USD checkout', () => {
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), { url: 'https://store.example/product.html?id=rental-income-arrears-ledger', runScripts: 'outside-only' });
  dom.window.PRODUCTS = [{ id: 'rental-income-arrears-ledger', name: 'Nigeria Rent & Property Ledger Workbook', category: 'Business Software', short: 'Track rents.', description: 'Workbook.', features: ['Receipts'], price: 'NGN 12,500.00', amounts: { NGN: 1250000 }, paymentEnabled: true, status: 'live' }];
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  const detail = dom.window.document.querySelector('#product-detail');
  assert.match(detail.textContent, /2016 or later.*pre-release build.*Excel 2019/i);
  assert.match(detail.textContent, /300 charge and receipt rows/i);
  assert.match(detail.textContent, /refundable deposits.*separately/i);
  assert.match(detail.textContent, /US\$9\.3(?:0)?/);
  assert.equal(detail.querySelector('img').getAttribute('src'), 'assets/rental-income-arrears-ledger-mockup.png');
  detail.querySelector('.buy').click();
  assert.deepEqual([...dom.window.document.querySelectorAll('#checkout-currency option')].map(option => option.value), ['NGN']);
  dom.window.close();
});

test('rental public build includes product artwork but excludes the buyer package', () => {
  const source = fs.readFileSync('scripts/build.js', 'utf8');
  assert.match(source, /rental-income-arrears-ledger-mockup/);
  assert.doesNotMatch(source, /rental-income-arrears-ledger-v1\.0\.0-customer\.zip|landlord-rent-ledger-clean\.xlsx/);
});
