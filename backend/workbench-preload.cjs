const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('pawpdotIsland', {
    setContext: context => ipcRenderer.invoke('pawpdot:island:source', 'context', context),
    publish: item => ipcRenderer.invoke('pawpdot:island:source', 'publish', item),
    dismiss: (id, pluginId) => ipcRenderer.invoke('pawpdot:island:source', 'dismiss', { id, pluginId }),
    onNavigate: callback => {
      const listener = (_event, pageId) => callback(pageId);
      ipcRenderer.on('pawpdot:island:navigate', listener);
      return () => ipcRenderer.off('pawpdot:island:navigate', listener);
    },
  });
  contextBridge.exposeInMainWorld('pawpdotIslandSettings', {
    get: () => ipcRenderer.invoke('pawpdot:island:settings:get'),
    set: value => ipcRenderer.invoke('pawpdot:island:settings:set', value),
  });
  contextBridge.exposeInMainWorld('pawpdotWindowState', {
    onDrag: callback => {
      const listener = (_event, dragging) => callback(Boolean(dragging));
      ipcRenderer.on('pawpdot:window-drag', listener);
      return () => ipcRenderer.off('pawpdot:window-drag', listener);
    },
    onResize: callback => {
      const listener = (_event, resizing) => callback(Boolean(resizing));
      ipcRenderer.on('pawpdot:window-resize', listener);
      return () => ipcRenderer.off('pawpdot:window-resize', listener);
    },
  });
  contextBridge.exposeInMainWorld('pawpdotHomeSurface', {
    setActive: active => ipcRenderer.send('pawpdot:home-surface', Boolean(active)),
    onMessage: callback => {
      const listener = (_event, message) => callback(message);
      ipcRenderer.on('pawpdot:pet-surface-message', listener);
      return () => ipcRenderer.off('pawpdot:pet-surface-message', listener);
    },
  });
  contextBridge.exposeInMainWorld('pawpdotAccount', {
    request: (action, input) => ipcRenderer.invoke('pawpdot:account', action, input),
  });
  window.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    if (!body) return;
    let previousTheme;
    const publishTheme = () => {
      const theme = body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
      if (theme === previousTheme) return;
      previousTheme = theme;
      ipcRenderer.send('pawpdot:workbench-theme', theme);
    };
    const observer = new MutationObserver(publishTheme);
    observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    publishTheme();
  }, { once: true });
}
