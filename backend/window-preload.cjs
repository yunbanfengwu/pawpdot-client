const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pawpdotWindow', {
  minimize: () => ipcRenderer.send('pawpdot:window', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('pawpdot:window', 'toggle-maximize'),
  startDrag: () => ipcRenderer.send('pawpdot:window', 'drag-start'),
  moveDrag: (dx, dy) => ipcRenderer.send('pawpdot:window', 'drag-move', dx, dy),
  endDrag: () => ipcRenderer.send('pawpdot:window', 'drag-end'),
  close: () => ipcRenderer.send('pawpdot:window', 'close'),
  retry: () => ipcRenderer.send('pawpdot:window', 'retry'),
  onWindowLayout: callback => ipcRenderer.on('pawpdot:window-layout', (_event, inset) => callback(inset)),
  onWindowState: callback => ipcRenderer.on('pawpdot:window-state', (_event, maximized) => callback(maximized)),
  onWorkbenchTheme: callback => ipcRenderer.on('pawpdot:workbench-theme', (_event, theme) => callback(theme)),
  onWorkbenchReady: callback => ipcRenderer.once('pawpdot:workbench-ready', () => callback()),
});
