'use strict';

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const xlsx = require('./xlsx');
let window;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => window?.show());

function createWindow() {
  window = new BrowserWindow({
    title: 'BGM Sales & Settlement Reconciler', width: 1280, height: 900, minWidth: 1000, minHeight: 720,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(createWindow);

ipcMain.handle('pick-xlsx', async () => {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Excel workbook (.xlsx)', extensions: ['xlsx'] }] });
  if (result.canceled) return null;
  const filename = result.filePaths[0], stat = fs.statSync(filename);
  if (stat.size > 40 * 1024 * 1024) throw new Error('This release supports source files up to 40 MB each.');
  return { fileName: path.basename(filename), sourcePath: path.resolve(filename), workbook: xlsx.parseWorkbook(fs.readFileSync(filename)) };
});

ipcMain.handle('save-report', async (event, payload) => {
  if (!payload || !Array.isArray(payload.sheets) || payload.sheets.length < 1 || payload.sheets.length > 12) throw new Error('Invalid report request.');
  const result = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath('documents'), 'Reconciliation-Report.xlsx'), filters: [{ name: 'Excel workbook (.xlsx)', extensions: ['xlsx'] }] });
  if (result.canceled) return false;
  const destination = path.resolve(result.filePath);
  const target = destination.toLowerCase().endsWith('.xlsx') ? destination : destination + '.xlsx';
  if (payload.sourcePaths.some(source => source && path.resolve(source).toLocaleLowerCase() === target.toLocaleLowerCase())) throw new Error('Choose a new report file; source workbooks are never overwritten.');
  fs.writeFileSync(target, xlsx.buildWorkbook(payload.sheets), { flag: 'wx', mode: 0o600 });
  return { fileName: path.basename(target) };
});
