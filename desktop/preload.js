'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bursary', { call: (action, input) => ipcRenderer.invoke('bursary', action, input) });
