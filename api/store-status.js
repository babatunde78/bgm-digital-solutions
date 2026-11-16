'use strict';
const crypto = require('node:crypto');
const { handleUploadPresigned } = require('@vercel/blob/client');
const { get, head, issueSignedToken } = require('@vercel/blob');
const { endpoint, HttpError, equal } = require('../lib/http');
const { emailEnabled } = require('../lib/config');

const pathname = 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip';
const size = 126638654;
const sha256 = 'da610514c0afea27c49edee17f6c44091c303b6c82814f823812269ba8398bf5';

function blobOptions(req) {
  const oidcToken = req.headers['x-vercel-oidc-token'];
  const storeId = process.env.BLOB_STORE_ID;
  if (typeof oidcToken !== 'string' || typeof storeId !== 'string') throw new Error('Private Blob authentication is unavailable.');
  return { oidcToken, storeId, abortSignal: AbortSignal.timeout(150000) };
}

async function verifyStored(req) {
  const options = blobOptions(req);
  const metadata = await head(pathname, options);
  if (metadata.size !== size || !metadata.url.includes('.private.blob.vercel-storage.com/')) {
    throw new Error('Private release metadata verification failed.');
  }
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
  const secret = process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  if (typeof secret === 'string' && secret.length >= 32 && equal(req.headers.authorization, `Bearer ${secret}`)) {
    await verifyStored(req);
    return res.status(200).json({ verified: true, pathname, size, sha256 });
  }
  return res.status(200).json({ emailEnabled: emailEnabled() });
});

const upload = endpoint('POST', async (req, res) => {
  const secret = process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'Release upload is unavailable.');
  const result = await handleUploadPresigned({
    body: req.body,
    request: req,
    getSignedToken: async (requestedPath, clientPayload) => {
      if (!equal(clientPayload, secret)) throw new HttpError(401, 'Unauthorized.');
      if (requestedPath !== pathname) throw new HttpError(400, 'Invalid release path.');
      const options = {
        ...blobOptions(req),
        pathname,
        operations: ['put'],
        validUntil: Date.now() + 20 * 60 * 1000,
        allowedContentTypes: ['application/zip'],
        maximumSizeInBytes: size,
      };
      const token = await issueSignedToken(options);
      return {
        token,
        urlOptions: {
          allowedContentTypes: ['application/zip'],
          maximumSizeInBytes: size,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ pathname, size, sha256 }),
        },
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      if (blob.pathname !== pathname || tokenPayload !== JSON.stringify({ pathname, size, sha256 })) {
        throw new Error('Unexpected release upload.');
      }
      await verifyStored(req);
    },
  });
  return res.status(200).json(result);
});

module.exports = (req, res) => req.method === 'GET' ? getStatus(req, res) : upload(req, res);
