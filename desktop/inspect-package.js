'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const config = require('./package.json');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, config.build.directories.output, 'win-unpacked/resources/app.asar');
const allowed = new Set(config.build.files.map(name => `/${name}`));
const files = asar.listPackage(file).map(name => name.replaceAll('\\', '/'));
for (const name of files) {
  assert.ok(allowed.has(name), `Unexpected packaged file: ${name}`);
  const bytes = asar.extractFile(file, name.slice(1)), text = bytes.toString('utf8');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|BLOB_READ_WRITE_TOKEN|sk_live_[A-Za-z0-9]|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(text), `Server secret material or server binding in package: ${name}`);
  assert.ok(!/\.env|sqlite|backup|csv|\.test\./.test(name), `Customer data or development file in package: ${name}`);
  if (name !== '/package.json') assert.deepEqual(bytes, fs.readFileSync(path.join(__dirname, name.slice(1))), `Packaged source differs: ${name}`);
}
assert.ok(files.includes('/pdf.css'));
assert.ok(!files.includes('/smoke.js'));
process.stdout.write(`Inspected ${files.length} allowlisted application files; no server bindings, sample records, private keys or development tests bundled. Unsigned package only; not installer acceptance.\n`);
