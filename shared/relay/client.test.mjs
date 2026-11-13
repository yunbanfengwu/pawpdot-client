import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RelayClient} from './client.mjs';
import {MAX_FRAME_BYTES, MAX_DELIVERY_BYTES} from './envelope.mjs';

test('签名中的动作关闭重连后不得发往新socket', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }), sent = [];
  const client = new RelayClient({url: 'ws://127.0.0.1/relay/v1/connect', terminalId: randomUUID(), sign: async () => { await gate; return 'a'.repeat(86); }});
  client.context = {}; client.ws = {readyState: 1, close() {}, send() { sent.push('old'); }};
  const pending = client.send({type: 'event', to: randomUUID(), service: 'test', method: 'run', payload: {}});
  const rejected = assert.rejects(pending, e => e.code === 'UNKNOWN');
  client.close(); client.context = {}; client.ws = {readyState: 1, send() { sent.push('new'); }};
  release(); await rejected; assert.deepEqual(sent, []);
});

test('超限出站帧在SDK拒绝，不送到网络；delivery有独立包装预算', async () => {
  const sent = [], client = new RelayClient({url: 'ws://127.0.0.1/relay/v1/connect', terminalId: randomUUID(), sign: async () => 'a'.repeat(86)});
  client.context = {}; client.ws = {readyState: 1, send(frame) { sent.push(frame); }};
  await assert.rejects(client.send({type: 'event', to: randomUUID(), service: 'test', method: 'run', payload: 'x'.repeat(MAX_FRAME_BYTES)}), e => e.code === 'TOO_LARGE');
  assert.equal(sent.length, 0); assert.equal(MAX_DELIVERY_BYTES, MAX_FRAME_BYTES + 4096);
});

test('旧签名拒绝的清理不能删除重连后同ID的新请求', async () => {
  let release, first = true; const gate = new Promise(resolve => { release = resolve; });
  const client = new RelayClient({url: 'ws://127.0.0.1/relay/v1/connect', terminalId: randomUUID(), sign: async () => { if (first) { first = false; await gate; } return 'a'.repeat(86); }});
  client.context = {}; client.ws = {readyState: 1, close() {}, send() {}};
  const input = {id: randomUUID(), to: randomUUID(), service: 'test', method: 'run', payload: {}};
  const old = client.request(input), oldRejected = assert.rejects(old, e => e.code === 'UNKNOWN'); client.close(); await oldRejected;
  client.context = {}; client.ws = {readyState: 1, close() {}, send() {}};
  const next = client.request(input), nextRejected = assert.rejects(next, e => e.code === 'UNKNOWN');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.pending.size, 1); client.close(); await nextRejected;
});
