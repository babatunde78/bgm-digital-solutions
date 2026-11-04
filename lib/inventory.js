'use strict';
const { query } = require('./db');
const storage = require('./storage');

// Only returned through the bearer-protected operator route; never a public catalogue.
async function inventory() {
  const products = await query('products?select=id,name,category,short,description,features,amounts,status,delivery_ready,blob_pathnames&order=created_at.desc');
  const files = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const result = await storage.list(cursor);
    files.push(...result.blobs.map(blob => ({ pathname: blob.pathname, size: blob.size })));
    if (!result.hasMore) return { products, files, complete: true };
    if (!result.cursor || result.cursor === cursor) throw new Error('Invalid storage pagination');
    cursor = result.cursor;
  }
  return { products, files, complete: false };
}
module.exports = { inventory };
