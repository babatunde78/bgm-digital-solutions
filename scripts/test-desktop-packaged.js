'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Store } = require('../desktop/store');
const { unseal } = require('../desktop/security');
const pilotEnvironment = require('../desktop/pilot-environment');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, '.product-work/campus-bursary-documents/v0.1.0/ui-review/release/win-unpacked/Campus Bursary Documents.exe');
const expectedAsar = process.argv[3] || 'a31cf9c45e218008cdff0f3e8b50a65990dad96066dac3bb64114448ee50f6d7';
const backup = path.join(root, '.product-work/cbd-native-audit/.product-work/campus-bursary-documents/v0.1.0/demo/synthetic.backup');
const output = path.join(root, `.product-work/cbd-pack-pilot-${Date.now()}`);
const profile = path.join(output, 'BGM Digital Solutions/CampusBursaryDocuments');
async function run() {
  assert.equal(process.platform, 'win32', 'This test requires Windows');
  assert.ok(executable.startsWith(path.join(root, '.product-work/campus-bursary-documents') + path.sep) && path.basename(executable) === 'Campus Bursary Documents.exe', 'Use an owned private audit artifact');
  assert.match(expectedAsar, /^[a-f0-9]{64}$/);
  const asar = fs.readFileSync(path.join(path.dirname(executable), 'resources/app.asar'));
  assert.equal(createHash('sha256').update(asar).digest('hex'), expectedAsar, 'Use the inspected audit package');
  const data = unseal(fs.readFileSync(backup), 'synthetic-demo-passphrase');
  assert.match(data.settings.name, /Synthetic River College/);
  assert.ok(data.records.every(row => /synthetic|fictional/i.test(JSON.parse(row.json).name)), 'Only synthetic records may be seeded');
  fs.mkdirSync(profile, { recursive: true });
  const store = new Store(path.join(profile, 'bursary.sqlite'));
  const expectedPdfs = {};
  try {
    store.restore(data, 'Synthetic Packaged Pilot');
    for (const doc of store.documents()) expectedPdfs[doc.id] = createHash('sha256').update(store.pdf(doc.id)).digest('hex');
  } finally { store.close(); }
  const environment = pilotEnvironment(output);
  const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-gpu'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let socket, browser, exited = false;
  const exit = new Promise(resolve => child.once('exit', code => { exited = true; resolve(code); }));
  const messages = new Map(); let next = 0;
  function command(connection, method, params = {}) {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { messages.delete(id); reject(new Error(`Debugger command timed out: ${method}`)); }, 10000);
      messages.set(id, { resolve, reject, timeout, connection, method }); connection.send(JSON.stringify({ id, method, params }));
    });
  }
  async function connect(url) {
    assert.ok(url.startsWith('ws://127.0.0.1:'), 'Debugger must bind loopback only');
    const connection = new WebSocket(url);
    connection.addEventListener('message', event => {
      const result = JSON.parse(event.data), pending = messages.get(result.id);
      if (pending) { clearTimeout(pending.timeout); messages.delete(result.id); result.error ? pending.reject(new Error(result.error.message)) : pending.resolve(result.result); }
    });
    connection.addEventListener('close', () => {
      for (const [id, pending] of messages) if (pending.connection === connection) {
        clearTimeout(pending.timeout); messages.delete(id);
        if (pending.method === 'Browser.close') pending.resolve({});
        else pending.reject(new Error('Test debugger connection closed'));
      }
    });
    await new Promise((resolve, reject) => { connection.addEventListener('open', resolve, { once: true }); connection.addEventListener('error', reject, { once: true }); });
    return connection;
  }
  try {
    const address = await new Promise((resolve, reject) => {
      let text = '';
      const timeout = setTimeout(() => reject(new Error('Packaged application did not expose its test debugger within 20 seconds')), 20000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.stderr.on('data', bytes => { text += bytes.toString(); const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    browser = await connect(address);
    const origin = `http://${new URL(address).host}`;
    let target;
    for (let attempt = 0; attempt < 40; attempt++) {
      const targets = await (await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
      target = targets.find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.endsWith('/index.html'));
      if (target) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, 'Packaged application window must open'); socket = await connect(target.webSocketDebuggerUrl);
    async function evaluate(expression) {
      const result = await command(socket, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, 'Packaged renderer evaluation must succeed'); return result.result.value;
    }
    let state;
    for (let attempt = 0; attempt < 30; attempt++) {
      state = await evaluate("window.bursary ? window.bursary.call('state') : null");
      if (state?.ok) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(state.ok, true); assert.equal(state.value.records.length, 3);
    assert.equal(state.value.licence.canFinalise, true); assert.equal(state.value.licence.canExport, true);
    assert.match(state.value.licence.label, /No activation required/);
    assert.equal(await evaluate("typeof require"), 'undefined');
    assert.equal(await evaluate("Boolean(document.querySelector('#actor').compareDocumentPosition(document.querySelector('#setup-form')) & Node.DOCUMENT_POSITION_FOLLOWING)"), true);
    assert.equal(await evaluate("(async () => { const selected = document.querySelector('#records input'); selected.checked = true; const reference = selected.value; await refresh(); return [...document.querySelectorAll('#records input:checked')].some(input => input.value === reference); })()"), true);
    const draft = await evaluate(`window.bursary.call('create', ${JSON.stringify({ kind: 'statement', references: ['00000000000000000001', '00000000000000000002'], actor: 'Synthetic Preparer', options: { opening: '0', openingEvidence: 'Synthetic zero opening' } })})`);
    assert.equal(draft.ok, true);
    assert.equal((await evaluate(`window.bursary.call('review', ${JSON.stringify({ id: draft.value.id, actor: 'Synthetic Reviewer' })})`)).ok, true);
    const queued = await evaluate(`window.bursary.call('enqueue', ${JSON.stringify({ id: draft.value.id })})`);
    assert.equal(queued.ok, true);
    let finalDocument;
    for (let attempt = 0; attempt < 100; attempt++) {
      const latest = await evaluate("window.bursary.call('state')");
      finalDocument = latest.value.documents.find(doc => doc.id === draft.value.id);
      if (finalDocument.state === 'final') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(finalDocument.state, 'final');
    const history = Object.keys(expectedPdfs)[0];
    assert.equal((await evaluate(`window.bursary.call('preview', ${JSON.stringify({ id: history })})`)).ok, true);
    await command(browser, 'Browser.close');
    let exitTimeout;
    let code;
    try { code = await Promise.race([exit, new Promise((_, reject) => { exitTimeout = setTimeout(() => reject(new Error('Graceful application exit not observed')), 10000); })]); }
    finally { clearTimeout(exitTimeout); }
    assert.equal(code, 0);
    const retained = new Store(path.join(profile, 'bursary.sqlite'));
    try { for (const [id, hash] of Object.entries(expectedPdfs)) assert.equal(createHash('sha256').update(retained.pdf(id)).digest('hex'), hash); }
    finally { retained.close(); }
    const report = { platform: process.platform, artifact: path.relative(root, executable), asarSha256: createHash('sha256').update(asar).digest('hex'), syntheticRecordsVisible: 3, archivedPdfHashesPreserved: true, historicalPreviewOpened: true, finalisedWithoutLicenceFile: true, nodeIntegrationDisabled: true, gracefulExit: true, scope: 'Unsigned unpacked application; no installer, officer acceptance or file-dialog export acceptance' };
    report.officerFieldBeforeSetup = true;
    report.recordSelectionSurvivedRefresh = true;
    fs.writeFileSync(path.join(output, 'packaged-results.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\nEvidence: ${path.relative(root, output)}\n`);
  } finally {
    if (!exited && browser?.readyState === WebSocket.OPEN) { try { await command(browser, 'Browser.close'); } catch { /* The browser may close its socket before replying. */ } }
    for (const pending of messages.values()) clearTimeout(pending.timeout);
    socket?.close(); browser?.close();
    if (!exited) { child.unref(); child.stderr.destroy(); process.stderr.write(`Owned test process ${child.pid} may still be open; close only that synthetic pilot window normally.\n`); }
  }
}
run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
