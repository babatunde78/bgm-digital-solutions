'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const products = [
  ['questionnaire-data-checking', 'questionnaire-data-checking-mockup-v1.png'],
  ['client-pack-assembler', 'client-pack-assembler-mockup.png'],
  ['contractor-cash-flow-planner', 'contractor-cash-flow-planner-mockup.jpg'],
  ['drinks-stock-customer-book', 'drinks-stock-customer-book-mockup-v2.jpg'],
  ['furniture-quote-invoice', 'furniture-quote-invoice-mockup.png'],
  ['rental-income-arrears-ledger', 'rental-income-arrears-ledger-mockup-v2.jpg'],
  ['sales-settlement-reconciler', 'sales-settlement-reconciler-mockup.png'],
  ['social-seller-bookkeeping', 'social-seller-bookkeeping.jpg'],
  ['training-certificate-generator', 'training-certificate-generator-v1.1.0.png']
];

test('restored product mockups appear on cards and detail pages and ship in the public build', () => {
  execFileSync(process.execPath, ['scripts/build.js'], { stdio: 'ignore' });
  for (const [id, asset] of products) {
    for (const [page, selector] of [['index.html', '#product-grid .cover img'], ['product.html', '#product-detail .cover img']]) {
      const dom = new JSDOM(fs.readFileSync(page, 'utf8'), {
        url: `https://store.example/${page}?id=${id}`,
        runScripts: 'outside-only'
      });
      try {
        dom.window.PRODUCTS = [{
          id, name: id, category: 'Business Software', short: 'Digital business resource.',
          description: 'Product information.', features: [], paymentEnabled: false, status: 'live'
        }];
        dom.window.eval(fs.readFileSync('app.js', 'utf8'));
        assert.equal(dom.window.document.querySelector(selector)?.getAttribute('src'), `assets/${asset}`);
      } finally {
        dom.window.close();
      }
    }

    const source = fs.readFileSync(path.join('assets', asset));
    const built = fs.readFileSync(path.join('public', 'assets', asset));
    assert.deepEqual(built, source);
  }
});
