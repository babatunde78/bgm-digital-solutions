'use strict';

const zlib = require('node:zlib');
const path = require('node:path');

function readZip(buffer, maxTotal = 100 * 1024 * 1024) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The selected file is not a valid XLSX zip package.');
  const entries = buffer.readUInt16LE(eocd + 10), offset = buffer.readUInt32LE(eocd + 16);
  const output = new Map(); let cursor = offset, total = 0;
  for (let i = 0; i < entries; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid XLSX directory entry.');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), expectedCrc = buffer.readUInt32LE(cursor + 16), compressed = buffer.readUInt32LE(cursor + 20), uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32), localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw new Error('Unsafe file path inside XLSX package.');
    if (flags & 1) throw new Error('Encrypted XLSX workbooks are not supported.');
    total += uncompressed;
    if (total > maxTotal) throw new Error('Expanded XLSX package exceeds 100 MB.');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid XLSX file entry.');
    const localName = buffer.readUInt16LE(localOffset + 26), localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const bytes = buffer.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(bytes) : method === 8 ? zlib.inflateRawSync(bytes, { maxOutputLength: 100 * 1024 * 1024 }) : null;
    if (!data) throw new Error(`Unsupported XLSX compression method ${method}.`);
    if (data.length !== uncompressed || crc32(data) !== expectedCrc) throw new Error('XLSX entry failed its size or integrity check.');
    output.set(name, data.toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

function xmlText(text) {
  return String(text ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function attr(xml, name) { return new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(xml)?.[1] ?? ''; }
function columnNumber(cellRef) { return [...cellRef.match(/^([A-Z]+)/u)[1]].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1; }

function parseWorkbook(buffer) {
  const zip = readZip(buffer);
  const workbook = zip.get('xl/workbook.xml');
  const relations = zip.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !relations) throw new Error('Workbook metadata is missing. Select an .xlsx workbook.');
  const relMap = new Map([...relations.matchAll(/<Relationship\b([^>]*)\/?\s*>/gu)].map(([, source]) => [xmlText(attr(source, 'Id')), xmlText(attr(source, 'Target'))]));
  const shared = zip.get('xl/sharedStrings.xml');
  const strings = shared ? [...shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)].map(([, body]) => [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map(([, value]) => xmlText(value)).join('')) : [];
  const customFormats = new Map([...String(zip.get('xl/styles.xml') || '').matchAll(/<numFmt\b([^>]*)\/?\s*>/gu)].map(([, source]) => [Number(attr(source, 'numFmtId')), xmlText(attr(source, 'formatCode'))]));
  const styleFormats = [];
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u.exec(zip.get('xl/styles.xml') || '')?.[1] || '';
  for (const [, source] of xfs.matchAll(/<xf\b([^>]*)\/?\s*>/gu)) styleFormats.push(Number(attr(source, 'numFmtId')));
  const sheets = [];
  for (const [, source] of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/gu)) {
    const name = xmlText(attr(source, 'name')), id = xmlText(attr(source, 'r:id'));
    let target = relMap.get(id);
    if (!target) continue;
    target = path.posix.normalize(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (!target.startsWith('xl/') || target.includes('..')) continue;
    const sheetXml = zip.get(target);
    if (!sheetXml) continue;
    const rows = [];
    for (const [, rowAttributes, rowBody] of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gu)) {
      const values = [];
      for (const [, cellAttributes, cellBody] of rowBody.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
        const ref = attr(cellAttributes, 'r'), column = columnNumber(ref), type = attr(cellAttributes, 't'), style = Number(attr(cellAttributes, 's') || 0);
        const formula = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/u.exec(cellBody)?.[1];
        const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(cellBody)?.[1] ?? '';
        let raw = '', shown = '';
        if (formula !== undefined) raw = shown = `= ${xmlText(formula)}`;
        else if (type === 's') raw = shown = strings[Number(value)] ?? '';
        else if (type === 'inlineStr') raw = shown = [...cellBody.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map(([, entry]) => xmlText(entry)).join('');
        else if (type === 'b') raw = shown = value === '1' ? 'TRUE' : 'FALSE';
        else {
          raw = xmlText(value);
          const format = customFormats.get(styleFormats[style]);
          if (/^0+$/u.test(format || '') && /^\d+$/u.test(raw)) shown = raw.padStart(format.length, '0');
          else if (isDateFormat(styleFormats[style], customFormats)) {
            const date = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000);
            shown = Number.isNaN(date.valueOf()) ? raw : date.toISOString().slice(0, 10);
          } else shown = raw;
        }
        values[column] = { raw, shown, formula: formula !== undefined };
      }
      const dense = [];
      for (let i = 0; i < values.length; i++) dense.push(values[i] || { raw: '', shown: '', formula: false });
      rows.push({ rowNumber: Number(attr(rowAttributes, 'r') || rows.length + 1), cells: dense });
    }
    sheets.push({ name, rows });
  }
  return { sheets, fileFormat: 'xlsx' };
}

function isDateFormat(id, formats) { return [14,15,16,17,18,19,20,21,22,45,46,47].includes(id) || /[dmy]/iu.test(formats.get(id) || ''); }

const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipFiles(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name, 'utf8'), raw = Buffer.from(content, 'utf8'), compressed = zlib.deflateRawSync(raw), crc = crc32(raw);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8); head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(filename.length, 26);
    local.push(head, filename, compressed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); offset += head.length + filename.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function colName(n) { let name = ''; while (n > 0) { const rem = (n - 1) % 26; name = String.fromCharCode(65 + rem) + name; n = Math.floor((n - 1) / 26); } return name; }
function safeCell(value) {
  if (value === null || value === undefined) return '<c/>';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c><v>${value}</v></c>`;
  const text = String(value);
  return `<c t="inlineStr"><is><t xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</t></is></c>`;
}
function buildWorkbook(sheets) {
  const safeSheets = sheets.map((sheet, index) => {
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => safeCell(value).replace('<c', `<c r="${colName(c + 1)}${r + 1}"`)).join('')}</row>`).join('');
    return { name: sheet.name.slice(0, 31).replace(/[\\/?*:[\]]/gu, '_') || `Sheet${index + 1}`, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>` };
  });
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${safeSheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeSheets.map((sheet, i) => `<sheet name="${sheet.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeSheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
  };
  safeSheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheet.xml; });
  return zipFiles(files);
}

module.exports = { parseWorkbook, buildWorkbook, readZip };
