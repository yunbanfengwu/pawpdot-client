const { spawn } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const packageDirectory = path.dirname(require.resolve('@deepseek-ai/dsh/package.json'));
const readyUrl = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_%~.\-]+/;

async function startHarness(dataDirectory, signal) {
  const home = path.join(dataDirectory, 'harness');
  const workspace = path.join(dataDirectory, 'workspace');
  await Promise.all([home, workspace].map(directory => mkdir(directory, { recursive: true })));

  const clientBundle = name => pathToFileURL(path.join(__dirname, '..', 'frontend', name, 'index.mjs')).href;
  const phoneBundle = pathToFileURL(path.join(__dirname, '..', 'plugins', 'phone-connector', 'index.mjs')).href;
  const profilePatch = path.join(home, 'pawpdot-client.patch.json');
  await writeFile(profilePatch, JSON.stringify([
    { id: 'ui-brand-official', disabled: true },
    { id: 'ui-account-notifications', disabled: true },
    { id: 'ui-settings-models', config: { credentialOnboarding: false } },
    { insert: [
      { id: 'pawpdot-client-onboarding', name: clientBundle('onboarding') },
      { id: 'pawpdot-client-branding', name: clientBundle('branding') },
      { id: 'pawpdot-client-account', name: clientBundle('account') },
      { id: 'pawpdot-client-apps', name: clientBundle('apps') },
      { id: 'pawpdot-phone-connector', name: phoneBundle },
    ] },
  ]));
  signal.throwIfAborted();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('DSH_'))
  );
  Object.assign(env, {
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
  });

  const child = spawn(process.execPath, [
    '--expose-internals',
    path.join(packageDirectory, 'lib', 'bin.js'),
    'web', '--patch', profilePatch, '--no-open', '--host', '127.0.0.1', '--port', '0',
  ], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

  // Keep the token and raw Harness output inside the main process.
  child.stderr.resume();
  const stop = () => child.kill();
  signal.addEventListener('abort', stop, { once: true });
  child.once('close', () => signal.removeEventListener('abort', stop));
  try {
    const address = await waitForAddress(child);
    const response = await fetch(address, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    const cookies = response.headers.getSetCookie()
      .map(cookie => cookie.split(';', 1)[0])
      .filter(cookie => cookie.startsWith('dsh-auth-'));
    await response.body?.cancel();
    if (!cookies.length) throw new Error('Harness did not establish local authentication.');
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Harness stopped during authentication.');
    }
    return { child, home, origin: new URL(address).origin, cookie: cookies.join('; ') };
  } catch (error) {
    child.kill();
    throw error;
  }
}

function waitForAddress(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const deadline = setTimeout(() => finish(new Error('Harness startup timed out.')), 90000);
    const onError = error => finish(error);
    const onExit = code => finish(new Error('Harness exited during startup (' + code + ').'));
    const onOutput = chunk => {
      output = (output + chunk).slice(-8192);
      const match = output.match(readyUrl);
      if (match) finish(null, match[0]);
    };

    function finish(error, address) {
      clearTimeout(deadline);
      child.off('error', onError);
      child.off('exit', onExit);
      child.stdout.off('data', onOutput);
      child.stdout.resume();
      if (error) reject(error);
      else resolve(address);
    }

    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onOutput);
  });
}

module.exports = { startHarness };
