'use strict';
const $ = selector => document.querySelector(selector);
let state, staged;
async function call(action, input = {}) {
  const result = await window.bursary.call(action, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function message(value, error = false) { $('#message').textContent = value; $('#message').className = error ? 'error' : ''; }
function actor() { const value = $('#actor').value.trim(); if (!value) throw new Error('Enter the recorded officer name'); return value; }
function cell(row, value) { const td = document.createElement('td'); td.textContent = String(value ?? ''); row.append(td); return td; }
function button(parent, label, action) { const btn = document.createElement('button'); btn.textContent = label; btn.type = 'button'; btn.onclick = () => perform(action); parent.append(btn); }
function table(target, headers) {
  const wrap = document.createElement('div'); wrap.className = 'scroll'; const grid = document.createElement('table'), head = document.createElement('tr');
  for (const label of headers) { const th = document.createElement('th'); th.textContent = label; head.append(th); }
  const thead = document.createElement('thead'); thead.append(head); const body = document.createElement('tbody'); grid.append(thead, body); wrap.append(grid); $(target).replaceChildren(wrap); return body;
}
async function refresh() {
  state = await call('state');
  $('#product-name').textContent = state.config?.productName || state.release.productName;
  $('#licence-status').textContent = state.licence.label;
  draw();
}
function draw() {
  const query = $('#search').value.toLowerCase();
  const selected = new Set([...$('#records').querySelectorAll('input:checked')].map(input => input.value));
  const rows = table('#records', ['Select', 'Reference', 'Account / payee', 'Date', 'Kind', 'Currency', 'Minor units']);
  for (const record of state.records.filter(row => JSON.stringify(row).toLowerCase().includes(query))) {
    const tr = document.createElement('tr'), select = document.createElement('input'); select.type = 'checkbox'; select.value = record.reference; select.checked = selected.has(record.reference); select.setAttribute('aria-label', `Select ${record.reference}`); cell(tr, '').append(select);
    for (const value of [record.reference, `${record.student} · ${record.name}`, record.date, record.kind, record.currency, record.minor]) cell(tr, value);
    rows.append(tr);
  }
  const docs = table('#document-list', ['Document', 'Template', 'Status', 'Actions']);
  for (const doc of state.documents.filter(row => JSON.stringify(row).toLowerCase().includes(query))) {
    const tr = document.createElement('tr'); cell(tr, doc.id); cell(tr, doc.kind); cell(tr, doc.state); const actions = cell(tr, '');
    button(actions, 'Preview', () => call('preview', { id: doc.id }));
    if (doc.state === 'draft') button(actions, 'Record review', () => call('review', { id: doc.id, actor: actor() }));
    if (doc.state === 'reviewed') button(actions, 'Queue final PDF', () => call('enqueue', { id: doc.id }));
    if (doc.state === 'final') button(actions, 'Export original', () => call('export-pdf', { id: doc.id, actor: actor() }));
    if (['final', 'cancelled'].includes(doc.state)) button(actions, 'Marked copy', () => call('reprint', { id: doc.id, actor: actor() }));
    if (doc.state !== 'cancelled') button(actions, 'Cancel document', () => {
      const reason = $('#create-form').elements.namedItem('reason').value;
      if (!reason.trim()) throw new Error('Enter the cancellation reason in the Correction reason field first');
      return call('cancel-document', { id: doc.id, actor: actor(), reason });
    });
    docs.append(tr);
  }
  const jobs = table('#job-list', ['Job / document', 'State', 'Attempts', 'Exception', 'Actions']);
  for (const job of state.jobs) {
    const tr = document.createElement('tr'); cell(tr, `${job.id} / ${job.document}`); cell(tr, job.state); cell(tr, job.attempts); cell(tr, job.error); const actions = cell(tr, '');
    if (job.state === 'failed') button(actions, 'Retry only this job', () => call('retry', { id: job.id }));
    if (['queued', 'running', 'failed'].includes(job.state)) button(actions, 'Cancel job', () => call('cancel-job', { id: job.id, actor: actor() }));
    jobs.append(tr);
  }
}
async function perform(action) {
  try { const result = await action(); await refresh(); message(result === false ? 'Cancelled. No changes made.' : 'Operation completed.'); }
  catch (error) { message(error.message, true); }
}
$('#setup-form').onsubmit = event => { event.preventDefault(); perform(() => call('configure', { config: Object.fromEntries(new FormData(event.target)), actor: actor() })); };
$('#import').onclick = () => perform(async () => {
  const previewBatch = await call('import', { source: $('#source').value }); if (!previewBatch) return false;
  staged = previewBatch;
  const area = $('#import-preview'); area.replaceChildren();
  const summary = document.createElement('p'); summary.textContent = `${staged.count} rows · control total ${staged.totalMinor ?? 'UNAVAILABLE'} minor units · ${staged.errors.length} errors · ${staged.state}`; area.append(summary);
  for (const error of staged.errors) { const p = document.createElement('p'); p.className = 'error'; p.textContent = `Row ${error.row}: ${error.message}`; area.append(p); }
  const preview = document.createElement('pre'); preview.textContent = JSON.stringify(staged.rows.slice(0, 20), null, 2); area.append(preview);
  $('#accept').disabled = staged.errors.length > 0 || staged.state !== 'staged';
});
$('#accept').onclick = () => perform(async () => { await call('accept', { id: staged.id, actor: actor(), evidence: $('#evidence').value }); $('#accept').disabled = true; });
$('#create-form').onsubmit = event => {
  event.preventDefault(); perform(() => {
    const form = Object.fromEntries(new FormData(event.target));
    return call('create', { kind: form.kind, actor: actor(), references: [...$('#records').querySelectorAll('input:checked')].map(input => input.value), options: { opening: form.opening, openingEvidence: form.openingEvidence, original: form.original, reason: form.reason } });
  });
};
$('#search').oninput = () => draw();
$('#backup').onclick = () => perform(async () => { const value = await call('backup', { password: $('#password').value }); $('#password').value = ''; return value; });
$('#restore').onclick = () => perform(async () => { const value = await call('restore', { password: $('#password').value, actor: actor() }); $('#password').value = ''; return value; });
$('#export').onclick = () => perform(() => call('export-data'));
$('#licence').onclick = () => perform(() => call('licence'));
$('#update').onclick = () => perform(() => call('update'));
refresh().then(() => {
  if (state.config) for (const [key, value] of Object.entries(state.config)) { const control = $('#setup-form').elements.namedItem(key); if (control) control.value = value; }
}).catch(error => message(error.message, true));
setInterval(async () => {
  try {
    const latest = await call('state');
    if (JSON.stringify(latest.jobs) !== JSON.stringify(state?.jobs)) { state = latest; draw(); }
  } catch { message('Local state unavailable. Restart the application; retained records are not removed.', true); }
}, 2000);
