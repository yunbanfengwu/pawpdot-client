(() => {
  'use strict';
  const parentOrigin = __AUDOTER_PARENT_ORIGIN__;
  const channel = 'audoter.ui-app/v1';
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== channel) return;
    const { id, result, error } = event.data;
    const row = pending.get(id);
    if (!row) return;
    pending.delete(id);
    clearTimeout(row.timer);
    if (error) row.reject(Error(error));
    else row.resolve(result);
  });
  function request(method, params = {}) {
    if (parent === window) return Promise.reject(Error('请从 PawPdot 的应用菜单打开'));
    if (pending.size >= 16) return Promise.reject(Error('应用请求过多'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('应用宿主响应超时，请核对保存结果后重试'));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ channel, id, method, params }, parentOrigin);
    });
  }
  const unsupported = async () => { throw Error('当前应用宿主未开放此能力'); };
  window.pawpdotIsland = Object.freeze({
    publish: item => request('island.publish', item),
    dismiss: id => request('island.dismiss', { id }),
  });
  window.soduWorkApp = Object.freeze({
    context: Object.freeze({ get: () => request('context.get') }),
    createRequestId: () => crypto.randomUUID(),
    data: Object.freeze({
      get: params => request('data.get', params),
      batch: params => request('data.batch', params),
      assetPut: params => request('data.assetPut', { ...params, data: new Uint8Array(params.data).toBase64() }),
      assetGet: async params => {
        const result = await request('data.assetGet', params);
        if (result.data) result.data = Uint8Array.fromBase64(result.data);
        return result;
      }
    }),
    chat: Object.freeze({ send: unsupported, expand: unsupported }),
    attachments: Object.freeze({ importFile: unsupported, release: unsupported }),
    mcp: Object.freeze({ connect: unsupported })
  });
})();
