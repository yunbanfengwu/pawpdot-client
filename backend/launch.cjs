const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const suppliedElectron = require('electron');

function electronExecutable() {
  if (process.platform !== 'win32') return suppliedElectron;

  // On Windows, launching Chromium from the source volume can fail before
  // Electron reaches the application. Run the pinned distribution from LocalAppData.
  const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cache = path.resolve(localData, 'Pawpdot Client', 'runtime');
  const version = require('electron/package.json').version;
  const target = path.join(cache, 'electron-' + version + '-' + process.arch);
  const executable = path.join(target, 'electron.exe');
  if (fs.existsSync(executable)) return executable;

  fs.mkdirSync(cache, { recursive: true });
  const staging = fs.mkdtempSync(path.join(cache, 'electron-stage-'));
  try {
    fs.cpSync(path.dirname(suppliedElectron), staging, { recursive: true });
    try {
      fs.renameSync(staging, target);
    } catch (error) {
      if (!fs.existsSync(executable)) throw error;
    }
  } finally {
    // Only clean up the staging directory created under this app's runtime cache.
    const relative = path.relative(cache, staging);
    if (!relative.startsWith('electron-stage-') || relative.includes(path.sep)) {
      throw new Error('Invalid Electron staging path.');
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return executable;
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExecutable(), [project, ...process.argv.slice(2)], {
  env, cwd: project, stdio: 'inherit',
});
child.once('error', error => {
  console.error('Could not launch PawPdot:', error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
