'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReconcileCore = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const cleanText = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleUpperCase('en-NG');

  function parseAmount(value) {
    const source = String(value ?? '').trim();
    if (!source) return { ok: false, error: 'Amount is blank' };
    const negative = /^\(.*\)$/.test(source) || /^-/.test(source);
    let text = source.replace(/[₦$£€\s]/gu, '').replace(/^NGN|NGN$/giu, '').replace(/^N(?=\d)/u, '').replace(/^\((.*)\)$/u, '$1').replace(/^-/, '').replace(/\+$/, '');
    if (text.includes(',') && !/^\d{1,3}(,\d{3})*(\.\d+)?$/u.test(text)) return { ok: false, error: 'Amount format is unclear; use 1,234.56 or 1234.56' };
    text = text.replace(/,/gu, '');
    if (!/^\d+(?:\.\d{1,})?$/u.test(text)) return { ok: false, error: 'Amount is not a valid number' };
    const [whole, decimal = ''] = text.split('.');
    const cents = Number(whole) * 100 + Number((decimal + '00').slice(0, 2)) + (Number(decimal[2] || 0) >= 5 ? 1 : 0);
    if (!Number.isSafeInteger(cents)) return { ok: false, error: 'Amount exceeds the supported range' };
    return { ok: true, value: negative ? -cents : cents, note: decimal.length > 2 ? 'Rounded to 2 decimal places' : '' };
  }

  function parseDate(value, order = 'DMY') {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return { ok: true, value: value.toISOString().slice(0, 10), display: value.toISOString().slice(0, 10) };
    const source = String(value ?? '').trim();
    if (!source) return { ok: false, error: 'Date is blank' };
    let year, month, day;
    let match = source.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u);
    if (match) [, year, month, day] = match;
    else {
      match = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/u);
      if (!match) return { ok: false, error: 'Date format not recognized' };
      const first = Number(match[1]), second = Number(match[2]);
      year = match[3].length === 2 ? String(Number(match[3]) >= 70 ? 1900 + Number(match[3]) : 2000 + Number(match[3])) : match[3];
      [day, month] = order === 'MDY' ? [second, first] : [first, second];
    }
    year = Number(year); month = Number(month); day = Number(day);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 2200 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return { ok: false, error: 'Date is impossible or outside 1900–2200' };
    return { ok: true, value: parsed.toISOString().slice(0, 10), display: source, note: 'Parsed using ' + order + ' date order' };
  }

  function normalize(value, type, settings = {}) {
    if (type === 'amount') return parseAmount(value);
    if (type === 'date') return parseDate(value, settings.dateOrder || 'DMY');
    const text = cleanText(value);
    return text ? { ok: true, value: text } : { ok: false, error: 'Key value is blank' };
  }

  function duplicateGroups(rows, keys) {
    const groups = new Map();
    rows.forEach((row, index) => {
      const parts = keys.map(key => row.normalized[key.id]?.ok ? row.normalized[key.id].value : null);
      if (parts.some(part => part === null)) return;
      const signature = JSON.stringify(parts);
      if (!groups.has(signature)) groups.set(signature, []);
      groups.get(signature).push(index);
    });
    return [...groups.values()].filter(group => group.length > 1);
  }

  function reconcile(leftRows, rightRows, keys, settings = {}) {
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('Choose at least one matching key.');
    if (leftRows.length > 5000 || rightRows.length > 5000) throw new Error('This release supports up to 5,000 transaction rows per source workbook. Filter or split larger periods.');
    const dateTolerance = Math.max(0, Number(settings.dateToleranceDays) || 0);
    const amountTolerance = Math.max(0, Number(settings.amountToleranceCents) || 0);
    const dateOrder = settings.dateOrder || 'DMY';
    const prepare = rows => rows.map((row, index) => ({
      ...row,
      sourceIndex: index,
      normalized: Object.fromEntries(keys.map(key => [key.id, normalize(row.values[key.id], key.type, { dateOrder })]))
    }));
    const left = prepare(leftRows), right = prepare(rightRows);
    const valid = row => keys.every(key => row.normalized[key.id].ok);
    const errors = side => side.flatMap((row, index) => keys.filter(key => !row.normalized[key.id].ok).map(key => ({ side: row.side || '', sourceRow: row.sourceRow, key: key.label, message: row.normalized[key.id].error })));
    const usableLeft = left.filter(valid), usableRight = right.filter(valid);
    const candidates = new Map(usableLeft.map(row => [row.sourceIndex, []]));
    const rightCandidateCounts = new Map(usableRight.map(row => [row.sourceIndex, 0]));
    const equals = (a, b, key) => {
      const av = a.normalized[key.id].value, bv = b.normalized[key.id].value;
      if (key.type === 'amount') return Math.abs(av - bv) <= amountTolerance;
      if (key.type === 'date') return Math.abs((Date.parse(av) - Date.parse(bv)) / 86400000) <= dateTolerance;
      return av === bv;
    };
    let edgeCount = 0;
    for (const a of usableLeft) for (const b of usableRight) {
      if (keys.every(key => equals(a, b, key))) {
        if (++edgeCount > 250000) throw new Error('More than 250,000 possible pairs were found. Add a more discriminating key, reduce tolerance, or split the period; no partial results were produced.');
        candidates.get(a.sourceIndex).push(b.sourceIndex);
        rightCandidateCounts.set(b.sourceIndex, rightCandidateCounts.get(b.sourceIndex) + 1);
      }
    }
    const matched = [], ambiguous = [], unmatchedLeft = [], ambiguousRight = new Set();
    for (const a of usableLeft) {
      const options = candidates.get(a.sourceIndex);
      if (options.length === 1 && rightCandidateCounts.get(options[0]) === 1) matched.push({ leftIndex: a.sourceIndex, rightIndex: options[0], decision: 'Auto: mutually unique exact/tolerance match', explanation: explain(a, right[options[0]], keys, amountTolerance, dateTolerance) });
      else if (options.length) {
        options.forEach(index => ambiguousRight.add(index));
        ambiguous.push({ leftIndex: a.sourceIndex, rightIndices: options, explanation: options.map(index => explain(a, right[index], keys, amountTolerance, dateTolerance)) });
      } else unmatchedLeft.push(a.sourceIndex);
    }
    const pairedRight = new Set(matched.map(item => item.rightIndex));
    const unmatchedRight = usableRight.filter(row => !pairedRight.has(row.sourceIndex) && !ambiguousRight.has(row.sourceIndex)).map(row => row.sourceIndex);
    const leftDuplicates = duplicateGroups(left, keys), rightDuplicates = duplicateGroups(right, keys);
    return {
      left, right, matched, ambiguous, unmatchedLeft, unmatchedRight,
      leftDuplicates, rightDuplicates, invalidLeft: errors(left), invalidRight: errors(right),
      settings: { dateOrder, dateToleranceDays: dateTolerance, amountToleranceCents: amountTolerance }
    };
  }

  function explain(left, right, keys, amountTolerance, dateTolerance) {
    return keys.map(key => {
      const a = left.normalized[key.id].value, b = right.normalized[key.id].value;
      if (key.type === 'amount' && a !== b) return `${key.label}: ${formatMoney(a)} vs ${formatMoney(b)} (difference ${formatMoney(Math.abs(a - b))}; allowed ${formatMoney(amountTolerance)})`;
      if (key.type === 'date' && a !== b) return `${key.label}: ${a} vs ${b} (${Math.abs((Date.parse(a) - Date.parse(b)) / 86400000)} day(s); allowed ${dateTolerance})`;
      return `${key.label}: ${String(a)} matched`;
    }).join('; ');
  }

  function summarize(result) {
    const invalidSalesRows = new Set(result.invalidLeft.map(row => row.sourceRow)).size;
    const invalidBankRows = new Set(result.invalidRight.map(row => row.sourceRow)).size;
    const ambiguousBankRows = new Set(result.ambiguous.flatMap(row => row.rightIndices)).size;
    return {
      salesRows: result.left.length,
      bankRows: result.right.length,
      matchedRows: result.matched.length,
      matchRatePercent: result.left.length ? Number((result.matched.length * 100 / result.left.length).toFixed(1)) : 0,
      ambiguousSalesRows: result.ambiguous.length,
      ambiguousBankRows,
      unmatchedSalesRows: result.unmatchedLeft.length,
      unmatchedBankRows: result.unmatchedRight.length,
      invalidSalesRows,
      invalidBankRows,
      duplicateSalesGroups: result.leftDuplicates.length,
      duplicateBankGroups: result.rightDuplicates.length
    };
  }

  function formatMoney(cents) { return `₦${(Math.abs(cents) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

  function confirmPair(result, leftIndex, rightIndex) {
    const item = result.ambiguous.find(entry => entry.leftIndex === leftIndex && entry.rightIndices.includes(rightIndex));
    if (!item) throw new Error('Selected pair is not an available candidate.');
    if (result.matched.some(entry => entry.leftIndex === leftIndex || entry.rightIndex === rightIndex)) throw new Error('A confirmed row cannot be used twice.');
    result.matched.push({ leftIndex, rightIndex, decision: 'Manually confirmed by operator', explanation: item.explanation[item.rightIndices.indexOf(rightIndex)] });
    result.ambiguous = result.ambiguous.filter(entry => entry.leftIndex !== leftIndex);
    item.rightIndices = item.rightIndices.filter(index => index !== rightIndex);
    for (const entry of result.ambiguous) {
      entry.rightIndices = entry.rightIndices.filter(index => index !== rightIndex);
      if (!entry.rightIndices.length) result.unmatchedLeft.push(entry.leftIndex);
    }
    result.ambiguous = result.ambiguous.filter(entry => entry.rightIndices.length);
    const stillAmbiguousRights = new Set(result.ambiguous.flatMap(entry => entry.rightIndices));
    for (const row of result.right) {
      if (!result.matched.some(match => match.rightIndex === row.sourceIndex) && !stillAmbiguousRights.has(row.sourceIndex) && !result.unmatchedRight.includes(row.sourceIndex)) result.unmatchedRight.push(row.sourceIndex);
    }
    result.unmatchedRight = result.unmatchedRight.filter(index => index !== rightIndex);
    return result;
  }

  return { parseAmount, parseDate, normalize, reconcile, summarize, confirmPair, formatMoney };
});
