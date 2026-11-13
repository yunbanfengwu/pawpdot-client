import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {UI_PROTOCOL, validateSnapshot, validateInvocation, slotContributions} from './contract.mjs';
import {TerminalUiRegistry} from './registry.mjs';
import {approvalExtension, toolsExtension} from './examples.mjs';
const target = randomUUID(), peer = randomUUID(), identity = {userId: randomUUID(), tenantId: randomUUID(), spaceId: randomUUID()};
const snapshot = () => ({protocol: UI_PROTOCOL, terminalId: target, revision: 1, extensions: [approvalExtension(), toolsExtension()]});
const invoke = (revision, extra = {}) => ({protocol: UI_PROTOCOL, extensionId: 'example.approval', actionId: 'approve', revision, invocationId: randomUUID(), input: {comment: '同意'}, ...extra});
const message = payload => ({type: 'request', service: 'audoter.ui', method: 'invoke', from: peer, to: target, payload});

test('跨业务快照覆盖九类插槽、独占主屏与稳定排序', () => {
  const value = validateSnapshot(snapshot(), target);
  assert.equal(new Set(value.extensions.flatMap(e => e.contributions.map(c => c.slot))).size, 9);
  assert.equal(slotContributions(value, 'main')[0].extensionId, 'example.approval');
  const twin = structuredClone(value.extensions[0]); twin.id = 'example.a'; twin.contributions = [twin.contributions[0]];
  value.extensions.push(twin);
  assert.deepEqual(slotContributions(value, 'sidebar.items').map(c => c.extensionId), ['example.a', 'example.approval']);
});

test('未知脚本/样式/图标、动作越界、重复ID、组件深度与体积拒绝', () => {
  const variants = [v => v.extensions[0].contributions[0].node.script = 'steal()', v => v.extensions[0].contributions[0].node.icon = '🙂', v => v.extensions[0].contributions[0].node.action = 'other.action', v => v.extensions[0].permissions = [], v => v.extensions.push(v.extensions[0]), v => v.extensions[1].contributions.push({...v.extensions[0].contributions[1], id: 'collision'}), v => v.extensions[0].contributions[0].node = {type: 'webview', url: 'https://evil.test'}, v => v.extensions[0].contributions[0].node = {type: 'text', text: 'a'.repeat(140000)}];
  for (const mutate of variants) { const value = snapshot(); mutate(value); assert.throws(() => validateSnapshot(value)); }
  const deep = snapshot(); let node = {type: 'text', text: '内容'}; for (let i = 0; i < 10; i++) node = {type: 'column', children: [node]}; deep.extensions[0].contributions[0].node = node;
  assert.throws(() => validateSnapshot(deep));
  assert.throws(() => validateSnapshot(snapshot(), randomUUID()));
  assert.throws(() => validateInvocation(invoke(1, {input: {comment: 123}})));
});

test('并发动作幂等、内容冲突、过期界面及权限撤回', async () => {
  let allowed = true, runs = 0, release;
  const work = new Promise(resolve => { release = resolve; });
  const registry = new TerminalUiRegistry({terminalId: target, authorize: () => allowed});
  const dispose = registry.register(approvalExtension(), {open: () => ({}), approve: async () => { runs++; await work; return {result: {approved: true}}; }});
  const input = invoke(registry.revision), first = registry.request(message(input), identity), duplicate = registry.request(message(input), identity);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(runs, 1); release();
  assert.deepEqual(await first, await duplicate);
  assert.equal((await registry.request(message({...input, input: {comment: '不同意见'}}), identity)).error.code, 'CONFLICT');
  assert.equal((await registry.request(message(invoke(0)), identity)).error.code, 'STALE_UI');
  allowed = false;
  assert.equal((await registry.request(message(input), identity)).error.code, 'DENIED');
  dispose(); dispose(); assert.equal(registry.snapshot().extensions.length, 0);
});

test('身份来自认证上下文、未知动作/跨终端及无上下文拒绝', async () => {
  let actor;
  const registry = new TerminalUiRegistry({terminalId: target, authorize: () => true});
  registry.register(approvalExtension(), {open: () => ({}), approve: ({identity: value}) => { actor = value; return {}; }});
  const input = invoke(registry.revision);
  assert.equal((await registry.request({...message(input), to: randomUUID()}, identity)).error.code, 'DENIED');
  assert.equal((await registry.request(message(input))).error.code, 'DENIED');
  assert.equal((await registry.request({...message(input), service: 'audoter.harness'}, identity)).error.code, 'UNSUPPORTED');
  assert.equal((await registry.request(message({...input, actionId: 'delete'}), identity)).error.code, 'DENIED');
  await registry.request(message(input), identity);
  assert.equal(actor.userId, identity.userId); assert.equal(actor.terminalId, peer);
});

test('卸载中执行返回UNKNOWN，不假称撤销业务；有界账本拒绝新任务', async () => {
  let release; const work = new Promise(resolve => { release = resolve; });
  const registry = new TerminalUiRegistry({terminalId: target, authorize: () => true, maxInvocations: 1});
  const dispose = registry.register(approvalExtension(), {open: () => ({}), approve: async () => { await work; return {}; }});
  const pending = registry.request(message(invoke(registry.revision)), identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await registry.request(message(invoke(registry.revision)), identity)).error.code, 'BUSY');
  dispose(); release(); assert.equal((await pending).error.code, 'UNKNOWN');
});

test('浮层归属与组件校验；未知实现异常不泄露详情', async () => {
  const registry = new TerminalUiRegistry({terminalId: target, authorize: () => true});
  registry.register(approvalExtension(), {open: () => ({overlay: {kind: 'sheet', extensionId: 'example.approval', node: {type: 'text', text: '申请详情'}}}), approve: () => { throw Error('private-key-or-stack'); }});
  const open = await registry.request(message(invoke(registry.revision, {actionId: 'open'})), identity);
  assert.equal(open.overlay.kind, 'sheet');
  const error = await registry.request(message(invoke(registry.revision)), identity);
  assert.equal(error.error.code, 'BUSINESS_ERROR'); assert.ok(!JSON.stringify(error).includes('private-key'));
});

test('异步鉴权期间替换插件不得把旧声明标为新版本或调用新实现', async () => {
  let release, wait = true, executed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const registry = new TerminalUiRegistry({terminalId: target, authorize: async () => { if (wait) await gate; return true; }});
  const dispose = registry.register(approvalExtension(), {open: () => ({}), approve: () => ({})});
  const pending = registry.visible({...identity, terminalId: peer});
  const action = registry.request(message(invoke(registry.revision)), identity);
  await new Promise(resolve => setImmediate(resolve)); dispose();
  const next = approvalExtension(); next.title = '新版本'; registry.register(next, {open: () => ({}), approve: () => { executed++; return {}; }});
  wait = false; release();
  const value = await pending; assert.equal(value.extensions[0].title, '新版本'); assert.equal(value.revision, registry.revision);
  assert.equal((await action).error.code, 'STALE_UI'); assert.equal(executed, 0);
});
