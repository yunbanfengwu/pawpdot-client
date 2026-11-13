(() => {
  'use strict';
  const status = document.querySelector('[role="status"]');
  const frame = document.createElement('iframe');
  const channel = 'audoter.ui-app/v1';
  let view, origin, timer;
  let pending = 0;
  let closed = false;

  async function request(path, value, keepalive = false) {
    const response = await fetch('/api/pawpdot/apps' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value), cache: 'no-store', keepalive
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '应用连接已断开，请重新打开');
    return data;
  }

  async function onMessage(event) {
    const data = event.data;
    if (closed || event.source !== frame.contentWindow || event.origin !== origin || data?.channel !== channel ||
        typeof data.id !== 'string' || data.id.length > 64 || pending >= 16) return;
    pending += 1;
    let reply;
    try {
      if (data.method === 'island.publish' || data.method === 'island.dismiss') {
        const island = window.pawpdotIsland;
        const accepted = data.method === 'island.publish'
          ? await island?.publish(data.params)
          : await island?.dismiss(data.params?.id);
        if (!accepted) throw Error('灵动岛未接受这条消息');
        reply = { result: { ok: true } };
      } else {
        reply = { result: await request('/rpc', { view, method: data.method, params: data.params }) };
      }
    } catch (error) {
      reply = { error: error.message };
    } finally {
      pending -= 1;
    }
    if (!closed) event.source.postMessage({ ...reply, channel, id: data.id }, origin);
  }

  function close() {
    closed = true;
    clearInterval(timer);
    window.removeEventListener('message', onMessage);
    const closingView = view;
    view = undefined;
    if (closingView) void request('/close', { view: closingView }, true).catch(() => {});
  }

  function fail(error) {
    close();
    frame.remove();
    status.textContent = error.message;
    status.hidden = false;
  }

  async function open() {
    const id = decodeURIComponent(location.pathname.split('/').at(-1));
    const opened = await request('/open', { id, parentOrigin: location.origin });
    view = opened.view;
    if (closed) { close(); return; }
    if (view) {
      origin = new URL(opened.url).origin;
      window.addEventListener('message', onMessage);
      timer = setInterval(() => {
        void request('/keepalive', { view }).catch(error => { if (!closed) fail(error); });
      }, 15000);
    }
    frame.title = document.title;
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', opened.type === 'package' ? 'allow-scripts allow-same-origin allow-modals allow-popups' :
      'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups');
    frame.addEventListener('load', () => { if (!closed) status.hidden = true; }, { once: true });
    frame.src = opened.url;
    document.body.append(frame);
  }

  window.addEventListener('pagehide', close, { once: true });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  void open().catch(error => { if (!closed) fail(error); });
})();
