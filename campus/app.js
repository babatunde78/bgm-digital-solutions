'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createGateway, createAuthAdapter } = require('./server');

class CampusRequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function readConfig(env) {
  const origin = env.CAMPUS_ORIGIN;
  const port = Number(env.CAMPUS_PORT);
  if (typeof origin !== 'string' || !/^(https:\/\/[a-z0-9.-]+(?::[0-9]+)?|http:\/\/(127\.0\.0\.1|localhost):[0-9]+)$/.test(origin) ||
    !Number.isInteger(port) || port < 1024 || port > 65535 || typeof env.CAMPUS_PRODUCT_NAME !== 'string' ||
    !env.CAMPUS_PRODUCT_NAME.trim() || env.CAMPUS_PRODUCT_NAME.length > 100) throw new TypeError('Campus configuration is invalid');
  const project = { url: env.CAMPUS_SUPABASE_URL, publishableKey: env.CAMPUS_SUPABASE_PUBLISHABLE_KEY };
  try { createGateway(project); } catch { throw new TypeError('Campus configuration is invalid'); }
  return { origin, port, productName: env.CAMPUS_PRODUCT_NAME, project };
}
async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new CampusRequestError(400, 'JSON required');
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length <= 262144) chunks.push(chunk);
  }
  if (length > 262144) throw new CampusRequestError(413, 'Request too large');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new CampusRequestError(400, 'Invalid JSON'); }
}
function createApp(config, { gateway, auth }) {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/client.js', ['client.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']]
  ]);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (config.origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    function json(status, value) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
    try {
      if (req.headers.host !== new URL(config.origin).host) return json(403, { error: 'Invalid host' });
      const url = new URL(req.url, config.origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type });
        return res.end(fs.readFileSync(path.join(__dirname, 'web', file)));
      }
      if (url.pathname === '/health' && req.method === 'GET') return json(200, { status: 'process_ready', database: 'not_probed' });
      if (url.pathname === '/api/config' && req.method === 'GET') return json(200, { productName: config.productName });
      if (!['/api/login', '/api/logout', '/api/action'].includes(url.pathname)) return json(404, { error: 'Not found' });
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: 'Method not allowed' }); }
      if (req.headers.origin !== config.origin) return json(403, { error: 'Invalid origin' });
      const body = await readBody(req);
      let result;
      if (url.pathname === '/api/login') result = await auth.login(body);
      else if (url.pathname === '/api/logout') result = await auth.logout(req.headers.authorization);
      else {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'action') || !Object.hasOwn(body, 'payload')) {
          return json(400, { error: 'Invalid request' });
        }
        result = await gateway(req.headers.authorization, body.action, body.payload);
      }
      return json(result.status, result.error ? { error: result.error } : { data: result.data });
    } catch (error) { return json(error instanceof CampusRequestError ? error.status : 503, { error: error instanceof CampusRequestError ? error.message : 'Service unavailable' }); }
  };
}
if (require.main === module) {
  const config = readConfig(process.env);
  const server = http.createServer(createApp(config, { gateway: createGateway(config.project), auth: createAuthAdapter(config.project) }));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(config.port, '127.0.0.1');
}
module.exports = { createApp, readConfig };
