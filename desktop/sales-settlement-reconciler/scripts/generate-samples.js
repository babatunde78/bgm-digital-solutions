'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildWorkbook, parseWorkbook } = require('../xlsx');
const { reconcile } = require('../core');
const outputOption = process.argv.indexOf('--output');
const output = path.resolve(outputOption >= 0 ? process.argv[outputOption + 1] : path.resolve(__dirname, '../../../.product-work/sales-settlement-reconciler/v0.2.0/samples'));
fs.mkdirSync(output, { recursive: true });

const sales = [
  ['Sales ID','Bank Reference','Transaction Date','Gross Amount (NGN)','Customer'],
  ['000041','TRF-11001','17/11/2026','₦125,000.00','Amina Foods'],
  ['000042','TRF-11002','17/11/2026','45,000.00','Tunde Supplies'],
  ['000043','TRF-11003','17/11/2026','45000.00','Ayo Mart'],
  ['000044','RF-0007','16/11/2026','(2,500.00)','Bright Stores'],
  ['000045','POS-5191','17/11/2026','100,000.00','Oakline Retail'],
  ['000046','DUP-77','17/11/2026','20,000.00','Meridian Shop A'],
  ['000047','DUP-77','17/11/2026','20,000.00','Meridian Shop B'],
  ['000048','TRF-11008','15/11/2026','75,000.00','Lime House'],
  ['000049','TRF-11009','16/11/2026','12,500.00','Haven Market']
];
const bank = [
  ['Statement Reference','Value Date','Credit / Debit (NGN)','Narration'],
  ['TRF-11001','2026-11-17','125000','Amina Foods transfer'],
  ['TRF-11003','17-11-2026','45,000.00','Ayo Mart transfer'],
  ['TRF-11002','2026-11-17','45,000.00','Tunde Supplies transfer'],
  ['RF-0007','16/11/2026','-2500','Refund reversal'],
  ['POS-5191','2026-11-17','100,000.02','POS settlement'],
  ['DUP-77','2026-11-17','20,000','Multiple sales possible'],
  ['TRF-11010','2026-11-17','9,500.00','Unmatched deposit']
];
fs.writeFileSync(path.join(output, 'Sample-Sales-Register.xlsx'), buildWorkbook([{ name: 'Sales', rows: sales }]));
fs.writeFileSync(path.join(output, 'Sample-Bank-Export.xlsx'), buildWorkbook([{ name: 'Statement', rows: bank }]));
const salesWorkbook = parseWorkbook(fs.readFileSync(path.join(output, 'Sample-Sales-Register.xlsx'))).sheets[0];
const bankWorkbook = parseWorkbook(fs.readFileSync(path.join(output, 'Sample-Bank-Export.xlsx'))).sheets[0];
const readRows = (sheet, mapping, side) => sheet.rows.slice(1).map(row => ({ side, sourceRow: row.rowNumber, original: Object.fromEntries(sheet.rows[0].cells.map((cell, i) => [cell.shown, row.cells[i]?.raw || ''])), values: Object.fromEntries(mapping.map(([id, column]) => [id, row.cells[column]?.shown || ''])) }));
const keys = [{ id:'reference',label:'Bank Reference',type:'text' },{ id:'date',label:'Date',type:'date' },{ id:'amount',label:'Amount',type:'amount' }];
const result = reconcile(readRows(salesWorkbook, [['reference',1],['date',2],['amount',3]], 'left'), readRows(bankWorkbook, [['reference',0],['date',1],['amount',2]], 'right'), keys, { dateOrder:'DMY', amountToleranceCents:5 });
const matched = [['Sales source row','Bank source row','Decision','Explanation']]; result.matched.forEach(pair => matched.push([result.left[pair.leftIndex].sourceRow,result.right[pair.rightIndex].sourceRow,pair.decision,pair.explanation]));
const ambiguous = [['Sales source row','Candidate bank rows','Evidence']]; result.ambiguous.forEach(item => ambiguous.push([result.left[item.leftIndex].sourceRow,item.rightIndices.map(i=>result.right[i].sourceRow).join(', '),item.explanation.join(' || ')]));
const duplicates = [['Side','Source rows','Key values']]; for (const [side, groups, rows] of [['Sales',result.leftDuplicates,result.left],['Bank',result.rightDuplicates,result.right]]) groups.forEach(group=>duplicates.push([side,group.map(i=>rows[i].sourceRow).join(', '),JSON.stringify(rows[group[0]].values)]));
const exceptions = [['Side','Source row','Outcome'],...result.unmatchedLeft.map(i=>['Sales',result.left[i].sourceRow,'No matching bank record']),...result.unmatchedRight.map(i=>['Bank',result.right[i].sourceRow,'No matching sales record'])];
const summary = [['Demonstration report · fictional data','Count'],['Automatically matched',result.matched.length],['Ambiguous; needs human confirmation',result.ambiguous.length],['Unmatched sales',result.unmatchedLeft.length],['Unmatched bank',result.unmatchedRight.length],['Detected duplicate groups',result.leftDuplicates.length+result.rightDuplicates.length],['Amount tolerance (NGN)',result.settings.amountToleranceCents/100],['Date order',result.settings.dateOrder]];
fs.writeFileSync(path.join(output, 'Sample-Completed-Reconciliation.xlsx'), buildWorkbook([{name:'Summary',rows:summary},{name:'Matched',rows:matched},{name:'Ambiguous',rows:ambiguous},{name:'Duplicates',rows:duplicates},{name:'Exceptions',rows:exceptions}]));
console.log(`Created fictional sample files in ${output}`);
