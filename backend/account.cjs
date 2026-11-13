const { ipcMain, session } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { parseDocument } = require(require.resolve('yaml', { paths: [path.dirname(require.resolve('@deepseek-ai/dsh/package.json'))] }));
const { openWebUrl } = require('./browser-links.cjs');

const deepSeekOrigin = 'https://platform.deepseek.com';
const endpoints = new Map([
  ['session', '/api/session'],
  ['deepseek/open', '/api/auth/deepseek/browser'],
  ...['login', 'register', 'logout', 'deepseek/start', 'deepseek/status', 'deepseek/cancel']
    .map(action => [action, '/api/auth/' + action]),
]);

function registerAccount(parent, contents, workbenchOrigin, harnessHome) {
  const port = Number(process.env.PAWPDOT_PORT || 3195);
  const origin = Number.isInteger(port) && port > 0 && port <= 65535 ? 'http://127.0.0.1:' + port : undefined;
  const browserSession = session.fromPartition('persist:pawpdot-account-' + port);
  browserSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  browserSession.setPermissionCheckHandler(() => false);
  async function storeDeepSeekGrant(grant) {
    if (!grant || grant.version !== 1 || typeof grant.token !== 'string' || typeof grant.issuer !== 'string') return;
    const home = harnessHome();
    if (!home) return;
    const filename = path.join(home, '.credentials.yaml');
    let text = '';
    try { text = await readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const document = parseDocument(text || 'version: 1\nrefs: {}\nrecords: {}\n');
    document.setIn(['version'], 1);
    document.setIn(['records', 'deepseek-account-platform/default'], {
      kind: 'grant', payload: { version: 1, token: grant.token, issuer: grant.issuer },
    });
    await mkdir(home, { recursive: true });
    await writeFile(filename, String(document), { mode: 0o600 });
  }
  async function request(action, input) {
    if (!origin) return { error: '账号服务端口配置无效' };
    const endpoint = endpoints.get(action);
    if (!endpoint) return { error: '账号操作无效' };
    const post = action !== 'session';
    let response, result;
    try {
      response = await browserSession.fetch(origin + endpoint, {
        credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12000),
        ...(post && {
          method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-PawPdot-Desktop': '1' },
          body: JSON.stringify(input ?? {}),
        }),
      });
      result = await response.json();
    } catch {
      return { error: '无法连接 PawPdot 账号服务，请确认服务已启动后重试。' };
    }
    if (!response.ok) return { error: result.error || '账号操作失败，请重试。' };
    if (action === 'deepseek/open') {
      const url = typeof result.url === 'string' && URL.parse(result.url);
      if (url?.origin !== origin || url.pathname !== '/auth/deepseek/browser' || url.username || url.password) {
        return { error: '无法验证浏览器授权链接。' };
      }
      try { await openWebUrl(url.href); } catch { return { error: '无法打开系统默认浏览器，请重试。' }; }
      return {};
    }
    if (action === 'deepseek/status') {
      const url = result.authorizeUrl && URL.parse(result.authorizeUrl);
      if (result.authorizeUrl && (url?.origin !== deepSeekOrigin || url.pathname !== '/dsh/authorize' || url.username || url.password)) {
        return { error: '无法验证 DeepSeek 官方授权地址。' };
      }
      if (result.phase === 'succeeded' && result.bridge) {
        await storeDeepSeekGrant(result.bridge);
      }
      return { phase: result.phase, user: result.user, canOpen: result.phase === 'waiting-browser' && Boolean(url) };
    }
    return result;
  }

  let pending = Promise.resolve();
  ipcMain.handle('pawpdot:account', (event, action, input) => {
    const frame = event.senderFrame;
    if (!workbenchOrigin() || event.sender !== contents || !frame || frame !== contents.mainFrame ||
        URL.parse(frame.url)?.origin !== workbenchOrigin()) return { error: '账号请求来源无效' };
    const operation = pending.then(() => request(action, input));
    pending = operation.catch(() => {});
    return operation;
  });
  parent.once('closed', () => {
    ipcMain.removeHandler('pawpdot:account');
    // A signed-out desktop can be closed while authorization is still pending.
    void pending.then(() => request('deepseek/cancel')).catch(() => {});
  });
}

module.exports = { registerAccount };
