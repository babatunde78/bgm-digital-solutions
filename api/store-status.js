'use strict';
const crypto = require('node:crypto');
const { handleUpload } = require('@vercel/blob/client');
const { get, head } = require('@vercel/blob');
const { endpoint, HttpError, equal } = require('../lib/http');
const { emailEnabled } = require('../lib/config');

const pathname = 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip';
const size = 126638654;
const sha256 = 'da610514c0afea27c49edee17f6c44091c303b6c82814f823812269ba8398bf5';

async function verifyStored() {
  const options = { abortSignal: AbortSignal.timeout(150000) };
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
    await verifyStored();
    return res.status(200).json({ verified: true, pathname, size, sha256 });
  }
  return res.status(200).json({ emailEnabled: emailEnabled() });
});

const upload = endpoint('POST', async (req, res) => {
  const secret = process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'Release upload is unavailable.');
  const result = await handleUpload({
    body: req.body,
    request: req,
    onBeforeGenerateToken: async (requestedPath, clientPayload) => {
      if (!equal(clientPayload, secret)) throw new HttpError(401, 'Unauthorized.');
      if (requestedPath !== pathname) throw new HttpError(400, 'Invalid release path.');
      return {
        allowedContentTypes: ['application/zip'],
        maximumSizeInBytes: size,
        addRandomSuffix: false,
        tokenPayload: JSON.stringify({ pathname, size, sha256 }),
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      if (blob.pathname !== pathname || tokenPayload !== JSON.stringify({ pathname, size, sha256 })) {
        throw new Error('Unexpected release upload.');
      }
      await verifyStored();
    },
  });
  return res.status(200).json(result);
});

module.exports = (req, res) => req.method === 'GET' ? getStatus(req, res) : upload(req, res);
