'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assets = ['index.html','404.html','product.html','support.html','payment-success.html','campus-bursary.html','campus-documents.html','campus-documents.css','campus-documents-release.json','styles.css','app.js','site.js','products.js','catalog-loader.js','purchase.js','campus-preview.js','robots.txt','sitemap.xml'];
const output = path.resolve(__dirname, '../public');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of assets) fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(output, file));
fs.copyFileSync(path.resolve(__dirname, '../site.js'), path.join(output, 'site.js'));
const images = ['bgm-guides-mockup','business-prompts','ai-side-hustles','remote-jobs','scholarships','upwork','five-guide-bundle','collections-bank','campus-bursary-a','campus-bursary-b','campus-bursary-full-excel','batch-and-balance','contractor-cash-flow-planner-mockup','school-fee-reconciliation','social-seller-bookkeeping'];
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
for (const name of images) fs.copyFileSync(path.resolve(__dirname, '../assets', name + '.jpg'), path.join(output, 'assets', name + '.jpg'));
const productMockups = [
  'herbal-research-analysis-toolkit-mockup.jpg',
  'questionnaire-research-design-alignment-mockup.jpg',
  'questionnaire-scale-scoring-dashboard.jpg',
  'questionnaire-data-checking-mockup-v1.png',
  'nigeria-small-employer-payroll-mockup-v1.png',
  'client-pack-assembler-mockup.png',
  'sales-settlement-reconciler-mockup.png',
  'furniture-quote-invoice-mockup.png',
  'training-certificate-generator-v1.1.0.png',
  'rental-income-arrears-ledger-mockup-v2.jpg',
  'drinks-stock-customer-book-mockup-v2.jpg',
  'bakery-recipe-costing.jpg',
  'aluminium-job-costing.jpg',
  'paint-job-ledger-mockup.png',
  'rent-clear-mockup.png',
];
for (const file of productMockups) fs.copyFileSync(path.resolve(__dirname, '../assets', file), path.join(output, 'assets', file));
fs.copyFileSync(path.resolve(__dirname, '../assets/campus-documents-pdf-mockup-v0.1.1.png'), path.join(output, 'assets/campus-documents-pdf-mockup-v0.1.1.png'));
const sampleDir = path.join(output, 'assets', 'campus-documents-samples');
fs.mkdirSync(sampleDir, { recursive: true });
for (const name of ['receipt', 'statement', 'voucher']) fs.copyFileSync(path.resolve(__dirname, '../assets/campus-documents-samples', name + '.pdf'), path.join(sampleDir, name + '.pdf'));
console.log(`Built ${assets.length} public assets. Server code, SQL, tests and documentation are excluded.`);
