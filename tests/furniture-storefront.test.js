'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('furniture product detail shows its price, limits and NGN-only checkout', () => {
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), { url: 'https://store.example/product.html?id=furniture-quote-invoice', runScripts: 'outside-only' });
  dom.window.PRODUCTS = [{ id: 'furniture-quote-invoice', name: 'Workshop Quote-to-Invoice Workbook', category: 'Business Software', short: 'Cost custom furniture jobs.', description: 'A spreadsheet.', features: [], price: 'NGN 20,000.00', amounts: { NGN: 2000000 }, paymentEnabled: true, status: 'live' }];
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  const detail = dom.window.document.querySelector('#product-detail');
  assert.equal(detail.querySelector('.detail-price').textContent, 'NGN 20,000.00 / US$14.82 approximate equivalent (rate date 17 Nov 2026)');
  assert.match(detail.textContent, /not a furniture design tool.*tax-compliance product/i);
  assert.match(detail.textContent, /numbering is manual.*Printing and PDF export are manual/i);
  detail.querySelector('.buy').click();
  assert.equal(dom.window.document.querySelectorAll('#checkout-currency option').length, 1);
  assert.equal(dom.window.document.querySelector('#checkout-currency').value, 'NGN');
  dom.window.close();
});
