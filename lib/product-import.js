'use strict';
const definitions = require('./product-import.json');
const { query } = require('./db');
const { normalize } = require('./catalog');
const storage = require('./storage');
const { HttpError } = require('./http');
const { quote, priceBook } = require('./campus-pricing');
const GUIDE_IDS = ['500-business-prompts', 'ai-side-hustles', 'remote-job-2026-2027', 'scholarships-abroad', 'first-upwork-client'];
const CAMPUS_PRODUCTS = new Set(['campus-bursary-package-a', 'campus-bursary-package-b', 'campus-bursary-full-excel']);

async function importProducts(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > definitions.length || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !definitions.some(product => product.id === id))) {
    throw new HttpError(400, 'Select known product IDs for import.');
  }
  const existing = await query('products?select=id,name,status,amounts,delivery_ready,blob_pathnames');
  const byId = new Map(existing.map(product => [product.id, product]));
  const rows = definitions.filter(product => ids.includes(product.id) && !byId.has(product.id)).map(product => {
    if (CAMPUS_PRODUCTS.has(product.id)) {
      const pricing = quote(product.campusPackage);
      const { campusPackage, ...fields } = product;
      return { ...fields, name: fields.name.replace(/^Campus Bursary/, priceBook.productName), amounts: { NGN: pricing.firstYearKobo }, delivery_ready: true };
    }
    return { ...product, status: product.status || 'published', delivery_ready: true };
  });
  const bundle = rows.find(product => product.id === 'five-guide-bundle');
  if (bundle) {
    bundle.blob_pathnames = [...new Set(GUIDE_IDS.flatMap(id => {
      const product = byId.get(id) || rows.find(row => row.id === id);
      if (!product || !normalize(product).available) throw new HttpError(409, 'Publish all five deliverable guides before importing the bundle.');
      return product.blob_pathnames;
    }))];
  }
  for (const row of rows) if (!normalize({ ...row, status: 'published' }).available) throw new HttpError(400, 'Product definition is not deliverable.');
  // Validate every asset before writing any catalogue rows. Bundled files are checked once.
  const paths = [...new Set(rows.flatMap(row => row.blob_pathnames))];
  await Promise.all(paths.map(async path => {
    const file = await storage.head(path);
    if (!new URL(file.url).hostname.endsWith('.private.blob.vercel-storage.com') || file.size <= 0) throw new HttpError(409, 'Product files must exist in private storage.');
    const result = await storage.get(path);
    if (result?.statusCode !== 200 || !result.stream) throw new HttpError(409, 'A buyer file cannot be downloaded.');
    const reader = result.stream.getReader();
    try { const first = await reader.read(); if (first.done || !first.value?.byteLength) throw new HttpError(409, 'A buyer file is empty.'); }
    finally { await reader.cancel(); }
  }));
  const created = rows.length ? await query('products?on_conflict=id', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows)
  }) : [];
  return {
    imported: (created || []).map(product => ({ id: product.id, name: product.name, status: product.status })),
    preserved: existing.filter(product => ids.includes(product.id)).map(product => ({ id: product.id, status: product.status })),
    checkedFiles: paths.length
  };
}
module.exports = { importProducts };
