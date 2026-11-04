'use strict';
// Only imports an independently verified historical payment; never starts a charge.
const crypto = require('node:crypto');
const legacy = require('../api/_products');
const { reference } = require('../lib/http');
const { mode } = require('../lib/config');
const { rpc, orderByReference, query } = require('../lib/db');
const paystack = require('../lib/paystack');
async function main() {
  const ref = reference(process.argv[2]);
  const existing = await orderByReference(ref);
  if (existing) { console.log('This reference is already recorded; no changes made.'); return; }
  const data = await paystack.verify(ref);
  const meta = paystack.metadata(data.metadata);
  const product = Object.hasOwn(legacy,meta.product_id) ? legacy[meta.product_id] : null;
  if (!product || data.status !== 'success' || data.reference !== ref || data.domain !== mode() ||
      !Object.hasOwn(product.amounts,data.currency) || product.amounts[data.currency] !== data.amount ||
      !data.customer?.email || !product.blobPathnames?.length || !data.id) throw new Error('Historical payment requires manual review.');
  // Require the buyer files to exist privately before importing entitlement.
  const storage = require('../lib/storage');
  await Promise.all(product.blobPathnames.map(async path => {
    const file=await storage.head(path);
    if (!new URL(file.url).hostname.endsWith('.private.blob.vercel-storage.com')) throw new Error('Private delivery required');
  }));
  const order = await rpc('store_create_order', {
    p_key:crypto.randomUUID(),p_session:crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
    p_email:data.customer.email.toLowerCase(),p_environment:mode(),p_product:meta.product_id,p_name:product.name,
    p_amount:data.amount,p_currency:data.currency,p_assets:product.blobPathnames,p_reference:ref
  });
  await rpc('store_confirm_order',{p_order:order.id,p_transaction:String(data.id)});
  console.log('Historical purchase imported. Use the support-access script after verifying the buyer.');
}
main().catch(()=>{console.error('Import failed. Check this reference and order records before retrying. No payment was initiated.');process.exitCode=1});
