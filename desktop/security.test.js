'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { seal, unseal, verifyLicence, verifyUpdate } = require('./security');
test('encrypted backups round trip and reject wrong password or modified bytes', () => {
  const payload = { format: 'bgm-bursary-documents-1', records: [{ reference: '00001' }] };
  const encrypted = seal(payload, 'synthetic passphrase only');
  assert.deepEqual(unseal(encrypted, 'synthetic passphrase only'), payload);
  assert.throws(() => unseal(encrypted, 'wrong passphrase'));
  const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unseal(tampered, 'synthetic passphrase only'));
});
test('expired signed licence retains historical export but blocks new final documents', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from(JSON.stringify({ product: 'campus-bursary-documents', institution: 'Synthetic College', scope: 'single-computer', expires: '2026-11-01T00:00:00.000Z' }));
  const licence = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
  assert.deepEqual(verifyLicence(licence, publicKey, 'Synthetic College', new Date('2026-11-09')), { valid: true, expired: true, canFinalise: false, canExport: true });
  assert.throws(() => verifyLicence(licence, publicKey, 'Another College'));
});
test('signed update binds version hash size schema and private delivery origin', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from(JSON.stringify({ product: 'campus-bursary-documents', version: '0.2.0', schema: 1, size: 100, sha256: 'a'.repeat(64), url: 'https://www.bgmsolutions.site/api/download?token=synthetic' }));
  const manifest = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
  assert.equal(verifyUpdate(manifest, publicKey, '0.1.0', 1).version, '0.2.0');
  assert.throws(() => verifyUpdate(manifest, publicKey, '0.3.0', 1));
});
