import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { upload } from '@vercel/blob/client';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const release = join(root, '.product-work', 'sales-settlement-reconciler', 'v0.1.0');
const pathname = 'sales-settlement-reconciler/v0.1.0/sales-settlement-reconciler-v0.1.0-customer.zip';

async function main() {
  const [endpoint, tokenFile] = process.argv.slice(2);
  if (!endpoint?.startsWith('https://') || !tokenFile) throw new Error('Pass the HTTPS upload endpoint and private token-file path.');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const manifestFile = JSON.parse(await readFile(join(release, 'package-manifest.json'), 'utf8'));
  const entry = Array.isArray(manifestFile) ? manifestFile.find(item => item.file === 'Sales-Settlement-Reconciler-v0.1.0.zip') : manifestFile;
  const bytes = await readFile(join(release, 'Sales-Settlement-Reconciler-v0.1.0.zip'));
  if (!entry || bytes.length !== entry.size || bytes.length !== 43753 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Release package failed its local manifest check.');
  const uploaded = await upload(pathname, bytes, {
    access: 'private', handleUploadUrl: endpoint, clientPayload: token,
    headers: { Authorization: `Bearer ${token}` }, contentType: 'application/zip', multipart: true,
    abortSignal: AbortSignal.timeout(120000),
  });
  if (uploaded.pathname !== pathname) throw new Error('Private storage returned an unexpected pathname.');
  const verified = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
  if (!verified.ok || (await verified.json()).sha256 !== entry.sha256) throw new Error('Private storage read-back did not verify the release checksum.');
  process.stdout.write('Private ZIP upload and server-side checksum verification succeeded.\n');
}

main().catch(error => {
  process.stderr.write(`${error?.name || 'Error'}: release upload failed; no token or private URL was printed.\n`);
  process.exitCode = 1;
});
