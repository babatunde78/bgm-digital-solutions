'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
async function interfaceFixture(t, handlers = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { url: 'file:///synthetic/index.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const state = { config: null, release: { productName: 'Synthetic pilot', version: '0.1.0' }, licence: { label: 'Synthetic development pilot' }, documents: [], jobs: [], records: [{ reference: '00001', student: '0001', name: 'Synthetic Student', date: '2026-11-09', kind: 'payment', currency: 'NGN', minor: '10000' }] };
  const requests = [];
  dom.window.bursary = { call: async (action, input) => {
    requests.push({ action, input: JSON.parse(JSON.stringify(input || {})) });
    const value = action === 'state' ? state : handlers[action] ? await handlers[action](input) : true;
    return { ok: true, value };
  } };
  dom.window.eval(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8') + '\nwindow.testRefresh = refresh;');
  await new Promise(resolve => setImmediate(resolve));
  return { dom, state, requests, document: dom.window.document };
}
test('recorded officer field is available before the institution setup form', async t => {
  const ui = await interfaceFixture(t);
  const actor = ui.document.querySelector('#actor');
  assert.ok(actor.compareDocumentPosition(ui.document.querySelector('#setup-form')) & ui.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(ui.document.querySelectorAll('#actor').length, 1);
});
test('record selection survives a job-progress refresh', async t => {
  const ui = await interfaceFixture(t);
  ui.document.querySelector('#records input').checked = true;
  ui.state.jobs = [{ id: 'synthetic-job', document: 'CBD-1', state: 'running', attempts: 1, error: null }];
  await ui.dom.window.testRefresh();
  assert.deepEqual([...ui.document.querySelectorAll('#records input:checked')].map(input => input.value), ['00001']);
});
test('cancelled file choice preserves the visible staged batch for acceptance', async t => {
  const preview = { id: 'synthetic-batch', count: 1, totalMinor: '10000', errors: [], rows: [], state: 'staged' };
  const choices = [preview, null];
  const ui = await interfaceFixture(t, { import: () => choices.shift() });
  ui.document.querySelector('#actor').value = 'Demo Reviewer';
  ui.document.querySelector('#source').value = 'Synthetic source';
  ui.document.querySelector('#evidence').value = 'Synthetic confirmation';
  await ui.document.querySelector('#import').onclick();
  await ui.document.querySelector('#import').onclick();
  assert.equal(ui.document.querySelector('#accept').disabled, false);
  await ui.document.querySelector('#accept').onclick();
  assert.deepEqual(ui.requests.filter(request => request.action === 'accept').map(request => request.input.id), ['synthetic-batch']);
});
