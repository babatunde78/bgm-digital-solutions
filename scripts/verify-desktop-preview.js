'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const origin = 'https://www.bgmsolutions.site';
const directory = path.resolve(__dirname, '../.product-work/campus-bursary-documents/v0.1.0/release-audit-2026-11-09');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function run() {
  if (!['--before', '--after'].includes(process.argv[2])) throw new Error('Use --before to snapshot the public catalogue, then --after to verify the deployed preview. Read-only requests only.');
  fs.mkdirSync(directory, { recursive: true });
  const catalogue = await fetch(`${origin}/api/catalog`, { signal: AbortSignal.timeout(20000) });
  assert.equal(catalogue.status, 200, 'Public catalogue must be available');
  const data = await catalogue.json(); assert.ok(Array.isArray(data.products));
  const products = data.products.toSorted((a, b) => a.id.localeCompare(b.id));
  assert.ok(!products.some(product => product.id === 'campus-bursary-documents'), 'Desktop paid fulfilment must remain absent');
  const baseline = path.join(directory, 'catalogue-before.json');
  if (process.argv[2] === '--before') {
    fs.writeFileSync(baseline, JSON.stringify(products, null, 2), { flag: 'wx' });
    process.stdout.write(`Snapshotted ${products.length} public catalogue products. No customer or order records accessed.\n`); return;
  }
  assert.deepEqual(products, JSON.parse(fs.readFileSync(baseline, 'utf8')), 'Existing catalogue products, prices and availability must be preserved');
  const paths = [
    ['/campus-documents.html', 200], ['/campus-documents-release.json', 200], ['/campus-documents.css', 200],
    ['/assets/campus-documents-pilot.png', 200], ['/api/download?token=invalid', 401],
    ['/api/verify-payment?reference=invalid', 401], ['/api/process-payments?check=readiness', 401],
    ['/desktop/main.js', 404], ['/.env.local', 404]
  ];
  const checks = await Promise.all(paths.map(async ([pathname, expected]) => {
    const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, expected, pathname);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (pathname === '/campus-documents-release.json') assert.deepEqual(JSON.parse(bytes), JSON.parse(fs.readFileSync(path.resolve(__dirname, '../campus-documents-release.json'), 'utf8')));
    if (['/campus-documents.html', '/campus-documents.css', '/assets/campus-documents-pilot.png'].includes(pathname)) assert.equal(digest(bytes), digest(fs.readFileSync(path.resolve(__dirname, '..', pathname.slice(1)))), `Deployed asset differs: ${pathname}`);
    return { pathname, status: response.status, sha256: expected === 200 ? digest(bytes) : null };
  }));
  const report = { checkedAt: new Date().toISOString(), origin, version: '0.1.0', status: 'request-pilot', cataloguePreserved: true, publicCatalogueProducts: products.length, checks, paidInstallerDelivery: 'Not tested or enabled: no signed installer, approved price or controlled desktop entitlement', signedLinkExpiry: 'Synthetic integration tests only; no production purchaser token issued' };
  fs.writeFileSync(path.join(directory, 'production-verification.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
