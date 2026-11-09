'use strict';
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store');
const core = require('./core');
const security = require('./security');
const release = require('./release.json');
const showWindow = require('./window');
let store, window, processing = false, closing = false;
const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
if (smoke) app.disableHardwareAcceleration();
if (smoke) app.setPath('userData', path.resolve(__dirname, `../.product-work/cbd-smoke-${Date.now()}`));
else if (process.platform === 'win32') {
  const local = process.env.LOCALAPPDATA;
  if (!local || !path.isAbsolute(local) || local.startsWith('\\\\')) throw new core.DocumentError('A private local Windows application-data directory is required');
  app.setPath('userData', path.join(local, 'BGM Digital Solutions', 'CampusBursaryDocuments'));
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow(window));
function lockedWindow(options = {}) {
  const win = new BrowserWindow({ width: 1240, height: 880, ...options, webPreferences: { preload: options.preload, offscreen: Boolean(options.offscreen), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  return win;
}
async function pdf(html) {
  const win = lockedWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>', margins: { top: 0.7, bottom: 0.8, left: 0.6, right: 0.6 } });
  } finally { win.destroy(); }
}
function licence() {
  if (release.licensing?.activation === 'none') return { label: 'No activation required — offline document generation enabled', canFinalise: true, canExport: true };
  if (!app.isPackaged) return { label: 'Development pilot — commercial activation not configured', canFinalise: true, canExport: true };
  const key = release.licencePublicKey;
  const filename = path.join(app.getPath('userData'), 'institution.licence.json');
  if (!key || !fs.existsSync(filename)) return { label: 'Licence unavailable — records and exports remain accessible', canFinalise: false, canExport: true };
  try { const result = security.verifyLicence(JSON.parse(fs.readFileSync(filename, 'utf8')), key, store.config()?.name); return { ...result, label: result.expired ? 'Expired — historical export available' : 'Institution licence active' }; }
  catch { return { label: 'Licence invalid — historical export available', canFinalise: false, canExport: true }; }
}
async function processJobs() {
  if (processing || closing || !licence().canFinalise) return;
  processing = true;
  try {
    for (const job of store.jobs().filter(job => job.state === 'queued')) {
      if (closing || !licence().canFinalise) break;
      await store.run(job.id, pdf);
    }
  } finally { processing = false; }
}
async function pickRead(extension, max) {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: extension, extensions: [extension] }] });
  if (result.canceled) return null;
  const filename = result.filePaths[0];
  if (fs.statSync(filename).size > max) throw new core.DocumentError('Selected file exceeds the supported size');
  return fs.readFileSync(filename);
}
async function save(filename, bytes) {
  const result = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath('documents'), filename) });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, bytes, { mode: 0o600 }); return true;
}
async function handle(action, input = {}) {
  if (!input || typeof input !== 'object' || Buffer.byteLength(JSON.stringify(input)) > 100000) throw new core.DocumentError('Invalid request');
  switch (action) {
    case 'state': return { config: store.config(), documents: store.documents(), records: store.records(), jobs: store.jobs(), release, licence: licence() };
    case 'configure': return store.configure(input.config, input.actor);
    case 'import': { const bytes = await pickRead('csv', 20 * 1024 * 1024); return bytes ? store.stage(core.parseCsv(bytes.toString('utf8')), input.source) : null; }
    case 'accept': return store.accept(input.id, input.actor, input.evidence);
    case 'create': return store.create(input.kind, input.references, input.actor, input.options);
    case 'review': return store.review(input.id, input.actor);
    case 'preview': {
      const doc = store.document(input.id); if (!doc) throw new core.DocumentError('Document missing');
      const win = lockedWindow({ title: 'Document preview — current status' });
      if (doc.state === 'final') await win.loadURL(`data:application/pdf;base64,${store.pdf(doc.id).toString('base64')}`);
      else await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc.state === 'cancelled' && doc.snapshot.renderedHtml ? doc.snapshot.renderedHtml.replace('<span class="status">FINAL</span>', '<span class="status">CANCELLED</span>') : core.render({ ...doc.snapshot, status: doc.state }))}`);
      return true;
    }
    case 'enqueue': if (!licence().canFinalise) throw new core.DocumentError('A valid institution licence is required for new final documents; historical export remains available'); return store.enqueue(input.id);
    case 'retry': return store.retry(input.id);
    case 'cancel-job': return store.cancelJob(input.id, input.actor);
    case 'cancel-document': return store.cancelDocument(input.id, input.actor, input.reason);
    case 'export-pdf': {
      const doc = store.document(input.id); if (!doc) throw new core.DocumentError('Document missing');
      if (doc.state === 'cancelled') throw new core.DocumentError('Original cancelled PDF retained in encrypted backup; export a marked cancelled copy instead');
      const result = await save(`${doc.id}.pdf`, store.pdf(doc.id));
      if (result) store.event(input.actor, 'export-original-pdf', doc.id); return result;
    }
    case 'reprint': {
      const doc = store.document(input.id);
      if (!doc || !['final', 'cancelled'].includes(doc.state)) throw new core.DocumentError('Select a final or cancelled document');
      const status = doc.state === 'cancelled' ? 'cancelled' : 'reprinted';
      const html = doc.snapshot.renderedHtml ? doc.snapshot.renderedHtml.replace('<span class="status">FINAL</span>', `<span class="status">${status.toUpperCase()}</span>`) : core.render({ ...doc.snapshot, status });
      const bytes = await pdf(html);
      const result = await save(`${doc.id}-${status}.pdf`, bytes);
      if (result) store.event(input.actor, status, doc.id); return result;
    }
    case 'backup': return save('campus-bursary.backup', security.seal(store.exportData(), input.password));
    case 'restore': { const bytes = await pickRead('backup', 256 * 1024 * 1024 + 52); if (bytes) store.restore(security.unseal(bytes, input.password), input.actor); return Boolean(bytes); }
    case 'export-data': return save('campus-bursary-export.json', Buffer.from(JSON.stringify(store.exportData(), null, 2)));
    case 'licence': {
      if (!release.licencePublicKey) throw new core.DocumentError('Commercial licence verification key is not configured for this pilot');
      const bytes = await pickRead('json', 24000); if (!bytes) return false;
      security.verifyLicence(JSON.parse(bytes.toString()), release.licencePublicKey, store.config()?.name);
      fs.writeFileSync(path.join(app.getPath('userData'), 'institution.licence.json'), bytes, { mode: 0o600 }); return true;
    }
    case 'update': {
      if (!release.updatePublicKey) throw new core.DocumentError('Signed update channel is not configured. Offline work continues. Obtain reviewed installers through BGM purchase support.');
      const bytes = await pickRead('json', 24000); if (!bytes) return null;
      return security.verifyUpdate(JSON.parse(bytes.toString()), release.updatePublicKey, release.version, release.schemaVersion);
    }
    default: throw new core.DocumentError('Unsupported operation');
  }
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:', 'devtools:'].includes(new URL(details.url).protocol) }));
  const data = app.getPath('userData'); fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  if (data.startsWith('\\\\')) throw new core.DocumentError('Use a private local profile, not a network share');
  store = new Store(path.join(data, 'bursary.sqlite'));
  window = lockedWindow({ title: release.productName, preload: path.join(__dirname, 'preload.js'), ...(smoke ? { offscreen: true, show: false } : {}) });
  ipcMain.handle('bursary', async (event, action, input) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !security.trustedPage(event.senderFrame.url, entry)) throw new core.DocumentError('Untrusted window');
    try { return { ok: true, value: await handle(action, input) }; }
    catch (error) { return { ok: false, error: error instanceof core.DocumentError ? error.message : 'Operation failed. Original data retained; check input or contact support.' }; }
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (!smoke) showWindow(window);
  if (smoke) {
    try { await require('./smoke')(store, window, pdf); app.exit(0); }
    catch (error) { fs.writeFileSync(path.join(data, 'smoke-error.txt'), error.stack); app.exit(1); }
  } else {
    const timer = setInterval(() => { processJobs().catch(() => {}); }, 1000); timer.unref();
    await processJobs();
  }
}).catch(error => {
  const message = error instanceof core.DocumentError ? error.message : 'The local profile could not be opened. Check its permissions and contact BGM support; retained records have not been removed.';
  if (smoke) process.stderr.write(`${error.name}: ${message}\n`);
  else dialog.showErrorBox(release.productName, message);
  app.exit(1);
});
app.on('before-quit', event => {
  if (processing) { event.preventDefault(); closing = true; const timer = setInterval(() => { if (!processing) { clearInterval(timer); app.quit(); } }, 100); }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (store) store.close(); });
