'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('questionnaire scoring listing shows its dashboard preview and dated USD reference', () => {
  const dom = new JSDOM(fs.readFileSync('product.html', 'utf8'), {
    url: 'https://store.example/product.html?id=questionnaire-scale-scoring',
    runScripts: 'outside-only'
  });
  try {
    dom.window.PRODUCTS = [{
      id: 'questionnaire-scale-scoring', name: 'Questionnaire Scale Scoring & Descriptive Results Workbook',
      category: 'Research Tools', short: 'Use the offline Excel workbook.', description: 'Documented rules.',
      features: ['Excel scoring'], price: '₦15,000.00', amounts: { NGN: 1500000 },
      paymentEnabled: true, status: 'live'
    }];
    dom.window.eval(fs.readFileSync('app.js', 'utf8'));
    const image = dom.window.document.querySelector('#product-detail .detail-visual .cover img');
    assert.ok(image);
    assert.equal(image.getAttribute('src'), 'assets/questionnaire-scale-scoring-dashboard.jpg');
    assert.equal(image.getAttribute('width'), '1536');
    assert.equal(image.getAttribute('height'), '1024');
    assert.match(image.getAttribute('alt'), /fictional questionnaire/i);
    assert.match(dom.window.document.querySelector('#product-detail .detail-price').textContent, /US\$10\.76.*24 Nov 2026/);
  } finally {
    dom.window.close();
  }
});
