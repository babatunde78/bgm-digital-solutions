'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateData, analyse, importCsv, billStudents, reverseJournal } = require('../lib/campus-finance');
const [command, input, ...args] = process.argv.slice(2);
if (!input || !['validate', 'report', 'import', 'bill', 'reverse'].includes(command)) {
  process.stderr.write('Usage: node scripts/campus-data.js validate|report DATA.json [AS_OF]\nImport: import DATA.json CSV MAPPING.json OUTPUT.json\nBilling: bill DATA.json OPTIONS.json OUTPUT.json\nReversal: reverse DATA.json JOURNAL_ID OPTIONS.json OUTPUT.json\n');
  process.exitCode = 1;
} else {
  try {
    const data = JSON.parse(fs.readFileSync(input, 'utf8'));
    const issues = validateData(data);
    if (issues.length) { process.stderr.write(JSON.stringify({ issues }, null, 2) + '\n'); process.exitCode = 1; }
    else if (command === 'validate') process.stdout.write('Valid shared dataset\n');
    else if (command === 'report') process.stdout.write(JSON.stringify(analyse(data, args[0]), null, 2) + '\n');
    else {
      let output; let target;
      if (command === 'import') {
        const result = importCsv(data, fs.readFileSync(args[0], 'utf8'), JSON.parse(fs.readFileSync(args[1], 'utf8')));
        if (result.errors.length) { process.stderr.write(JSON.stringify({ errors: result.errors }, null, 2) + '\n'); process.exitCode = 1; }
        else { output = result.data; target = args[2]; }
      } else if (command === 'bill') {
        output = billStudents(data, JSON.parse(fs.readFileSync(args[0], 'utf8'))); target = args[1];
      } else { output = reverseJournal(data, args[0], JSON.parse(fs.readFileSync(args[1], 'utf8'))); target = args[2]; }
      if (output) {
        if (!target || path.resolve(target) === path.resolve(input)) throw new RangeError('Write to a new output dataset');
        fs.writeFileSync(target, JSON.stringify(output, null, 2), { flag: 'wx' });
        process.stdout.write('Validated output written; original preserved\n');
      }
    }
  } catch (error) { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; }
}
