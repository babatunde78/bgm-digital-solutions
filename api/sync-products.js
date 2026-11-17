'use strict';
const { createHash } = require('node:crypto');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');
const { endpoint, equal, body, HttpError } = require('../lib/http');
const { importProducts } = require('../lib/product-import');
module.exports = endpoint('POST', async (req, res) => {
  if (process.env.FURNITURE_RELEASE_UPLOAD_TOKEN && equal(req.headers.authorization, `Bearer ${process.env.FURNITURE_RELEASE_UPLOAD_TOKEN}`)) {
    const expectedHash = '0cc8ba13b4733bf90869c3c02c3d9bd254d2fcb9e5bdd5e3bc58bd5a72c42b87';
    const expectedSize = 224765;
    const pathname = 'furniture-quote-invoice/v1.0.0/furniture-quote-invoice-v1.0.0-customer.zip';
    const input = req.body;
    if (!String(req.headers['content-type'] || '').startsWith('application/json') || !input || typeof input.zipBase64 !== 'string' || input.zipBase64.length > 320000) throw new HttpError(400, 'Invalid release archive request.');
    const archive = Buffer.from(input.zipBase64, 'base64');
    const sha256 = createHash('sha256').update(archive).digest('hex');
    if (archive.length !== expectedSize || archive.toString('base64') !== input.zipBase64 || sha256 !== expectedHash) throw new HttpError(422, 'Release archive did not match the approved package.');
    let stored;
    try { stored = await head(pathname); }
    catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
    if (!stored) await put(pathname, archive, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip' });
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || result.blob.size !== expectedSize) throw new HttpError(502, 'Private storage read-back failed.');
    const digest = createHash('sha256');
    const reader = result.stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        digest.update(value);
      }
    } finally { reader.releaseLock(); }
    if (digest.digest('hex') !== expectedHash) throw new HttpError(502, 'Stored archive checksum did not match.');
    return res.status(200).json({ pathname, size: expectedSize, sha256: expectedHash });
  }
  if (!process.env.CRON_SECRET || !equal(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) throw new HttpError(401, 'Unauthorized');
  const input = body(req);
  return res.status(200).json(await importProducts(input.ids));
});
