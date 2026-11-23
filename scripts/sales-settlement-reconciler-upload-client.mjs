import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { uploadPresigned } from '@vercel/blob/client';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const release = join(root, '.product-work', 'sales-settlement-reconciler', 'v0.2.0');
const filename = 'Sales-Settlement-Reconciler-v0.2.0.zip';
const pathname = 'sales-settlement-reconciler/v0.2.0/sales-settlement-reconciler-v0.2.0-customer.zip';
let activeToken = '';
let activeEndpoint = '';

async function main() {
  const [endpoint, tokenFile, bypassFile] = process.argv.slice(2);
  if (!endpoint?.startsWith('https://') || !tokenFile || !bypassFile) throw new Error('Pass the HTTPS upload endpoint and protected credential-file paths.');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const bypass = (await readFile(bypassFile, 'utf8')).trim();
  activeToken = token;
  activeEndpoint = endpoint;
  const manifest = JSON.parse((await readFile(join(release, 'package-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const entry = manifest.file === filename ? manifest : manifest.package;
  const bytes = await readFile(join(release, filename));
  if (!entry || bytes.length !== entry.size || bytes.length !== 47931 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Release package failed its local manifest check.');
  const headers = { Authorization: `Bearer ${token}`, 'x-vercel-protection-bypass': bypass, 'Content-Type': 'application/json' };
  const preflight = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'blob.generate-presigned-url', payload: { pathname, clientPayload: token, multipart: true } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!preflight.ok) throw new Error(`Upload endpoint returned ${preflight.status}.`);
  const uploaded = await uploadPresigned(pathname, bytes, {
    access: 'private', handleUploadUrl: endpoint, clientPayload: token,
    headers: { Authorization: `Bearer ${token}`, 'x-vercel-protection-bypass': bypass },
    contentType: 'application/zip', multipart: true, abortSignal: AbortSignal.timeout(120000),
  });
  if (uploaded.pathname !== pathname) throw new Error('Private storage returned an unexpected pathname.');
  const verified = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, 'x-vercel-protection-bypass': bypass }, signal: AbortSignal.timeout(120000) });
  if (!verified.ok || (await verified.json()).sha256 !== entry.sha256) throw new Error('Private storage read-back did not verify the release checksum.');
  process.stdout.write('Private v0.2.0 ZIP upload and server-side checksum verification succeeded.\n');
}

main().catch(error => {
  const detail = [error?.name, error?.code, error?.statusCode, error?.message].filter(Boolean).join(' ')
    .replaceAll(activeToken, '[token redacted]')
    .replaceAll(activeEndpoint, '[endpoint redacted]')
    .replace(/[?&]_vercel_share=[^&\s]+/g, '?[share token redacted]');
  process.stderr.write(`Release upload failed: ${detail.slice(0, 220)}\n`);
  process.exitCode = 1;
});
