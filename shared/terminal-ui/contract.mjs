import {canonical, strictObject, terminalId} from '../relay/envelope.mjs';

export const UI_PROTOCOL = 'audoter.ui.v1';
export const UI_SERVICE = 'audoter.ui';
export const UI_MAX_BYTES = 131072;
export const UI_SLOTS = Object.freeze(['sidebar.items', 'header.actions', 'main', 'composer.above', 'composer.input', 'composer.tools', 'composer.expanded', 'content.cards', 'settings.items']);
export const UI_ICONS = Object.freeze(['menu', 'settings', 'add', 'send', 'close', 'refresh', 'check', 'file', 'info']);
const idPattern = /^[a-z][a-z0-9_.-]{0,79}$/;
export class UiFault extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = message => { throw new UiFault('INVALID_UI', message); };
function object(value, keys) { try { strictObject(value, keys); } catch { fail('界面包含未知字段或无效对象'); } }
function text(value, max = 80) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('界面文字无效'); }
function id(value) { if (typeof value !== 'string' || !idPattern.test(value)) fail('扩展标识无效'); }
function list(value, max) { if (!Array.isArray(value) || value.length > max) fail('界面列表超限'); }
function unique(values) { if (new Set(values).size !== values.length) fail('界面标识重复'); }
function bounded(value) { if (new TextEncoder().encode(canonical(value)).length > UI_MAX_BYTES) fail('界面超过128KiB'); }

export function validateNode(node, actions, permissions, budget = {nodes: 0}, depth = 0, inputs = new Set()) {
  if (depth > 8 || ++budget.nodes > 256) fail('界面组件数量或嵌套超限');
  const keys = {text: ['type', 'text'], column: ['type', 'children', 'title'], row: ['type', 'children', 'title'], card: ['type', 'children', 'title'], button: ['type', 'label', 'action', 'icon'], input: ['type', 'id', 'label', 'placeholder']}[node?.type];
  if (!keys) fail('组件类型不支持');
  object(node, keys);
  if (node.type === 'text') text(node.text, 8000);
  else if (node.type === 'button') {
    text(node.label); id(node.action);
    if (!actions.has(node.action) || !permissions.includes('ui.invoke')) fail('按钮动作未声明或没有调用权限');
    if (node.icon !== undefined && !UI_ICONS.includes(node.icon)) fail('图标不支持');
  } else if (node.type === 'input') {
    id(node.id); text(node.label);
    if (inputs.has(node.id)) fail('同一扩展输入标识重复');
    inputs.add(node.id);
    if (inputs.size > 32) fail('同一扩展输入数量超限');
    if (node.placeholder !== undefined) text(node.placeholder, 200);
  } else {
    list(node.children, 64);
    if (node.title !== undefined) text(node.title);
    for (const child of node.children) validateNode(child, actions, permissions, budget, depth + 1, inputs);
  }
  return node;
}

export function validateExtension(extension, budget = {nodes: 0}) {
  object(extension, ['id', 'version', 'title', 'permissions', 'actions', 'contributions']);
  id(extension.id); text(extension.title);
  if (typeof extension.version !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(extension.version)) fail('扩展版本无效');
  list(extension.permissions, 1); unique(extension.permissions);
  if (extension.permissions.some(p => p !== 'ui.invoke')) fail('扩展请求未知权限');
  list(extension.actions, 32); list(extension.contributions, 32);
  const actions = new Set();
  for (const action of extension.actions) { object(action, ['id', 'title']); id(action.id); text(action.title); actions.add(action.id); }
  if (actions.size !== extension.actions.length) fail('动作标识重复');
  const inputs = new Set();
  for (const item of extension.contributions) {
    object(item, ['id', 'slot', 'order', 'node']); id(item.id);
    if (!UI_SLOTS.includes(item.slot) || !Number.isInteger(item.order) || Math.abs(item.order) > 1000) fail('插槽或排序无效');
    validateNode(item.node, actions, extension.permissions, budget, 0, inputs);
  }
  unique(extension.contributions.map(item => item.id));
  return extension;
}

export function validateSnapshot(value, expectedTerminal) {
  bounded(value); object(value, ['protocol', 'terminalId', 'revision', 'extensions']);
  if (value.protocol !== UI_PROTOCOL || !terminalId(value.terminalId) || expectedTerminal && value.terminalId !== expectedTerminal || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('界面协议、来源或版本无效');
  list(value.extensions, 32); const budget = {nodes: 0};
  for (const extension of value.extensions) validateExtension(extension, budget);
  unique(value.extensions.map(e => e.id));
  for (const slot of ['main', 'composer.input']) if (value.extensions.flatMap(e => e.contributions).filter(c => c.slot === slot).length > 1) fail('独占插槽存在多个提供者');
  return value;
}

export function slotContributions(snapshot, slot) {
  return snapshot.extensions.flatMap(extension => extension.contributions.filter(c => c.slot === slot).map(c => ({...c, extensionId: extension.id})))
    .sort((a, b) => a.order - b.order || (a.extensionId < b.extensionId ? -1 : a.extensionId > b.extensionId ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function validateInvocation(input) {
  bounded(input); object(input, ['protocol', 'extensionId', 'actionId', 'revision', 'invocationId', 'input']);
  if (input.protocol !== UI_PROTOCOL || !Number.isSafeInteger(input.revision) || input.revision < 0 || !terminalId(input.invocationId)) fail('动作协议或版本无效');
  id(input.extensionId); id(input.actionId);
  if (!input.input || Object.getPrototypeOf(input.input) !== Object.prototype || Object.keys(input.input).length > 32) fail('输入表单无效');
  for (const [key, value] of Object.entries(input.input)) { id(key); if (typeof value !== 'string' || value.length > 4000) fail('输入内容超限'); }
  return input;
}

export function validateResult(value, snapshot, extensionId) {
  bounded(value); object(value, ['ok', 'result', 'overlay', 'snapshot']);
  if (value.ok !== true) fail('动作结果无效');
  if (value.snapshot !== undefined) validateSnapshot(value.snapshot, snapshot.terminalId);
  if (value.overlay !== undefined) {
    const overlay = value.overlay; object(overlay, ['kind', 'extensionId', 'node']);
    if (!['sheet', 'dialog', 'page'].includes(overlay.kind) || overlay.extensionId !== extensionId) fail('浮层来源无效');
    const owner = snapshot.extensions.find(e => e.id === extensionId);
    if (!owner) fail('浮层所属扩展已移除');
    validateNode(overlay.node, new Set(owner.actions.map(a => a.id)), owner.permissions);
  }
  return value;
}
