'use strict';
const crypto = require('node:crypto');
const { handleUploadPresigned } = require('@vercel/blob/client');
const { get, head, issueSignedToken } = require('@vercel/blob');
const { endpoint, HttpError, equal, secure } = require('../lib/http');
const { emailEnabled } = require('../lib/config');

const pathname = 'client-pack-assembler/v0.1.0/bgm-client-pack-assembler-v0.1.0-customer.zip';
const size = 125440135;
const sha256 = '54e1b6cccc469bcff09a464a0019b5fc8997d2ca031c2d8cfa6af52aea6ea733';

function blobOptions(req) {
  const oidcToken = req.headers['x-vercel-oidc-token'];
  const storeId = process.env.BLOB_STORE_ID;
  if (typeof oidcToken !== 'string' || typeof storeId !== 'string') throw new Error('Private Blob authentication is unavailable.');
  return { oidcToken, storeId, abortSignal: AbortSignal.timeout(120000) };
}

async function verifyStored(req) {
  const options = blobOptions(req);
  const metadata = await head(pathname, options);
  if (metadata.size !== size || !metadata.url.includes('.private.blob.vercel-storage.com/')) throw new Error('Private release metadata verification failed.');
  const result = await get(pathname, { ...options, access: 'private', useCache: false });
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

const getStatus = endpoint('GET', async (req, res) => {
  const secret = process.env.CLIENT_PACK_RELEASE_UPLOAD_TOKEN;
  if (typeof secret === 'string' && secret.length >= 32 && equal(req.headers.authorization, `Bearer ${secret}`)) {
    await verifyStored(req);
    return res.status(200).json({ verified: true, pathname, size, sha256 });
  }
  return res.status(200).json({ emailEnabled: emailEnabled() });
});

const upload = endpoint('POST', async (req, res) => {
  const secret = process.env.CLIENT_PACK_RELEASE_UPLOAD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'Release upload is unavailable.');
  const response = await handleUploadPresigned({
    body: req.body,
    request: req,
    getSignedToken: async (requestedPath, clientPayload) => {
      if (!equal(clientPayload, secret) || !equal(req.headers.authorization, `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized.');
      if (requestedPath !== pathname) throw new HttpError(400, 'Invalid release path.');
      const token = await issueSignedToken({
        ...blobOptions(req), pathname, operations: ['put'], validUntil: Date.now() + 10 * 60 * 1000,
        allowedContentTypes: ['application/zip'], maximumSizeInBytes: size,
      });
      return {
        token,
        urlOptions: {
          allowedContentTypes: ['application/zip'], maximumSizeInBytes: size, addRandomSuffix: false, allowOverwrite: false,
          tokenPayload: JSON.stringify({ pathname, size, sha256 }),
        },
      };
    },
  });
  return res.status(200).json(response);
});

module.exports = (req, res) => {
  secure(res);
  if (req.method === 'GET') return getStatus(req, res);
  if (req.method === 'POST') return upload(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
};
module.exports.config = { maxDuration: 180 };
