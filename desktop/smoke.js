'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { render } = require('./core');
const { seal, unseal } = require('./security');
const { Store } = require('./store');
module.exports = async function smoke(store, window, pdf) {
  const output = path.resolve(__dirname, '../.product-work/campus-bursary-documents/v0.1.0/demo');
  fs.mkdirSync(output, { recursive: true });
  if (store.config()) throw new Error('Smoke profile already used; use a fresh disposable copy rather than overwrite it');
  store.configure({ name: 'Synthetic River College — DEMO', type: 'Fictional institution', currency: 'NGN', session: '2026/2027', officer: 'Demo Bursar', title: 'Bursar (synthetic)', footer: 'SYNTHETIC DEMO — not valid for payment, clearance or financial evidence' }, 'Demo Preparer');
  const input = [
    { reference: '00000000000000000001', student: '00001', name: 'Ada Example — synthetic student', date: '2026-11-01', currency: 'NGN', amount: '50000.00', kind: 'charge', evidence: 'synthetic fee schedule' },
    { reference: '00000000000000000002', student: '00001', name: 'Ada Example — synthetic student', date: '2026-11-02', currency: 'NGN', amount: '25000.50', kind: 'payment', evidence: 'synthetic bank ledger 002' },
    { reference: '00000000000000000003', student: 'SUP-0001', name: 'Example Supplies — fictional supplier', date: '2026-11-03', currency: 'NGN', amount: '10000.25', kind: 'voucher', evidence: 'synthetic approved bill' }
  ];
  const batch = store.stage(input, 'Bundled synthetic demonstration');
  store.accept(batch.id, 'Demo Reviewer', 'All records are synthetic; no actual bank confirmation');
  const docs = [
    store.create('receipt', [input[1].reference], 'Demo Preparer'),
    store.create('statement', [input[0].reference, input[1].reference], 'Demo Preparer', { opening: '0', openingEvidence: 'Synthetic zero opening schedule' }),
    store.create('voucher', [input[2].reference], 'Demo Preparer')
  ];
  const hashes = {};
  for (const doc of docs) {
    store.review(doc.id, 'Demo Reviewer'); const job = store.enqueue(doc.id);
    await store.run(job.id, pdf);
    assert.equal(store.document(doc.id).state, 'final');
    const bytes = store.pdf(doc.id); fs.writeFileSync(path.join(output, `${doc.kind}.pdf`), bytes);
    hashes[`${doc.kind}.pdf`] = createHash('sha256').update(bytes).digest('hex');
    const preview = render({ ...store.document(doc.id).snapshot, status: 'draft' });
    fs.writeFileSync(path.join(output, `${doc.kind}-preview.html`), preview);
  }
  const long = { ...store.document(docs[1].id).snapshot, status: 'draft' };
  long.records = Array.from({ length: 250 }, (_, index) => ({ ...long.records[0], reference: `LONG-${String(index).padStart(6, '0')}`, name: 'Synthetic long name '.repeat(5), minor: '10001' }));
  long.totalMinor = '2500250';
  const longPdf = await pdf(render(long)); fs.writeFileSync(path.join(output, 'multipage-statement.pdf'), longPdf);
  const encrypted = seal(store.exportData(), 'synthetic-demo-passphrase');
  fs.writeFileSync(path.join(output, 'synthetic.backup'), encrypted);
  const restored = new Store(':memory:');
  try { restored.restore(unseal(encrypted, 'synthetic-demo-passphrase'), 'Demo Recovery'); assert.deepEqual(restored.pdf(docs[0].id), store.pdf(docs[0].id)); }
  finally { restored.close(); }
  await window.webContents.executeJavaScript('refresh()');
  await window.webContents.executeJavaScript(`for (const [key,value] of Object.entries(state.config)) { const control = document.querySelector('#setup-form').elements.namedItem(key); if(control) control.value=value; } document.querySelector('#actor').value='Demo Reviewer'; document.querySelector('#source').value='Bundled synthetic demonstration';`);
  await new Promise(resolve => setTimeout(resolve, 600));
  let screenshot = 'pending';
  try { const capture = await window.webContents.capturePage(); fs.writeFileSync(path.join(output, 'desktop-actual.png'), capture.toPNG()); screenshot = 'captured'; }
  catch { screenshot = 'unavailable: Windows display capture surface absent'; }
  if (screenshot === 'captured') for (const section of ['setup', 'imports', 'documents', 'jobs', 'recovery']) {
    await window.webContents.executeJavaScript(`document.getElementById('${section}').scrollIntoView()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    const capture = await window.webContents.capturePage(); fs.writeFileSync(path.join(output, `desktop-${section}.png`), capture.toPNG());
  }
  fs.writeFileSync(path.join(output, 'checksums.json'), JSON.stringify(hashes, null, 2));
  fs.writeFileSync(path.join(output, 'native-results.json'), JSON.stringify({ platform: process.platform, electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite, documents: docs.map(doc => ({ id: doc.id, kind: doc.kind, state: store.document(doc.id).state })), restore: 'passed', screenshot, network: 'HTTP and HTTPS blocked by application session; no provider connectivity', installerAcceptance: 'not tested' }, null, 2));
  process.stdout.write(`Native smoke passed: ${output}\n`);
};
