const { getProduct } = require('./_catalog');

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}

async function verifyTransaction(reference) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  const result = await response.json();
  const data = result.data || {};
  const metadata = parseMetadata(data.metadata);
  const productId = typeof metadata.product_id === 'string' ? metadata.product_id : '';
  const product = productId ? await getProduct(productId) : null;
  const expected = product?.amounts?.[String(data.currency || '').toUpperCase()];
  const valid = Boolean(response.ok && result.status && data.status === 'success' &&
    product && product.enabled && Number.isInteger(expected) && Number(data.amount) === expected);
  return { valid, response, result, data, metadata, product };
}

module.exports = { verifyTransaction, parseMetadata };
