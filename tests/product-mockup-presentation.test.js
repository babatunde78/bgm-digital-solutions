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

test('Sales & Settlement Reconciler uses its illustrative cover and current USD reference', () => {
  const product = {
    id: 'sales-settlement-reconciler',
    name: 'Sales & Settlement Reconciler',
    category: 'Business Software',
    short: 'Local reconciliation utility.',
    description: 'Local reconciliation utility.',
    features: ['Manual review'],
    price: 'NGN 15,000.00',
    amounts: { NGN: 1500000 },
    paymentEnabled: true,
    status: 'live'
  };
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), {
    url: 'https://store.example/product.html?id=sales-settlement-reconciler',
    runScripts: 'outside-only'
  });
  dom.window.PRODUCTS = [product];
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  const image = dom.window.document.querySelector('#product-detail .detail-visual .cover img');
  assert.ok(image);
  assert.equal(image.getAttribute('src'), 'assets/sales-settlement-reconciler-mockup.png');
  assert.equal(image.getAttribute('width'), '1536');
  assert.equal(image.getAttribute('height'), '1024');
  assert.match(dom.window.document.querySelector('#product-detail').textContent, /US\$11\.07/);
  for (const file of ['assets/sales-settlement-reconciler-mockup.png', 'public/assets/sales-settlement-reconciler-mockup.png']) {
    const bytes = fs.readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.equal(fs.existsSync('public/Sales-Settlement-Reconciler-v0.1.0.zip'), false);
  dom.window.close();
});

test('Client Pack Assembler shows its illustrative cover, price reference and verified release limits', () => {
  const product = {
    id: 'client-pack-assembler', name: 'BGM Client Pack Assembler', category: 'Business Software',
    short: 'Ordered local PDF packs.', description: 'Manifest-driven PDF packs.', features: ['Preflight'],
    price: 'NGN 25,000.00', amounts: { NGN: 2500000 }, usdReference: 18.45,
    paymentEnabled: true, status: 'live'
  };
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), {
    url: 'https://store.example/product.html?id=client-pack-assembler', runScripts: 'outside-only'
  });
  dom.window.PRODUCTS = [product];
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  const detail = dom.window.document.querySelector('#product-detail');
  assert.equal(detail.querySelector('.detail-visual img').getAttribute('src'), 'assets/client-pack-assembler-mockup.png');
  assert.match(detail.textContent, /US\$18\.45/);
  assert.match(detail.textContent, /end-to-end GUI preflight and generation.*unverified/i);
  assert.match(detail.textContent, /does not convert Office files or images/i);
  assert.equal(fs.existsSync('public/assets/client-pack-assembler-mockup.png'), true);
  assert.equal(fs.existsSync('public/bgm-client-pack-assembler-v0.1.0-customer.zip'), false);
  dom.window.close();
});
