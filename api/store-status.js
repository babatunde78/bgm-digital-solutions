'use strict';
const crypto = require('node:crypto');
const { handleUploadPresigned } = require('@vercel/blob/client');
const { get, head, issueSignedToken } = require('@vercel/blob');
const { endpoint, HttpError, equal, secure } = require('../lib/http');
const { emailEnabled } = require('../lib/config');
const { importProducts } = require('../lib/product-import');
const { query } = require('../lib/db');
const definition = require('../lib/product-import.json').find(item => item.id === 'questionnaire-data-checking');

const pathname = 'questionnaire-data-checking/v1.0.0/questionnaire-data-checking-v1.0.0-customer.zip';
const size = 18426207;
const sha256 = '6664b41d8104b130aecd999c6bb95c4673d21401ddae1213dc953c93588ac3a2';

function blobOptions(req) {
  const oidcToken = req.headers['x-vercel-oidc-token'];
  const storeId = process.env.BLOB_STORE_ID;
  if (typeof oidcToken !== 'string' || typeof storeId !== 'string') throw new Error('Private Blob authentication is unavailable.');
  return { oidcToken, storeId, abortSignal: AbortSignal.timeout(120000) };
}

async function verifyStored(req) {
  const options = blobOptions(req);
  const metadata = await head(pathname, options);
  if (metadata.size !== size || !metadata.url.endsWith(pathname) || !metadata.url.includes('.private.blob.vercel-storage.com/')) {
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

const status = endpoint('GET', async (req, res) => {
  const secret = process.env.QUESTIONNAIRE_RELEASE_UPLOAD_TOKEN;
  if (typeof secret === 'string' && secret.length >= 32 && equal(req.headers.authorization, `Bearer ${secret}`)) {
    if (req.headers['x-questionnaire-preflight'] === '1') {
      return res.status(200).json({ oidcHeaderPresent: typeof req.headers['x-vercel-oidc-token'] === 'string', storeIdPresent: typeof process.env.BLOB_STORE_ID === 'string' });
    }
    await verifyStored(req);
    return res.status(200).json({ verified: true, pathname, size, sha256 });
  }
  return res.status(200).json({ emailEnabled: emailEnabled() });
});

const upload = endpoint('POST', async (req, res) => {
  const secret = process.env.QUESTIONNAIRE_RELEASE_UPLOAD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'Release upload is unavailable.');
  if (req.body?.action === 'publish') {
    if (!equal(req.headers.authorization, `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized.');
    await verifyStored(req);
    await importProducts([definition.id]);
    const fields = 'id,name,category,short,description,features,amounts,status,delivery_ready,blob_pathnames';
    const select = `products?id=eq.${definition.id}&select=${fields}`;
    const row = (await query(select))?.[0];
    const matches = row && ['id','name','category','short','description','features','amounts','blob_pathnames']
      .every(key => JSON.stringify(row[key]) === JSON.stringify(definition[key]));
    if (!matches || !['draft','published'].includes(row.status)) throw new Error('Catalogue row does not match the reviewed release.');
    if (row.status === 'draft') await query(`products?id=eq.${definition.id}&status=eq.draft`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'published', delivery_ready: true })
    });
    const published = (await query(select))?.[0];
    if (!published || published.status !== 'published' || published.delivery_ready !== true ||
        published.amounts?.NGN !== 1500000 || JSON.stringify(published.blob_pathnames) !== JSON.stringify(definition.blob_pathnames)) {
      throw new Error('Published product failed read-back verification.');
    }
    return res.status(200).json({ published: true, id: definition.id, amountNGNSubunits: published.amounts.NGN, pathname });
  }
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
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      if (blob.pathname !== pathname || tokenPayload !== JSON.stringify({ pathname, size, sha256 })) throw new Error('Unexpected private release upload.');
      await verifyStored(req);
    },
  });
  return res.status(200).json(response);
});

module.exports = (req, res) => {
  secure(res);
  if (req.method === 'GET') return status(req, res);
  if (req.method === 'POST') return upload(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
};
module.exports.config = { maxDuration: 180 };
