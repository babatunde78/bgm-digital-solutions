'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('./store');
test('Windows rejects overlong database paths before creating a profile', { skip: process.platform !== 'win32' }, () => {
  const filename = require('node:path').join(require('node:os').tmpdir(), 'x'.repeat(240), 'bursary.sqlite');
  assert.throws(() => new Store(filename), { name: 'DocumentError', message: 'Windows profile path is too long. Use a shorter private local profile path (database path at most 240 characters).' });
});
const rows = [{ reference: '00001', student: '00012', name: 'Synthetic Student', date: '2026-11-09', currency: 'NGN', amount: '10.25', kind: 'payment', evidence: 'synthetic-bank-ledger' }];
function setup(t) {
  const store = new Store(':memory:'); t.after(() => store.close());
  store.configure({ name: 'Synthetic College', currency: 'NGN' }, 'Officer');
  return store;
}
function accept(store) {
  const batch = store.stage(rows, 'Synthetic ledger');
  store.accept(batch.id, 'Reviewer', 'Reviewed against synthetic bank ledger, not a screenshot');
  return batch;
}
test('accepted imports are atomic and repeated imports return the same batch', t => {
  const store = setup(t), batch = accept(store);
  assert.equal(store.stage(rows, 'Synthetic ledger').id, batch.id);
  assert.equal(store.records().length, 1);
  assert.throws(() => store.accept(batch.id, 'Reviewer', 'again'));
  assert.equal(store.records().length, 1);
});
test('final documents retain branding and PDF bytes after configuration changes', async t => {
  const store = setup(t); accept(store);
  const doc = store.create('receipt', ['00001'], 'Preparer');
  assert.throws(() => store.enqueue(doc.id));
  store.review(doc.id, 'Reviewer'); const job = store.enqueue(doc.id);
  const bytes = Buffer.from('%PDF-1.7\nsynthetic-test-output');
  await store.run(job.id, async () => bytes);
  store.configure({ name: 'Renamed College', currency: 'NGN' }, 'Officer');
  assert.equal(store.document(doc.id).snapshot.config.name, 'Synthetic College');
  assert.deepEqual(store.pdf(doc.id), bytes);
  assert.equal(store.document(doc.id).state, 'final');
  assert.throws(() => store.review(doc.id, 'Someone'));
});
test('failed jobs retry without allocating another number or duplicate PDF', async t => {
  const store = setup(t); accept(store);
  const doc = store.create('receipt', ['00001'], 'Preparer'); store.review(doc.id, 'Reviewer');
  const job = store.enqueue(doc.id);
  await store.run(job.id, async () => { throw new Error('Synthetic renderer failure'); });
  assert.equal(store.jobs()[0].state, 'failed');
  store.retry(job.id);
  await store.run(job.id, async () => Buffer.from('%PDF-1.7\nretry'));
  assert.equal(store.document(doc.id).state, 'final');
  assert.equal(store.jobs().length, 1);
  assert.equal(store.enqueue(doc.id).id, job.id);
});
test('receipt duplication and mixed document kinds are blocked', t => {
  const store = setup(t); accept(store);
  store.create('receipt', ['00001'], 'Preparer');
  assert.throws(() => store.create('receipt', ['00001'], 'Other'));
  assert.throws(() => store.create('voucher', ['00001'], 'Preparer'));
});
test('statement distinguishes movements and records explicit opening provenance', t => {
  const store = setup(t); accept(store);
  const doc = store.create('statement', ['00001'], 'Preparer', { opening: '10000', openingEvidence: 'Synthetic opening schedule' });
  assert.equal(doc.snapshot.totals.closing, '8975');
  assert.throws(() => store.create('statement', ['00001'], 'Preparer', { opening: '10000' }));
});
test('blank statement opening is rejected instead of becoming zero', t => {
  const store = setup(t); accept(store);
  assert.throws(() => store.create('statement', ['00001'], 'Preparer', { opening: '', openingEvidence: 'Synthetic opening schedule' }));
});
test('review by preparer is refused', t => {
  const store = setup(t); accept(store);
  const doc = store.create('receipt', ['00001'], 'Preparer');
  assert.throws(() => store.review(doc.id, 'Preparer'));
});
test('backup restores records jobs PDFs and history into an empty profile', async t => {
  const store = setup(t); accept(store);
  const doc = store.create('receipt', ['00001'], 'Preparer'); store.review(doc.id, 'Reviewer');
  await store.run(store.enqueue(doc.id).id, async () => Buffer.from('%PDF-1.7\nrestoration fixture'));
  const restored = new Store(':memory:'); t.after(() => restored.close());
  restored.restore(JSON.parse(JSON.stringify(store.exportData())), 'Recovery Officer');
  assert.deepEqual(restored.records(), store.records());
  assert.deepEqual(restored.pdf(doc.id), store.pdf(doc.id));
  assert.deepEqual(restored.jobs(), store.jobs());
  assert.throws(() => restored.restore(store.exportData(), 'Recovery Officer'));
});
test('stale conflicting import rolls back all rows', t => {
  const store = setup(t);
  const batch = store.stage([...rows, { ...rows[0], reference: '00002' }], 'Second synthetic source');
  accept(store);
  assert.throws(() => store.accept(batch.id, 'Reviewer', 'Synthetic verification'));
  assert.deepEqual(store.records().map(row => row.reference), ['00001']);
});
test('cancellation during render retains the reviewed document without a PDF', async t => {
  const store = setup(t); accept(store);
  const doc = store.create('receipt', ['00001'], 'Preparer'); store.review(doc.id, 'Reviewer');
  const job = store.enqueue(doc.id);
  await store.run(job.id, async () => { store.cancelJob(job.id, 'Reviewer'); return Buffer.from('%PDF-1.7\nignored cancelled render'); });
  assert.equal(store.jobs()[0].state, 'cancelled');
  assert.equal(store.document(doc.id).state, 'reviewed');
  assert.throws(() => store.pdf(doc.id));
});
test('interrupted running jobs recover after reopening their local database', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-documents-test-'));
  const filename = path.join(directory, 'test.sqlite');
  const first = new Store(filename);
  first.configure({ name: 'Synthetic College', currency: 'NGN' }, 'Officer'); accept(first);
  const doc = first.create('receipt', ['00001'], 'Preparer'); first.review(doc.id, 'Reviewer');
  const job = first.enqueue(doc.id);
  first.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(job.id); first.close();
  const reopened = new Store(filename); t.after(() => reopened.close());
  assert.equal(reopened.jobs()[0].state, 'queued');
  await reopened.run(job.id, async () => Buffer.from('%PDF-1.7\nrecovered fixture'));
  assert.equal(reopened.document(doc.id).state, 'final');
  assert.equal(reopened.documents().length, 1);
});
test('correction retains the cancelled original PDF and links a new revision', async t => {
  const store = setup(t); accept(store);
  const original = store.create('receipt', ['00001'], 'Preparer'); store.review(original.id, 'Reviewer');
  const bytes = Buffer.from('%PDF-1.7\noriginal fixture'); await store.run(store.enqueue(original.id).id, async () => bytes);
  store.cancelDocument(original.id, 'Reviewer', 'Synthetic correction');
  const correction = store.create('receipt', ['00001'], 'Preparer', { original: original.id, reason: 'Synthetic correction' });
  assert.equal(correction.original, original.id);
  assert.equal(correction.snapshot.revision, 2);
  assert.deepEqual(store.pdf(original.id), bytes);
});
test('corrupt backup PDFs roll back restoration without changing the empty profile', async t => {
  const store = setup(t); accept(store);
  const doc = store.create('receipt', ['00001'], 'Preparer'); store.review(doc.id, 'Reviewer');
  await store.run(store.enqueue(doc.id).id, async () => Buffer.from('%PDF-1.7\nintegrity fixture'));
  const data = store.exportData(); data.documents[0].pdf = Buffer.from('modified').toString('base64');
  const restored = new Store(':memory:'); t.after(() => restored.close());
  assert.throws(() => restored.restore(data, 'Recovery Officer'));
  assert.equal(restored.config(), null);
  assert.deepEqual(restored.records(), []);
});
