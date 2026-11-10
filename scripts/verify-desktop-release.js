'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { assetDigest } = require('../lib/asset-integrity');
const origin = 'https://www.bgmsolutions.site';
const directory = path.resolve(__dirname, '../.product-work/campus-bursary-documents/v0.1.1/production-verification-2026-11-10');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function run() {
  if (!['--before', '--after'].includes(process.argv[2])) throw new Error('Use --before before publication, then --after to verify the live release. Read-only requests only.');
  fs.mkdirSync(directory, { recursive: true });
  const catalogue = await fetch(`${origin}/api/catalog`, { signal: AbortSignal.timeout(20000) });
  assert.equal(catalogue.status, 200, 'Public catalogue must be available');
  const data = await catalogue.json(); assert.ok(Array.isArray(data.products));
  const products = data.products.toSorted((a, b) => a.id.localeCompare(b.id));
  const baseline = path.join(directory, 'catalogue-before.json');
  if (process.argv[2] === '--before') {
    fs.writeFileSync(baseline, JSON.stringify(products, null, 2), { flag: 'wx' });
    assert.equal(products.length, 10, 'The existing catalogue baseline must contain ten products before publication');
    assert.ok(!products.some(product => product.id === 'campus-bursary-documents'), 'Desktop release must not appear before publication');
    process.stdout.write(`Snapshotted ${products.length} public catalogue products before release. No customer or order records accessed.\n`); return;
  }
  const priorProducts = JSON.parse(fs.readFileSync(baseline, 'utf8'));
  const desktopProducts = products.filter(product => product.id === 'campus-bursary-documents');
  assert.equal(desktopProducts.length, 1, 'The released desktop product must appear exactly once');
  assert.equal(products.length, priorProducts.length + 1, 'Only the desktop product may be added');
  assert.deepEqual(products.filter(product => product.id !== 'campus-bursary-documents'), priorProducts, 'Existing catalogue products, prices and availability must be preserved');
  const desktop = desktopProducts[0];
  assert.equal(desktop.status, 'live');
  assert.equal(desktop.paymentEnabled, true);
  assert.deepEqual(desktop.amounts, { NGN: 20000000 });
  const release = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../campus-documents-release.json'), 'utf8'));
  assert.equal(release.status, 'live');
  assert.equal(release.paymentEnabled, true);
  assert.equal(release.deliveryReady, true);
  assert.equal(release.installer.published, true);
  assert.equal(release.installer.sha256, '713f2984c64c95408317b0cf02580c717a84585deaa0e74696684e16fb97dd7b');
  assert.equal(release.installer.downloadUrl, null, 'Paid installer must not have a permanent public URL');
  const paths = [
    ['/campus-documents.html', 200], ['/campus-documents-release.json', 200], ['/campus-documents.css', 200],
    ['/assets/campus-documents-pilot.png', 200],
    ['/assets/campus-documents-samples/receipt.pdf', 200],
    ['/assets/campus-documents-samples/statement.pdf', 200],
    ['/assets/campus-documents-samples/voucher.pdf', 200],
    ['/api/download?token=invalid', 401],
    ['/api/verify-payment?reference=invalid', 401], ['/api/process-payments?check=readiness', 401],
    ['/desktop/main.js', 404], ['/.env.local', 404]
  ];
  const checks = await Promise.all(paths.map(async ([pathname, expected]) => {
    const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, expected, pathname);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (pathname === '/campus-documents-release.json') assert.deepEqual(JSON.parse(bytes), release);
    if (['/campus-documents.html', '/campus-documents.css', '/assets/campus-documents-pilot.png', '/assets/campus-documents-samples/receipt.pdf', '/assets/campus-documents-samples/statement.pdf', '/assets/campus-documents-samples/voucher.pdf'].includes(pathname)) {
      const localBytes = fs.readFileSync(path.resolve(__dirname, '..', pathname.slice(1)));
      const text = pathname.endsWith('.html') || pathname.endsWith('.css');
      assert.equal(assetDigest(bytes, text), assetDigest(localBytes, text), `Deployed asset differs: ${pathname}`);
    }
    if (pathname === '/campus-documents.html') {
      const page = bytes.toString('utf8');
      assert.match(page, /Available now\./);
      assert.match(page, /product\.html\?id=campus-bursary-documents/);
      assert.doesNotMatch(page, /Sales and downloads are not open|Preview only\./);
    }
    return { pathname, status: response.status, sha256: expected === 200 ? digest(bytes) : null };
  }));
  const report = { checkedAt: new Date().toISOString(), origin, version: release.version, status: 'live', cataloguePreserved: true, existingProductsPreserved: priorProducts.length, publicCatalogueProducts: products.length, desktopPriceMinor: desktop.amounts.NGN, paymentEnabled: desktop.paymentEnabled, deliveryReady: release.deliveryReady, installerSha256: release.installer.sha256, checks, signedPurchaserFlow: 'Unauthenticated denials verified; valid purchaser flow and signed-link expiry remain covered by synthetic integration tests only.' };
  fs.writeFileSync(path.join(directory, 'production-verification.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
