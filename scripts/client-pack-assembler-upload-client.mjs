import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { uploadPresigned } from '@vercel/blob/client';

const root = resolve(process.cwd());
const release = join(root, '.product-work', 'document-pack-assembler', 'v0.1.0');
const pathname = 'client-pack-assembler/v0.1.0/bgm-client-pack-assembler-v0.1.0-customer.zip';
const filename = 'bgm-client-pack-assembler-v0.1.0-customer.zip';
const sha256 = '54e1b6cccc469bcff09a464a0019b5fc8997d2ca031c2d8cfa6af52aea6ea733';
let activeToken = '';
let activeEndpoint = '';

async function main() {
  const [endpoint, tokenFile] = process.argv.slice(2);
  if (!endpoint?.startsWith('https://') || !tokenFile) throw new Error('Pass the HTTPS upload endpoint and temporary credential-file path.');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  activeToken = token;
  activeEndpoint = endpoint;
  const manifestData = JSON.parse(await readFile(join(release, 'package-manifest.json'), 'utf8'));
  const manifest = Array.isArray(manifestData) ? manifestData : [manifestData];
  const entry = manifest.find(item => item.file === filename);
  const bytes = await readFile(join(release, filename));
  if (!entry || bytes.length !== 125440135 || bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== sha256 || entry.sha256 !== sha256 || token.length < 32) {
    throw new Error('Release ZIP or temporary credential failed local validation.');
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const preflight = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'blob.generate-presigned-url', payload: { pathname, clientPayload: token, multipart: true } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!preflight.ok) throw new Error(`Upload preflight returned ${preflight.status}.`);
  const uploaded = await uploadPresigned(pathname, bytes, {
    access: 'private', handleUploadUrl: endpoint, clientPayload: token, headers, contentType: 'application/zip', multipart: true,
    abortSignal: AbortSignal.timeout(180000),
  });
  if (uploaded.pathname !== pathname) throw new Error('Private storage returned an unexpected pathname.');
  const verified = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180000) });
  if (!verified.ok || (await verified.json()).sha256 !== sha256) throw new Error('Private package read-back did not verify its checksum.');
  process.stdout.write('Private Client Pack Assembler ZIP uploaded and server-side checksum verified.\n');
}

main().catch(error => {
  const detail = String(error?.message || '').replaceAll(activeToken, '[credential redacted]').replaceAll(activeEndpoint, '[endpoint redacted]').replace(/https?:\/\/\S+/g, '[URL redacted]');
  process.stderr.write(`Release upload failed: ${error?.name || 'Error'} ${detail.slice(0, 200)}\n`);
  process.exitCode = 1;
});
