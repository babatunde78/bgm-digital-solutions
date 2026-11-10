'use strict';
const storage = require('../lib/storage');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { endpoint, HttpError } = require('../lib/http');
const { verify } = require('../lib/tokens');
const { query, rateLimit } = require('../lib/db');
const { mode } = require('../lib/config');
const { getProduct } = require('../lib/catalog');
const CAMPUS_EXCEL_PRODUCTS = new Set(['campus-bursary-package-a', 'campus-bursary-package-b', 'campus-bursary-full-excel']);
const CAMPUS_DESKTOP_ASSET = 'campus-bursary-documents/v0.1.1/campus-bursary-documents-setup-0.1.1.exe';
module.exports = endpoint('GET', async (req, res) => {
  const token = verify(req.query.token, 'download') || verify(req.query.token, 'campus-desktop-upgrade');
  if (!token) throw new HttpError(401, 'This download link has expired or is invalid. Reopen your purchase page for fresh links.');
  await rateLimit(req, 'download', 30);
  const rows = await query(`store_orders?id=eq.${token.order}&select=*&limit=1`);
  const order = rows[0];
  if (!order || order.status !== 'paid' || order.revoked_at || order.environment !== mode()) throw new HttpError(403, 'Purchase access is unavailable. Please contact support.');
  let path;
  if (token.purpose === 'campus-desktop-upgrade') {
    if (!CAMPUS_EXCEL_PRODUCTS.has(order.product_id)) throw new HttpError(403, 'This purchase does not include the Campus desktop upgrade.');
    const desktop = await getProduct('campus-bursary-documents');
    if (!desktop?.available || !desktop.assets.includes(CAMPUS_DESKTOP_ASSET)) throw new HttpError(404, 'The Campus desktop upgrade is not available.');
    path = CAMPUS_DESKTOP_ASSET;
  } else {
    if (token.file >= order.assets.length) throw new HttpError(404, 'File not found');
    path = order.assets[token.file];
  }
  const result = await storage.get(path);
  if (result?.statusCode !== 200 || !result.stream) throw new HttpError(404, 'The file is temporarily unavailable. Please contact support.');
  const filename = path.split('/').pop().replace(/[\x00-\x1f\x7f"\\]/g, '_');
  res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await pipeline(Readable.fromWeb(result.stream), res);
});
