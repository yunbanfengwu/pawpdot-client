const { WebContentsView, ipcMain } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const frontend = join(__dirname, '..', 'frontend');
const chromePage = join(frontend, 'index.html');
const islandPage = join(frontend, 'island.html');
const chromeUrl = pathToFileURL(chromePage).href + '?state=chrome';
const islandUrl = pathToFileURL(islandPage).href;
const barHeight = 38;
const panelHeight = 260;
const pageLabels = { home: '首页', chat: '对话', schedules: '自动化', plugins: '插件', apps: '应用', settings: '设置' };
const states = new Set(['info', 'running', 'success', 'error']);
const maxEntries = 40;
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const id = value => typeof value === 'string' && /^[\w@./:-]{1,160}$/.test(value) ? value : '';
const isFrame = (event, contents) => Boolean(event.senderFrame && event.sender === contents &&
  event.senderFrame.frameTreeNodeId === contents.mainFrame.frameTreeNodeId);

function overlay(owner, preload) {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, preload),
      partition: 'pawpdot-shell',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  view.setBackgroundColor('#00000000');
  view.webContents.on('will-navigate', event => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  owner.contentView.addChildView(view);
  return view;
}

function createDesktopChrome() {
  const windows = new Set();
  const activities = new Map();
  const sources = new Map();
  const shells = new Map();
  const islands = new Map();

  function broadcast() {
    const items = [...activities.values()].reverse().sort((a, b) =>
      Number(b.status === 'running') - Number(a.status === 'running')).map(({ target, ...item }) => ({
        ...item, canOpen: Boolean(target && sources.has(target.id)),
      }));
    for (const view of windows) {
      const contents = view.island.webContents;
      if (!contents.isDestroyed()) contents.send('pawpdot:island:snapshot', { context: view.context, items });
    }
  }

  function broadcastSettings(settings) {
    for (const view of windows) {
      const contents = view.island.webContents;
      if (!contents.isDestroyed()) contents.send('pawpdot:island:settings', settings);
    }
  }

  ipcMain.handle('pawpdot:island:source', (event, operation, input) => {
    const source = sources.get(event.sender.id);
    if (!source || !isFrame(event, source.contents) || !source.owns(event.senderFrame.url)) return false;
    const { view, pluginId } = source;
    if (operation === 'context' && !pluginId) {
      const pageId = id(input?.pageId);
      if (!pageId) return false;
      view.context = {
        pageId,
        label: clean(input.label, 56) || pageLabels[pageId] || pageId,
        pluginId: id(input.pluginId),
      };
    } else if (operation === 'publish' || operation === 'dismiss') {
      const messageId = id(input?.id);
      if (!messageId) return false;
      // Package frames have an identity bound to their verified host window.
      // Harness modules share one trusted renderer and supply their namespace.
      const namespace = pluginId || id(input.pluginId) || view.context.pluginId || view.context.pageId;
      const key = (pluginId ? 'app:' : 'harness:') + namespace + ':' + messageId;
      if (operation === 'dismiss') {
        activities.delete(key);
      } else {
        const title = clean(input.title, 120);
        if (!title) return false;
        const status = states.has(input.status) ? input.status : 'info';
        const progress = Number.isFinite(input.progress) ? Math.max(0, Math.min(100, Math.round(input.progress))) : null;
        const page = pluginId ? 'app' : id(input.pageId) || view.context.pageId;
        activities.delete(key);
        activities.set(key, {
          key, title, status, progress, detail: clean(input.detail, 180),
          source: pluginId ? view.context.label : clean(input.source, 56) || pageLabels[page] || view.context.label,
          target: pluginId || id(input.pageId) ? { id: event.sender.id, page } : undefined,
        });
        if (activities.size > maxEntries) {
          const oldest = [...activities.values()].find(item => item.status !== 'running');
          activities.delete(oldest?.key ?? activities.keys().next().value);
        }
      }
    } else {
      return false;
    }
    broadcast();
    return true;
  });


  ipcMain.on('pawpdot:island:control', (event, operation, width, height) => {
    const view = islands.get(event.sender);
    if (!view || !isFrame(event, view.island.webContents) || event.senderFrame.url !== islandUrl) return;
    if (operation === 'ready') broadcast();
    if (operation === 'resize' && Number.isInteger(width) && Number.isInteger(height)) {
      view.width = Math.max(180, Math.min(528, width));
      view.height = Math.max(42, Math.min(panelHeight, height));
      view.layout();
    }
    if (operation === 'blur') view.contents.focus();
    if (operation === 'open') {
      const target = activities.get(width)?.target;
      const source = target && sources.get(target.id);
      if (!source || source.contents.isDestroyed() || source.view.owner.isDestroyed()) return;
      source.view.owner.focus();
      source.contents.focus();
      if (!source.pluginId) source.contents.send('pawpdot:island:navigate', target.page);
    }
  });

  return {
    isShell(event, owner) {
      const view = shells.get(event.sender);
      return view?.owner === owner && isFrame(event, view.chrome.webContents) && event.senderFrame.url === chromeUrl;
    },
    ownerOfShell(event) { return shells.get(event.sender)?.owner; },
    attach(owner, contents, { owns, pluginId = '', inset = 1 }) {
      const chrome = overlay(owner, 'window-preload.cjs');
      const island = overlay(owner, 'island-preload.cjs');
      const contentId = contents.id;
      const captionContents = chrome.webContents;
      const islandContents = island.webContents;
      const view = {
        owner, contents, chrome, island, width: 202, height: 42,
        context: pluginId ? { pageId: 'app', pluginId, label: pluginId } : { pageId: 'home', pluginId: '', label: '首页' },
        layout() {
          const [width, height] = owner.getContentSize();
          const edge = typeof inset === 'function' ? inset() : inset;
          const usableWidth = Math.max(1, width - edge - 1);
          chrome.setBounds({ x: 1, y: 1, width: usableWidth, height: barHeight });
          // Keep the island between the left rail and the window buttons even
          // at the supported minimum desktop width.
          const islandWidth = Math.min(view.width, Math.max(180, width - 290));
          island.setBounds({
            x: Math.floor((width - islandWidth) / 2), y: 1,
            width: islandWidth, height: Math.min(view.height, height - 2),
          });
        },
        theme(theme) { chrome.webContents.send('pawpdot:workbench-theme', theme); },
        windowState(value) { chrome.webContents.send('pawpdot:window-state', value); },
      };
      windows.add(view);
      sources.set(contentId, { view, contents, owns, pluginId });
      shells.set(captionContents, view);
      islands.set(islandContents, view);
      if (pluginId) contents.on('page-title-updated', (_event, title) => {
        view.context.label = clean(title, 56) || pluginId;
        broadcast();
      });
      owner.on('resize', view.layout);
      owner.on('move', view.layout);
      const restoreOverlays = () => {
        if (owner.isDestroyed()) return;
        if (!captionContents.isDestroyed()) chrome.setVisible(true);
        if (!islandContents.isDestroyed()) island.setVisible(true);
        view.layout();
      };
      owner.on('restore', restoreOverlays);
      owner.on('show', restoreOverlays);
      owner.on('focus', restoreOverlays);
      owner.on('maximize', () => view.windowState(true));
      owner.on('unmaximize', () => view.windowState(false));
      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'F6' || !island.getVisible()) return;
        event.preventDefault();
        island.webContents.focus();
        island.webContents.send('pawpdot:island:focus');
      });
      owner.once('closed', () => {
        owner.off('restore', restoreOverlays);
        owner.off('show', restoreOverlays);
        owner.off('focus', restoreOverlays);
        windows.delete(view);
        sources.delete(contentId);
        shells.delete(captionContents);
        islands.delete(islandContents);
        for (const overlayContents of [captionContents, islandContents]) {
          if (!overlayContents.isDestroyed()) overlayContents.close();
        }
        broadcast();
      });
      view.layout();
      const loaded = Promise.all([
        chrome.webContents.loadFile(chromePage, { query: { state: 'chrome' } }),
        island.webContents.loadFile(islandPage),
      ]);
      // The owner may close during loading, before the caller needs show().
      void loaded.catch(() => {});
      return {
        async show() {
          await loaded;
          if (owner.isDestroyed()) return;
          chrome.setVisible(true);
          island.setVisible(true);
          view.layout();
          broadcast();
        },
        hide() {
          chrome.setVisible(false);
          island.setVisible(false);
        },
        theme: view.theme,
        windowState: view.windowState,
        layout: view.layout,
        broadcastSettings,
      };
    },
  };
}

module.exports = { createDesktopChrome };

