'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const definitions = require('../lib/product-import.json').filter(item => item.id.startsWith('campus-bursary-'));
const { priceBook, quote } = require('../lib/campus-pricing');
const { publishCampusProducts } = require('../scripts/campus-publish-products');

function setup(status = 'draft') {
  const calls = [];
  let rows = definitions.map(product => ({
    ...Object.fromEntries(Object.entries(product).filter(([key]) => !['campusPackage', 'status', 'amounts'].includes(key))),
    name: product.name.replace(/^Campus Bursary/, priceBook.productName),
    amounts: { NGN: quote(product.campusPackage).firstYearKobo },
    delivery_ready: true,
    status
  }));
  const query = async (path, options = {}) => {
    calls.push({ path, options });
    if (options.method === 'PATCH') {
      rows = rows.map(row => row.status === 'draft' ? { ...row, status: 'published' } : row);
      return rows.filter(row => row.status === 'published');
    }
    return rows;
  };
  return { calls, query, rows: () => rows };
}

test('Campus publication validates every exact package record and private file before publishing', async () => {
  const state = setup();
  const imported = [];
  const verifiedFiles = [];
  const result = await publishCampusProducts({
    importProducts: async ids => { imported.push(...ids); return { checkedFiles: 3 }; },
    query: state.query,
    verifyPrivateFile: async path => { verifiedFiles.push(path); }
  });
  assert.deepEqual(imported, definitions.map(product => product.id));
  assert.deepEqual(verifiedFiles.sort(), definitions.map(product => product.blob_pathnames[0]).sort());
  assert.equal(state.calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.deepEqual(state.rows().map(row => row.status), ['published', 'published', 'published']);
  assert.deepEqual(result.published, definitions.map(product => product.id));
});

test('Campus publication refuses a mismatched stored price without changing catalogue status', async () => {
  const state = setup();
  const query = async (path, options) => {
    const rows = await state.query(path, options);
    if (!options?.method) rows[0].amounts.NGN++;
    return rows;
  };
  await assert.rejects(publishCampusProducts({
    importProducts: async () => ({ checkedFiles: 3 }), query,
    verifyPrivateFile: async () => {}
  }), /does not match the approved release/);
  assert.equal(state.calls.some(call => call.options.method === 'PATCH'), false);
  assert.deepEqual(state.rows().map(row => row.status), ['draft', 'draft', 'draft']);
});

test('Campus publication does not run a partial catalogue write when a private file fails verification', async () => {
  const state = setup();
  await assert.rejects(publishCampusProducts({
    importProducts: async () => ({ checkedFiles: 3 }), query: state.query,
    verifyPrivateFile: async path => { if (path === definitions[1].blob_pathnames[0]) throw new Error('private file verification failed'); }
  }), /private file verification failed/);
  assert.equal(state.calls.some(call => call.options.method === 'PATCH'), false);
  assert.deepEqual(state.rows().map(row => row.status), ['draft', 'draft', 'draft']);
});

test('Campus publication is idempotent for already published matching products', async () => {
  const state = setup('published');
  const result = await publishCampusProducts({
    importProducts: async () => ({ checkedFiles: 3 }), query: state.query,
    verifyPrivateFile: async () => {}
  });
  assert.equal(state.calls.some(call => call.options.method === 'PATCH'), false);
  assert.deepEqual(result.published, definitions.map(product => product.id));
});
