import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-][a-zA-Z0-9_.:-]{0,159}$/.test(value);

export function appManifest(manifest) {
  if (manifest.audoter?.pluginType !== 'ui-app') return null;
  const app = manifest.audoter.app;
  if (app?.apiVersion !== 1 || typeof app.title !== 'string' || !app.title.trim() || app.title.length > 100) {
    throw new Error('应用清单版本或标题无效');
  }
  let entry;
  if (app.entry?.type === 'external') {
    const url = new URL(app.entry.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('应用网址无效');
    entry = { type: 'external', url: url.href };
  } else if (app.entry?.type === 'package' && typeof app.entry.path === 'string' &&
      /^ui\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.html$/.test(app.entry.path)) {
    entry = { type: 'package', path: app.entry.path };
  } else {
    throw new Error('应用入口无效');
  }
  const collections = app.collections ?? [];
  if (!Array.isArray(collections) || collections.length > 64 || !collections.every(key => /^[a-zA-Z0-9_-]{1,80}$/.test(key)) ||
      ![undefined, 'workspace'].includes(app.storage) || (app.storage === 'workspace' && entry.type !== 'package')) {
    throw new Error('应用存储声明无效');
  }
  const icon = typeof app.icon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(app.icon) && app.icon.length <= 192000 ? app.icon : null;
  return { title: app.title.trim(), entry, storage: app.storage, collections, icon };
}

export async function within(root, path) {
  const file = await realpath(resolve(root, path));
  const child = relative(root, file);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) throw new Error('应用资源越界');
  return file;
}

export async function installedApps(manager, resolveBundle) {
  const bundles = await manager.listBundles();
  const apps = await Promise.all(bundles.filter(bundle => bundle.installed && bundle.availability !== 'missing').map(async bundle => {
    try {
      const root = await realpath(resolveBundle(bundle.name));
      const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
      const app = appManifest(manifest);
      if (!app || manifest.name !== bundle.name) return null;
      return {
        ...app, root, id: bundle.name, version: bundle.version ?? manifest.version,
        description: typeof manifest.description === 'string' ? manifest.description.slice(0, 300) : '',
        enabled: bundle.enabled && !bundle.error, removable: bundle.removable
      };
    } catch (error) {
      // The native inventory remains available for packages with invalid metadata.
      return null;
    }
  }));
  return apps.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}
