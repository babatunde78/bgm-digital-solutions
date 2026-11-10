'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('published desktop release accurately advertises price, delivery and limitations', () => {
  const release = JSON.parse(fs.readFileSync('campus-documents-release.json', 'utf8'));
  const desktop = require('../desktop/release.json');
  assert.equal(release.productId, desktop.productId);
  assert.equal(release.version, desktop.version);
  assert.deepEqual(release.licensing, {
    activation: 'none',
    grant: 'one-time use of version 0.1.1 by one institution on one computer',
    renewal: 'none',
    ongoingSupport: 'not included',
    laterVersionUpdates: 'not included',
    existingCampusExcelBuyers: 'verified paid buyers of Package A, Package B or Full Excel receive version 0.1.1 at no extra charge'
  });
  assert.equal(release.status, 'live');
  assert.deepEqual(release.pricing, { status: 'published', currency: 'NGN', amount: 200000 });
  assert.equal(release.paymentEnabled, true);
  assert.equal(release.deliveryReady, true);
  assert.deepEqual(release.installer, {
    published: true,
    sizeBytes: 121275598,
    sha256: '713f2984c64c95408317b0cf02580c717a84585deaa0e74696684e16fb97dd7b',
    downloadUrl: null
  });
  assert.match(release.windowsVerification, /per-user install.*passed on one Windows 11 x64 machine/i);
  assert.match(release.windowsVerification, /reviewer reported all 14 pilot scenarios passed/i);
  assert.ok(release.limitations.some(item => /unsigned installer.*installation and uninstallation passed only/i.test(item)));
  assert.ok(release.limitations.some(item => /contractual.*no device lock.*can be copied/i.test(item)));
  assert.ok(release.limitations.some(item => /No ongoing product-use support.*seven-day refund policy continue/i.test(item)));
  const dom = new JSDOM(fs.readFileSync('campus-documents.html', 'utf8'));
  const document = dom.window.document;
  const pageText = document.body.textContent;
  assert.equal(document.querySelector('a[href="campus-documents-release.json"]')?.textContent, 'Release metadata');
  assert.equal(document.querySelector('a.buy, button.buy, form'), null);
  assert.ok(document.querySelector('#installation'));
  assert.deepEqual([...document.querySelectorAll('[data-sample-pdf]')].map(link => link.getAttribute('href')), [
    'assets/campus-documents-samples/receipt.pdf',
    'assets/campus-documents-samples/statement.pdf',
    'assets/campus-documents-samples/voucher.pdf'
  ]);
  for (const link of document.querySelectorAll('[data-sample-pdf]')) {
    const sample = fs.readFileSync(link.getAttribute('href'));
    assert.equal(sample.subarray(0, 5).toString('ascii'), '%PDF-');
  }
  assert.match(document.querySelector('main h1')?.textContent, /Campus Bursary\s*Documents/);
  assert.equal(document.querySelector('#page-title')?.getAttribute('aria-label'), 'Campus Bursary Documents');
  assert.equal(document.querySelector('.product-screen img')?.getAttribute('src'), 'assets/campus-documents-pdf-mockup-v0.1.1.png');
  assert.match(document.querySelector('.product-screen figcaption')?.textContent || '', /Illustrative PDF document mockup, not an issued record/);
  assert.ok(fs.existsSync('assets/campus-documents-pdf-mockup-v0.1.1.png'));
  assert.match(pageText, /Indicative equivalent: about US\$148\.11.*CBN central rate dated 10 November 2026.*checkout is NGN-only/i);
  assert.match(document.querySelector('#difference-title')?.textContent || '', /focused document tool alongside Campus Excel/i);
  assert.match(pageText, /Package A covers broader student-fee and treasury schedules.*Package B covers budgets, commitments, suppliers and expenditure/i);
  assert.equal(document.querySelector('.text-link')?.getAttribute('href'), '#samples');
  assert.equal(document.querySelector('#samples')?.tagName, 'SECTION');
  assert.match(pageText, /fictional sample data/i);
  assert.match(pageText, /not a shared network database/i);
  assert.match(pageText, /not an accounting system/i);
  assert.ok(pageText.includes('No activation or internet connection is required for ordinary document work'));
  assert.match(pageText, /current installer is unsigned/i);
  assert.doesNotMatch(pageText, /has not completed officer acceptance/i);
  assert.match(pageText, /authenticated order flow.*no permanent public installer URL/i);
  assert.match(pageText, /default-path permissions, upgrade checks and Windows versions other than Windows 11 x64 remain unverified/i);
  assert.match(pageText, /available now.*one-time NGN 200,000/i);
  assert.match(pageText, /verified paid buyers of Campus Package A, Package B or Full Excel receive version 0\.1\.1 at no extra charge/i);
  assert.match(pageText, /contractual limit.*does not enforce a device lock.*downloaded installers can be copied/i);
  assert.match(pageText, /Buy version 0\.1\.1/);
  const homepage = new JSDOM(fs.readFileSync('index.html', 'utf8')).window.document;
  const previewLink = homepage.querySelector('a[href="campus-documents.html"]');
  assert.equal(previewLink?.textContent.trim(), 'See the Windows edition');
  assert.match(homepage.querySelector('.campus-desktop-preview')?.textContent || '', /One-time NGN 200,000/);
  assert.match(fs.readFileSync('sitemap.xml', 'utf8'), /https:\/\/www\.bgmsolutions\.site\/campus-documents\.html/);
  dom.window.close();
});
