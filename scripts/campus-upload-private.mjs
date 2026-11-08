import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { BlobNotFoundError, get, head, put } from '@vercel/blob';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workDir = join(root, '.product-work', 'campus-bursary', 'v0.2.1');
const files = [
  ['campus-bursary-a-pilot-v0.2.1.zip', 'campus-bursary/v0.2.1/campus-bursary-a-pilot-v0.2.1.zip'],
  ['campus-bursary-b-pilot-v0.2.1.zip', 'campus-bursary/v0.2.1/campus-bursary-b-pilot-v0.2.1.zip'],
  ['campus-bursary-all-pilot-v0.2.1.zip', 'campus-bursary/v0.2.1/campus-bursary-all-pilot-v0.2.1.zip']
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function verifyStored(path, expectedHash, expectedSize, options) {
  const metadata = await head(path, options);
  if (!metadata.url.endsWith(path) || !metadata.url.includes('.private.blob.vercel-storage.com/') || metadata.size !== expectedSize) {
    throw new Error('Private Blob metadata did not match the expected file.');
  }
  const result = await get(path, { ...options, access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || result.blob.size !== expectedSize) throw new Error('Private Blob read-back failed.');
  const reader = result.stream.getReader();
  const digest = createHash('sha256');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      digest.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (digest.digest('hex') !== expectedHash) throw new Error('Private Blob checksum did not match the release manifest.');
}

async function main() {
  const manifest = JSON.parse(await readFile(join(workDir, 'package-manifest.json'), 'utf8'));
  const verifiedFiles = await Promise.all(files.map(async ([name, path]) => {
    const entry = manifest.find(item => item.file === name);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Release manifest is missing a valid package checksum.');
    const buffer = await readFile(join(workDir, name));
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || sha256(buffer) !== entry.sha256) {
      throw new Error('Local ZIP failed its release checksum or format check.');
    }
    return { name, path, buffer, sha256: entry.sha256 };
  }));

  if (process.argv.includes('--check-only')) {
    for (const file of verifiedFiles) process.stdout.write(`READY ${file.name} (${file.buffer.length} bytes)\n`);
    process.stdout.write('No upload was performed.\n');
    return;
  }
  if (!process.argv.includes('--upload')) throw new Error('Choose --check-only or explicitly pass --upload.');

  const auth = process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN }
    : process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID
      ? { oidcToken: process.env.VERCEL_OIDC_TOKEN, storeId: process.env.BLOB_STORE_ID }
      : null;
  if (!auth) throw new Error('Private Blob access is missing; configure credentials in ignored .env.local.');
  const options = { ...auth, abortSignal: AbortSignal.timeout(120000) };

  for (const file of verifiedFiles) {
    let existing;
    try { existing = await head(file.path, options); }
    catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
    if (existing) {
      await verifyStored(file.path, file.sha256, file.buffer.length, options);
      process.stdout.write(`VERIFIED existing ${file.path}\n`);
      continue;
    }
    await put(file.path, file.buffer, {
      ...options, access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip'
    });
    await verifyStored(file.path, file.sha256, file.buffer.length, options);
    process.stdout.write(`UPLOADED and verified ${file.path}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error?.name || 'Error'}: Campus private upload stopped. No secret or URL was printed.\n`);
  process.exitCode = 1;
});
