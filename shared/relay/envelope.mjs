// Transport- and business-independent JSON contract. No phone/Harness names.
export const RELAY_PROTOCOL = 'audoter.relay.v1';
export const MAX_FRAME_BYTES = 262144;
// A delivery wraps a signed envelope with bounded authenticated identity data.
export const MAX_DELIVERY_BYTES = MAX_FRAME_BYTES + 4096;
export class RelayFault extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const terminalId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function canonical(value, depth = 0) {
  if (depth > 32) throw new RelayFault('INVALID', '消息嵌套过深');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  }
  throw new RelayFault('INVALID', '消息必须是有效 JSON');
}
export function unsigned(value) { const {signature, ...rest} = value; return rest; }
export function strictObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new RelayFault('INVALID', '消息格式不符合协议');
}
export function validateEnvelope(value, now = Date.now()) {
  strictObject(value, ['protocol','id','type','from','to','service','method','replyTo','payload','timestamp','nonce','signature']);
  if (value.protocol !== RELAY_PROTOCOL || !['request','response','event','cancel'].includes(value.type) ||
    !terminalId(value.id) || !terminalId(value.from) || !terminalId(value.to) || !terminalId(value.nonce) ||
    !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(value.service || '') || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(value.method || '') ||
    !Number.isSafeInteger(value.timestamp) || Math.abs(now - value.timestamp) > 30000 ||
    typeof value.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value.signature) || !Object.hasOwn(value, 'payload') ||
    (value.replyTo !== undefined && !terminalId(value.replyTo)) || (value.type === 'request' && value.replyTo !== undefined) || (['response','cancel'].includes(value.type) && !value.replyTo)) throw new RelayFault('INVALID', '消息格式、时间或签名字段无效');
  if (new TextEncoder().encode(canonical(value)).length > MAX_FRAME_BYTES) throw new RelayFault('TOO_LARGE', '消息超过256KB，请由业务协议分片', 413);
  return value;
}
export function semanticMessage(value) {
  const {signature, timestamp, nonce, ...message} = value; return message;
}
