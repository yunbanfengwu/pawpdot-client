const { app, BrowserWindow, Menu, WebContentsView, ipcMain, screen } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startHarness } = require('./harness.cjs');
const { registerAccount } = require('./account.cjs');
const { routeBrowserLinks } = require('./browser-links.cjs');
const { createDesktopChrome } = require('./desktop-chrome.cjs');

const frontend = path.join(__dirname, '..', 'frontend');
const appIcon = path.join(__dirname, '..', 'assets', 'brand', 'pawpdot.ico');
const shellPage = path.join(frontend, 'index.html');
const shellUrl = pathToFileURL(shellPage).href;
const errorUrl = shellUrl + '?state=error';
const windowBorder = 1;
const lifetime = new AbortController();
let window;
let workbench;
let homeSurface;
let runtime;
let workbenchTheme;
let restoredWindowBounds;
let previousRestore;
const windowDrags = new WeakMap();
let chromeHost;
let desktopChrome;
let resizeTimer;
let starting = false;
let closing = false;

app.setName('PawPdot');
if (process.platform === 'win32') app.setAppUserModelId('PawPdot.Desktop');
const dataOverride = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', dataOverride
  ? path.resolve(dataOverride)
  : path.join(app.getPath('appData'), 'Pawpdot Client'));

const islandSettingsDefaults = {
  wallpaper: '',
};
const islandSettingsFile = () => path.join(app.getPath('userData'), 'island-settings.json');
async function readIslandSettings() {
  try {
    const value = JSON.parse(await readFile(islandSettingsFile(), 'utf8'));
    return { ...islandSettingsDefaults, ...value };
  } catch {
    return { ...islandSettingsDefaults };
  }
}
function sanitizeIslandSettings(value) {
  const next = { ...islandSettingsDefaults };
  if (typeof value?.wallpaper === 'string' && value.wallpaper.length <= 5_500_000 && /^data:image\/(png|jpeg|webp);base64,/i.test(value.wallpaper)) next.wallpaper = value.wallpaper;
  return next;
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(createWindow).catch(error => {
    console.error('Could not open PawPdot:', error.message);
    app.quit();
  });
} else {
  app.quit();
}

app.on('before-quit', () => {
  closing = true;
  lifetime.abort();
});
app.on('window-all-closed', () => app.quit());

async function createWindow() {
  const theme = await readFile(path.join(frontend, 'workbench.css'), 'utf8');
  const { workAreaSize } = screen.getPrimaryDisplay();
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    title: 'PawPdot',
    icon: appIcon,
    width: Math.min(1248, workAreaSize.width - 32),
    height: Math.min(820, workAreaSize.height - 32),
    minWidth: Math.min(640, workAreaSize.width),
    minHeight: Math.min(420, workAreaSize.height),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: process.platform !== 'win32',
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'window-preload.cjs'),
      partition: 'pawpdot-shell',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.on('page-title-updated', event => event.preventDefault());
  routeBrowserLinks(window.webContents, url => url === shellUrl || url === errorUrl);

  workbench = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'workbench-preload.cjs'),
      partition: 'persist:pawpdot-client',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const contents = workbench.webContents;
  workbench.setBackgroundColor('#00000000');
  window.contentView.addChildView(workbench);
  homeSurface = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'pet-surface-preload.cjs'),
      partition: 'persist:pawpdot-client',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  homeSurface.setBackgroundColor('#00000000');
  homeSurface.setVisible(false);
  window.contentView.addChildView(homeSurface);
  chromeHost = createDesktopChrome();
  desktopChrome = chromeHost.attach(window, contents, {
    owns: url => Boolean(runtime && URL.parse(url)?.origin === runtime.origin),
    inset: trailingInset,
  });
  ipcMain.handle('pawpdot:island:settings:get', async () => readIslandSettings());
  ipcMain.handle('pawpdot:island:settings:set', async (_event, value) => {
    const next = sanitizeIslandSettings(value);
    await writeFile(islandSettingsFile(), JSON.stringify(next, null, 2), 'utf8');
    desktopChrome.broadcastSettings(next);
    return next;
  });
  window.on('resize', handleWindowResize);
  window.webContents.on('did-finish-load', layoutWindow);
  window.on('maximize', publishWindowState);
  window.on('unmaximize', publishWindowState);
  window.once('closed', () => {
    if (!contents.isDestroyed()) contents.close();
    if (homeSurface && !homeSurface.webContents.isDestroyed()) homeSurface.webContents.close();
  });
  layoutWindow();

  ipcMain.on('pawpdot:window', (event, action, dx, dy) => {
    const owner = chromeHost.ownerOfShell(event) ?? window;
    if (owner.isDestroyed()) return;
    const source = event.senderFrame?.url;
    const mainShell = owner === window && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && (source === shellUrl || source === errorUrl);
    if (!mainShell && !chromeHost.isShell(event, owner)) return;
    if (action === 'minimize') owner.minimize();
    if (action === 'toggle-maximize') {
      if (owner === window) toggleMaximize();
      else if (owner.isMaximized()) owner.unmaximize();
      else owner.maximize();
    }
    if (action === 'drag-start' && !owner.isMaximized() && !(owner === window && restoredWindowBounds)) {
      windowDrags.set(owner, owner.getBounds());
      const target = owner === window ? contents : owner.webContents;
      if (!target.isDestroyed()) target.send('pawpdot:window-drag', true);
      if (owner === window && homeSurface && !homeSurface.webContents.isDestroyed()) {
        homeSurface.webContents.send('pawpdot:pet-surface-host', { type: 'pawpdot:window-drag', dragging: true });
      }
    }
    const start = windowDrags.get(owner);
    if (action === 'drag-move' && start && Number.isFinite(dx) && Number.isFinite(dy)) {
      owner.setBounds({
        ...start,
        x: start.x + Math.round(dx),
        y: start.y + Math.round(dy),
      });
    }
    if (action === 'drag-end') {
      windowDrags.delete(owner);
      const target = owner === window ? contents : owner.webContents;
      if (!target.isDestroyed()) target.send('pawpdot:window-drag', false);
      if (owner === window && homeSurface && !homeSurface.webContents.isDestroyed()) {
        homeSurface.webContents.send('pawpdot:pet-surface-host', { type: 'pawpdot:window-drag', dragging: false });
      }
    }
    if (action === 'close') owner.close();
    if (action === 'retry' && mainShell && source === errorUrl) void boot();
  });

  ipcMain.on('pawpdot:home-surface', (event, active) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame || !runtime) return;
    homeSurface?.setVisible(Boolean(active));
  });

  ipcMain.on('pawpdot:pet-surface', (event, message) => {
    if (!homeSurface || event.sender !== homeSurface.webContents || !runtime || !message || typeof message.type !== 'string') return;
    if (!contents.isDestroyed()) contents.send('pawpdot:pet-surface-message', message);
  });

  ipcMain.on('pawpdot:workbench-theme', (event, colorScheme) => {
    if (!runtime || window.isDestroyed() || event.sender !== contents ||
        event.senderFrame !== contents.mainFrame ||
        new URL(event.senderFrame.url).origin !== runtime.origin ||
        (colorScheme !== 'dark' && colorScheme !== 'light')) return;
    workbenchTheme = colorScheme;
    window.webContents.send('pawpdot:workbench-theme', colorScheme);
    desktopChrome.theme(colorScheme);
  });

  configureWorkbench(contents, theme);
  registerAccount(window, contents, () => runtime?.origin, () => runtime?.home);
  await boot();
}

function trailingInset() {
  const { scaleFactor } = screen.getDisplayMatching(window.getBounds());
  // Windows can round the view's far edges outward at fractional display scales.
  return process.platform === 'win32' && !Number.isInteger(scaleFactor) ? windowBorder + 1 : windowBorder;
}

function layoutWindow() {
  const [width, height] = window.getContentSize();
  const trailingBorder = trailingInset();
  window.webContents.send('pawpdot:window-layout', trailingBorder);
  workbench.setBounds({
    x: windowBorder,
    y: windowBorder,
    width: width - windowBorder - trailingBorder,
    height: height - windowBorder - trailingBorder,
  });
  if (homeSurface && !homeSurface.webContents.isDestroyed()) {
    homeSurface.setBounds({
      x: windowBorder + 56,
      y: windowBorder + 42,
      width: Math.max(1, width - windowBorder - trailingBorder - 56),
      height: Math.max(1, height - windowBorder - trailingBorder - 42),
    });
  }
}

function handleWindowResize() {
  layoutWindow();
  const contents = workbench?.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.send('pawpdot:window-resize', true);
  if (homeSurface && !homeSurface.webContents.isDestroyed()) {
    homeSurface.webContents.send('pawpdot:pet-surface-host', { type: 'pawpdot:window-resize', resizing: true });
  }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!contents.isDestroyed()) contents.send('pawpdot:window-resize', false);
    if (homeSurface && !homeSurface.webContents.isDestroyed()) {
      homeSurface.webContents.send('pawpdot:pet-surface-host', { type: 'pawpdot:window-resize', resizing: false });
    }
  }, 140);
}

function toggleMaximize() {
  if (process.platform !== 'win32') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return;
  }

  // A transparent Windows window can differ from workArea by a device pixel.
  // Keep the normal bounds so maximize/restore doesn't depend on that equality.
  if (restoredWindowBounds) {
    const bounds = restoredWindowBounds;
    restoredWindowBounds = undefined;
    window.setResizable(true);
    window.setBounds(bounds);
    previousRestore = { requested: bounds, actual: window.getBounds() };
  } else {
    const bounds = window.getBounds();
    // Reuse the previous request if the user has not moved or resized it.
    const sameBounds = previousRestore && ['x', 'y', 'width', 'height']
      .every(key => bounds[key] === previousRestore.actual[key]);
    restoredWindowBounds = sameBounds ? previousRestore.requested : bounds;
    window.setResizable(false);
    window.setBounds(screen.getDisplayMatching(restoredWindowBounds).workArea);
  }
  publishWindowState();
}

function publishWindowState() {
  const maximized = process.platform === 'win32' ? Boolean(restoredWindowBounds) : window.isMaximized();
  window.webContents.send('pawpdot:window-state', maximized);
  desktopChrome.windowState(maximized);
  if (runtime && !workbench.webContents.isDestroyed()) {
    void workbench.webContents.executeJavaScript(
      'document.documentElement.toggleAttribute("data-pawpdot-maximized", ' + maximized + ')'
    ).catch(() => {});
  }
}

function configureWorkbench(contents, theme) {
  const appWindows = new Set();
  const appPrefix = '/api/pawpdot/apps/';
  contents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.webRequest.onBeforeSendHeaders({
    urls: ['http://127.0.0.1:*/*', 'ws://127.0.0.1:*/*'],
  }, (details, reply) => {
    const request = new URL(details.url);
    const appContents = details.webContents;
    const isHomeSurfaceRequest = appContents === homeSurface?.webContents;
    const isAppHostRequest = appWindows.has(appContents) && request.pathname.startsWith(appPrefix) &&
      (details.resourceType === 'mainFrame' || details.frame === appContents.mainFrame) &&
      (!details.initiatorOrigin || details.initiatorOrigin === runtime?.origin);
    if (runtime && (details.webContentsId === contents.id || isAppHostRequest || isHomeSurfaceRequest) &&
        request.origin.replace(/^ws:/, 'http:') === runtime.origin) {
      const existing = Object.keys(details.requestHeaders).find(key => key.toLowerCase() === 'cookie');
      const name = existing ?? 'Cookie';
      const otherCookies = details.requestHeaders[name]?.split(/;\s*/)
        .filter(cookie => !cookie.startsWith('dsh-auth-')) ?? [];
      details.requestHeaders[name] = [...otherCookies, runtime.cookie].join('; ');
    }
    reply({ requestHeaders: details.requestHeaders });
  });
  routeBrowserLinks(homeSurface.webContents, owns);

  const owns = url => runtime && URL.parse(url)?.origin === runtime.origin;
  routeBrowserLinks(contents, owns, url => {
    const target = URL.parse(url);
    if (target && owns(contents.getURL()) && owns(url) && /^\/api\/pawpdot\/apps\/window\/[^/]+$/.test(target.pathname)) {
      let pluginId;
      try { pluginId = decodeURIComponent(target.pathname.split('/').at(-1)); }
      catch { return false; }
      const appWindow = new BrowserWindow({
        icon: appIcon,
        parent: window,
        width: 1080,
        height: 720,
        minWidth: 640,
        minHeight: 420,
        frame: false,
        fullscreenable: false,
        backgroundColor: '#fafafa',
        show: false,
        webPreferences: {
          session: contents.session,
          preload: path.join(__dirname, 'app-preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      const appContents = appWindow.webContents;
      appWindows.add(appContents);
      appContents.once('destroyed', () => appWindows.delete(appContents));
      const appChrome = chromeHost.attach(appWindow, appContents, {
        owns: url => url === target.href,
        pluginId,
      });
      routeBrowserLinks(appContents, destination => destination === target.href);
      void Promise.all([appWindow.loadURL(target.href), appChrome.show()]).then(() => {
        if (!appWindow.isDestroyed()) appWindow.show();
      }).catch(() => {
        if (!appWindow.isDestroyed()) appWindow.close();
      });
      return true;
    }
    return false;
  });
  contents.on('dom-ready', () => {
    if (owns(contents.getURL())) {
      void contents.insertCSS(theme, { cssOrigin: 'user' }).catch(() => {});
    }
  });
}

async function boot() {
  if (starting || closing || runtime) return;
  starting = true;
  try {
    await window.loadFile(shellPage);
    publishWindowState();
    if (workbenchTheme) window.webContents.send('pawpdot:workbench-theme', workbenchTheme);
    const host = await startHarness(app.getPath('userData'), lifetime.signal);
    if (closing) {
      host.child.kill();
      return;
    }
    runtime = host;
    host.child.once('exit', () => {
      if (runtime !== host) return;
      runtime = undefined;
      if (!closing && !starting) void showFailure();
    });
    // Keep the view visible during navigation so Chromium acknowledges later view resizes.
    workbench.setVisible(true);
    await workbench.webContents.loadURL(host.origin);
    if (runtime !== host) throw new Error('Harness stopped before the workspace loaded.');
    publishWindowState();
    if (workbenchTheme) window.webContents.send('pawpdot:workbench-theme', workbenchTheme);
    await homeSurface.webContents.loadURL(host.origin + '/pawpdot/pet-home/index.html?full&surface');
    homeSurface.setVisible(false);
    await desktopChrome.show();
    if (closing) return;
    if (runtime !== host) throw new Error('Harness stopped before the workspace loaded.');
    if (workbenchTheme) desktopChrome.theme(workbenchTheme);
    window.webContents.send('pawpdot:workbench-ready');
    workbench.setVisible(true);
    if (window.isFocused()) workbench.webContents.focus();
  } catch (error) {
    if (closing) return;
    const host = runtime;
    runtime = undefined;
    host?.child.kill();
    console.error('Could not start Harness:', error.message);
    await showFailure();
  } finally {
    starting = false;
  }
}

async function showFailure() {
  if (!window || window.isDestroyed()) return;
  workbench.setVisible(false);
  homeSurface?.setVisible(false);
  desktopChrome.hide();
  try {
    await window.loadFile(shellPage, { query: { state: 'error' } });
    publishWindowState();
    if (workbenchTheme) window.webContents.send('pawpdot:workbench-theme', workbenchTheme);
  } catch {
    // The window may have closed while the failure page was loading.
  }
}
