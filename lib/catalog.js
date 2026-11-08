'use strict';
const { query } = require('./db');
const { currencies, ready } = require('./config');
const { quote, usdEquivalent } = require('./campus-pricing');
const campusPackages = {
  'campus-bursary-package-a': 'a',
  'campus-bursary-package-b': 'b',
  'campus-bursary-full-excel': 'excel'
};

function normalize(row) {
  const amounts = Object.fromEntries(Object.entries(row.amounts || {}).filter(([currency, amount]) =>
    currencies().includes(currency) && Number.isSafeInteger(amount) && amount >= 100));
  const assets = Array.isArray(row.blob_pathnames) ? row.blob_pathnames.filter(path =>
    typeof path === 'string' && path.length > 0 && path.length <= 1024 && !/[\r\n\x00]/.test(path) && !path.includes('://') && !path.startsWith('/')) : [];
  const deliverable = row.delivery_ready === true && assets.length > 0 && assets.length === row.blob_pathnames?.length;
  return { ...row, amounts, assets, available: row.status === 'published' && deliverable && Object.keys(amounts).length > 0 };
}
async function getProduct(id) {
  const rows = await query(`products?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows.length ? normalize(rows[0]) : null;
}
async function getPublicProducts() {
  const rows = await query('products?status=eq.published&select=id,name,category,short,description,features,amounts,status,delivery_ready,blob_pathnames&order=created_at.desc');
  const enabled = ready();
  return rows.map(normalize).map(p => {
    const pricing = campusPackages[p.id] ? quote(campusPackages[p.id]) : null;
    return {
      id: p.id, name: p.name, category: p.category, short: p.short, description: p.description,
      features: Array.isArray(p.features) ? p.features.filter(f => typeof f === 'string') : [],
      amounts: p.amounts,
      price: Object.entries(p.amounts).map(([currency, amount]) => new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(amount / 100)).join(' / '),
      ...(pricing && Number.isSafeInteger(p.amounts.NGN) ? { usdReference: usdEquivalent(p.amounts.NGN), usdRateDate: pricing.reference.date } : {}),
      paymentEnabled: enabled && p.available, status: 'live'
    };
  });
}
module.exports = { normalize, getProduct, getPublicProducts };
