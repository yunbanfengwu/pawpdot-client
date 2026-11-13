const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pawpdotPetSurface', {
  post: message => ipcRenderer.send('pawpdot:pet-surface', message),
  onHostMessage: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('pawpdot:pet-surface-host', listener);
    return () => ipcRenderer.off('pawpdot:pet-surface-host', listener);
  },
});
