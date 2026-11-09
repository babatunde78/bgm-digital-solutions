'use strict';
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const core = require('./core');
const release = require('./release.json');
class Store {
  constructor(filename) {
    if (process.platform === 'win32' && filename !== ':memory:' && require('node:path').resolve(filename).length > 240) throw new core.DocumentError('Windows profile path is too long. Use a shorter private local profile path (database path at most 240 characters).');
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > release.schemaVersion) { this.close(); throw new core.DocumentError('Database is newer than this application. Restore the matching application version.'); }
    if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE imports (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('staged','accepted')), reviewer TEXT, evidence TEXT);
      CREATE TABLE records (reference TEXT PRIMARY KEY, batch TEXT NOT NULL REFERENCES imports(id), json TEXT NOT NULL);
      CREATE TABLE documents (number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, kind TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('draft','reviewed','final','cancelled')), json TEXT NOT NULL, reviewer TEXT, pdf BLOB, hash TEXT, original TEXT REFERENCES documents(id));
      CREATE TABLE receipt_claims (reference TEXT PRIMARY KEY REFERENCES records(reference), document TEXT NOT NULL REFERENCES documents(id));
      CREATE TABLE jobs (id TEXT PRIMARY KEY, document TEXT UNIQUE NOT NULL REFERENCES documents(id), state TEXT NOT NULL CHECK(state IN ('queued','running','done','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TRIGGER frozen_document BEFORE UPDATE OF json, pdf, hash ON documents WHEN OLD.state IN ('final','cancelled') BEGIN SELECT RAISE(ABORT,'Final document snapshot is immutable'); END;
      PRAGMA user_version=1; COMMIT;`);
    this.db.exec("UPDATE jobs SET state='queued',error='Recovered interrupted render' WHERE state='running'");
  }
  close() { this.db.close(); }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(actor, action, subject, detail = '') {
    this.db.prepare('INSERT INTO events(at,actor,action,subject,detail) VALUES(?,?,?,?,?)').run(new Date().toISOString(), core.text(actor, 'officer'), action, subject, detail);
  }
  configure(input, actor) {
    const config = core.configuration(input);
    return this.transaction(() => {
      this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(config));
      this.event(actor, 'configure', 'institution'); return config;
    });
  }
  config() { const row = this.db.prepare('SELECT json FROM settings WHERE id=1').get(); return row ? JSON.parse(row.json) : null; }
  stage(rows, source) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ source: core.text(source, 'source system'), input: rows })).digest('hex');
    const previous = this.db.prepare('SELECT id,json,state FROM imports WHERE fingerprint=?').get(fingerprint);
    if (previous) return { id: previous.id, ...JSON.parse(previous.json), state: previous.state };
    const preview = core.stage(rows, source, this.records().map(row => row.reference));
    const id = randomUUID();
    this.db.prepare("INSERT INTO imports(id,fingerprint,json,state) VALUES(?,?,?,'staged')").run(id, preview.fingerprint, JSON.stringify(preview));
    return { id, ...preview, state: 'staged' };
  }
  accept(id, actor, evidence) {
    actor = core.text(actor, 'reviewer'); evidence = core.text(evidence, 'source confirmation notes', 2000);
    return this.transaction(() => {
      const batch = this.db.prepare('SELECT * FROM imports WHERE id=?').get(id);
      if (!batch || batch.state !== 'staged') throw new core.DocumentError('Select a staged batch');
      const preview = JSON.parse(batch.json), config = this.config();
      if (preview.errors.length || !config || preview.rows.some(row => row.currency !== config.currency)) throw new core.DocumentError('Resolve import errors and institution currency before accepting');
      for (const row of preview.rows) this.db.prepare('INSERT INTO records VALUES(?,?,?)').run(row.reference, id, JSON.stringify(row));
      this.db.prepare("UPDATE imports SET state='accepted',reviewer=?,evidence=? WHERE id=?").run(actor, evidence, id);
      this.event(actor, 'accept-import', id, evidence);
      return preview.rows.length;
    });
  }
  records() { return this.db.prepare('SELECT json FROM records ORDER BY reference').all().map(row => JSON.parse(row.json)); }
  create(kind, references, actor, options = {}) {
    actor = core.text(actor, 'preparer');
    if (Array.isArray(references) && !references.length) throw new core.DocumentError('Tick a source-record checkbox in Documents before creating a draft. For a receipt, select exactly one payment.');
    if (!['receipt', 'statement', 'voucher'].includes(kind) || !Array.isArray(references) || !references.length || references.length > 10000 || new Set(references).size !== references.length) throw new core.DocumentError('Select unique source records and a supported template');
    return this.transaction(() => {
      const config = this.config();
      if (!config) throw new core.DocumentError('Configure institution first');
      const records = references.map(reference => {
        const record = this.db.prepare('SELECT r.json,i.json AS import_json,i.reviewer,i.evidence FROM records r JOIN imports i ON i.id=r.batch WHERE reference=?').get(reference);
        if (!record) throw new core.DocumentError('Source reference missing');
        return { ...JSON.parse(record.json), source: JSON.parse(record.import_json).source, confirmedBy: record.reviewer, confirmation: record.evidence };
      }).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
      if (records.some(row => row.currency !== config.currency)) throw new core.DocumentError('Source and institution currency differ');
      if (kind === 'receipt' && (records.length !== 1 || records[0].kind !== 'payment')) throw new core.DocumentError('Receipt requires exactly one confirmed source payment');
      if (kind === 'voucher' && records.some(row => row.kind !== 'voucher')) throw new core.DocumentError('Voucher requires voucher source rows');
      if (kind === 'statement' && (new Set(records.map(row => row.student)).size !== 1 || records.some(row => row.kind === 'voucher'))) throw new core.DocumentError('Statement requires one student account and charge/credit/payment movements');
      const opening = kind === 'statement' ? options.opening : '0';
      const totals = kind === 'statement' ? core.statement(opening, records) : null;
      if (kind === 'statement' && !options.openingEvidence) throw new core.DocumentError('Record opening balance provenance, including a confirmed zero');
      let original = null;
      if (options.original) {
        original = this.document(options.original);
        if (!original || original.state !== 'cancelled' || original.kind !== kind) throw new core.DocumentError('Correction must reference a cancelled document of the same kind');
        core.text(options.reason, 'correction reason');
      }
      const insert = this.db.prepare("INSERT INTO documents(kind,state,json,original) VALUES(?,'draft','{}',?)").run(kind, original?.id || null);
      const id = `${config.prefix}-${String(insert.lastInsertRowid).padStart(8, '0')}`;
      const snapshot = { id, kind, status: 'draft', revision: original ? original.snapshot.revision + 1 : 1, original: original?.id || null, reason: options.reason || '', records, config, actor, created: new Date().toISOString(), source: [...new Set(records.map(row => row.source))].join('; '), totalMinor: records.reduce((sum, row) => sum + BigInt(row.minor), 0n).toString(), opening, openingEvidence: options.openingEvidence || '', totals, templateVersion: release.templateVersion, applicationVersion: release.version };
      core.render(snapshot);
      this.db.prepare('UPDATE documents SET id=?,json=? WHERE number=?').run(id, JSON.stringify(snapshot), insert.lastInsertRowid);
      if (kind === 'receipt') for (const row of records) {
        const claim = this.db.prepare('SELECT document FROM receipt_claims WHERE reference=?').get(row.reference);
        if (claim && claim.document !== original?.id) throw new core.DocumentError('This payment already has a receipt; cancel and link a correction instead');
        this.db.prepare('INSERT INTO receipt_claims VALUES(?,?) ON CONFLICT(reference) DO UPDATE SET document=excluded.document').run(row.reference, id);
      }
      this.event(actor, 'create-draft', id); return this.document(id);
    });
  }
  document(id) {
    const row = this.db.prepare('SELECT id,kind,state,json,reviewer,hash,original FROM documents WHERE id=?').get(id);
    return row ? { ...row, snapshot: JSON.parse(row.json), json: undefined } : null;
  }
  documents() { return this.db.prepare('SELECT id,kind,state,hash,original FROM documents ORDER BY number DESC').all(); }
  review(id, actor) {
    actor = core.text(actor, 'reviewer');
    return this.transaction(() => {
      const doc = this.document(id);
      if (!doc || doc.state !== 'draft' || doc.snapshot.actor === actor) throw new core.DocumentError('A different named reviewer must review a draft');
      this.db.prepare("UPDATE documents SET state='reviewed',reviewer=? WHERE id=?").run(actor, id);
      this.event(actor, 'review-document', id);
    });
  }
  enqueue(id) {
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM jobs WHERE document=?').get(id);
      if (prior) return prior;
      const doc = this.document(id);
      if (!doc || doc.state !== 'reviewed') throw new core.DocumentError('Review document before final generation');
      const job = { id: randomUUID(), document: id, state: 'queued' };
      this.db.prepare("INSERT INTO jobs(id,document,state) VALUES(?,?,'queued')").run(job.id, id);
      this.event(doc.reviewer, 'queue-document', id); return job;
    });
  }
  jobs() { return this.db.prepare('SELECT * FROM jobs ORDER BY rowid').all(); }
  retry(id) {
    if (!this.db.prepare("UPDATE jobs SET state='queued',error=NULL WHERE id=? AND state='failed'").run(id).changes) throw new core.DocumentError('Only failed jobs may retry');
  }
  cancelJob(id, actor) {
    return this.transaction(() => {
      if (!this.db.prepare("UPDATE jobs SET state='cancelled' WHERE id=? AND state IN ('queued','running','failed')").run(id).changes) throw new core.DocumentError('Job cannot be cancelled');
      this.event(actor, 'cancel-job', id);
    });
  }
  cancelDocument(id, actor, reason) {
    reason = core.text(reason, 'cancellation reason');
    return this.transaction(() => {
      const doc = this.document(id);
      if (!doc || doc.state === 'cancelled') throw new core.DocumentError('Select an active document');
      this.db.prepare("UPDATE jobs SET state='cancelled' WHERE document=? AND state!='done'").run(id);
      this.db.prepare("UPDATE documents SET state='cancelled' WHERE id=?").run(id);
      this.event(actor, 'cancel-document', id, reason);
    });
  }
  async run(id, renderer) {
    const job = this.db.prepare("SELECT * FROM jobs WHERE id=? AND state='queued'").get(id);
    if (!job || !this.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1 WHERE id=? AND state='queued'").run(id).changes) return;
    const doc = this.document(job.document);
    try {
      const snapshot = { ...doc.snapshot, status: 'final', reviewer: doc.reviewer, finalisedAt: new Date().toISOString() };
      const html = core.render(snapshot);
      snapshot.renderedHtml = html;
      const pdf = await renderer(html);
      if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') throw new core.DocumentError('Renderer returned invalid PDF');
      this.transaction(() => {
        const current = this.db.prepare('SELECT state FROM jobs WHERE id=?').get(id);
        if (current.state !== 'running') return;
        this.db.prepare("UPDATE documents SET state='final',json=?,pdf=?,hash=? WHERE id=? AND state='reviewed'").run(JSON.stringify(snapshot), pdf, createHash('sha256').update(pdf).digest('hex'), doc.id);
        this.db.prepare("UPDATE jobs SET state='done',error=NULL WHERE id=?").run(id);
        this.event(doc.reviewer, 'finalise-document', doc.id);
      });
    } catch {
      this.db.prepare("UPDATE jobs SET state='failed',error='PDF generation failed. Original data retained; retry or contact support.' WHERE id=? AND state='running'").run(id);
    }
  }
  pdf(id) {
    const row = this.db.prepare('SELECT pdf,hash FROM documents WHERE id=?').get(id);
    if (!row?.pdf) throw new core.DocumentError('No final PDF retained');
    const bytes = Buffer.from(row.pdf);
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new core.DocumentError('PDF integrity check failed; recover from a verified backup');
    return bytes;
  }
  exportData() {
    return { format: 'bgm-bursary-documents-1', release: release.version, settings: this.config(), imports: this.db.prepare('SELECT * FROM imports').all(), records: this.db.prepare('SELECT * FROM records').all(), documents: this.db.prepare('SELECT * FROM documents').all().map(row => ({ ...row, pdf: row.pdf ? Buffer.from(row.pdf).toString('base64') : null })), jobs: this.jobs(), claims: this.db.prepare('SELECT * FROM receipt_claims').all(), events: this.db.prepare('SELECT * FROM events ORDER BY id').all() };
  }
  restore(data, actor) {
    if (this.config() || this.records().length || this.documents().length) throw new core.DocumentError('Restore requires a new empty profile; existing records will not be overwritten');
    if (data?.format !== 'bgm-bursary-documents-1' || !data.settings || !['imports', 'records', 'documents', 'jobs', 'claims', 'events'].every(key => Array.isArray(data[key]))) throw new core.DocumentError('Invalid backup structure');
    const config = core.configuration(data.settings);
    return this.transaction(() => {
      this.db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(config));
      for (const row of data.imports) this.db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?)').run(row.id, row.fingerprint, row.json, row.state, row.reviewer, row.evidence);
      for (const row of data.records) { JSON.parse(row.json); this.db.prepare('INSERT INTO records VALUES(?,?,?)').run(row.reference, row.batch, row.json); }
      for (const row of data.documents) {
        const snapshot = JSON.parse(row.json); core.render(snapshot);
        const pdf = row.pdf ? Buffer.from(row.pdf, 'base64') : null;
        if (pdf && createHash('sha256').update(pdf).digest('hex') !== row.hash) throw new core.DocumentError('Backup PDF integrity check failed');
        if (row.state === 'final' && !pdf) throw new core.DocumentError('Final PDF missing from backup');
        this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(row.number, row.id, row.kind, row.state, row.json, row.reviewer, pdf, row.hash, row.original);
      }
      for (const row of data.claims) this.db.prepare('INSERT INTO receipt_claims VALUES(?,?)').run(row.reference, row.document);
      for (const row of data.jobs) this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(row.id, row.document, row.state === 'running' ? 'queued' : row.state, row.attempts, row.error);
      for (const row of data.events) this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(row.id, row.at, row.actor, row.action, row.subject, row.detail);
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new core.DocumentError('Backup references failed validation');
      this.event(actor, 'restore-backup', 'institution');
    });
  }
}
module.exports = { Store };
