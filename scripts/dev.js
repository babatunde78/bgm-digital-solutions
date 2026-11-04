'use strict';
// Small local adapter for the same CommonJS handlers deployed as Vercel functions.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assets = new Set(['index.html','404.html','payment-success.html','styles.css','app.js','products.js','catalog-loader.js','purchase.js','robots.txt']);
const port = Number(process.env.PORT || 3000);
process.env.SITE_URL ||= `http://localhost:${port}`;
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.txt':'text/plain' };
http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  if (/^\/api\/[a-z-]+$/.test(url.pathname)) {
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
  const found=assets.has(file);
  res.statusCode=found?200:404;
  res.setHeader('Content-Type',types[path.extname(found?file:'404.html')]);
  fs.createReadStream(path.resolve(__dirname,'..',found?file:'404.html')).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Store running at http://localhost:${port}. Checkout stays disabled until configuration is complete.`));
