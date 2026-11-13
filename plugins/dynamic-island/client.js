window.__ModuleLoader__.load({ id: '@pawpdot/dynamic-island', factory: require => {
  const { createElement: h, useEffect, useState } = require('react');
  const clientCss = `#pawpdot-simple-wallpaper{position:fixed;inset:0;z-index:0;pointer-events:none;border-radius:var(--paw-window-radius,11px);background:transparent center/cover no-repeat;background-color:transparent}[data-slot="root"]{position:relative;z-index:1}html[data-pawpdot-navigation]:not([data-pawpdot-wallpaper="active"]){background:transparent!important}html[data-pawpdot-navigation]:not([data-pawpdot-wallpaper="active"]) body{background:#fff!important}html[data-pawpdot-navigation]:not([data-pawpdot-wallpaper="active"]) body[data-ds-dark-theme]{background:#171717!important}html[data-pawpdot-navigation][data-pawpdot-wallpaper="active"]{background:transparent!important}html[data-pawpdot-navigation][data-pawpdot-wallpaper="active"] body{background:transparent!important}html[data-pawpdot-navigation]:not([data-pawpdot-wallpaper="active"]) [data-slot="sidebar"] > [class*="_root"]{background:#fff!important}html[data-pawpdot-navigation]:not([data-pawpdot-wallpaper="active"]) body[data-ds-dark-theme] [data-slot="sidebar"] > [class*="_root"]{background:#171717!important}.pawpdot-island-settings{display:grid;gap:12px;padding:14px 0 4px}.pawpdot-island-settings label{display:grid;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.pawpdot-island-settings input[type="file"]{font-size:12px}.pawpdot-island-settings .pawpdot-island-actions{display:flex;align-items:center;gap:8px}.pawpdot-island-settings button{min-height:34px;border:1px solid #000;border-radius:8px;background:#000;color:#fff;padding:7px 12px;cursor:pointer}.pawpdot-island-settings button.secondary{background:transparent;color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}.pawpdot-island-settings [role="status"]{color:var(--dsw-alias-label-secondary);font-size:12px}`;
  const settingsApi = () => window.pawpdotIslandSettings;
  const defaults = { wallpaper: '' };

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  function WallpaperLayer() {
    const [settings, setSettings] = useState(defaults);
    useEffect(() => {
      let live = true;
      Promise.resolve(settingsApi()?.get?.()).then(value => { if (live) setSettings({ ...defaults, ...value }); }).catch(() => {});
      return () => { live = false; };
    }, []);
    useEffect(() => {
      const root = document.documentElement;
      const layer = document.getElementById('pawpdot-simple-wallpaper') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'pawpdot-simple-wallpaper' }));
      if (settings.wallpaper) root.dataset.pawpdotWallpaper = 'active'; else delete root.dataset.pawpdotWallpaper;
      layer.style.backgroundColor = 'transparent';
      layer.style.backgroundImage = settings.wallpaper ? `url(${JSON.stringify(settings.wallpaper)})` : 'none';
      return () => { layer.remove(); if (!document.getElementById('pawpdot-simple-wallpaper')) delete root.dataset.pawpdotWallpaper; };
    }, [settings.wallpaper]);
    return null;
  }

  function Settings() {
    const [settings, setSettings] = useState(defaults);
    const [status, setStatus] = useState('');
    useEffect(() => { Promise.resolve(settingsApi()?.get?.()).then(value => setSettings({ ...defaults, ...value })).catch(() => {}); }, []);
    async function save(next, message = '已保存') {
      const value = { ...settings, ...next };
      setSettings(value);
      try { await settingsApi()?.set?.(value); setStatus(message); }
      catch (error) { setStatus(error.message || '保存失败'); }
    }
    async function chooseImage(event, key, message) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) {
        setStatus('请选择 4MB 以内的 PNG、JPG 或 WebP 图片'); return;
      }
      await save({ [key]: await readFile(file) }, message);
    }
    return h('section', { className: 'pawpdot-island-settings', 'aria-label': '灵动岛与壁纸设置' },
      h('label', null, '上传窗口背景（可选）', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: event => chooseImage(event, 'wallpaper', '窗口背景已更新') })),
      h('div', { className: 'pawpdot-island-actions' },
        h('button', { type: 'button', className: 'secondary', onClick: () => save({ wallpaper: '' }, '已清除背景') }, '清除背景'),
        h('span', { role: 'status' }, status)),
    );
  }

  return {
    inject: ['slots'],
    apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style'); style.dataset.pawpdot = 'dynamic-island'; style.textContent = clientCss; document.head.append(style);
        return () => style.remove();
      });
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@pawpdot/dynamic-island' }, Settings));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'pawpdot-dynamic-island-settings' }, WallpaperLayer));
    },
  };
} });
