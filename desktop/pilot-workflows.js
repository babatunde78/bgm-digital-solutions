'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Store } = require('./store');
const { parseCsv } = require('./core');
const { seal, unseal } = require('./security');
const { config, expected } = require('./pilot-fixtures');
const showWindow = require('./window');
module.exports = async function pilot(store, window, pdf) {
  const output = path.resolve(__dirname, '../pilot-results'); fs.mkdirSync(output, { recursive: true });
  window.show();
  const minimized = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native minimize event not observed')), 5000);
    window.once('minimize', () => { clearTimeout(timeout); resolve(); });
  });
  window.minimize(); await minimized;
  assert.equal(window.isMinimized(), true);
  const restoredWindow = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native restore event not observed')), 5000);
    window.once('restore', () => { clearTimeout(timeout); resolve(); });
  });
  showWindow(window); await restoredWindow;
  assert.equal(window.isMinimized(), false);
  assert.equal(store.config(), null);
  store.configure(config, 'Demo Preparer');
  const invalid = store.stage(parseCsv(fs.readFileSync(path.join(__dirname, 'pilot-invalid.csv'), 'utf8')), 'Synthetic invalid pilot');
  assert.equal(invalid.errors.length, expected.invalidErrors); assert.equal(invalid.totalMinor, null);
  assert.throws(() => store.accept(invalid.id, 'Demo Reviewer', 'Synthetic invalid source'));
  assert.equal(store.records().length, 0);
  const input = parseCsv(fs.readFileSync(path.join(__dirname, 'pilot-valid.csv'), 'utf8'));
  const batch = store.stage(input, 'Synthetic pilot ledger');
  assert.equal(batch.count, expected.validRows); assert.equal(batch.totalMinor, expected.grossControlTotalMinor);
  assert.equal(store.accept(batch.id, 'Demo Reviewer', 'Reviewed synthetic ledger; no actual bank confirmation'), 4);
  assert.equal(store.stage(input, 'Synthetic pilot ledger').id, batch.id);
  assert.equal(store.records().length, 4);
  const account = input.filter(row => row.student === '00001').map(row => row.reference);
  assert.throws(() => store.create('statement', account, 'Demo Preparer', { opening: '', openingEvidence: 'Synthetic source' }));
  const docs = [
    store.create('receipt', [input[1].reference], 'Demo Preparer'),
    store.create('statement', account, 'Demo Preparer', { opening: '0', openingEvidence: 'Confirmed synthetic zero opening' }),
    store.create('voucher', [input[2].reference], 'Demo Preparer')
  ];
  assert.deepEqual(docs[1].snapshot.totals, expected.statement);
  assert.throws(() => store.create('receipt', [input[1].reference], 'Demo Preparer'));
  const files = {};
  for (const doc of docs) {
    assert.throws(() => store.enqueue(doc.id)); assert.throws(() => store.review(doc.id, 'Demo Preparer'));
    store.review(doc.id, 'Demo Reviewer'); const job = store.enqueue(doc.id);
    if (doc.kind === 'receipt') {
      await store.run(job.id, async () => { throw new Error('Synthetic interrupted renderer'); });
      assert.equal(store.jobs().find(row => row.id === job.id).state, 'failed');
      store.retry(job.id);
    }
    await store.run(job.id, pdf);
    assert.equal(store.document(doc.id).state, 'final');
    const bytes = store.pdf(doc.id); fs.writeFileSync(path.join(output, `${doc.kind}.pdf`), bytes);
    files[`${doc.kind}.pdf`] = createHash('sha256').update(bytes).digest('hex');
  }
  const original = store.document(docs[0].id);
  store.configure({ ...config, name: 'Synthetic River College — REVISED PILOT' }, 'Demo Preparer');
  assert.equal(store.document(original.id).snapshot.config.name, config.name);
  assert.equal(createHash('sha256').update(store.pdf(original.id)).digest('hex'), files['receipt.pdf']);
  store.cancelDocument(original.id, 'Demo Reviewer', 'Synthetic branding correction; amount unchanged');
  const cancelled = await pdf(original.snapshot.renderedHtml.replace('<span class="status">FINAL</span>', '<span class="status">CANCELLED</span>'));
  fs.writeFileSync(path.join(output, 'receipt-cancelled.pdf'), cancelled);
  const reprint = await pdf(store.document(docs[1].id).snapshot.renderedHtml.replace('<span class="status">FINAL</span>', '<span class="status">REPRINTED</span>'));
  fs.writeFileSync(path.join(output, 'statement-reprint.pdf'), reprint);
  const correction = store.create('receipt', [input[1].reference], 'Demo Preparer', { original: original.id, reason: 'Synthetic branding correction; amount unchanged' });
  assert.equal(correction.snapshot.revision, 2); assert.equal(correction.original, original.id);
  store.review(correction.id, 'Demo Reviewer'); await store.run(store.enqueue(correction.id).id, pdf);
  fs.writeFileSync(path.join(output, 'receipt-corrected.pdf'), store.pdf(correction.id));
  const cancelledJobDoc = store.create('statement', account, 'Demo Preparer', { opening: '0', openingEvidence: 'Confirmed synthetic zero opening' });
  store.review(cancelledJobDoc.id, 'Demo Reviewer'); const cancelledJob = store.enqueue(cancelledJobDoc.id);
  store.cancelJob(cancelledJob.id, 'Demo Reviewer');
  await store.run(cancelledJob.id, async () => { throw new Error('Cancelled job must not render'); });
  assert.equal(store.document(cancelledJobDoc.id).state, 'reviewed');
  assert.throws(() => store.pdf(cancelledJobDoc.id));
  const encrypted = seal(store.exportData(), 'synthetic-pilot-passphrase');
  fs.writeFileSync(path.join(output, 'synthetic-pilot.backup'), encrypted);
  assert.throws(() => unseal(encrypted, 'wrong synthetic passphrase'));
  const restored = new Store(path.join(output, 'restored.sqlite'));
  try {
    restored.restore(unseal(encrypted, 'synthetic-pilot-passphrase'), 'Demo Recovery');
    assert.deepEqual(restored.records(), store.records()); assert.deepEqual(restored.jobs(), store.jobs());
    for (const doc of store.documents().filter(row => ['final', 'cancelled'].includes(row.state))) assert.deepEqual(restored.pdf(doc.id), store.pdf(doc.id));
  } finally { restored.close(); }
  await window.webContents.executeJavaScript("refresh().then(() => document.getElementById('documents').scrollIntoView())");
  await new Promise(resolve => setTimeout(resolve, 300));
  let screenshot = 'unavailable';
  try { fs.writeFileSync(path.join(output, 'pilot-actual.png'), (await window.webContents.capturePage()).toPNG()); screenshot = 'captured'; } catch { /* Display capture may be unavailable on a test host. */ }
  for (const file of fs.readdirSync(output).filter(file => file.endsWith('.pdf'))) files[file] = createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex');
  const report = { platform: process.platform, node: process.versions.node, electron: process.versions.electron, validRows: 4, invalidBatchBlocked: true, grossControlTotalMinor: '9000075', statementClosingMinor: '1999950', duplicateImportAndReceiptBlocked: true, selfReviewBlocked: true, failedRenderRetriedWithSameJob: true, cancellationAndLinkedRevision: true, cancelledJobDidNotRender: true, finalBrandingAndPdfPreserved: true, wrongBackupPasswordDenied: true, backupRestoreMatchedRecordsJobsPdfs: true, screenshot, files, jobs: store.jobs(), humanOfficerAcceptance: 'pending', scope: 'Automated source-mode synthetic pilot; not installer or human acceptance' };
  report.minimizedWindowRestored = true;
  fs.writeFileSync(path.join(output, 'pilot-results.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'expected-pdfs.json'), JSON.stringify({ receipt: ['FINAL', '25,000.50'], statement: ['19,999.50', '5,000.00'], voucher: ['10,000.25'], 'receipt-cancelled': ['CANCELLED', '25,000.50'], 'statement-reprint': ['REPRINTED', '19,999.50'], 'receipt-corrected': ['Revision 2', 'Replaces CBD-00000001', 'REVISED PILOT', '25,000.50'] }, null, 2));
  process.stdout.write(`Synthetic workflow pilot passed. Human officer acceptance remains pending.\n`);
};
