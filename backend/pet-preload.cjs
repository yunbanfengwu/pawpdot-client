const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pawpdotPetHost', {
  adopt: id => ipcRenderer.invoke('pawpdot:pet', 'adopt', { id }),
  openAdoption: () => ipcRenderer.invoke('pawpdot:pet', 'open-adoption'),
  closeAdoption: () => ipcRenderer.invoke('pawpdot:pet', 'close-adoption'),
  setAction: action => ipcRenderer.invoke('pawpdot:pet', 'action', action),
  onSnapshot: callback => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('pawpdot:pet:snapshot', listener);
    return () => ipcRenderer.off('pawpdot:pet:snapshot', listener);
  },
});
