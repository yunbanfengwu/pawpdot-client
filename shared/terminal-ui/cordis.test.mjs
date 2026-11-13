import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Context} from '../../runtime/core/node_modules/@deepseek-ai/cordis/lib/index.js';
import {TerminalUiRegistry} from './registry.mjs';
import {approvalExtension} from './examples.mjs';

test('真实Cordis：业务插件卸载释放其插槽，重装后旧清理不删除新注册', async () => {
  const root = new Context(); let registry, cleanup;
  try {
    const host = await root.plugin(ctx => {
      registry = new TerminalUiRegistry({terminalId: randomUUID(), authorize: () => true});
      ctx.provide('terminalUi', registry); ctx.effect(() => () => registry.close());
    });
    const business = {inject: ['terminalUi'], apply(ctx) { ctx.effect(() => { cleanup = ctx.terminalUi.register(approvalExtension(), {open: () => ({}), approve: () => ({})}); return cleanup; }); }};
    const first = await root.plugin(business); assert.equal(registry.snapshot().extensions.length, 1);
    const old = cleanup; await first.dispose(); assert.equal(registry.snapshot().extensions.length, 0);
    const second = await root.plugin(business); old(); assert.equal(registry.snapshot().extensions.length, 1);
    const value = registry.snapshot(); value.extensions[0].title = '外部修改';
    assert.equal(registry.snapshot().extensions[0].title, '审批工作台');
    await second.dispose(); await host.dispose(); assert.equal(registry.snapshot().extensions.length, 0);
  } finally { await root.fiber.dispose(); }
});
