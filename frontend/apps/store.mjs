import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isId, within } from './manifest.mjs';

const recordLimit = 512 * 1024;

async function durableFile(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function workspaceAssets(workspace, appId) {
  const root = await realpath(workspace);
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(appId)) throw Error('应用包名不适用于工作区文件');
  const packageName = appId.replace('/', '__').replace(/^@/, '') + '-' + createHash('sha256').update(appId).digest('hex').slice(0, 12);
  let directory = root;
  for (const name of ['应用', packageName, '素材']) {
    await mkdir(join(directory, name), { mode: 0o700 }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await lstat(join(directory, name))).isDirectory()) throw Error('应用素材路径不是普通目录');
    directory = await within(directory, name);
  }
  return directory;
}

export function createWorkspaceStore({ workspace, openDomain }) {
  const domains = new Map();
  const writes = new Map();
  function tableFor(appId) {
    if (!domains.has(appId)) {
      const key = 'ui_app_' + createHash('sha256').update(appId).digest('hex').slice(0, 40);
      const opening = openDomain(key);
      domains.set(appId, opening);
      opening.catch(() => { if (domains.get(appId) === opening) domains.delete(appId); });
    }
    return domains.get(appId).then(domain => domain.table('collections'));
  }
  function write(appId, change) {
    const pending = (writes.get(appId) ?? Promise.resolve()).catch(() => {}).then(change);
    writes.set(appId, pending);
    return pending.finally(() => { if (writes.get(appId) === pending) writes.delete(appId); });
  }
  return {
    async close() {
      await Promise.allSettled(writes.values());
      const opened = await Promise.allSettled(domains.values());
      domains.clear();
      await Promise.all(opened.filter(result => result.status === 'fulfilled').map(result => result.value.close()));
    },
    async request(app, method, input) {
      if (app.storage !== 'workspace') throw Error('应用没有声明工作区存储');
      if (method === 'data.assetPut') {
        if (typeof input.data !== 'string' || input.data.length > 11_184_812 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) throw Error('素材超出大小限制或格式无效');
        const bytes = Buffer.from(input.data, 'base64');
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw Error('素材超出大小限制');
        const directory = await workspaceAssets(workspace, app.id);
        const id = 'asset_' + createHash('sha256').update(bytes).digest('hex');
        await durableFile(join(directory, id), bytes);
        return { ok: true, asset: { id, size: bytes.length } };
      }
      if (method === 'data.assetGet') {
        if (typeof input.id !== 'string' || !/^asset_[a-f0-9]{64}$/.test(input.id)) throw Error('素材标识无效');
        const directory = await workspaceAssets(workspace, app.id);
        try {
          const data = await readFile(await within(directory, input.id));
          if ('asset_' + createHash('sha256').update(data).digest('hex') !== input.id) throw Error('工作区素材校验失败');
          return { ok: true, asset: { id: input.id, size: data.length }, data: data.toString('base64') };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return { ok: true, asset: null };
        }
      }
      const { collection } = input;
      if (!app.collections.includes(collection)) throw Error('应用未声明此数据集合');
      const table = await tableFor(app.id);
      if (method === 'data.get') {
        if (!isId(input.id)) throw Error('记录标识无效');
        const item = table.get(collection)?.items.find(row => row.id === input.id);
        return { ok: true, item: item ?? null, revision: item?.revision ?? 0 };
      }
      if (method !== 'data.batch') throw Error('此数据接口未开放');
      const operations = input.operations;
      if (!Array.isArray(operations) || !operations.length || operations.length > 80) throw Error('批次大小无效');
      return write(app.id, async () => {
        const rows = new Map((table.get(collection)?.items ?? []).map(row => [row.id, row]));
        const seen = new Set();
        const items = operations.map(operation => {
          if (!isId(operation?.id) || seen.has(operation.id) || !Object.hasOwn(operation, 'value')) throw Error('批次记录无效');
          seen.add(operation.id);
          const revision = rows.get(operation.id)?.revision ?? 0;
          if (revision !== operation.expectedRevision) throw Error('记录已更新，请重新读取后保存');
          if (Buffer.byteLength(JSON.stringify(operation.value)) > recordLimit) throw Error('记录超过大小限制');
          const row = { id: operation.id, value: operation.value, revision: revision + 1 };
          rows.set(operation.id, row);
          return row;
        });
        await table.put(collection, { items: [...rows.values()] });
        return { ok: true, items };
      });
    }
  };
}
