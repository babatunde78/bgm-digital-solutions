'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const product = { id: 'guide', name: 'A useful guide', category: 'Career Guides', short: 'Prepare your application.', description: 'A guide to preparing applications.', features: ['Application planning'], price: '₦10,000.00', amounts: { NGN: 1000000 }, paymentEnabled: true, status: 'live' };
test('loading the storefront as browser scripts preserves the native window close method', () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://store.example', runScripts: 'dangerously' });
  const nativeClose = dom.window.close;
  dom.window.PRODUCTS = [product];
  const script = dom.window.document.createElement('script');
  script.textContent = fs.readFileSync('app.js', 'utf8');
  dom.window.document.body.append(script);
  const actualClose = dom.window.close;
  nativeClose.call(dom.window);
  assert.equal(actualClose, nativeClose);
});
function store(file = 'index.html', query = '', catalogue = [product]) {
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { url: `https://store.example/${file}${query}`, runScripts: 'outside-only' });
  dom.window.PRODUCTS = catalogue;
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  return dom;
}

test('navigation works before the catalogue is available and closes after choosing a destination', () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://store.example', runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(fs.readFileSync('site.js', 'utf8'));
  const menu = window.document.querySelector('.menu');
  menu.click();
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  window.document.querySelector('nav a').click();
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(window.document.querySelector('nav').classList.contains('open'), false);
  dom.window.close();
});

test('service details do not promise digital delivery or a product refund', () => {
  const service = { ...product, id: 'service', status: 'service', paymentEnabled: false };
  const dom = store('product.html', '?id=service', [service]);
  const detail = dom.window.document.querySelector('#product-detail');
  assert.equal(detail.querySelector('.policy-link'), null);
  assert.equal(detail.textContent.includes('Your files & support'), false);
  assert.match(detail.textContent, /proposal/);
  dom.window.close();
});

test('a selected payment currency updates the payable checkout summary', () => {
  const dom = store('index.html', '', [{ ...product, amounts: { NGN: 1000000, USD: 1200 }, price: '₦10,000 / $12' }]);
  const doc = dom.window.document;
  doc.querySelector('.buy').click();
  assert.equal(doc.querySelector('#currency-field').hidden, false);
  doc.querySelector('#checkout-currency').value = 'USD';
  doc.querySelector('#checkout-currency').dispatchEvent(new dom.window.Event('change'));
  assert.match(doc.querySelector('#checkout-product-name').textContent, /USD|\$/);
  assert.equal(doc.querySelector('#checkout-product-name').textContent.includes('₦'), false);
  dom.window.close();
});

test('bundle savings use current published amounts and exclude the business toolkit', () => {
  const ids = ['500-business-prompts', 'ai-side-hustles', 'remote-job-2026-2027', 'scholarships-abroad', 'first-upwork-client'];
  const guides = ids.map(id => ({ ...product, id, name: id, amounts: { NGN: 1000000 } }));
  const bundle = { ...product, id: 'five-guide-bundle', amounts: { NGN: 3500000 }, price: '₦35,000' };
  const dom = store('product.html', '?id=five-guide-bundle', [...guides, bundle, { ...product, id: 'bgm-collections-bank', amounts: { NGN: 5490000 } }]);
  assert.equal(dom.window.document.querySelector('.bundle-saving').textContent, 'Bought separately: ₦50,000. Bundle: ₦35,000. Save ₦15,000.');
  assert.equal(dom.window.document.querySelectorAll('#product-detail a[href^="product.html?id="]').length, 5);
  dom.window.close();
  const missingGuide = store('product.html', '?id=five-guide-bundle', [bundle, ...guides.slice(1)]);
  assert.equal(missingGuide.window.document.querySelector('.bundle-saving'), null);
  missingGuide.window.close();
});

test('USD reference values are visible beside naira without enabling dollar checkout', () => {
  const guide = { ...product, id: 'remote-job-2026-2027', price: '₦10,000.00' };
  const dom = store('index.html', '', [guide]);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('.price').textContent, '₦10,000.00 / US$12 reference');
  doc.querySelector('.buy').click();
  assert.equal(doc.querySelectorAll('#checkout-currency option').length, 1);
  assert.equal(doc.querySelector('#checkout-currency').value, 'NGN');
  assert.equal(doc.querySelector('#checkout-product-name').textContent.includes('US$12'), false);
  dom.window.close();
});

test('the university toolkit shows the owner supplied US$40.75 reference beside ₦54,900', () => {
  const toolkit = { ...product, id: 'bgm-collections-bank', price: '₦54,900.00', amounts: { NGN: 5490000 } };
  const dom = store('product.html', '?id=bgm-collections-bank', [toolkit]);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('.detail-price').textContent, '₦54,900.00 / US$40.75 reference');
  doc.querySelector('#product-detail .buy').click();
  assert.equal(doc.querySelector('#checkout-currency').value, 'NGN');
  assert.match(doc.querySelector('#checkout-product-name').textContent, /54,900/);
  assert.equal(doc.querySelector('#checkout-product-name').textContent.includes('40.75'), false);
  dom.window.close();
});

test('Campus prices show a dated approximate USD equivalent without adding USD checkout', () => {
  const campus = { ...product, id: 'campus-bursary-package-a', name: 'Campus Bursary — Student Revenue & Treasury Toolkit (Excel)',
    price: 'NGN 800,000.00', amounts: { NGN: 80000000 }, usdReference: '593.42', usdRateDate: '2026-11-07' };
  const dom = store('product.html', '?id=campus-bursary-package-a', [campus]);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('.detail-price').textContent, 'NGN 800,000.00 / US$593.42 approximate equivalent (rate date 7 Nov 2026)');
  assert.match(doc.querySelector('.audience-description').textContent, /traceable schedules from fee billing through receipt allocation/);
  assert.match(doc.querySelector('#product-detail').textContent, /single-writer pilot workbooks/);
  doc.querySelector('#product-detail .buy').click();
  assert.equal(doc.querySelectorAll('#checkout-currency option').length, 1);
  assert.equal(doc.querySelector('#checkout-currency').value, 'NGN');
  assert.equal(doc.querySelector('#checkout-product-name').textContent.includes('593.42'), false);
  dom.window.close();
});

test('Campus product covers appear in the storefront catalogue and product details', () => {
  const images = ['campus-bursary-a', 'campus-bursary-b', 'campus-bursary-full-excel'];
  const campusProducts = images.map((image, index) => ({ ...product,
    id: ['campus-bursary-package-a', 'campus-bursary-package-b', 'campus-bursary-full-excel'][index],
    name: ['Student Fees & Treasury Control', 'Budget-to-Payment Control', 'Complete Bursary Control Suite'][index]
  }));
  const catalogue = store('index.html', '', campusProducts);
  const cards = catalogue.window.document.querySelectorAll('#product-grid .cover img');
  assert.equal(cards.length, 3);
  cards.forEach((image, index) => {
    assert.equal(image.getAttribute('src'), `assets/${images[index]}.jpg`);
    assert.match(image.alt, /illustrative product mockup/);
    assert(fs.existsSync(`assets/${images[index]}.jpg`));
  });
  catalogue.window.close();

  const detail = store('product.html', '?id=campus-bursary-full-excel', campusProducts);
  assert.equal(detail.window.document.querySelector('.detail-visual img').getAttribute('src'), 'assets/campus-bursary-full-excel.jpg');
  detail.window.close();
});

test('Campus Full Excel shows first-year savings against current published package prices', () => {
  const packageA = { ...product, id: 'campus-bursary-package-a', amounts: { NGN: 80000000 } };
  const packageB = { ...product, id: 'campus-bursary-package-b', amounts: { NGN: 120000000 } };
  const full = { ...product, id: 'campus-bursary-full-excel', amounts: { NGN: 160000000 }, price: '₦1,600,000' };
  const dom = store('product.html', '?id=campus-bursary-full-excel', [packageA, packageB, full]);
  assert.equal(dom.window.document.querySelector('.bundle-saving').textContent,
    'Package A and Package B separately: ₦2,000,000. Full Excel first-year total: ₦1,600,000. Save ₦400,000.');
  dom.window.close();
  const missingPackage = store('product.html', '?id=campus-bursary-full-excel', [packageA, full]);
  assert.equal(missingPackage.window.document.querySelector('.bundle-saving'), null);
  missingPackage.window.close();
});

test('Campus page shows live catalogue prices and secure product links', async () => {
  const definitions = JSON.parse(fs.readFileSync('lib/product-import.json', 'utf8'))
    .filter(item => item.id.startsWith('campus-bursary-'))
    .map(({ id, name, short, description, features }, index) => ({ id, name, short, description, features,
      paymentEnabled: true, price: `NGN ${800000 + index * 400000}`, usdReference: '593.42', usdRateDate: '2026-11-07' }));
  const dom = new JSDOM(fs.readFileSync('campus-bursary.html', 'utf8'), {
    url: 'https://store.example/campus-bursary.html', runScripts: 'outside-only'
  });
  dom.window.fetch = async path => {
    assert.equal(path, '/api/catalog');
    return { ok: true, json: async () => ({ products: definitions }) };
  };
  dom.window.eval(fs.readFileSync('campus-preview.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  const list = dom.window.document.querySelector('#campus-product-list');
  const text = list.textContent;
  for (const item of definitions) {
    assert(text.includes(item.name));
    assert(text.includes(item.short));
    assert(text.includes(item.description));
  }
  const images = ['campus-bursary-a', 'campus-bursary-b', 'campus-bursary-full-excel'];
  const artwork = list.querySelectorAll('.campus-product-art');
  assert.equal(artwork.length, 3);
  artwork.forEach((image, index) => {
    assert.equal(image.getAttribute('src'), `assets/${images[index]}.jpg`);
    assert.match(image.alt, /illustrative product mockup/);
    assert(fs.existsSync(`assets/${images[index]}.jpg`));
  });
  assert.equal(list.querySelectorAll('a[href^="product.html?id="]').length, 3);
  assert.equal(list.querySelectorAll('.price').length, 3);
  assert.match(text, /approximate equivalent/);
  assert.match(text, /7 Nov 2026/);
  dom.window.close();
});

test('Campus page requests a quote and hides purchase links when checkout is disabled', async () => {
  const dom = new JSDOM(fs.readFileSync('campus-bursary.html', 'utf8'), {
    url: 'https://store.example/campus-bursary.html', runScripts: 'outside-only'
  });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ products: [{
    id: 'campus-bursary-package-a', name: 'Campus A', short: 'Scope', description: 'Details', features: [],
    paymentEnabled: false, price: 'NGN 800,000'
  }] }) });
  dom.window.eval(fs.readFileSync('campus-preview.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  const list = dom.window.document.querySelector('#campus-product-list');
  assert.equal(list.querySelector('a[href^="product.html?id="]'), null);
  assert.equal(list.querySelector('a[href^="https://wa.me/"]').textContent, 'Request a pilot quote ↗');
  dom.window.close();
});

test('Campus page does not claim a sale when packages are absent from the public catalogue', async () => {
  const dom = new JSDOM(fs.readFileSync('campus-bursary.html', 'utf8'), {
    url: 'https://store.example/campus-bursary.html', runScripts: 'outside-only'
  });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ products: [] }) });
  dom.window.eval(fs.readFileSync('campus-preview.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  const list = dom.window.document.querySelector('#campus-product-list');
  assert.match(list.textContent, /not currently available for purchase/);
  assert.equal(list.querySelector('a[href^="product.html?id="]'), null);
  dom.window.close();
});

test('a single payment currency is displayed without asking the buyer to choose', () => {
  const dom = store();
  dom.window.document.querySelector('.buy').click();
  assert.equal(dom.window.document.querySelector('#checkout-currency').value, 'NGN');
  assert.equal(dom.window.document.querySelector('#currency-field').hidden, true);
  assert.equal(dom.window.document.querySelector('#checkout-modal').getAttribute('aria-labelledby'), 'checkout-heading');
  dom.window.close();
});

test('session rejection shows the server reason and does not initialize a payment', async () => {
  const dom = store();
  const requests = [];
  dom.window.fetch = async url => {
    requests.push(url);
    return { ok: false, status: 403, json: async () => ({ error: 'Please submit this form from the store.' }) };
  };
  const doc = dom.window.document;
  doc.querySelector('.buy').click();
  doc.querySelector('#checkout-email').value = 'buyer@example.com';
  doc.querySelector('#checkout-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.querySelector('#checkout-error').textContent, 'Please submit this form from the store.');
  assert.deepEqual(requests, ['/api/session']);
  assert.equal(doc.querySelector('#checkout-submit').disabled, false);
  dom.window.close();
});

test('closing checkout while the session starts prevents payment initialization', async () => {
  const dom = store();
  const requests = [];
  let finishSession;
  dom.window.fetch = url => {
    requests.push(url);
    if (url === '/api/session') return new Promise(resolve => { finishSession = resolve; });
    return Promise.resolve({ ok: false, json: async () => ({ error: 'Unexpected initialization' }) });
  };
  const doc = dom.window.document;
  doc.querySelector('.buy').click();
  doc.querySelector('#checkout-email').value = 'buyer@example.com';
  doc.querySelector('#checkout-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  doc.querySelector('#checkout-close').click();
  finishSession({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  dom.window.close();
  assert.deepEqual(requests, ['/api/session']);
});

test('download buttons are hidden while payment access is being rechecked', async () => {
  const dom = new JSDOM(fs.readFileSync('payment-success.html', 'utf8'), { url: 'https://store.example/payment-success.html?reference=bgm-check', runScripts: 'outside-only' });
  let finishRecheck;
  let checks = 0;
  dom.window.fetch = async url => {
    if (url === '/api/store-status') return { ok: true, json: async () => ({ emailEnabled: false }) };
    if (++checks === 1) return { ok: true, json: async () => ({ verified: true, product: { name: 'Guide' }, downloads: [{ name: 'Guide.zip', url: '/api/download?token=synthetic' }], emailEnabled: false }) };
    return new Promise(resolve => { finishRecheck = resolve; });
  };
  dom.window.eval(fs.readFileSync('purchase.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  const doc = dom.window.document;
  assert.equal(doc.querySelector('#downloads').hidden, false);
  doc.querySelector('#retry').click();
  const hiddenWhileChecking = doc.querySelector('#downloads').hidden;
  finishRecheck({ ok: false, json: async () => ({ error: 'Access is suspended.' }) });
  await new Promise(resolve => setImmediate(resolve));
  dom.window.close();
  assert.equal(hiddenWhileChecking, true);
});

test('product links open a persistent detail page using the published catalogue', () => {
  const dom = store();
  assert.equal(dom.window.document.querySelector('.product-link').getAttribute('href'), 'product.html?id=guide');
  dom.window.close();
  const detail = store('product.html', '?id=guide');
  assert.equal(detail.window.document.querySelector('#product-detail h1').textContent, product.name);
  assert.equal(detail.window.document.querySelector('#product-detail').textContent.includes('Application planning'), true);
  detail.window.document.querySelector('#product-detail .buy').click();
  assert.equal(detail.window.document.querySelector('#checkout-modal').hidden, false);
  detail.window.close();
});

test('an unpublished product has no purchase action on its detail page', () => {
  const dom = store('product.html', '?id=unpublished');
  assert.equal(dom.window.document.querySelector('#product-detail .buy'), null);
  assert.match(dom.window.document.querySelector('#product-detail').textContent, /not available/);
  dom.window.close();
});

for (const emailEnabled of [false, true]) {
  test(`purchase support matches emailEnabled=${emailEnabled} without a payment reference`, async () => {
    const dom = new JSDOM(fs.readFileSync('payment-success.html', 'utf8'), { url: 'https://store.example/payment-success.html', runScripts: 'outside-only' });
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ emailEnabled }) });
    dom.window.eval(fs.readFileSync('purchase.js', 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.window.document.querySelector('#recovery-form').hidden, !emailEnabled);
    const message = dom.window.document.querySelector('#message').textContent;
    assert.equal(message.includes('form below'), emailEnabled);
    if (!emailEnabled) assert.match(message, /WhatsApp/);
    dom.window.close();
  });
}

test('catalogue failure retains enquiry services and exposes a retry action', async () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://store.example', runScripts: 'outside-only' });
  dom.window.PRODUCTS = [{ ...product, id: 'service', status: 'service', paymentEnabled: false }];
  dom.window.fetch = async () => { throw new TypeError('Network unavailable'); };
  dom.window.eval(fs.readFileSync('catalog-loader.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.PRODUCTS.length, 1);
  assert.equal(dom.window.document.querySelector('#catalog-retry').hidden, false);
  assert.match(dom.window.document.querySelector('#catalog-status').textContent, /unavailable/);
  dom.window.close();
});
