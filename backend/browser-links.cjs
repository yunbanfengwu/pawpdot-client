const { shell } = require('electron');

function openWebUrl(url) {
  const target = URL.parse(url);
  if (!target || !['http:', 'https:'].includes(target.protocol)) return;
  return shell.openExternal(target.href);
}

function routeBrowserLinks(contents, isLocal, openLocalWindow) {
  const forward = url => {
    void openWebUrl(url)?.catch(error => console.warn('Could not open browser:', error.code || error.name));
  };

  function navigate(event) {
    if (!event.isMainFrame || isLocal(event.url)) return;
    event.preventDefault();
    forward(event.url);
  }

  contents.on('will-frame-navigate', navigate);
  contents.on('will-redirect', navigate);
  contents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      // A login flow can open a tab on click before its authorization URL is ready.
      return { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: { sandbox: true } } };
    }
    if (!openLocalWindow?.(url)) forward(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => {
    const staged = child.webContents;
    function handOff(event) {
      if (!event.isMainFrame || event.url === 'about:blank') return;
      event.preventDefault();
      if (!openLocalWindow?.(event.url)) forward(event.url);
      child.destroy();
    }
    staged.on('will-frame-navigate', handOff);
    staged.on('will-redirect', handOff);
    staged.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

module.exports = { openWebUrl, routeBrowserLinks };
