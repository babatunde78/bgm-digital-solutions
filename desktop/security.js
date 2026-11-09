'use strict';
const { randomBytes, scryptSync, createCipheriv, createDecipheriv, verify } = require('node:crypto');
const { DocumentError, text } = require('./core');
const MAX_BACKUP = 256 * 1024 * 1024;
function seal(payload, password) {
  text(password, 'backup passphrase', 1024);
  if (password.length < 12) throw new DocumentError('Use at least 12 characters for the backup passphrase');
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > MAX_BACKUP) throw new DocumentError('Backup exceeds pilot size limit of 256 MB');
  const salt = randomBytes(16), nonce = randomBytes(12), key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const header = Buffer.concat([Buffer.from('BGMBK001'), salt, nonce]); cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  key.fill(0);
  return Buffer.concat([header, cipher.getAuthTag(), encrypted]);
}
function unseal(bytes, password) {
  text(password, 'backup passphrase', 1024);
  if (!Buffer.isBuffer(bytes) || bytes.length < 53 || bytes.length > MAX_BACKUP + 52 || bytes.subarray(0, 8).toString() !== 'BGMBK001') throw new DocumentError('Unsupported backup format or size');
  const key = scryptSync(password, bytes.subarray(8, 24), 32);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(24, 36));
    decipher.setAAD(bytes.subarray(0, 36)); decipher.setAuthTag(bytes.subarray(36, 52));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(52)), decipher.final()]).toString());
  } catch { throw new DocumentError('Backup authentication failed: wrong passphrase or damaged file'); }
  finally { key.fill(0); }
}
function signed(envelope, publicKey) {
  if (!publicKey || !envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || envelope.payload.length > 16384 || envelope.signature.length > 256) throw new DocumentError('Signed file or verification key unavailable');
  const payload = Buffer.from(envelope.payload, 'base64');
  if (!verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new DocumentError('Signed file authenticity check failed');
  try { return JSON.parse(payload.toString('utf8')); } catch { throw new DocumentError('Invalid signed file'); }
}
function verifyLicence(envelope, publicKey, institution, now = new Date()) {
  const claims = signed(envelope, publicKey);
  if (claims.product !== 'campus-bursary-documents' || claims.institution !== institution || claims.scope !== 'single-computer' || typeof claims.expires !== 'string' || !Number.isFinite(Date.parse(claims.expires))) throw new DocumentError('Licence does not match this institution, product or scope');
  const expired = now.getTime() >= Date.parse(claims.expires);
  return { valid: true, expired, canFinalise: !expired, canExport: true };
}
function verifyUpdate(envelope, publicKey, current, schema) {
  const manifest = signed(envelope, publicKey);
  if (manifest.product !== 'campus-bursary-documents' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !Number.isSafeInteger(manifest.schema) || manifest.schema < schema || !Number.isSafeInteger(manifest.size) || manifest.size < 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new DocumentError('Invalid update manifest');
  const next = manifest.version.split('.').map(Number), installed = current.split('.').map(Number);
  const different = next.findIndex((part, index) => part !== installed[index]);
  if (different < 0 || next[different] < installed[different]) throw new DocumentError('Update is not newer; downgrade refused');
  const url = new URL(manifest.url);
  if (url.origin !== 'https://www.bgmsolutions.site' || url.pathname !== '/api/download' || url.username || url.password || url.hash) throw new DocumentError('Update must use the existing private delivery endpoint');
  return manifest;
}
function trustedPage(url, entry) { return typeof url === 'string' && url.split('#', 1)[0] === entry; }
module.exports = { seal, unseal, verifyLicence, verifyUpdate, trustedPage };
