/// 0.2.2 移除了 sessionController.inspect()（rc.5 的「不唤醒 Agent 读会话」接口）。
/// 本模块按 0.2.2 公开接口重建同样的两个只读语义，rc.5 回退保留：
/// - probeSession：仅校验会话存在（0.2.2 被动 state 采样；rc.5 走 inspect）。
/// - readSessionEvents：读取全部历史事件（0.2.2 用 follow() 快照分页；
///   快照与续流均为被动读，不会唤醒空闲会话，与 rc.5 inspect 一致）。
const readSignal = () => AbortSignal.timeout(10000);

export async function probeSession(ctx, sessionId) {
  const ctrl = ctx.sessionController;
  if (typeof ctrl.state === 'function') return ctrl.state({ sessionId }, readSignal());
  return ctrl.inspect(sessionId, readSignal());
}

export async function readSessionEvents(ctx, sessionId, { maxPages = 20, pageMessages = 200, maxEvents = 4000 } = {}) {
  const ctrl = ctx.sessionController;
  if (typeof ctrl.inspect === 'function') {
    const inspection = await ctrl.inspect(sessionId, readSignal());
    return Array.isArray(inspection?.events) ? inspection.events : [];
  }
  const events = [];
  let beforeSeq;
  for (let page = 0; page < maxPages && events.length < maxEvents; page++) {
    const request = { address: { kind: 'session', sessionId }, maxMessages: pageMessages };
    if (beforeSeq !== undefined) request.beforeSeq = beforeSeq;
    const iterator = ctrl.follow(request, readSignal())[Symbol.asyncIterator]();
    let frame;
    try {
      frame = (await iterator.next()).value;
    } finally {
      await iterator.return?.();
    }
    if (!frame || frame.type !== 'snapshot') break;
    const rows = Array.isArray(frame.records) ? frame.records : [];
    for (const row of rows) if (row?.event) events.push(row.event);
    const seqs = rows.map(row => row?.event?.seq).filter(seq => Number.isSafeInteger(seq));
    if (!frame.hasMore || !seqs.length) break;
    if (events.length >= maxEvents) break;
    const lowest = Math.min(...seqs);
    if (lowest <= 0) break;
    beforeSeq = lowest;
  }
  events.sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0));
  return events.length > maxEvents ? events.slice(-maxEvents) : events;
}
