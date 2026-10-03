const { get } = require('@vercel/blob');
const { Readable } = require('node:stream');
const PRODUCTS = require('./_products');
const { verify } = require('./_delivery-token');
const { verifyTransaction } = require('./_paystack');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');
  try {
    const payload = verify(req.query.token);
    if (!payload) return res.status(401).end('This download link is invalid or has expired. Return to your payment confirmation page to verify again.');
    const v = await verifyTransaction(payload.reference);
    if (!v.valid || v.metadata.product_id !== payload.productId || String(v.data.customer?.email||'').toLowerCase() !== payload.email) {
      return res.status(403).end('Purchase verification failed.');
    }
    const product = PRODUCTS[payload.productId];
    const pathname = product?.blobPathnames?.[0];
    if (!pathname) return res.status(404).end('Product file is not configured.');
    const result = await get(pathname, { access:'private' });
    if (!result || result.statusCode !== 200) return res.status(404).end('Product file was not found.');
    const filename = pathname.split('/').pop().replace(/["\r\n]/g,'');
    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','private, no-store');
    Readable.fromWeb(result.stream).pipe(res);
  } catch(e) {
    res.status(500).end('Secure download is temporarily unavailable.');
  }
};
