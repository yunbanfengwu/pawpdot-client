import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const maxEntries = 500;
const fault = (status, message) => Object.assign(Error(message), { status });

async function probe(candidate) {
  try { await fs.stat(candidate); return true; } catch { return false; }
}

// Read-only directory listing for the paired phone. The listing carries only
// names, types, sizes and timestamps; no file content travels through the
// connector. The user picks paths on the phone, and the chosen paths travel
// back as an ordinary session message that the model reads from local disk.
export async function fsList(input = {}) {
  const raw = typeof input?.path === 'string' ? input.path.trim() : '';
  if (!raw) {
    const home = os.homedir();
    const roots = [];
    for (const letter of 'CDEFGH') {
      const drive = `${letter}:\\`;
      if (await probe(drive)) roots.push({ path: drive, name: `${letter} 盘` });
    }
    const places = [];
    for (const [name, candidate] of [['用户目录', home], ['桌面', path.join(home, 'Desktop')],
      ['文档', path.join(home, 'Documents')], ['下载', path.join(home, 'Downloads')]]) {
      if (await probe(candidate)) places.push({ path: candidate, name });
    }
    return { path: '', parent: null, roots, places, entries: [] };
  }
  if (raw.length > 400 || raw.includes('\0')) throw fault(400, '路径无效');
  if (!path.isAbsolute(raw)) throw fault(400, '需要绝对路径');
  let target = path.normalize(raw);
  let stat;
  try { stat = await fs.stat(target); } catch { throw fault(404, '目录不存在或不可读'); }
  if (!stat.isDirectory()) {
    const parent = path.dirname(target);
    try { stat = await fs.stat(parent); } catch { throw fault(404, '目录不存在或不可读'); }
    if (!stat.isDirectory()) throw fault(400, '不是目录');
    target = parent;
  }
  const names = (await fs.readdir(target))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base', numeric: true }));
  const entries = [];
  for (const name of names.slice(0, maxEntries)) {
    const full = path.join(target, name);
    try {
      const row = await fs.stat(full);
      entries.push({ name, type: row.isDirectory() ? 'dir' : 'file',
        size: row.isDirectory() ? null : row.size, modified: row.mtime.toISOString() });
    } catch { entries.push({ name, type: 'file', size: null, modified: null }); }
  }
  entries.sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1));
  const parent = path.dirname(target);
  return {
    path: target, parent: parent === target ? null : parent,
    truncated: names.length > maxEntries, entries,
  };
}
