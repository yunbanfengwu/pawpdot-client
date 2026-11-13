const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.dataset.pawpdotDesktopApp = '';
  }, { once: true });
  contextBridge.exposeInMainWorld('pawpdotIsland', {
    publish: item => ipcRenderer.invoke('pawpdot:island:source', 'publish', item),
    dismiss: id => ipcRenderer.invoke('pawpdot:island:source', 'dismiss', { id }),
  });
}

