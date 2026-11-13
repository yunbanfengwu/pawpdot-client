window.__ModuleLoader__.load({
  id: '@pawpdot/client-branding',
  factory: require => {
    const { createElement: h, useEffect, useLayoutEffect, useRef, useState } = require('react');
    const { createPortal } = require('react-dom');
    const home = 'pawpdot-home';
    const apps = 'pawpdot-apps';
    const brandLocale = 'pawpdot.brand';
    const brandMessages = {
      zh: { slogan: '不止陪伴' },
      en: { slogan: 'More than companionship' },
    };
    const navigation = [
      ['home', '首页', 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
      ['chat', '对话', 'M7 3h11a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-5l-4 3v-3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-5 7v7a3 3 0 0 0 3 3h1v2l3-2h5'],
      ['schedules', '自动化', 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
      ['plugins', '插件', 'M12 3c1.8 0 2.7 1.4 2.2 3.3l-.4 1.5 3.5-.2c2.4 0 3.7 1.2 3.7 2.8 0 1.7-1.3 2.6-3.1 2.7l-1.9.2.2 2.4c.2 2.5-.8 4.3-2.6 4.3s-2.7-1.4-2.4-3.4l.2-1.6-3.4.2C5.5 15.3 4 14 4 12.4c0-1.8 1.4-2.7 3.4-2.8l2-.1-.1-2.6C9.2 4.5 10.2 3 12 3Z'],
      ['apps', '应用', 'M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm11 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm11 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z'],
    ];
    const selectedSession = state => Object.values(state.byId).find(row => row.retainedBy?.mainView > 0)?.id;

    function Icon({ path, size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: path }));
    }

    function BrandMark({ size = 24 }) {
      return h('img', {
        className: 'pawpdot-brand-mark', src: '/pawpdot/brand.svg', alt: '',
        width: Math.round(size * 4 / 3), height: size, draggable: false,
      });
    }

    function ConversationHeading({ size, t }) {
      return h('span', { className: 'pawpdot-conversation-heading' },
        h(BrandMark, { size }),
        h('span', { className: 'pawpdot-slogan' }, t('slogan')));
    }

    function watchScheduleActivity(ctx, island) {
      const pluginId = '@deepseek-ai/dsh-client-ui-schedule';
      return ctx.remoteAccess.whenAccess('schedule/catalog', () => {
        const known = new Map();
        let disposed = false;
        let running = false;
        let timer;
        let inFlight;
        let invalidated = false;
        let initialized = false;

        function refresh() {
          if (disposed) return;
          if (inFlight) { invalidated = true; return; }
          clearTimeout(timer);
          inFlight = ctx.remote.schedule.catalog().then(result => {
            if (disposed || !result.ok) return;
            const next = new Map();
            for (const task of result.value) {
              const delivery = task.lastDelivery?.messageId;
              const active = Boolean(task.executionActive);
              const previous = known.get(task.id);
              next.set(task.id, { delivery, active });
              if (previous?.active === active && previous?.delivery === delivery) continue;
              if (!active && !previous?.active && !(initialized && delivery && previous?.delivery !== delivery)) continue;
              void island.publish({
                id: 'schedule:' + task.id, pluginId, pageId: 'schedules',
                title: task.title,
                status: active ? 'running' : 'info',
                detail: active ? '任务已排队或正在运行' : '任务已投递到会话',
              }).catch(() => {});
            }
            for (const [taskId, row] of known) {
              if (!next.has(taskId) && row.active) void island.dismiss('schedule:' + taskId, pluginId).catch(() => {});
            }
            known.clear();
            for (const [key, row] of next) known.set(key, row);
            initialized = true;
            running = [...known.values()].some(row => row.active);
          }).catch(() => {}).finally(() => {
            inFlight = undefined;
            if (disposed) return;
            if (invalidated) { invalidated = false; refresh(); }
            else if (running) timer = setTimeout(refresh, 4000);
          });
        }
        const onChanged = ctx.remote.$on('schedule/changed', refresh);
        const onReset = ctx.on('connection/reset', refresh);
        refresh();
        return () => {
          disposed = true;
          clearTimeout(timer);
          onChanged();
          onReset();
        };
      });
    }

    function apply(ctx) {
      const { layout, slots, sessions, uiWorkspace } = ctx;
      const island = window.pawpdotIsland;
      if (island) ctx.effect(() => watchScheduleActivity(ctx, island));
      ctx.effect(() => ctx.locale.register(brandLocale, brandMessages));
      let lastChat;
      const lifetime = new AbortController();
      ctx.effect(() => {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = '/pawpdot/desktop.css';
        document.head.append(stylesheet);
        document.documentElement.dataset.pawpdotNavigation = '';
        return () => {
          lifetime.abort();
          stylesheet.remove();
          delete document.documentElement.dataset.pawpdotNavigation;
        };
      });

      function openHome() {
        layout.selectPanel(home);
      }

      async function openChat(current) {
        const id = current || lastChat || selectedSession(sessions.list.getSnapshot());
        layout.selectPanel(null);
        if (id && sessions.list.getSnapshot().byId[id]) {
          uiWorkspace.openSession(id);
          return;
        }
        const signal = layout.beginNavigation();
        const id2 = await sessions.create().catch(() => undefined);
        if (id2 && !signal.aborted && !lifetime.signal.aborted) uiWorkspace.openSession(id2);
      }

      if (island) ctx.effect(() => island.onNavigate(page => {
        if (page === 'home') { void openHome(); return; }
        if (page === 'chat') { void openChat(selectedSession(sessions.list.getSnapshot())); return; }
        const key = page === 'apps' ? apps : page;
        if (slots.entries('main').some(entry => entry.options.key === key)) layout.selectPanel(key);
      }));

      ctx.effect(() => sessions.list.subscribe(() => {
        const selected = selectedSession(sessions.list.getSnapshot());
        if (selected) lastChat = selected;
      }));

      function HomeDashboard({ renderSlot, useSessions, useSessionStatus }) {
        const list = useSessions(state => state);
        const statuses = useSessionStatus(state => state);
        const active = Object.values(list.byId)
          .filter(row => {
            const status = statuses.get(row.id);
            return row.running === true || status?.running === true || status?.pendingInteraction !== undefined ||
              status?.completionUnread === true;
          })
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        const statusLabel = row => {
          const status = statuses.get(row.id);
          if (status?.pendingInteraction) return '等待你的回复';
          if (status?.running) return '正在进行';
          if (status?.completionUnread) return '刚刚完成';
          return '进行中';
        };
        const openSession = id => {
          layout.selectPanel(null);
          uiWorkspace.openSession(id);
        };
        useEffect(() => {
          window.pawpdotHomeSurface?.setActive(true);
          const stop = window.pawpdotHomeSurface?.onMessage?.(message => {
            if (message?.type === 'pawpdot:pet-market') window.dispatchEvent(new Event('pawpdot:pet-market'));
            if (message?.type === 'pawpdot:work' || message?.type === 'pawpdot:expand-world') void openChat();
          });
          return () => { stop?.(); window.pawpdotHomeSurface?.setActive(false); };
        }, []);
        return h('main', { className: 'pawpdot-home-dashboard', 'aria-label': '首页' },
          h('div', { className: 'pawpdot-home-world' },
            renderSlot('pawpdot.home.pet', { full: true })),
          active.length > 0 && h('section', { className: 'pawpdot-home-activity', 'aria-label': '进行中的对话' },
            h('div', { className: 'pawpdot-home-activity-heading' },
              h('strong', null, '进行中的对话'),
              h('span', null, `${active.length} 个`)),
            h('div', { className: 'pawpdot-home-activity-list' }, active.map(row => h('button', {
              key: row.id, type: 'button', className: 'pawpdot-home-task', onClick: () => openSession(row.id),
            },
            h('span', { className: 'pawpdot-home-task-status' }, statusLabel(row)),
            h('span', { className: 'pawpdot-home-task-title' }, row.title || '未命名对话'),
            h('span', { className: 'pawpdot-home-task-open' }, '打开对话'))))));
      }

      function Rail({ usePanelInfo, useSessions }) {
        const panel = usePanelInfo(info => info.activePanelId);
        const current = useSessions(selectedSession);
        const isHome = panel === home;
        const chat = panel === null && !isHome;
        const wasChat = useRef(false);
        const frame = () => document.querySelector('[data-slot="root"] > :has(> [data-shell-overlay])');

        useLayoutEffect(() => {
          document.documentElement.toggleAttribute('data-pawpdot-chat', chat);
          const appFrame = frame();
          if (!appFrame) return;
          const enteringChat = chat && !wasChat.current;
          wasChat.current = chat;
          const reconcile = () => {
            const collapsed = appFrame.hasAttribute('data-sidebar-collapsed');
            // The closed drawer keeps its account control in the permanent rail.
            if (collapsed && appFrame.hasAttribute('data-sidebar-drawer')) {
              const sidebar = appFrame.querySelector('[data-slot="sidebar"]');
              sidebar?.parentElement.removeAttribute('inert');
            }
            if (!chat && !collapsed) layout.toggleSidebar();
          };
          if (enteringChat && appFrame.hasAttribute('data-sidebar-collapsed')) layout.toggleSidebar();
          reconcile();
          const observer = new MutationObserver(reconcile);
          observer.observe(appFrame, { attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-drawer'] });
          return () => {
            observer.disconnect();
            document.documentElement.removeAttribute('data-pawpdot-chat');
          };
        }, [chat]);

        const [, setPanelVersion] = useState(0);
        useLayoutEffect(() => slots.subscribe('main', () => setPanelVersion(version => version + 1)), []);
        const registered = slots.entries('main');
        const active = isHome ? 'home' : chat ? 'chat' : panel === apps ? 'apps' : panel;
        const activeEntry = registered.find(entry => entry.options.key === panel);
        const label = navigation.find(([id]) => id === active)?.[1];
        const pluginId = active === 'apps' ? '@pawpdot/client-apps' :
          active === 'schedules' ? '@deepseek-ai/dsh-client-ui-schedule' :
          active === 'plugins' ? '@deepseek-ai/dsh-client-ui-plugin-manager' : activeEntry && !label ? panel : '';
        useLayoutEffect(() => {
          if (!island) return;
          let previous;
          const publishContext = () => {
            const settings = document.querySelector('[data-shortcut-modal="settings"]');
            const context = settings
              ? { pageId: 'settings', label: '设置', pluginId: '@deepseek-ai/dsh-client-ui-settings-general' }
              : { pageId: active, label, pluginId };
            if (context.pageId === previous) return;
            previous = context.pageId;
            void island.setContext(context).catch(() => {});
          };
          publishContext();
          const observer = new MutationObserver(publishContext);
          observer.observe(document.body, { childList: true });
          return () => observer.disconnect();
        }, [active, label, pluginId]);
        const rail = h('div', { className: 'pawpdot-rail' },
          h('nav', { className: 'pawpdot-rail-nav', 'aria-label': '主导航' }, navigation.map(([id, label, path]) => {
            const key = id === 'apps' ? apps : id;
            const available = id === 'home' || id === 'chat' || registered.some(entry => entry.options.key === key);
            return h('button', {
              key: id, type: 'button', className: 'pawpdot-rail-button', 'data-pawpdot-nav': id,
              title: label, 'aria-label': label, 'aria-current': active === id ? 'page' : undefined, disabled: !available,
              onClick: () => {
                if (id === 'home') { if (!isHome || panel === home) void openHome(); }
                else if (id === 'chat') {
                  if (chat && frame()?.hasAttribute('data-sidebar-collapsed')) layout.toggleSidebar();
                  else if (!chat) void openChat(current);
                } else layout.selectPanel(key);
              },
            }, h(Icon, { path }));
          })));
        return createPortal(rail, document.querySelector('#root'));
      }
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay', id: 'pawpdot-navigation',
      }, Rail));
      slots.inject('sidebar.brand.mark', () => slots.register({ name: 'sidebar.brand.mark' }, BrandMark));
      slots.inject('sidebar.brand.name', () => slots.register({ name: 'sidebar.brand.name' },
        () => h('span', { className: 'pawpdot-wordmark' }, 'PawPdot')));
      slots.inject('main', function* () {
        yield slots.register({
          name: 'main', key: home,
          children: { 'pawpdot.home.pet': { kind: 'single', scope: 'root' } },
        }, HomeDashboard);
        if (layout.panelInfo.getSnapshot().activePanelId === null) layout.selectPanel(home);
      });
      slots.inject('conversation.hero.brand.mark', () => slots.register({
        name: 'conversation.hero.brand.mark', locale: brandLocale,
      }, ConversationHeading));
    }

    return { inject: ['slots', 'locale', 'layout', 'sessions', 'uiWorkspace', 'remote', 'remote.schedule', 'remoteAccess'], apply };
  },
});
