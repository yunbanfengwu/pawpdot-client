import fs from 'node:fs';
import path from 'node:path';
const clean = (value, max) => String(value || '')
  .replace(/(?:https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, match => match.split(/[?#]/)[0] + '?[redacted]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[redacted]')
  .replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

// Bounded, private per-instance diagnostics. Never accepts arbitrary log objects,
// request bodies, conversation text, cookies, or authorization headers.
export function browserDiagnostics(file) {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')).slice(-300); } catch {}
  return {
    read: () => rows,
    append(deviceId, input) {
      const row = { at: new Date().toISOString(), deviceId,
        stage: clean(input.stage, 40), kind: clean(input.kind, 40),
        message: clean(input.message, 700), stack: clean(input.stack, 1400),
        userAgent: clean(input.userAgent, 250),
        features: Object.fromEntries(Object.entries(input.features || {}).filter(([key, value]) =>
          /^[A-Za-z.]{1,40}$/.test(key) && typeof value === 'boolean').slice(0, 20)),
        ...(Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? { status: input.status } : {}) };
      rows.push(row); rows = rows.slice(-300);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file + '.tmp', JSON.stringify(rows), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
      return row;
    }
  };
}
