import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const directory = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, '../.product-work/campus-bursary-documents/v0.1.0/demo');
const expected = { receipt: ['Confirmed-payment receipt', '25,000.50', '00000000000000000002'], statement: ['Student account statement', '24,999.50', '50,000.00'], voucher: ['Payment voucher', '10,000.25', 'SUP-0001'], 'multipage-statement': ['DRAFT', '25,002.50', 'LONG-000249'] };
const results = [];
for (const [name, phrases] of Object.entries(expected)) {
  const loading = getDocument({ data: new Uint8Array(fs.readFileSync(path.join(directory, `${name}.pdf`))), useSystemFonts: true });
  const document = await loading.promise;
  const texts = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number), content = await page.getTextContent();
    const text = content.items.filter(item => 'str' in item).map(item => item.str).join(' '); texts.push(text);
    assert.match(text, /Page \d+ of \d+/);
    if (name === 'multipage-statement' && text.includes('LONG-')) assert.match(text, /Source reference/);
    if (number === 1 || number === document.numPages) {
      const viewport = page.getViewport({ scale: 1.3 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      fs.writeFileSync(path.join(directory, `${name}-page-${number}.png`), canvas.toBuffer('image/png'));
    }
  }
  const all = texts.join('\n').replace(/\s+/g, ' ');
  for (const phrase of phrases) assert.ok(all.replace(/\s/g, '').includes(phrase.replace(/\s/g, '')), `${name}: missing ${phrase}`);
  if (name === 'multipage-statement') assert.ok(document.numPages > 1);
  results.push({ file: `${name}.pdf`, pages: document.numPages, searchableText: true, expectedAmountsAndReferences: true, pageNumbers: true });
  await loading.destroy();
}
fs.writeFileSync(path.join(directory, 'pdf-verification.json'), JSON.stringify(results, null, 2));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
