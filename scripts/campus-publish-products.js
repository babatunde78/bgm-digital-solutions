'use strict';
const definitions = require('../lib/product-import.json').filter(product => ['campus-bursary-package-a', 'campus-bursary-package-b', 'campus-bursary-full-excel'].includes(product.id));
const { priceBook, quote } = require('../lib/campus-pricing');

function expectedProduct(product) {
  const pricing = quote(product.campusPackage);
  return {
    id: product.id,
    name: product.name.replace(/^Campus Bursary/, priceBook.productName),
    category: product.category,
    short: product.short,
    description: product.description,
    features: product.features,
    amounts: { NGN: pricing.firstYearKobo },
    delivery_ready: true,
    blob_pathnames: product.blob_pathnames
  };
}

function matchesRelease(row, expected) {
  return row.status === 'draft' || row.status === 'published'
    ? ['id', 'name', 'category', 'short', 'description', 'features', 'amounts', 'delivery_ready', 'blob_pathnames']
      .every(key => JSON.stringify(row[key]) === JSON.stringify(expected[key]))
    : false;
}

async function publishCampusProducts({ importProducts, query, verifyPrivateFile }) {
  const ids = definitions.map(product => product.id);
  const expected = definitions.map(expectedProduct);
  await importProducts(ids);
  const path = `products?id=in.(${ids.join(',')})&select=id,name,category,short,description,features,amounts,status,delivery_ready,blob_pathnames`;
  const rows = await query(path);
  if (!Array.isArray(rows) || rows.length !== expected.length) throw new Error('Campus catalogue rows do not match the approved release.');
  for (const product of expected) {
    const row = rows.find(item => item.id === product.id);
    if (!row || !matchesRelease(row, product)) throw new Error('Campus catalogue does not match the approved release.');
  }
  await Promise.all([...new Set(expected.flatMap(product => product.blob_pathnames))].map(verifyPrivateFile));
  const draftIds = rows.filter(row => row.status === 'draft').map(row => row.id);
  if (draftIds.length) {
    await query(`products?id=in.(${draftIds.join(',')})&status=eq.draft`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'published' })
    });
  }
  const published = await query(path);
  if (!Array.isArray(published) || published.length !== expected.length || published.some(row => row.status !== 'published')) {
    throw new Error('Campus catalogue publication could not be verified.');
  }
  return { published: ids };
}

async function verifyPrivateFile(path) {
  const storage = require('../lib/storage');
  const metadata = await storage.head(path);
  if (!metadata.url.includes('.private.blob.vercel-storage.com/') || metadata.size <= 0) {
    throw new Error('Campus product file is not in private storage.');
  }
  const result = await storage.get(path);
  if (result?.statusCode !== 200 || !result.stream) throw new Error('Campus private file cannot be read.');
  const reader = result.stream.getReader();
  try {
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) throw new Error('Campus private file is empty.');
  } finally {
    await reader.cancel();
  }
}

async function main() {
  if (!process.argv.includes('--publish')) throw new Error('Pass --publish to activate the Campus catalogue records.');
  const { importProducts } = require('../lib/product-import');
  const { query } = require('../lib/db');
  const result = await publishCampusProducts({ importProducts, query, verifyPrivateFile });
  process.stdout.write(`Published ${result.published.length} verified Campus products.\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error?.name || 'Error'}: Campus publication stopped. No secret or asset URL was printed.\n`);
  process.exitCode = 1;
});

module.exports = { publishCampusProducts };
