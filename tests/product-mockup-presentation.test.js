'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const cases = [
  {
    id: 'rental-income-arrears-ledger',
    name: 'Nigeria Rent & Property Ledger Workbook',
    asset: 'rental-income-arrears-ledger-mockup-v2.jpg'
  },
  {
    id: 'drinks-stock-customer-book',
    name: 'BGM Drinks Stock & Customer Book',
    asset: 'drinks-stock-customer-book-mockup-v2.jpg'
  },
  {
    id: 'contractor-cash-flow-planner',
    name: 'Contractor Cash Flow Planner for Nigeria (Excel)',
    asset: 'contractor-cash-flow-planner-mockup.jpg'
  }
];

for (const item of cases) {
  test(`${item.name} uses its optimized product mockup`, () => {
    const product = {
      id: item.id,
      name: item.name,
      category: 'Business Software',
      short: 'Offline Excel workbook.',
      description: 'Offline Excel workbook.',
      features: ['Sample feature'],
      price: 'NGN 12,500.00',
      amounts: { NGN: 1250000 },
      paymentEnabled: true,
      status: 'live'
    };
    const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), {
      url: `https://store.example/product.html?id=${item.id}`,
      runScripts: 'outside-only'
    });
    dom.window.PRODUCTS = [product];
    dom.window.eval(fs.readFileSync('app.js', 'utf8'));

    const image = dom.window.document.querySelector('#product-detail .detail-visual .cover img');
    assert.ok(image);
    assert.equal(image.getAttribute('src'), `assets/${item.asset}`);
    assert.equal(image.getAttribute('width'), '1200');
    assert.equal(image.getAttribute('height'), '800');
    assert.match(image.getAttribute('alt'), /illustrative product mockup/i);
    assert.match(dom.window.document.querySelector('#product-detail .detail-visual figcaption').textContent, /digital download/i);

    const source = path.join('assets', item.asset);
    const built = path.join('public', 'assets', item.asset);
    for (const asset of [source, built]) {
      const bytes = fs.readFileSync(asset);
      assert.equal(bytes.readUInt16BE(0), 0xffd8);
      assert.ok(bytes.length < 400_000);
    }
    dom.window.close();
  });
}
