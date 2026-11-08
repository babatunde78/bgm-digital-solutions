'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assets = ['index.html','404.html','product.html','support.html','payment-success.html','campus-bursary.html','styles.css','app.js','site.js','products.js','catalog-loader.js','purchase.js','campus-preview.js','robots.txt','sitemap.xml'];
const output = path.resolve(__dirname, '../public');
fs.mkdirSync(output, { recursive: true });
for (const file of assets) fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(output, file));
const campusProducts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/product-import.json'), 'utf8'))
  .filter(product => product.id.startsWith('campus-bursary-'))
  .map(({ id, name, short, description, features }) => ({
    id,
    name: name.replace(/^Campus Bursary:\s*/, 'Campus Bursary: '),
    short,
    description,
    features: features.filter(feature => !/^First-year amount includes/i.test(feature))
  }));
fs.writeFileSync(path.join(output, 'campus-preview.json'), JSON.stringify({ productName: 'Campus Bursary', products: campusProducts }));
fs.copyFileSync(path.resolve(__dirname, '../site.js'), path.join(output, 'site.js'));
const images = ['bgm-guides-mockup','business-prompts','ai-side-hustles','remote-jobs','scholarships','upwork','five-guide-bundle','collections-bank'];
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
for (const name of images) fs.copyFileSync(path.resolve(__dirname, '../assets', name + '.jpg'), path.join(output, 'assets', name + '.jpg'));
console.log(`Built ${assets.length} public assets. Server code, SQL, tests and documentation are excluded.`);
