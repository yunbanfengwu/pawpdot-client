(() => {
  'use strict';
  const base = '/api/teamseek/direct/';
  if (!location.pathname.startsWith(base + 'harness/')) return;
  const query = new URLSearchParams(location.search);
  let mode = ['conversation', 'full', 'input', 'workspace'].includes(query.get('mode')) ? query.get('mode') : 'conversation';
  const root = document.documentElement;
  root.dataset.teamseekEmbed = '1'; root.dataset.teamseekMode = mode;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = base + 'harness/embed.css'; document.head.append(style);
  const originalFetch = globalThis.fetch.bind(globalThis);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const sessionKey = 'teamseek-harness-web-v1';
  let webToken = '', initialSession = fragment.get('session') || null, instanceId = '', stopped = false;
  const publish = value => { if (globalThis.top === globalThis) globalThis.TeamSeekNative?.postMessage(JSON.stringify(value)); };
  let panelFailed = false;
  const status = (state, stage = 'conversation') => publish({ type: 'connection', state, stage });
  const features = () => ({ hasOwn: typeof Object.hasOwn === 'function', withResolvers: typeof Promise.withResolvers === 'function',
    randomUUID: typeof crypto.randomUUID === 'function', abortAny: typeof AbortSignal.any === 'function',
    findLast: typeof Array.prototype.findLast === 'function', arrayAt: typeof Array.prototype.at === 'function', ...globalThis.__TeamSeekNativeFeatures__ });
  function diagnostic(stage, kind, error, extra = {}) {
    const message = error instanceof Error ? error.message : String(error || '');
    const stack = error instanceof Error ? error.stack : '';
    void ready.then(() => originalFetch(base + 'harness/diagnostics', { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { authorization: 'Bearer ' + webToken, 'content-type': 'application/json' },
      body: JSON.stringify({ stage, kind, message: message.slice(0, 700), stack: String(stack || '').slice(0, 1400),
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent, features: features(), ...extra }) })).catch(() => {});
  }
  function fail(error, stage = 'conversation') {
    panelFailed = true; status('failed', stage); diagnostic(stage, 'failure', error);
    const target = document.getElementById?.('root');
    if (target) {
      const card = document.createElement('div'); card.style.cssText = 'padding:var(--ad-space-6);color:var(--ad-text-secondary);font:var(--ad-text-md)/var(--ad-leading-normal) var(--ad-font-sans);overflow-wrap:anywhere';
      card.textContent = '对话面板加载失败，请点击上方重试。诊断信息会自动上报。'; target.replaceChildren(card);
    }
  }
  window.addEventListener('error', event => diagnostic('runtime', 'script-error', event.error || event.message || '资源加载失败'));
  window.addEventListener('unhandledrejection', event => diagnostic('runtime', 'unhandled-rejection', event.reason));
  const originalConsoleError = console.error.bind(console);
  console.error = (...items) => {
    originalConsoleError(...items);
    // React error boundaries may report through console.error without dispatching
    // window.error. Do not serialize arbitrary application objects into the log.
    const error = items.find(item => item instanceof Error);
    diagnostic('runtime', 'console-error', error || items.filter(item => typeof item === 'string').join(' ').slice(0, 700));
  };
  status('connecting');
  const ready = (async () => {
    if (fragment.has('ticket')) {
      const response = await originalFetch(base + 'harness/exchange', { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: fragment.get('ticket') }) });
      if (!response.ok) throw Error('网页授权失效，请从App重新打开终端');
      const value = await response.json(); webToken = value.webToken; initialSession = value.sessionId; instanceId = value.instanceId;
      sessionStorage.setItem(sessionKey, JSON.stringify({ webToken, instanceId, initialSession }));
    } else {
      const value = JSON.parse(sessionStorage.getItem(sessionKey) || '{}'); webToken = value.webToken; instanceId = value.instanceId; initialSession ||= value.initialSession;
      if (!webToken) throw Error('请先使用App扫码绑定，再打开终端');
    }
    history.replaceState(null, '', location.pathname + location.search);
  })();
  ready.then(() => diagnostic('authorization', 'ready', '网页授权完成')).catch(error => { fail(error, 'authorization'); console.warn('[teamseek-embed]', error.message); });
  async function request(path, body, signal) {
    await ready;
    const response = await originalFetch(base + path, { credentials: 'omit', cache: 'no-store', headers: { authorization: 'Bearer ' + webToken, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal });
    if (!response.ok) diagnostic('request', 'http-error', path.split('?')[0], { status: response.status });
    if (response.status === 401 || response.status === 403) status('failed', 'authorization');
    return response;
  }
  const mediaBridge = { async imageSource(url, signal) {
    if (location.protocol !== 'https:' || new URL(url).protocol !== 'http:') return { url, release() {} };
    const response = await request('harness/media-image', { url }, signal);
    if (!response.ok) throw Error('手机图片转发失败');
    const source = URL.createObjectURL(await response.blob());
    return { url: source, release: () => URL.revokeObjectURL(source) };
  } };
  globalThis.TeamSeekMedia = mediaBridge;
  // Directory metadata reaches the shell before React and the message renderer
  // finish booting. It is fetched from this instance with the scoped web token.
  ready.then(async () => {
    const response = await request('harness/directory');
    if (response.ok) publish({ type: 'directory', value: await response.json() });
  }).catch(() => {});
  // Upstream's public transport hook; UI components, projections and RPC codecs stay upstream.
  globalThis.__DSH_TRANSPORT__ = {
    fetch: async (path, init) => {
      const url = new URL(path, document.baseURI);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw Error('未知Harness接口');
      await ready;
      const headers = new Headers(init.headers); headers.set('authorization', 'Bearer ' + webToken);
      const response = await originalFetch(base + 'harness/rpc/' + url.pathname.slice(5), { ...init, credentials: 'omit', cache: 'no-store', headers });
      if (!response.ok) diagnostic('rpc', 'http-error', url.pathname, { status: response.status });
      if (response.status === 401 || response.status === 403) status('failed', 'authorization');
      return response;
    },
    async *openStream(endpoint, payload, signal, uplink) {
      const streamId = crypto.randomUUID(), abort = new AbortController();
      const cancelled = () => abort.abort(); signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) abort.abort();
      let reader, source;
      try {
        const response = await request('harness/stream', { streamId, endpoint, payload }, abort.signal);
        if (!response.ok) throw Error('Harness流连接失败');
        if (uplink) {
          source = uplink[Symbol.asyncIterator]();
          void (async () => {
            while (!abort.signal.aborted) {
              const item = await source.next(); if (abort.signal.aborted) break;
              const response = await request('harness/uplink', { streamId, ...(item.done ? { end: true } : { value: item.value }) }, abort.signal);
              if (!response.ok) throw Error('Harness流输入失败');
              if (item.done) break;
            }
          })().catch(() => abort.abort());
        }
        reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        while (!abort.signal.aborted) {
          const chunk = await reader.read(); if (chunk.done) throw Error('Harness流意外断开');
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 8388608) throw Error('Harness流帧过大');
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
            const frame = JSON.parse(line);
            if (frame.kind === 'value') yield frame.value;
            else if (frame.kind === 'error') throw Object.assign(Error(frame.error.message), frame.error);
            else if (frame.kind === 'end') return;
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) diagnostic('stream', 'stream-error', error);
        throw error;
      } finally {
        abort.abort(); signal.removeEventListener('abort', cancelled); void reader?.cancel().catch(() => {}); void source?.return?.().catch(() => {});
      }
    }
  };
  globalThis.TeamSeekHarnessEmbed = {
    fail,
    install(ctx) {
      diagnostic('components', 'ready', '原版对话组件已启动');
      const cleanups = [], lifetime = new AbortController();
      let current = null, revision = -1, syncing = false, switching = 0, initialWorkspace = false;
      let closeDesktop;
      let controlsRevision = 0, controlsSource = '', controlsLoading = false, controlsCatalog;
      const controlSubscriptions = [];
      const controlWaiters = [];
      function clearControls() { controlSubscriptions.splice(0).forEach(fn => fn()); controlsSource = ''; ++controlsRevision; }
      async function refreshControls(force = false) {
        if (!current || stopped) { if (force) throw Error('会话尚未就绪'); return; }
        if (controlsLoading) {
          if (!force) return;
          await new Promise(resolve => controlWaiters.push(resolve));
          return refreshControls(true);
        }
        const sessionId = current, generation = controlsRevision;
        controlsLoading = true;
        try {
          controlsCatalog ||= ctx.remote.session.modelCatalog().then(result => { if (!result.ok) throw Error(result.error.message); return result.value; }).catch(error => { controlsCatalog = null; throw error; });
          const catalog = await controlsCatalog;
          const live = ctx.sessions.binding(sessionId)?.session;
          const selection = live?.projections.faceOf('modelSelection').getSnapshot()?.next || catalog.default;
          const permissions = live?.projections.faceOf('permissions').getSnapshot();
          const response = await request('harness/engine?sessionId=' + encodeURIComponent(sessionId), undefined, lifetime.signal);
          const engine = await response.json(); if (!response.ok) throw Error(engine.error || '读取底座失败');
          if (sessionId !== current || generation !== controlsRevision || stopped) { if (force) throw Error('会话已切换'); return; }
          const state = { sessionId, engine: engine.engine, engines: engine.engines, model: selection,
            models: catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id, label: model.name || model.id }))),
            permission: permissions?.currentValue || permissions?.preset || null, busy: ctx.uiSession.sessionStatus.getSnapshot().get(sessionId)?.running === true };
          const identity = JSON.stringify(state);
          if (force || identity !== controlsSource) { controlsSource = identity; publish({ type: 'session-controls', value: state }); }
          return state;
        } catch (error) {
          diagnostic('controls', 'read-error', error);
          if (sessionId === current && generation === controlsRevision) publish({ type: 'session-controls', value: { sessionId, error: '宿主会话选项暂时不可用' } });
          if (force) throw error;
        } finally { controlsLoading = false; controlWaiters.splice(0).forEach(resolve => resolve()); }
      }
      function watchControls() {
        clearControls();
        const live = ctx.sessions.binding(current)?.session;
        for (const key of ['modelSelection', 'permissions']) {
          const source = live?.projections.faceOf(key);
          if (source) controlSubscriptions.push(source.subscribe(() => { void refreshControls(); }));
        }
        void refreshControls();
      }
      // A fresh conversation continues where the user left off. The host keeps
      // engine and model per session, so the blank session is explicitly set to
      // the captured combination. Every step is best effort: a failure falls
      // back to host defaults, is logged and never blocks the new session.
      async function carryInto(sessionId, carry) {
        try {
          const engineResponse = await request('harness/command', { action: 'set-engine', sessionId, engine: carry.engine }, lifetime.signal);
          const engineResult = await engineResponse.json(); if (!engineResponse.ok) throw Error(engineResult.error || '底座沿用失败');
          if (carry.provider && carry.model) {
            const catalog = await (controlsCatalog ||= ctx.remote.session.modelCatalog().then(result => { if (!result.ok) throw Error(result.error.message); return result.value; }).catch(error => { controlsCatalog = null; throw error; }));
            if (catalog?.groups.some(group => group.id === carry.provider && group.models.some(model => model.id === carry.model))) {
              const result = await ctx.remote.session.selectModel({ sessionId, provider: carry.provider, model: carry.model });
              if (!result.ok) throw Error(result.error.message);
              const source = ctx.sessions.binding(sessionId)?.session?.projections.faceOf('modelSelection');
              if (source) await new Promise(resolve => {
                let timer, unsubscribe = () => {};
                const finish = () => { clearTimeout(timer); unsubscribe(); resolve(); };
                const check = () => { if (stopped) return finish(); const next = source.getSnapshot()?.next; if (next?.provider === carry.provider && next?.model === carry.model) finish(); };
                timer = setTimeout(finish, 3000);
                unsubscribe = source.subscribe(check);
                if (lifetime.signal.aborted || stopped) finish(); else check();
              });
            }
          }
        } catch (error) { diagnostic('controls', 'carry-over', error); }
      }
      // Keep upstream Session objects and history resident across navigation.
      // References belong to this device-authorized document, never another host.
      const cached = new Map();
      // HTTP/1 has six connections: four process/control streams plus one
      // history leave one command slot. Two retained histories deadlock writes.
      // HTTP/2 can multiplex resident history.
      const multiplexed = globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.nextHopProtocol === 'h2';
      const cacheLimit = multiplexed ? 32 : 1;
      let warmTimer, warming = false, prefetchEnabled = true, cleared = false;
      function retainConversation(id) {
        let reference = cached.get(id);
        if (reference) cached.delete(id);
        else reference = ctx.sessions.retain(id, { source: 'teamseekMobileCache', signal: lifetime.signal });
        cached.set(id, reference);
        reference.ready.catch(() => { if (cached.get(id) === reference) { cached.delete(id); reference.release(); } });
        while (cached.size > cacheLimit) {
          const oldest = [...cached.keys()].find(key => key !== id && key !== current) || [...cached.keys()].find(key => key !== id);
          cached.get(oldest).release(); cached.delete(oldest);
        }
        return reference;
      }
      function clearCache() {
        cleared = true; clearTimeout(warmTimer);
        for (const reference of cached.values()) reference.release();
        cached.clear();
      }
      function scheduleWarm(directory) {
        if (!multiplexed || !prefetchEnabled || cleared || warming || document.hidden || stopped) return;
        clearTimeout(warmTimer);
        warmTimer = setTimeout(async () => {
          if (stopped || cleared || !prefetchEnabled) return;
          warming = true;
          try {
            const recent = [...directory.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, multiplexed ? 8 : 1);
            for (const row of recent) {
              if (stopped || cleared || !prefetchEnabled || document.hidden) break;
              if (!cached.has(row.id)) await retainConversation(row.id).ready.catch(() => {});
            }
          } finally { warming = false; }
        }, 1200);
      }
      const toolbar = document.createElement('div'); toolbar.className = 'teamseek-embed-tools';
      const workspace = document.createElement('button'); workspace.textContent = '工作面板'; workspace.type = 'button';
      workspace.onclick = () => { if (!closeWorkspace()) { ctx.sidebarRight.toggleExpanded(); updateLayout(); } };
      toolbar.append(workspace);
      if (!root.dataset.teamseekLean) document.body.append(toolbar);
      function updateLayout() {
        for (const leading of document.querySelectorAll('[data-conversation-header-leading]')) leading.closest?.('header')?.setAttribute('data-teamseek-conversation-header', '');
        const right = document.querySelector('[data-rightbar-col]'), frame = right?.parentElement;
        if (frame) { frame.dataset.teamseekFrame = '1'; if (frame.firstElementChild) frame.firstElementChild.dataset.teamseekSidebar = '1'; if (right.previousElementSibling) right.previousElementSibling.dataset.teamseekCenter = '1'; }
        if (mode === 'workspace' && current && !initialWorkspace) {
          initialWorkspace = true;
          if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
        }
        const expanded = ctx.sidebarRight.isExpanded();
        root.toggleAttribute('data-teamseek-workspace', expanded || mode === 'workspace');
        const label = expanded ? '关闭工作面板' : '工作面板'; if (workspace.textContent !== label) workspace.textContent = label; workspace.setAttribute('aria-expanded', String(expanded));
        const pending = current && ctx.uiSession.sessionStatus.getSnapshot().get(current)?.pendingInteraction;
        for (const composer of document.querySelectorAll('[data-conversation-region="composer"]')) composer.toggleAttribute('data-teamseek-interaction', !!pending);
      }
      async function syncDirectory(force = false) {
        if (syncing || stopped || (document.hidden && !force)) return;
        syncing = true;
        try {
          const response = await request('harness/directory', undefined, lifetime.signal);
          if (!response.ok) throw Error('目录同步失败');
          const value = await response.json();
          if (value.revision !== revision) { revision = value.revision; publish({ type: 'directory', value }); }
          if (!current) {
            const wanted = value.sessions.find(s => s.id === initialSession)?.id || value.sessions[0]?.id;
            if (wanted) await openConversation(wanted);
          }
          scheduleWarm(value);
          if (!panelFailed) status('connected');
        } catch (error) { if (!lifetime.signal.aborted) { status('failed', 'conversation'); diagnostic('conversation', 'open-error', error); } }
        finally { syncing = false; }
      }
      async function openConversation(sessionId) {
        if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw Error('会话标识无效');
        const serial = ++switching;
        await ready;
        // Server metadata check before navigation; no hidden native cache can grant access.
        const response = await request('harness/directory', undefined, lifetime.signal);
        const directory = await response.json();
        if (!response.ok || !directory.sessions.some(s => s.id === sessionId)) throw Error('会话不在当前目录');
        if (serial !== switching || stopped) return false;
        // Native directory HTTP may finish before the official Session stream
        // baseline. Do not navigate a Session the client does not know yet.
        const list = ctx.sessions.list;
        if (list.getSnapshot().phase && list.getSnapshot().phase !== 'ready') await new Promise((resolve, reject) => {
          let unsubscribe = () => {};
          const finish = error => { clearTimeout(timer); unsubscribe(); lifetime.signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
          const aborted = () => finish(Error('对话打开已取消'));
          const timer = setTimeout(() => finish(Error('原版会话列表加载超时')), 30000);
          unsubscribe = list.subscribe(() => { if (list.getSnapshot().phase === 'ready') finish(); });
          lifetime.signal.addEventListener('abort', aborted, { once: true });
          if (lifetime.signal.aborted) aborted(); else if (list.getSnapshot().phase === 'ready') finish();
        });
        if (serial !== switching || stopped) return false;
        // Await the original initial history only once. Revisited sessions reuse
        // the same official binding and stream instead of fetching history again.
        await retainConversation(sessionId).ready;
        if (serial !== switching || stopped) return false;
        await ctx.uiWorkspace.openSession(sessionId);
        if (serial !== switching || stopped) return false;
        current = sessionId;
        watchControls();
        diagnostic('conversation', 'opened', '会话导航完成');
        publish({ type: 'selection', sessionId }); updateLayout(); return true;
      }
      function closeWorkspace() {
        if (!ctx.sidebarRight.isExpanded()) return false;
        if (mode === 'workspace') { mode = 'conversation'; root.dataset.teamseekMode = mode; }
        ctx.sidebarRight.toggleExpanded(); updateLayout(); return true;
      }
      globalThis.TeamSeekMobile = { refresh: () => syncDirectory(true), openConversation, closeWorkspace,
        async command(message) {
          try {
            let value;
            if (message.action === 'desktop') {
              if (message.sessionId !== current) throw Error('当前会话已切换');
              if (closeDesktop) await closeDesktop();
              const { openDesktop } = await import(base + 'harness/desktop.js');
              closeDesktop = await openDesktop({ request, sessionId: current, mode: message.payload?.mode || 'control', onState: (active, warning) => publish({ type: 'desktop-state', active, warning }) });
              value = { accepted: true };
            }
            else if (message.action === 'open') { if (closeDesktop) await closeDesktop(); value = { accepted: await openConversation(message.sessionId) }; }
            else if (message.action === 'new') {
              const response = await request('harness/directory', undefined, lifetime.signal);
              if (!response.ok) throw Error('目录同步失败');
              const directory = await response.json();
              const workspaceId = directory.sessions.find(s => s.id === current)?.groupId || directory.groups[0]?.id;
              if (!workspaceId) throw Error('请先在电脑创建工作区');
              // The host keeps engine and model per session. Capture the
              // combination the user is leaving so the blank session continues
              // with it instead of resetting to host defaults.
              let carry = null;
              try {
                const previous = await refreshControls(true);
                if (previous?.engine) carry = { engine: previous.engine, provider: previous.model?.provider || null, model: previous.model?.model || null };
              } catch { carry = null; }
              const sessionId = await ctx.uiWorkspace.connectWorkspace(workspaceId);
              // Admission uses the same native command API as Session.command,
              // before adding another long-lived history stream on HTTP/1.
              const permission = await ctx.remote.commands.execute(sessionId, '/permission danger-full-access', []);
              if (!permission?.ok || permission.value === undefined) throw Error('新会话未能设置全部权限，请重试');
              await syncDirectory(true);
              if (carry) await carryInto(sessionId, carry);
              value = { accepted: await openConversation(sessionId), sessionId };
            }
            else if (message.action === 'controls') {
              if (message.sessionId && message.sessionId !== current) throw Error('会话已切换');
              value = await refreshControls(true);
            }
            else if (['select-model', 'select-engine'].includes(message.action)) {
              if (message.sessionId !== current) throw Error('当前会话已切换');
              const sessionId = current, generation = controlsRevision;
              if (message.action === 'select-model') {
                const catalog = await controlsCatalog;
                if (sessionId !== current || generation !== controlsRevision || stopped) throw Error('当前会话已切换');
                const selection = message.payload;
                if (!catalog?.groups.some(group => group.id === selection?.provider && group.models.some(model => model.id === selection?.model))) throw Error('模型不在宿主可用目录中');
                const result = await ctx.remote.session.selectModel({ sessionId, provider: selection.provider, model: selection.model });
                if (!result.ok) throw Error(result.error.message);
                // The RPC installs the model before its history projection
                // arrives. Await that same native projection before reporting
                // controls, otherwise a fast reply can show the previous model.
                const source = ctx.sessions.binding(sessionId)?.session?.projections.faceOf('modelSelection');
                if (!source) throw Error('当前会话模型状态未就绪');
                await new Promise((resolve, reject) => {
                  let unsubscribe = () => {};
                  const finish = error => { clearTimeout(timer); unsubscribe(); lifetime.signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
                  const aborted = () => finish(Error('模型确认已取消'));
                  const check = () => {
                    if (sessionId !== current || generation !== controlsRevision || stopped) return finish(Error('当前会话已切换'));
                    const next = source.getSnapshot()?.next;
                    if (next?.provider === selection.provider && next.model === selection.model) finish();
                  };
                  const timer = setTimeout(() => finish(Error('模型已提交，但会话状态同步超时，请重新读取')), 10000);
                  unsubscribe = source.subscribe(check);
                  lifetime.signal.addEventListener('abort', aborted, { once: true });
                  if (lifetime.signal.aborted) aborted(); else check();
                });
              } else {
                const response = await request('harness/command', { action: 'set-engine', sessionId: current, engine: message.payload?.engine }, lifetime.signal);
                const result = await response.json(); if (!response.ok) throw Error(result.error || '底座切换失败');
              }
              if (sessionId !== current || generation !== controlsRevision || stopped) throw Error('当前会话已切换');
              value = { accepted: true, ...await refreshControls(true) };
            }
            else if (message.action === 'clear-cache') { clearCache(); value = { cleared: true }; }
            else if (message.action === 'cache-settings') { prefetchEnabled = message.payload?.prefetch !== false; if (!prefetchEnabled) clearTimeout(warmTimer); value = { accepted: true }; }
            else if (message.action === 'cache-stats') value = { sessions: cached.size, limit: cacheLimit, transport: multiplexed ? 'h2' : 'http1' };
            else if (['prompt', 'cancel', 'fs-list'].includes(message.action)) {
              const response = await request('harness/command', { action: message.action, ...message.payload }, lifetime.signal);
              value = await response.json(); if (!response.ok) throw Error(value.error || '操作失败');
            } else throw Error('不支持的操作');
            publish({ type: 'reply', requestId: message.requestId, ok: true, value });
          } catch (error) { publish({ type: 'reply', requestId: message.requestId, ok: false, error: error.message }); }
        }
      };
      const selected = () => {
        const list = ctx.sessions.list.getSnapshot();
        const id = ctx.uiSession.adapter?.current?.getSnapshot().key || list.ids.find(id => (list.byId[id]?.retainedBy?.mainView || 0) > 0);
        if (id && id !== current) { current = id; watchControls(); publish({ type: 'selection', sessionId: id }); }
        updateLayout();
      };
      cleanups.push(ctx.sessions.list.subscribe(selected));
      if (ctx.uiSession.adapter?.current) cleanups.push(ctx.uiSession.adapter.current.subscribe(selected));
      cleanups.push(ctx.uiSession.sessionStatus.subscribe(selected));
      const observer = new MutationObserver(updateLayout); observer.observe(document.body, { childList: true, subtree: true });
      const interval = setInterval(() => { if (!document.hidden) { updateLayout(); void syncDirectory(); void refreshControls(); } }, 3000);
      const visible = () => { if (!document.hidden) void syncDirectory(); };
      document.addEventListener('visibilitychange', visible); window.addEventListener('resize', updateLayout);
      ready.then(() => { publish({ type: 'ready', instanceId, bridgeVersion: 1, renderer: 'sessions.v1' }); void syncDirectory(true); }).catch(() => {});
      return () => { stopped = true; ++switching; clearControls(); clearCache(); lifetime.abort(); clearInterval(interval); observer.disconnect(); cleanups.forEach(fn => fn()); toolbar.remove(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('resize', updateLayout); delete globalThis.TeamSeekMobile; if(globalThis.TeamSeekMedia === mediaBridge)delete globalThis.TeamSeekMedia; };
    }
  };
})();
