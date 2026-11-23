'use strict';

window.WorkbookTable = {
  from(workbook, sheetName, headerRowNumber) {
    const sheet = workbook.sheets.find(item => item.name === sheetName);
    if (!sheet) throw new Error('Choose a worksheet from the selected workbook.');
    const header = sheet.rows.find(row => row.rowNumber === Number(headerRowNumber));
    if (!header) throw new Error('Header row was not found.');
    const headers = [], used = new Set();
    for (let i = 0; i < header.cells.length; i++) {
      let name = (header.cells[i]?.shown || '').trim() || `Column ${i + 1}`;
      const base = name; let suffix = 2;
      while (used.has(name.toLocaleLowerCase())) name = `${base} (${suffix++})`;
      used.add(name.toLocaleLowerCase()); headers[i] = name;
    }
    const rows = sheet.rows.filter(row => row.rowNumber > Number(headerRowNumber)).map(source => {
      const original = Object.fromEntries(headers.map((name, index) => [name, source.cells[index]?.raw ?? '']));
      const values = Object.fromEntries(headers.map((name, index) => [name, source.cells[index]?.shown ?? '']));
      return { sourceRow: source.rowNumber, original, sourceValues: values, values: {}, side: '' };
    }).filter(row => Object.values(row.sourceValues).some(value => String(value).trim() !== ''));
    return { sheetName, headers, rows };
  }
};
