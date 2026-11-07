'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const roots = ['api','lib','scripts','tests'];
const files = roots.flatMap(dir => fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir,f)))
  .concat(['app.js','site.js','products.js','catalog-loader.js','purchase.js']);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
for (const file of ['package.json','vercel.json']) JSON.parse(fs.readFileSync(file,'utf8'));
console.log(`Syntax and configuration checks passed (${files.length} JavaScript files).`);
