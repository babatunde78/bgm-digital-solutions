import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BlobNotFoundError, get, head, put } from '@vercel/blob';

const root = resolve(process.cwd());
const release = join(root, '.product-work', 'document-pack-assembler', 'v0.1.0');
const filename = 'bgm-client-pack-assembler-v0.1.0-customer.zip';
const pathname = 'client-pack-assembler/v0.1.0/bgm-client-pack-assembler-v0.1.0-customer.zip';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const manifestFile = JSON.parse(await readFile(join(release, 'package-manifest.json'), 'utf8'));
  const entry = Array.isArray(manifestFile) ? manifestFile.find(item => item.file === filename) : manifestFile;
  const bytes = await readFile(join(release, filename));
  if (!entry || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes.length !== entry.size || hash(bytes) !== entry.sha256) {
    throw new Error('Local buyer ZIP does not match its package manifest.');
  }
  if (!process.argv.includes('--upload')) throw new Error('Pass --upload to upload the verified private package.');
  const auth = process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN }
    : process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID ? { oidcToken: process.env.VERCEL_OIDC_TOKEN, storeId: process.env.BLOB_STORE_ID } : null;
  if (!auth) throw new Error('Private Blob credentials are unavailable.');
  const options = { ...auth, abortSignal: AbortSignal.timeout(180000) };
  let existing;
  try { existing = await head(pathname, options); }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  if (!existing) await put(pathname, bytes, { ...options, access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip' });
  const metadata = await head(pathname, options);
  if (!metadata.url.endsWith(pathname) || !metadata.url.includes('.private.blob.vercel-storage.com/') || metadata.size !== bytes.length) throw new Error('Private Blob metadata did not match this release.');
  const result = await get(pathname, { ...options, access: 'private', useCache: false });
  if (result?.statusCode !== 200 || !result.stream) throw new Error('Private Blob read-back failed.');
  const digest = createHash('sha256');
  const reader = result.stream.getReader();
  try { while (true) { const { done, value } = await reader.read(); if (done) break; digest.update(value); } }
  finally { reader.releaseLock(); }
  if (digest.digest('hex') !== entry.sha256) throw new Error('Private package checksum mismatch.');
  process.stdout.write(`${existing ? 'VERIFIED existing' : 'UPLOADED and verified'} private package (${bytes.length} bytes, SHA-256 verified).\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.name || 'Error'}: private upload stopped; no credentials or URLs were printed.\n`);
  process.exitCode = 1;
});
