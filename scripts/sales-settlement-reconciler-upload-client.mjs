import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { uploadPresigned } from '@vercel/blob/client';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const release = join(root, '.product-work', 'sales-settlement-reconciler', 'v0.1.0');
const pathname = 'sales-settlement-reconciler/v0.1.0/sales-settlement-reconciler-v0.1.0-customer.zip';
let activeToken = '';
let activeEndpoint = '';

async function main() {
  const [endpoint, tokenFile, bypassFile] = process.argv.slice(2);
  if (!endpoint?.startsWith('https://') || !tokenFile || !bypassFile) throw new Error('Pass the HTTPS upload endpoint and private credential-file paths.');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const bypass = (await readFile(bypassFile, 'utf8')).trim();
  activeToken = token;
  activeEndpoint = endpoint;
  const manifestFile = JSON.parse(await readFile(join(release, 'package-manifest.json'), 'utf8'));
  const entry = Array.isArray(manifestFile) ? manifestFile.find(item => item.file === 'Sales-Settlement-Reconciler-v0.1.0.zip') : manifestFile;
  const bytes = await readFile(join(release, 'Sales-Settlement-Reconciler-v0.1.0.zip'));
  if (!entry || bytes.length !== entry.size || bytes.length !== 43753 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Release package failed its local manifest check.');
  const preflight = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-vercel-protection-bypass': bypass, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'blob.generate-presigned-url', payload: { pathname, clientPayload: token, multipart: true } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!preflight.ok) {
    const responseText = (await preflight.text()).replaceAll(token, '[token redacted]').replace(/[?&]_vercel_share=[^&\s]+/g, '?[share token redacted]');
    throw new Error(`upload handler returned ${preflight.status}: ${responseText.slice(0, 180)}`);
  }
  const uploaded = await uploadPresigned(pathname, bytes, {
    access: 'private', handleUploadUrl: endpoint, clientPayload: token,
    headers: { Authorization: `Bearer ${token}`, 'x-vercel-protection-bypass': bypass }, contentType: 'application/zip', multipart: true,
    abortSignal: AbortSignal.timeout(120000),
  });
  if (uploaded.pathname !== pathname) throw new Error('Private storage returned an unexpected pathname.');
  const verified = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, 'x-vercel-protection-bypass': bypass }, signal: AbortSignal.timeout(120000) });
  if (!verified.ok || (await verified.json()).sha256 !== entry.sha256) throw new Error('Private storage read-back did not verify the release checksum.');
  process.stdout.write('Private ZIP upload and server-side checksum verification succeeded.\n');
}

main().catch(error => {
  const detail = [error?.name, error?.code, error?.statusCode, error?.message].filter(Boolean).join(' ')
    .replaceAll(activeToken, '[token redacted]')
    .replaceAll(activeEndpoint, '[endpoint redacted]')
    .replace(/[?&]_vercel_share=[^&\s]+/g, '?[share token redacted]');
  process.stderr.write(`Release upload failed: ${detail.slice(0, 220)}\n`);
  process.exitCode = 1;
});
