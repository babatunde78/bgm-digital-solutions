'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('desktop preview cannot advertise paid delivery without an approved installer', () => {
  const release = JSON.parse(fs.readFileSync('campus-documents-release.json', 'utf8'));
  const desktop = require('../desktop/release.json');
  assert.equal(release.productId, desktop.productId);
  assert.equal(release.version, desktop.version);
  assert.deepEqual(release.licensing, { activation: 'none' });
  assert.equal(release.status, 'request-pilot');
  assert.deepEqual(release.pricing, { status: 'approved-not-for-sale', currency: 'NGN', amount: 200000 });
  assert.equal(release.paymentEnabled, false);
  assert.equal(release.deliveryReady, false);
  assert.deepEqual(release.installer, { published: false, sha256: null, downloadUrl: null });
  assert.match(release.windowsVerification, /per-user install.*passed on one Windows 11 x64 machine/i);
  assert.ok(release.limitations.some(item => /unsigned installer.*installation and uninstallation passed only/i.test(item)));
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
  assert.equal(document.querySelector('.text-link')?.getAttribute('href'), '#samples');
  assert.equal(document.querySelector('#samples')?.tagName, 'SECTION');
  assert.match(pageText, /fictional sample data/i);
  assert.match(pageText, /not a shared network database/i);
  assert.match(pageText, /not an accounting system/i);
  assert.ok(pageText.includes('No activation or institution licence file is required'));
  assert.match(pageText, /current installer is unsigned/i);
  assert.match(pageText, /default-path permissions, upgrade checks or compatibility testing across Windows versions/i);
  assert.match(pageText, /private installer integrity read-back, legitimate purchaser entitlement and signed-link expiry/i);
  assert.match(pageText, /planned price.*NGN 200,000.*sales are not open/i);
  assert.match(pageText, /no customer installer or paid download is available/i);
  const homepage = new JSDOM(fs.readFileSync('index.html', 'utf8')).window.document;
  const previewLink = homepage.querySelector('a[href="campus-documents.html"]');
  assert.equal(previewLink?.textContent.trim(), 'View desktop preview');
  assert.match(homepage.querySelector('.campus-desktop-preview')?.textContent || '', /request-pilot preview only/i);
  assert.match(fs.readFileSync('sitemap.xml', 'utf8'), /https:\/\/www\.bgmsolutions\.site\/campus-documents\.html/);
  dom.window.close();
});
