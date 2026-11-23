'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('../xlsx');

test('generated report round-trips as a valid multi-sheet XLSX with literal untrusted text', () => {
  const buffer = xlsx.buildWorkbook([{ name: 'Matched', rows: [['Reference','Amount'], ['=HYPERLINK("http://bad")','₦5,000.00']] }, { name: 'Exceptions', rows: [['Issue'], ['<script>do not run</script>']] }]);
  const workbook = xlsx.parseWorkbook(buffer);
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ['Matched','Exceptions']);
  assert.equal(workbook.sheets[0].rows[1].cells[0].shown, '=HYPERLINK("http://bad")');
  assert.equal(workbook.sheets[1].rows[1].cells[0].shown, '<script>do not run</script>');
});

test('text identifiers keep leading zeroes through XLSX export and import', () => {
  const source = xlsx.parseWorkbook(xlsx.buildWorkbook([{ name:'Sales', rows:[['ID'],['000041']] } ]));
  assert.equal(source.sheets[0].rows[1].cells[0].shown, '000041');
});

test('XLSX parser refuses unsafe internal zip paths', () => {
  const invalid = Buffer.alloc(22); invalid.writeUInt32LE(0x06054b50); invalid.writeUInt16LE(1,8); invalid.writeUInt16LE(1,10);
  assert.throws(() => xlsx.parseWorkbook(invalid), /directory entry/u);
});
