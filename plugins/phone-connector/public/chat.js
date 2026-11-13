(() => {
  'use strict';
  const $ = id => document.getElementById(id), root = $('messages');
  // Also remove the old composer when an already-served HTML document loads
  // this updated script. The embedding App exclusively owns message input.
  $('compose')?.remove();
  const activityDirectory = new URLSearchParams(location.search).get('directory') === '2';
  const status = state => window.TeamSeekBridge?.publishStatus(state);
  let webToken = sessionStorage.getItem('teamseek-web-token') || '';
  let streamConnected = false;
  let lastHistory = '', liveText = '', source, syncing = false;
  async function api(action, body) {
    const response = await fetch(action, { credentials: 'same-origin', cache: 'no-store',
      headers: { ...(webToken ? { authorization: 'Bearer ' + webToken } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '连接暂不可用');
    return value;
  }
  function error(value = '') { $('error').textContent = value; }
  function render(messages) {
    const nearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 100;
    root.replaceChildren();
    if (!messages.length && !liveText) {
      const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '从这里开始对话'; root.append(empty);
    }
    for (const message of messages) {
      const article = document.createElement('article'); article.className = 'message ' + (message.role === 'user' ? 'user' : 'assistant');
      const role = document.createElement('div'); role.className = 'role'; role.textContent = message.role === 'user' ? '你' : 'DeepSeek';
      const content = document.createElement('div'); content.textContent = message.text;
      article.append(role, content); root.append(article);
    }
    if (liveText) { const live = document.createElement('article'); live.className = 'message assistant'; live.id = 'live'; live.textContent = liveText; root.append(live); }
    if (nearBottom || lastHistory === '') root.scrollTop = root.scrollHeight;
  }
  async function refresh() {
    if (syncing) return;
    syncing = true;
    try {
      const value = await api('api/history');
      status('connected');
      const signature = JSON.stringify(value.messages);
      if (signature !== lastHistory) { render(value.messages); lastHistory = signature; }
      $('status').textContent = value.state === 'running' ? '正在生成 · 来自当前 DeepSeek' : '已连接 · 正文来自当前 DeepSeek';
      if (value.failure) error(value.failure);
    } catch (e) { status('failed'); error(e.message); $('status').textContent = '连接暂不可用 · 可从侧栏重新打开'; }
    finally { syncing = false; }
  }
  async function directory() {
    try { window.TeamSeekBridge?.publishDirectory(await api('api/directory' + (activityDirectory ? '?activity=1' : ''))); } catch { /* Keep native cached metadata. */ }
  }
  async function follow() {
    source?.abort();
    const abort = new AbortController(); source = abort;
    try {
      const response = await fetch('api/events', { headers: { authorization: 'Bearer ' + webToken }, cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error('实时连接暂不可用');
      streamConnected = true;
      status('connected');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value: bytes, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(bytes, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let value; try { value = JSON.parse(line.slice(6)); } catch { continue; }
            if (value.type === 'delta') {
              liveText += value.text;
              let live = $('live');
              if (!live) { live = document.createElement('article'); live.id = 'live'; live.className = 'message assistant'; root.append(live); }
              live.textContent = liveText; root.scrollTop = root.scrollHeight;
            } else if (value.type === 'reset') { liveText = ''; $('live')?.remove(); void refresh(); }
            else if (value.type === 'changed') { void refresh(); }
          }
        }
        if (buffer.length > 1048576) throw new Error('实时响应过大');
      }
    } catch { if (!abort.signal.aborted) { status('connecting'); $('status').textContent = '实时连接重试中 · 对话保留在实例中'; } }
    streamConnected = false;
    if (!abort.signal.aborted && !document.hidden) setTimeout(() => void follow(), 3000);
  }
  window.TeamSeekMobile = Object.freeze({ refresh });
  async function start() {
    status('connecting');
    try {
      const parameters = new URLSearchParams(location.hash.slice(1));
      const ticket = parameters.get('ticket');
      history.replaceState(null, '', location.pathname);
      if (ticket) {
        const exchanged = await api('session', { ticket });
        webToken = exchanged.webToken;
        sessionStorage.setItem('teamseek-web-token', webToken);
      }
      else await api('api/history');
      await directory(); await refresh(); void follow();
      setInterval(() => { if (!document.hidden) void directory(); }, 15000);
      setInterval(() => { if (!document.hidden && !streamConnected) void refresh(); }, 15000);
    } catch (e) { status('failed'); error(e.message); $('status').textContent = '请从手机侧栏重新打开会话'; }
  }
  window.addEventListener('pagehide', () => source?.abort());
  void start();
})();
