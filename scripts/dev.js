'use strict';
// Small local adapter for the same CommonJS handlers deployed as Vercel functions.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assets = new Set(['index.html','404.html','product.html','support.html','payment-success.html','campus-documents.html','campus-documents.css','campus-documents-release.json','styles.css','app.js','site.js','products.js','catalog-loader.js','purchase.js','robots.txt','sitemap.xml']);
const port = Number(process.env.PORT || 3000);
const cataloguePreview = process.argv.includes('--preview-catalogue');
const images = new Set(['bgm-guides-mockup','business-prompts','ai-side-hustles','remote-jobs','scholarships','upwork','five-guide-bundle','collections-bank'].map(name => 'assets/' + name + '.jpg'));
images.add('assets/campus-documents-pilot.png');
process.env.SITE_URL ||= `http://localhost:${port}`;
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.txt':'text/plain', '.xml':'application/xml; charset=utf-8', '.jpg':'image/jpeg' };
http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  if (/^\/api\/[a-z-]+$/.test(url.pathname)) {
    if (cataloguePreview && url.pathname === '/api/initialize-payment') return res.status(503).json({ error: 'Payments are disabled in this read-only preview.' });
    if (cataloguePreview && url.pathname === '/api/catalog' && req.method === 'GET') {
      try {
        const response = await fetch('https://www.bgmsolutions.site/api/catalog', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Catalogue unavailable');
        const data = await response.json();
        if (!Array.isArray(data.products)) throw new Error('Catalogue unavailable');
        return res.status(200).json({ preview: true, products: data.products.map(product => ({ ...product, paymentEnabled: false })) });
      } catch { return res.status(503).json({ error: 'Public catalogue unavailable for preview.' }); }
    }
    const file = path.resolve(__dirname,'..',url.pathname.slice(1)+'.js');
    if (!fs.existsSync(file)) return res.status(404).json({error:'Not found'});
    req.query = Object.fromEntries(url.searchParams);
    try {
      const chunks=[]; let size=0;
      for await (const chunk of req) { size+=chunk.length; if(size>262144) { res.statusCode=413;res.end();return; } chunks.push(chunk); }
      const raw=Buffer.concat(chunks);
      if(url.pathname==='/api/paystack-webhook') req.body=raw;
      else if(raw.length) req.body=JSON.parse(raw.toString());
      await require(file)(req,res);
    } catch { if(!res.headersSent)res.status(400).json({error:'Invalid request'});else res.destroy(); }
    return;
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const found=assets.has(file)||images.has(file);
  res.statusCode=found?200:404;
  res.setHeader('Content-Type', path.extname(file) === '.png' && found ? 'image/png' : types[path.extname(found?file:'404.html')]);
  fs.createReadStream(path.resolve(__dirname,'..',found?file:'404.html')).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Store running at http://localhost:${port}. Checkout stays disabled until configuration is complete.`));
