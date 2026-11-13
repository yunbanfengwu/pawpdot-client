import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from '../vendor/qrcode.cjs';
import { JsonStore } from './store.mjs';

export class InboxFault extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const text = (v, max) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new InboxFault(400, '消息字段无效');
  return v.trim();
};
const id = v => { v = text(v, 100); if (!/^[\w-]+$/.test(v)) throw new InboxFault(400, '消息标识无效'); return v; };

/** Owner publishes metadata; authenticated devices only read their own rows. */
export class DeviceInbox {
  constructor(home, { authorizeDevice, issuePairing }) {
    this.authorizeDevice = authorizeDevice; this.issuePairing = issuePairing;
    this.store = new JsonStore(path.join(home, 'inbox.json'), { version: 1, messages: [] }, s => s?.version === 1 && Array.isArray(s.messages));
    this.cache = new Map(); this.pending = new Map();
  }
  send(input) {
    const row = { id: id(input.id), title: text(input.title, 120), body: text(input.body, 1200),
      kind: 'pairing', targetId: id(input.targetId), recipients: [...new Set((input.recipients || []).map(id))] };
    if (!row.recipients.length || row.recipients.length > 50) throw new InboxFault(400, '请选择接收设备');
    row.recipients.forEach(device => this.authorizeDevice(device));
    const old = this.store.snapshot().messages.find(m => m.id === row.id);
    if (old) {
      if (JSON.stringify(Object.fromEntries(Object.keys(row).map(k => [k, old[k]]))) !== JSON.stringify(row)) throw new InboxFault(409, '同一消息标识不能覆盖不同内容');
      return { id: old.id, recipients: old.recipients.length, queued: true };
    }
    if (this.store.snapshot().messages.length >= 500) throw new InboxFault(429, '消息记录已满');
    this.store.change(s => s.messages.push({ ...row, createdAt: new Date().toISOString(), receipts: {} }));
    return { id: row.id, recipients: row.recipients.length, queued: true };
  }
  row(device, messageId) {
    this.authorizeDevice(device.id);
    const row = this.store.snapshot().messages.find(m => m.id === id(messageId) && m.recipients.includes(device.id));
    if (!row) throw new InboxFault(404, '消息不存在或不属于此设备');
    return row;
  }
  list(device) {
    this.authorizeDevice(device.id);
    return { messages: this.store.snapshot().messages.filter(m => m.recipients.includes(device.id)).slice(-100).reverse()
      .map(({ id, title, body, kind, createdAt }) => ({ id, title, body, kind, createdAt })) };
  }
  ack(device, input) {
    this.row(device, input.id);
    if (!['received', 'notified', 'opened'].includes(input.state)) throw new InboxFault(400, '消息回执无效');
    this.store.change(s => {
      const row = s.messages.find(m => m.id === input.id);
      const receipt = row.receipts[device.id] ||= {};
      receipt[input.state] ||= new Date().toISOString();
    });
    return { ok: true };
  }
  async open(device, input) {
    const row = this.row(device, input.id), key = device.id + ':' + row.id;
    const cached = this.cache.get(key);
    if (cached && Date.parse(cached.expiresAt) > Date.now() + 30000) return cached;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = (async () => {
      const issued = await this.issuePairing(row.targetId);
      this.authorizeDevice(device.id);
      if (!/^seeks?:[^\s?]+\?code=[\w-]{22}$/.test(issued.url) || !issued.offer?.instanceId ||
          !Number.isFinite(Date.parse(issued.offer.expiresAt))) throw new InboxFault(502, '目标插件未返回有效的新配对码');
      const value = { url: issued.url, instanceId: issued.offer.instanceId, label: issued.offer.label,
        expiresAt: issued.offer.expiresAt, png: await QRCode.toDataURL(issued.url, { width: 328, margin: 4, errorCorrectionLevel: 'M' }) };
      this.cache.set(key, value); this.ack(device, { id: row.id, state: 'opened' }); return value;
    })();
    this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
  admin() { return { messages: this.store.snapshot().messages }; }
}

