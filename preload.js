// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  downloadAudio: () => ipcRenderer.send('download-audio'),
  addUrlQueue: (url, format, browser) => ipcRenderer.send('add-url-queue', { url, format, browser }),
  queueUpdated: (callback) => ipcRenderer.on('queue-updated', (event, queueStatus) => callback(queueStatus)),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  getSavedFolder: () => ipcRenderer.invoke('get-saved-folder'),
  onProgress: (callback) => ipcRenderer.on('download-progress', (event, percent) => callback(percent)),
  onComplete: (callback) => ipcRenderer.on('download-complete', callback),
  onCancelled: (callback) => ipcRenderer.on('download-cancelled', callback),
  onError: (callback) => ipcRenderer.on('download-error', (event, message) => callback(message)),
  onTerminated: (callback) => ipcRenderer.on('download-ended', callback),
});
