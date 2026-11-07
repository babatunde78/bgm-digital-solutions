'use strict';
const crypto = require('node:crypto');
const { siteUrl } = require('./config');

class HttpError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
function secure(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function endpoint(method, handler) {
  return async (req, res) => {
    secure(res);
    if (req.method !== method) { res.setHeader('Allow', method); return res.status(405).json({ error: 'Method not allowed' }); }
    try { return await handler(req, res); }
    catch (error) {
      const incident = crypto.randomUUID();
      // Never log request bodies, tokens, credentials, emails or provider objects.
      console.error(JSON.stringify({ incident, code: error.code || 'internal_error', status: error.status || 503 }));
      if (res.headersSent) { res.destroy(); return; }
      return res.status(error.status || 503).json({ error: error.status ? error.message : 'Service temporarily unavailable. Please try again.', code: error.code || 'service_unavailable', incident });
    }
  };
}
function sameOrigin(req) {
  if (req.headers.origin !== siteUrl()) throw new HttpError(403, 'Please submit this form from the store.');
}
function body(req) {
  let value;
  try { value = req.body; } catch { throw new HttpError(400, 'Invalid JSON request.'); }
  if (!String(req.headers['content-type'] || '').startsWith('application/json') || !value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
    throw new HttpError(400, 'Invalid request.');
  }
  if (JSON.stringify(value).length > 4096) throw new HttpError(413, 'Request too large.');
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function session(req) {
  const value = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('bgm_session='))?.slice(12);
  return /^[A-Za-z0-9_-]{43}$/.test(value || '') ? value : null;
}
function setSession(req, res) {
  const token = session(req) || crypto.randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', `bgm_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${siteUrl().startsWith('https:') ? '; Secure' : ''}`);
  return token;
}
function requireSession(req) {
  const token = session(req);
  if (!token) throw new HttpError(401, 'Please reopen your purchase in the original browser or contact BGM support to recover access.', 'session_required');
  return hash(token);
}
function reference(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.=-]{6,120}$/.test(value)) throw new HttpError(400, 'Invalid payment reference.');
  return value;
}
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new HttpError(400, 'Enter a valid email address.');
  return value.trim().toLowerCase();
}
module.exports = { HttpError, endpoint, secure, sameOrigin, body, hash, equal, session, setSession, requireSession, reference, email };
