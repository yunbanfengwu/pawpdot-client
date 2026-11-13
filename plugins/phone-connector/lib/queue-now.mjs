import { DirectFault } from './direct-host.mjs';

export async function attachedAgent(ctx, sessionId) {
  const resolved = ctx.agents.get(sessionId) ?? await ctx.sessionController.resolveAgent(sessionId);
  const agent = resolved?.agent ?? resolved?.value?.agent ?? resolved?.value ?? resolved;
  if (!agent || agent.id !== sessionId) throw new DirectFault(409, '会话尚未连接，请打开会话后重试');
  return agent;
}

// One synchronous transition after authorization: preserve the original message,
// cancel cooperatively through the host, prioritize it, then wake the same Agent.
export async function queueNow(ctx, input) {
  const agent = await attachedAgent(ctx, input.sessionId);
  const message = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].find(m => m.id === input.itemId);
  if (!message) throw new DirectFault(409, '消息已被处理或移除，请查看最新会话');
  if (typeof agent.inbox.prepend !== 'function' || typeof agent.wakeDriver !== 'function') throw new DirectFault(503, '宿主不支持立即引导');
  // This also enforces native subagent ownership; do not bypass it with a raw abort.
  const cancelled = ctx.sessionController.cancel({ sessionId: input.sessionId });
  if (cancelled?.accepted !== true && cancelled?.value?.accepted !== true) throw new DirectFault(503, '停止当前执行未确认');
  agent.inbox.remove(message.id);
  agent.inbox.prepend('next-turn', message);
  agent.wakeDriver(true);
  return { accepted: true, itemId: message.id, delivery: 'immediate' };
}

export async function goalCommand(ctx, input) {
  const agent = await attachedAgent(ctx, input.sessionId), goals = ctx.get('goals');
  if (!goals) return { goal: null };
  const current = goals.get(agent);
  if (input.action === 'goal-state') return { goal: current ?? null };
  if (!current) throw new DirectFault(409, '当前会话没有目标');
  if (input.goalId !== current.id || input.revision !== current.revision) throw new DirectFault(409, '目标已更新，请重试');
  const ref = { id: current.id, revision: current.revision };
  return { goal: input.action === 'goal-pause' ? goals.pause(agent, ref) : goals.resume(agent, ref) };
}
