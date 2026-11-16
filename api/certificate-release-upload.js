'use strict';

const crypto = require('node:crypto');
const { handleUpload } = require('@vercel/blob/client');
const { get, head } = require('@vercel/blob');
const { HttpError, secure, equal } = require('../lib/http');

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

module.exports = async (req, res) => {
  secure(res);
  const secret = process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) return res.status(503).json({ error: 'Release upload is unavailable.' });

  if (req.method === 'GET') {
    if (!equal(req.headers.authorization, `Bearer ${secret}`)) return res.status(401).json({ error: 'Unauthorized.' });
    try {
      await verifyStored();
      return res.status(200).json({ verified: true, pathname, size, sha256 });
    } catch {
      return res.status(503).json({ error: 'Private release verification failed.' });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
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
        const verifiedPayload = JSON.stringify({ pathname, size, sha256 });
        if (blob.pathname !== pathname || tokenPayload !== verifiedPayload) throw new Error('Unexpected release upload.');
        await verifyStored();
      },
    });
    return res.status(200).json(result);
  } catch {
    return res.status(400).json({ error: 'Release upload request rejected.' });
  }
};

module.exports.config = { maxDuration: 180 };
