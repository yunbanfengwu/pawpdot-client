import fs from 'node:fs';
import crypto from 'node:crypto';

const ns = '@deepseek-ai/';
const prefix = '/api/teamseek/direct/harness/';
const roots = ['dsh-client-modules', 'dsh-client-ui-chat', 'dsh-client-ui-tool',
  'dsh-client-ui-attachment', 'dsh-client-ui-secret-mask'];
const workspaceRoots = ['dsh-client-ui-sidebar-files', 'dsh-client-ui-sidebar-documentpreview', 'dsh-client-ui-sidebar-terminal'];
const customId = 'teamseek-mobile-view';
const customInject = ['dsh-client-modules', 'dsh-client-ui-conversation', 'dsh-client-ui-session',
  'dsh-client-ui-workspace', 'dsh-client-ui-sidebar-right', 'dsh-api-remotes'].map(x => ns + x);
const digest = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');

// Package edges schedule services as well as factories. ui-workspace's browser
// body has no sidebar service dependency; its sidebar seats are optional slot
// registrations. Omit that composition edge in this dedicated document only.
export function selectConversationEntries(graph, workspace = false) {
  const byId = new Map(graph.entries.map(row => [row.id, row]));
  const selected = new Set();
  function visit(id) {
    id = id.replace(/\/client$/, '');
    if (selected.has(id)) return;
    const row = byId.get(id);
    if (!row) throw new Error('轻量页面缺少原版组件：' + id);
    selected.add(id);
    for (const dep of [...row.inject || [], ...row.external || []]) {
      if (id === ns + 'dsh-client-ui-workspace' && dep === ns + 'dsh-client-ui-sidebar') continue;
      const key = dep.replace(/\/client$/, '');
      if (byId.has(key)) visit(key);
      else if (row.inject?.includes(dep)) throw new Error('组件依赖不兼容：' + dep);
    }
  }
  [...roots, ...(workspace ? workspaceRoots : [])].forEach(x => visit(ns + x));
  return graph.entries.filter(row => selected.has(row.id)).map(row => ({ ...row,
    url: '/' + row.url.replace(/^\//, ''),
    ...(row.id === ns + 'dsh-client-ui-workspace'
      ? { inject: row.inject.filter(id => id !== ns + 'dsh-client-ui-sidebar') } : {})
  }));
}

// Independent, revisioned roster. No desktop renderIndex/taps or original SPA.
export function createLeanEntry(ctx) {
  const custom = fs.readFileSync(new URL('../public/lean-view.js', import.meta.url), 'utf8');
  const bundles = new Map();
  function graph(workspace = false) {
    const original = ctx.clientModules.graph();
    const initial = selectConversationEntries(original);
    // The mobile document has its own roster; desktop-only registration does
    // not load media here. Include this optional message renderer explicitly.
    const media = original.entries.find(row => row.id === 'teamseek-chat-media');
    if (media) initial.push({ ...media, url: '/' + media.url.replace(/^\//, '') });
    const entries = workspace ? selectConversationEntries(original, true) : [...initial];
    if (workspace && media && !entries.some(row => row.id === media.id)) entries.push(initial.find(row => row.id === media.id));
    entries.push({ id: customId, url: prefix + 'view-' + digest(custom) + '.js', rev: digest(custom), inject: customInject, external: ['react'] });
    const batches = [];
    function batch(rows, phase) {
      if (!rows.length) return;
      const rev = digest(JSON.stringify(rows.map(r => [r.id, r.rev])));
      const url = prefix + 'modules-' + rev + '.js';
      batches.push({ phase, url, rev, entries: rows.map(r => r.id) });
      if (!bundles.has(url)) bundles.set(url, { rows, promise: null });
    }
    batch(initial.filter(r => r.id === ns + 'dsh-client-modules'), 'bootstrap');
    batch([...initial.filter(r => r.id !== ns + 'dsh-client-modules'), entries.at(-1)], 'application');
    batch(entries.filter(r => !initial.some(i => i.id === r.id) && r.id !== customId), 'application');
    // Keep recent documents reloadable across a module graph rebuild.
    while (bundles.size > 12) bundles.delete(bundles.keys().next().value);
    return { rev: digest(JSON.stringify(entries)), release: original.release, entries, batches };
  }
  async function bundle(path) {
    if (path === prefix + 'view-' + digest(custom) + '.js') return custom;
    const row = bundles.get(path);
    if (!row) return null;
    row.promise ||= Promise.all(row.rows.map(async entry => {
      if (entry.id === customId) return custom;
      const response = await ctx.clientModules.fetchBundle(new Request(new URL(entry.url, 'http://localhost')));
      if (!response.ok) throw new Error('原版组件资源不可用：' + entry.id);
      return response.text();
    })).then(parts => parts.join('\n;\n')).catch(error => { row.promise = null; throw error; });
    return row.promise;
  }
  function html() {
    const bootstrap = ['harness-compat.js', 'lean-bootstrap.js'].map(name =>
      fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8')).join('\n');
    const wire = graph();
    const template = fs.readFileSync(new URL('../public/lean/index.html', import.meta.url), 'utf8');
    const injection = '<base href="/"><link rel="stylesheet" href="'+prefix+'tokens.css"><script>' + bootstrap + '</script>' +
      '<script>globalThis.__DSH_BOOT__=' + safeJSON(wire) + ';</script>' +
      '<script src="' + prefix + 'boot.js"></script>' +
      wire.batches.map(b => b.phase === 'bootstrap' ? '<script src="' + b.url + '"></script>'
        : '<link rel="preload" as="script" href="' + b.url + '">').join('');
    return template.replace(/<head[^>]*>/i, '$&' + injection);
  }
  return { html, graph, bundle };
}
