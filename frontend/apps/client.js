window.__ModuleLoader__.load({ id: '@pawpdot/client-apps', factory: require => {
  const React = require('react');
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;
  const paths = {
    search: 'M15.5 15.5 20 20m-3-9a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
    refresh: 'M20 5v5h-5M4.5 10a7.5 7.5 0 0 1 12.7-4.1L20 10m-16 9v-5h5m10.5 0a7.5 7.5 0 0 1-12.7 4.1L4 14',
    settings: 'M9.5 3.5h5l.5 2.4 2 .9 2.1-1.1 2.5 4.3-1.7 1.5v2l1.7 1.5-2.5 4.3-2.1-1.1-2 .9-.5 2.4h-5l-.5-2.4-2-.9-2.1 1.1-2.5-4.3L4 13.5v-2L2.4 10l2.5-4.3L7 6.8l2-.9.5-2.4ZM15 12.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'
  };
  function AppGlyph({ colored = false, size = 20 } = {}) {
    return h('svg', { className: colored ? 'aua-glyph aua-glyph-color' : 'aua-glyph', width: size, height: size,
      viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
    h('rect', { className: 'aua-glyph-gold', x: 4, y: 3.75, width: 4.2, height: 4.2, rx: 1 }),
    h('rect', { className: 'aua-glyph-violet', x: 10.2, y: 1.4, width: 3.8, height: 6, rx: 1.15, transform: 'rotate(14 12.1 4.4)' }),
    h('circle', { className: 'aua-glyph-red', cx: 18.6, cy: 5.5, r: 2.2 }),
    h('rect', { className: 'aua-glyph-box', x: 2, y: 10, width: 20, height: 4.7, rx: 1.25 }),
    h('path', { className: 'aua-glyph-box', d: 'M3.5 14h7.75v8.5H5a1.5 1.5 0 0 1-1.5-1.5Zm9.25 0h7.75v7a1.5 1.5 0 0 1-1.5 1.5h-6.25Z' }));
  }
  function icon(name) {
    return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] }));
  }
  async function api(path = '', value) {
    const response = await fetch('/api/pawpdot/apps' + path, value === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '应用请求未完成');
    return data;
  }
  function Apps() {
    const [apps, setApps] = useState(null);
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [settings, setSettings] = useState(null);
    const settingsRef = useRef(null);
    const mounted = useRef(true);
    async function refresh() {
      const value = await api();
      if (mounted.current) setApps(value.apps);
    }
    useEffect(() => {
      mounted.current = true;
      refresh().catch(error => { if (mounted.current) setError(error.message); });
      return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
      if (!settings) return undefined;
      const outside = event => { if (!settingsRef.current?.contains(event.target)) setSettings(null); };
      const escape = event => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        settingsRef.current?.querySelector('button')?.focus();
        setSettings(null);
      };
      document.addEventListener('pointerdown', outside);
      document.addEventListener('keydown', escape, true);
      return () => {
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape, true);
      };
    }, [settings]);
    async function run(action) {
      setBusy(true);
      setError('');
      try { await action(); }
      catch (error) { if (mounted.current) setError(error.message); }
      finally { if (mounted.current) setBusy(false); }
    }
    const query = search.trim().toLocaleLowerCase();
    const filtered = (apps ?? []).filter(app => `${app.title}\n${app.description}`.toLocaleLowerCase().includes(query));
    return h('section', { className: 'aua-page ad-root' },
      h('header', { className: 'aua-header' }, h('h1', null, h(AppGlyph, { colored: true, size: 24 }), '应用'),
        h('div', { className: 'aua-actions' },
          h('label', { className: 'aua-search' }, icon('search'),
            h('input', { type: 'search', 'aria-label': '搜索应用', placeholder: '搜索应用', value: search, onChange: event => { setSettings(null); setSearch(event.target.value); } })),
          h('button', { type: 'button', className: 'aua-icon-button', 'aria-label': '刷新应用', onClick: () => run(refresh), disabled: busy }, icon('refresh')))),
      h('section', { className: 'aua-library', 'aria-labelledby': 'aua-mine' },
        h('h2', { id: 'aua-mine' }, '我的'),
        error && h('p', { className: 'aua-error', role: 'alert' }, error),
        apps === null ? h('p', { role: 'status' }, error ? '应用清单暂不可用' : '正在读取应用…') :
        !filtered.length ? h('p', { className: 'aua-empty' }, query ? '没有匹配的应用' : '暂无已安装的应用') :
        h('ul', { className: 'aua-list' }, filtered.map(app => h('li', { key: app.id, className: 'aua-card' },
          h('a', { className: 'aua-open', 'aria-label': `打开${app.title}`, 'aria-disabled': !app.enabled || busy,
            href: app.enabled && !busy ? '/api/pawpdot/apps/window/' + encodeURIComponent(app.id) : undefined,
            target: '_blank', rel: 'noopener noreferrer' },
          h('span', { className: 'aua-app-icon' }, app.icon ? h('img', { src: app.icon, alt: '', width: 46, height: 46 }) : h(AppGlyph)),
          h('span', { className: 'aua-summary' },
            h('span', { className: 'aua-card-title' }, h('strong', null, app.title), app.version && h('small', null, `v${app.version}`)),
            h('span', { className: 'aua-card-caption', title: app.description },
              h('span', null, !app.enabled ? '已停用' : app.entryType === 'external' ? '网站' : '本机'), h('span', null, app.description)))),
          h('div', { className: 'aua-card-tools', ref: settings === app.id ? settingsRef : null },
            h('button', { type: 'button', className: 'aua-icon-button', 'aria-label': `管理${app.title}`, 'aria-expanded': settings === app.id,
              disabled: busy, onClick: () => setSettings(settings === app.id ? null : app.id) }, icon('settings')),
            settings === app.id && h('div', { className: 'aua-settings' },
              h('button', { type: 'button', onClick: () => run(async () => {
                setSettings(null);
                try { await api('/enable', { id: app.id, enabled: !app.enabled }); } finally { await refresh(); }
              }) }, app.enabled ? '停用' : '启用'),
              app.removable && h('button', { type: 'button', onClick: () => {
                if (window.confirm(`卸载「${app.title}」？应用数据会保留。`)) run(async () => { setSettings(null); await api('/remove', { id: app.id }); await refresh(); });
              } }, '卸载'))))))));
  }
  return {
    inject: ['slots'],
    apply(ctx) {
      ctx.effect(() => {
        const styles = ['/api/pawpdot/apps/style.css'].map(href => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          document.head.append(link);
          return link;
        });
        return () => styles.forEach(link => link.remove());
      });
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'pawpdot-apps', order: 14, label: () => '应用' }, ({ active, size }) => h(AppGlyph, { colored: active, size })));
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pawpdot-apps' }, Apps));
    }
  };
} });
