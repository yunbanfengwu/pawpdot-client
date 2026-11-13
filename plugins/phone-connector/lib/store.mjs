import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function text(value, label, { optional = false, max = 4000 } = {}) {
  if (value == null && optional) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) {
    throw new Error(`${label}需为${optional ? '' : '非空'}文字，最多 ${max} 字`);
  }
  return value.trim();
}
export function oneOf(value, values, label) {
  if (!values.includes(value)) throw new Error(`${label}无效`);
  return value;
}
export class JsonStore {
  constructor(file, initial, validate) {
    this.file = file;
    this.validate = validate;
    this.value = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(initial);
    if (!validate(this.value)) throw new Error('数据格式不正确，已停止写入以保护原文件');
  }
  snapshot() { return structuredClone(this.value); }
  change(update) {
    const draft = this.snapshot();
    const result = update(draft);
    if (!this.validate(draft)) throw new Error('更新后的数据格式不正确');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(draft, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    this.value = draft;
    return structuredClone(result);
  }
}
