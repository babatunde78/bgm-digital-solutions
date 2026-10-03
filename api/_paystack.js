const PRODUCTS = require('./_products');

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function verifyTransaction(reference) {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
  });
  const result = await response.json();
  const d = result.data || {};
  const metadata = parseMetadata(d.metadata);
  const product = PRODUCTS[metadata.product_id];
  const expected = product && product.amounts && product.amounts[d.currency];
  const valid = Boolean(
    response.ok && result.status && d.status === 'success' && product &&
    Number.isInteger(expected) && d.amount === expected
  );
  return { valid, response, result, data: d, metadata, product };
}

module.exports = { verifyTransaction, parseMetadata };
