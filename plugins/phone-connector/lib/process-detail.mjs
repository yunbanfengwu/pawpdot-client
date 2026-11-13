// Process details stay on the computer. Mobile receives slimmed follow
// frames (labels and short fields only) and fetches full details on demand
// through harness/command `process-detail`. Desktop web terminals that do not
// ask for the lazy profile keep the untouched frames.
import { DirectFault } from './direct-host.mjs';
import { readSessionEvents } from './session-read.mjs';

export const LAZY_MARKER = '_lazyDetail';
const SLIM_TEXT = 240;
const SLIM_DEPTH = 5;
const DETAIL_EVENTS = ['tool/call', 'tool/result', 'assistant/message', 'assistant/attempt'];
const DETAIL_BUDGET = 400 * 1024;

function slimValue(value, depth = 0) {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > SLIM_TEXT) return value.slice(0, SLIM_TEXT) + '…';
    return value;
  }
  if (depth >= SLIM_DEPTH) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) return value.map(item => slimValue(item, depth + 1));
  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = slimValue(item, depth + 1);
  return output;
}

const slimPart = part => {
  if (!part || typeof part !== 'object') return part;
  if (['reasoning', 'thinking'].includes(part.type)) {
    return { ...part, text: '', thinking: '', [LAZY_MARKER]: true };
  }
  const output = slimValue(part);
  // 正文 text 是手机端渲染的唯一来源（含 ```autodot-media 媒体围栏，闭合
  // 围栏常在第 240 字符之后）；截断会把整条消息退化为原始 JSON 代码块
  // （2026-11-05 用户真机实测）。正文完整下发，其余字段照常瘦身。
  if (typeof part.text === 'string') output.text = part.text;
  return output;
};

// Attempt 流恢复未完成生成的实况块：正文增量（text-chunks / text-delta /
// block-end）完整保留，思考增量继续瘦身为占位。
const slimStreamRecord = record => {
  if (!record || typeof record !== 'object') return record;
  if (record.type === 'reasoning-chunks') return slimValue(record);
  if (record.type === 'chunk' && ['reasoning-delta', 'thinking-delta'].includes(record.chunk?.type)) return slimValue(record);
  return { ...record };
};

function slimData(type, data) {
  // Message bodies keep their part structure so labels/order survive; the
  // reasoning texts become lazy placeholders. Attempt streams keep their
  // text records intact: they restore the live block UI for unfinished
  // generations. Content/stream arrays bypass the generic string cap (see
  // slimPart/slimStreamRecord); every other field still goes through it.
  if (type === 'assistant/message' && Array.isArray(data?.message?.content)) {
    const content = data.message.content;
    const value = slimValue({ ...data, message: { ...data.message, content: [] } });
    value.message.content = content.map(slimPart);
    return value;
  }
  if (type === 'assistant/attempt' && Array.isArray(data?.stream)) {
    const stream = data.stream;
    const value = slimValue({ ...data, stream: [] });
    value.stream = stream.map(slimStreamRecord);
    return value;
  }
  return slimValue(data);
}

export function slimEvent(event) {
  if (!event || !DETAIL_EVENTS.includes(event.type)) return event;
  return { ...event, [LAZY_MARKER]: true, data: slimData(event.type, event.data) };
}

/// Slim a session/follow frame. Only journal events are trimmed; live
/// assistant-stream chunks keep full text because they arrive in small
/// increments and drive the open-group live view.
export function slimFollowValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'event' && value.event) return { ...value, event: slimEvent(value.event) };
  if (value.type === 'snapshot' && Array.isArray(value.records)) {
    return { ...value, records: value.records.map(row => row && row.event ? { ...row, event: slimEvent(row.event) } : row) };
  }
  return value;
}

/// Return full journal events for the requested seqs. Oversized events fall
/// back to the slim shape so one giant log entry cannot blow the response.
export async function processDetail(ctx, body) {
  const requested = Array.isArray(body?.seqs) ? body.seqs.filter(seq => Number.isSafeInteger(seq) && seq >= 0) : [];
  if (!requested.length || requested.length > 40) throw new DirectFault(400, '明细序号无效');
  const inspection = { events: await readSessionEvents(ctx, body.sessionId) };
  const bySeq = new Map((Array.isArray(inspection?.events) ? inspection.events : []).map(event => [event?.seq, event]));
  let used = 0;
  const events = [];
  for (const seq of [...new Set(requested)].sort((a, b) => a - b)) {
    const event = bySeq.get(seq);
    if (!event || !DETAIL_EVENTS.includes(event.type)) continue;
    const size = JSON.stringify(event.data ?? null).length;
    if (used + size > DETAIL_BUDGET) {
      events.push({ type: event.type, seq: event.seq, [LAZY_MARKER]: true, data: slimData(event.type, event.data) });
      continue;
    }
    used += size;
    events.push({ type: event.type, seq: event.seq, data: event.data });
  }
  return { events };
}
