'use strict';
const { createHash } = require('node:crypto');
const release = require('./release.json');
const pdfStyles = require('node:fs').readFileSync(require('node:path').join(__dirname, 'pdf.css'), 'utf8');
class DocumentError extends Error {
  constructor(message) { super(message); this.name = 'DocumentError'; }
}
function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new DocumentError(`Invalid ${label}`);
  return value.trim();
}
function amount(value) {
  if (typeof value !== 'string' || !/^\d{1,15}(\.\d{1,2})?$/.test(value)) throw new DocumentError('Amount must be nonnegative decimal text, at most two places');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
function minor(value) {
  if (typeof value !== 'string' || !/^-?\d{1,22}$/.test(value)) throw new DocumentError('Invalid integer minor units');
  return BigInt(value);
}
function configuration(input) {
  if (!input || typeof input !== 'object') throw new DocumentError('Institution setup required');
  if (!['NGN', 'USD'].includes(input.currency)) throw new DocumentError('This pilot supports NGN and USD with two decimal places');
  const colour = input.colour || '#174c3c';
  if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new DocumentError('Use a six-digit brand colour');
  const timezone = input.timezone || 'Africa/Lagos';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new DocumentError('Invalid timezone'); }
  const result = { name: text(input.name, 'institution'), currency: input.currency, colour, timezone, rounding: 'exact-two-decimal-input', dateFormat: 'YYYY-MM-DD' };
  for (const key of ['type', 'address', 'contacts', 'website', 'campus', 'department', 'programme', 'session', 'footer', 'officer', 'title']) result[key] = input[key] ? text(input[key], key, 1000) : '';
  result.productName = input.productName ? text(input.productName, 'product name', 100) : release.productName;
  result.prefix = input.prefix || 'CBD';
  if (!/^[A-Z0-9-]{1,16}$/.test(result.prefix)) throw new DocumentError('Number prefix: 1–16 uppercase letters, digits or hyphens');
  return result;
}
function stage(input, source, existing) {
  source = text(source, 'source system');
  if (!Array.isArray(input) || input.length > 10000) throw new DocumentError('Import up to 10,000 rows');
  const rows = [], errors = [], refs = new Set(existing);
  if (!input.length) errors.push({ row: 0, message: 'No records supplied' });
  for (const [index, record] of input.entries()) {
    try {
      if (!record || typeof record !== 'object') throw new DocumentError('Invalid record');
      const row = {};
      for (const field of ['reference', 'student', 'name', 'date', 'currency', 'kind']) row[field] = text(record[field], field);
      if (refs.has(row.reference)) throw new DocumentError('Duplicate reference; references must be unique across this institution');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date) throw new DocumentError('Use a valid ISO date YYYY-MM-DD');
      if (!['NGN', 'USD'].includes(row.currency)) throw new DocumentError('Unsupported currency');
      if (!['charge', 'credit', 'payment', 'voucher'].includes(row.kind)) throw new DocumentError('Unsupported movement kind');
      row.minor = amount(record.amount);
      if (BigInt(row.minor) === 0n) throw new DocumentError('Amount must be positive');
      row.evidence = record.evidence ? text(record.evidence, 'source evidence') : '';
      if (row.kind === 'payment' && !row.evidence) throw new DocumentError('Payment requires a bank/provider/authorised cash-ledger reference; a screenshot is insufficient');
      refs.add(row.reference); rows.push(row);
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      errors.push({ row: index + 2, message: error.message });
    }
  }
  const currencies = [...new Set(rows.map(row => row.currency))];
  if (currencies.length > 1) errors.push({ row: 0, message: 'Use one currency per import' });
  return { source, rows, errors, count: input.length, totalMinor: errors.length ? null : rows.reduce((sum, row) => sum + BigInt(row.minor), 0n).toString(), fingerprint: createHash('sha256').update(JSON.stringify({ source, input })).digest('hex') };
}
function statement(opening, rows) {
  let charges = 0n, credits = 0n, payments = 0n;
  for (const row of rows) {
    const value = minor(row.minor);
    if (value < 0n) throw new DocumentError('Movements must be nonnegative');
    if (row.kind === 'charge') charges += value;
    else if (row.kind === 'credit') credits += value;
    else if (row.kind === 'payment') payments += value;
    else throw new DocumentError('Statement contains an unsupported movement');
  }
  return { opening: minor(opening).toString(), charges: charges.toString(), credits: credits.toString(), payments: payments.toString(), closing: (minor(opening) + charges - credits - payments).toString() };
}
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function format(value, currency) {
  const n = minor(value), absolute = n < 0n ? -n : n;
  return `${currency} ${n < 0n ? '-' : ''}${(absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
function render(doc) {
  const config = configuration(doc.config), titles = { receipt: 'Confirmed-payment receipt', statement: 'Student account statement', voucher: 'Payment voucher' };
  if (!titles[doc.kind] || !doc.records?.length || !doc.id || !doc.actor) throw new DocumentError('Required document placeholders missing');
  if (!['draft', 'reviewed', 'final', 'cancelled', 'reprinted', 'reversed'].includes(doc.status)) throw new DocumentError('Invalid document state');
  const isStatement = doc.kind === 'statement', totals = isStatement ? statement(doc.opening || '0', doc.records) : null;
  let running = minor(doc.opening || '0');
  const rows = doc.records.map(row => {
    if (isStatement) {
      running += row.kind === 'charge' ? minor(row.minor) : -minor(row.minor);
      return `<tr><td>${escape(row.date)}</td><td class="reference">${escape(row.reference)}</td>${['charge', 'credit', 'payment'].map(kind => `<td class="money">${row.kind === kind ? escape(format(row.minor, config.currency).replace(`${config.currency} `, '')) : '—'}</td>`).join('')}<td class="money">${escape(format(running.toString(), config.currency).replace(`${config.currency} `, ''))}</td></tr>`;
    }
    return `<tr><td>${escape(row.date)}</td><td class="reference">${escape(row.reference)}</td><td>${escape(row.student)}<br>${escape(row.name)}</td><td class="money">${escape(format(row.minor, config.currency))}</td></tr>`;
  }).join('');
  const totalBlock = isStatement ? `<div class="summary"><h3>Account reconciliation · ${config.currency}</h3>${Object.entries(totals).map(([key, value]) => `<div class="summary-row${key === 'closing' ? ' closing' : ''}"><span>${escape({ opening: 'Opening balance', charges: 'Charges', credits: 'Credits', payments: 'Payments', closing: 'Closing balance' }[key])}</span><strong>${escape(format(value, config.currency))}</strong></div>`).join('')}<p class="note">Opening + charges − credits − payments = closing.<br>Opening source: ${escape(doc.openingEvidence || 'Not supplied — review required')}</p></div>` : `<div class="amount-panel"><span>${doc.kind === 'receipt' ? 'Payment received' : 'Voucher total'}</span><strong>${escape(format(doc.totalMinor, config.currency))}</strong></div>`;
  const institutionLines = [[config.type, config.campus], [config.address], [config.contacts, config.website]].map(parts => parts.filter(Boolean).map(escape).join(' · ')).filter(Boolean).map(line => `<p class="institution-detail">${line}</p>`).join('');
  const labels = [config.session && `Session ${config.session}`, config.department, config.programme].filter(Boolean).map(escape).join(' · ');
  const issueTime = Number.isFinite(Date.parse(doc.created)) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone }).format(new Date(doc.created)) : doc.created;
  const headings = isStatement ? '<th class="date">Date</th><th class="ref">Source reference</th><th class="money">Charges</th><th class="money">Credits</th><th class="money">Payments</th><th class="money">Balance</th>' : '<th class="date">Date</th><th class="ref">Source reference</th><th>Account / payee</th><th class="money amount">Amount</th>';
  const confirmation = doc.kind === 'receipt' ? `<p class="note">Source confirmation: ${escape(doc.records[0].evidence)}. Recorded by ${escape(doc.records[0].confirmedBy || 'officer')}. This application does not contact the bank.</p>` : doc.kind === 'voucher' ? '<p class="note">Approval document only. This voucher neither executes payment nor proves settlement.</p>' : '<p class="note">Payments are shown in full. This statement does not allocate payments to individual invoices or reconcile bank settlements. Credit balances are shown as negative.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(titles[doc.kind])}</title><style>${pdfStyles.replaceAll("BRAND_COLOUR", config.colour)}</style></head><body class="${isStatement ? 'statement' : ''}"><header class="institution"><h1>${escape(config.name)}</h1>${institutionLines}</header><div class="document-header"><h2>${escape(titles[doc.kind])}</h2><span class="status">${escape(doc.status.toUpperCase())}</span><p class="meta">Document ${escape(doc.id)} · Revision ${doc.revision}<br>Prepared ${escape(issueTime)} (${escape(config.timezone)})${doc.finalisedAt ? `<br>Finalised ${escape(doc.finalisedAt)}` : ''}${labels ? `<br>${labels}` : ''}${doc.original ? `<br>Replaces ${escape(doc.original)} · ${escape(doc.reason)}` : ''}</p></div>${isStatement ? `<div class="account"><p>Student account <strong>${escape(doc.records[0].student)}</strong></p><p>${escape(doc.records[0].name)}</p><p class="note">Selected movements: ${escape(doc.records[0].date)} to ${escape(doc.records.at(-1).date)} · ${doc.records.length} records · ${config.currency}</p></div>` : totalBlock}<table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table>${isStatement ? totalBlock : ''}<div class="endmatter">${confirmation}<p class="note">Source: ${escape(doc.source)}. Fields, references, duplicates, dates and control totals validated. Source records are not independently audited.</p><div class="signatures"><div class="signature">Prepared: ${escape(doc.actor)}<br>Manual signature: __________________</div><div class="signature">${escape(config.officer || doc.reviewer || 'Authorised officer')}${config.title ? `<br>${escape(config.title)}` : ''}<br>Manual signature: __________________</div></div><p class="footer">${escape(config.footer)}</p><small>Reviewed by ${escape(doc.reviewer || 'Not yet reviewed')} · Template ${escape(doc.templateVersion || release.templateVersion)} · Application ${escape(doc.applicationVersion || release.version)}.<br>Manual signature blocks only. No certificate-based signature. No financial clearance conferred.</small></div></body></html>`;
}
function parseCsv(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 20 * 1024 * 1024) throw new DocumentError('CSV exceeds 20 MB');
  const table = [], row = []; let cell = '', quoted = false, closed = false;
  input = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!cell && !closed) quoted = true;
      else throw new DocumentError('Malformed CSV quoting');
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(cell); cell = ''; closed = false;
      if (char !== ',') { if (char === '\r' && input[i + 1] === '\n') i++; table.push(row.splice(0)); }
    } else { if (closed) throw new DocumentError('Unexpected text after closing quote'); cell += char; }
  }
  if (quoted) throw new DocumentError('Unclosed CSV quote');
  if (cell || row.length || closed) { row.push(cell); table.push(row); }
  const header = table.shift();
  const required = ['reference', 'student', 'name', 'date', 'currency', 'amount', 'kind', 'evidence'];
  if (!header || header.length !== required.length || new Set(header).size !== header.length || required.some(key => !header.includes(key))) throw new DocumentError(`CSV headers must be ${required.join(',')}`);
  return table.filter(values => values.some(Boolean)).map(values => {
    if (values.length !== header.length) throw new DocumentError('CSV row width differs from header');
    return Object.fromEntries(header.map((key, index) => [key, values[index]]));
  });
}
module.exports = { DocumentError, text, amount, configuration, stage, statement, escape, format, render, parseCsv };
