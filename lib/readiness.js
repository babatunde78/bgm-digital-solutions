'use strict';
const { query } = require('./db');
const { normalize } = require('./catalog');
const { mode, emailEnabled } = require('./config');
const paystack = require('./paystack');
const storage = require('./storage');

// Operator-only deployment check. Never returns provider/customer records or private paths.
async function readiness() {
  const environment = mode();
  await paystack.request('transaction?perPage=1');
  const rows = await query('products?status=eq.published&select=id,name,status,amounts,delivery_ready,blob_pathnames');
  const products = rows.map(normalize).filter(product => product.available);
  const checked = [];
  for (const product of products) {
    for (const path of product.assets) {
      const file = await storage.head(path);
      if (!new URL(file.url).hostname.endsWith('.private.blob.vercel-storage.com') || file.size <= 0) throw new Error('Private file readiness failed');
      const downloaded = await storage.get(path);
      if (downloaded?.statusCode !== 200 || !downloaded.stream) throw new Error('Private file read failed');
      const reader = downloaded.stream.getReader();
      try {
        const first = await reader.read();
        if (first.done || !first.value?.byteLength) throw new Error('Empty private file');
      } finally { await reader.cancel(); }
    }
    checked.push({ id: product.id, files: product.assets.length, privateDeliveryReady: true });
  }
  return { environment, paystackConnected: true, databaseConnected: true, emailEnabled: emailEnabled(), products: checked };
}
module.exports = { readiness };
