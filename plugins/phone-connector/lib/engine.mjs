import path from 'node:path';
import os from 'node:os';
import { DirectFault } from './direct-host.mjs';
import { probeSession } from './session-read.mjs';

// 手机端底座控制与电脑端聊天切换器共用 pi-engine 的会话选择存储
// （$DSH_HOME/pi-engine/engines，不创建第二份偏好或独立执行路径）。
// pi-engine 插件未加载时保持纯原生底座：只报告 deepseek 并拒绝切换。
export async function engineControl(ctx, input, options = {}) {
  // entry.fiber.state === 2 即 cordis FiberState.ACTIVE（PENDING 0 / LOADING 1 / ACTIVE 2）。
  const active = [...ctx.loader?.entries?.() ?? []].some(entry =>
    (entry.options?.id === 'audoter-pi-engine'
      || String(entry.options?.name ?? '').replace(/\\/g, '/').endsWith('/pi-engine/index.mjs'))
    && !entry.options?.disabled && entry.fiber?.state === 2);
  await probeSession(ctx, input.sessionId);
  if (!active) {
    if (input.action === 'set-engine') throw new DirectFault(400, '宿主 Pi 底座插件未启用，不能切换');
    return { engine: 'deepseek', engines: ['deepseek'] };
  }
  const { EngineSelections } = await import('../../pi-engine/lib/state.mjs');
  const selections = new EngineSelections(options.home || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'pi-engine/engines'));
  if (input.action === 'set-engine') {
    const resolved = await ctx.sessionController.resolveAgent(input.sessionId);
    if (resolved?.error) throw new DirectFault(400, resolved.error.message || '此会话不能切换底座');
    const agent = resolved?.agent ?? resolved;
    if (!agent || agent.id !== input.sessionId) throw new DirectFault(400, '未能解析当前会话');
    try { selections.set(input.sessionId, input.engine, agent); }
    catch (error) { throw new DirectFault(400, error.message); }
  }
  return { engine: selections.get(input.sessionId), engines: ['deepseek', 'pi'] };
}
