const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pawpdotIslandHost', {
  ready: () => ipcRenderer.send('pawpdot:island:control', 'ready'),
  resize: (width, height) => ipcRenderer.send('pawpdot:island:control', 'resize', width, height),
  open: key => ipcRenderer.send('pawpdot:island:control', 'open', key),
  returnFocus: () => ipcRenderer.send('pawpdot:island:control', 'blur'),
  onSnapshot: callback => ipcRenderer.on('pawpdot:island:snapshot', (_event, snapshot) => callback(snapshot)),
  onFocus: callback => ipcRenderer.on('pawpdot:island:focus', () => callback()),
  getSettings: () => ipcRenderer.invoke('pawpdot:island:settings:get'),
  onSettings: callback => ipcRenderer.on('pawpdot:island:settings', (_event, settings) => callback(settings)),
});

