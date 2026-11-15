'use strict';
const crypto = require('node:crypto');
const blob = require('@vercel/blob');
const { endpoint, HttpError, equal } = require('../lib/http');
const { emailEnabled } = require('../lib/config');
const { importProducts } = require('../lib/product-import');
const path = 'rental-income-arrears-ledger/v1.0.0/rental-income-arrears-ledger-v1.0.0-customer.zip';
const size = 445394;
const sha256 = 'be0937611b59586e115b6f12ec49a981ff472a44b1d650d57092683b4fe383fc';

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > size) throw new HttpError(413, 'Release file is too large.');
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  if (body.length !== size || crypto.createHash('sha256').update(body).digest('hex') !== sha256) {
    throw new HttpError(400, 'Release file did not match the approved package.');
  }
  return body;
}

async function verifyStored(options) {
  const metadata = await blob.head(path, options);
  if (!metadata.url.endsWith(path) || !metadata.url.includes('.private.blob.vercel-storage.com/') || metadata.size !== size) {
    throw new Error('Private release metadata verification failed.');
  }
  const result = await blob.get(path, { ...options, access: 'private', useCache: false });
  if (result?.statusCode !== 200 || !result.stream) throw new Error('Private release read-back failed.');
  const digest = crypto.createHash('sha256');
  const reader = result.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      digest.update(value);
    }
  } finally { reader.releaseLock(); }
  if (digest.digest('hex') !== sha256) throw new Error('Private release checksum verification failed.');
}

const getStatus = endpoint('GET', async (req, res) => res.status(200).json({ emailEnabled: emailEnabled() }));
const upload = endpoint('POST', async (req, res) => {
  const secret = process.env.RENTAL_RELEASE_UPLOAD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'Release upload is unavailable.');
  if (!equal(req.headers.authorization, `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized.');
  if (req.headers['content-type'] !== 'application/zip' || Number(req.headers['content-length']) !== size) {
    throw new HttpError(400, 'Invalid release request.');
  }
  const buffer = await readBody(req);
  const options = { abortSignal: AbortSignal.timeout(120000) };
  let existing;
  try { existing = await blob.head(path, options); }
  catch (error) { if (!(error instanceof blob.BlobNotFoundError)) throw error; }
  if (!existing) {
    await blob.put(path, buffer, { ...options, access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip' });
  }
  await verifyStored(options);
  const catalogue = await importProducts(['rental-income-arrears-ledger']);
  return res.status(200).json({ uploaded: true, verified: true, bytes: size, sha256, catalogue });
});

module.exports = (req, res) => req.method === 'GET' ? getStatus(req, res) : upload(req, res);
module.exports.config = { api: { bodyParser: false } };
