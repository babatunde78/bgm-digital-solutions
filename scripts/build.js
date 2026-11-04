'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assets = ['index.html','404.html','payment-success.html','styles.css','app.js','products.js','catalog-loader.js','purchase.js','robots.txt'];
const output = path.resolve(__dirname, '../public');
fs.mkdirSync(output, { recursive: true });
for (const file of assets) fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(output, file));
console.log(`Built ${assets.length} public assets. Server code, SQL, tests and documentation are excluded.`);
