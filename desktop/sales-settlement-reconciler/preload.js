'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localFiles', {
  pickWorkbook: () => ipcRenderer.invoke('pick-xlsx'),
  saveReport: payload => ipcRenderer.invoke('save-report', payload)
});
