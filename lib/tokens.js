'use strict';
const crypto = require('node:crypto');
const { equal } = require('./http');
const MAX_AGE = { download: 600, 'campus-desktop-upgrade': 600, recovery: 604800 };
function secret() {
  if (process.env.DELIVERY_SECRET?.length < 32 || !process.env.DELIVERY_SECRET) throw new Error('Delivery secret missing');
  return process.env.DELIVERY_SECRET;
}
function sign(claims) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${crypto.createHmac('sha256', secret()).update(encoded).digest('base64url')}`;
}
function verify(token, purpose, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [encoded, signature] = token.split('.');
  if (!equal(signature, crypto.createHmac('sha256', secret()).update(encoded).digest('base64url'))) return null;
  let p; try { p = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { return null; }
  if (!p || p.v !== 1 || p.purpose !== purpose || !MAX_AGE[purpose] ||
      !Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.iat > now + 30 || p.exp <= now || p.exp <= p.iat || p.exp - p.iat > MAX_AGE[purpose] ||
      typeof p.order !== 'string' || !/^[0-9a-f-]{36}$/.test(p.order)) return null;
  if (purpose === 'download' && (!Number.isInteger(p.file) || p.file < 0)) return null;
  if (purpose === 'recovery' && (typeof p.jti !== 'string' || !/^[0-9a-f-]{36}$/.test(p.jti))) return null;
  return p;
}
module.exports = { sign, verify };
