'use strict';
const { createHash } = require('node:crypto');
const { endpoint, HttpError } = require('../lib/http');
const { query } = require('../lib/db');
const storage = require('../lib/storage');

const productId = 'campus-bursary-documents';

module.exports = endpoint('GET', async (_req, res) => {
  if (process.env.VERCEL_ENV !== 'preview') throw new HttpError(404, 'Not found.');

  const rows = await query(`products?id=eq.${productId}&select=id,status,amounts,delivery_ready,blob_pathnames&limit=1`);
  const row = rows[0];
  const expectedPath = 'campus-bursary-documents/v0.1.1/campus-bursary-documents-setup-0.1.1.exe';
  if (!row || row.status !== 'draft' || row.delivery_ready !== false ||
      JSON.stringify(row.amounts) !== JSON.stringify({ NGN: 20000000 }) ||
      JSON.stringify(row.blob_pathnames) !== JSON.stringify([expectedPath])) {
    throw new HttpError(409, 'The desktop draft does not match its expected release record.');
  }

  const metadata = await storage.head(expectedPath);
  const origin = new URL(metadata.url);
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.private.blob.vercel-storage.com') ||
      !origin.pathname.endsWith(`/${expectedPath}`) || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw new HttpError(409, 'The desktop file is not a nonempty private asset.');
  }

  const result = await storage.get(expectedPath);
  if (result?.statusCode !== 200 || !result.stream || result.blob?.size !== metadata.size) {
    throw new HttpError(409, 'The private desktop file could not be read completely.');
  }
  const reader = result.stream.getReader();
  const digest = createHash('sha256');
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      digest.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes !== metadata.size) throw new HttpError(409, 'The private desktop file size changed during verification.');
  return res.status(200).json({
    productId,
    status: row.status,
    deliveryReady: row.delivery_ready,
    currency: 'NGN',
    priceMinorUnits: row.amounts.NGN,
    private: true,
    bytes,
    sha256: digest.digest('hex')
  });
});
