// Voice realtime service: one Bailian realtime session per call.
// Wired into the unified relay by phone-connector's adapter (service 'audoter.voice').
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { RealtimeSession } from './bailian-realtime.mjs';

const DEFAULT_INSTRUCTIONS = [
  '你是 AuDoter 手机语音助手，用简短、口语化的中文回答。',
  '用户问项目、进度、今天安排时，先调用对应工具查询真实数据，不要编造。',
  '用户让你帮忙做事时，调用 start_task 工具把任务交给后台；工具返回后，明确告诉用户"已经帮你新开了一个对话"，并简要复述任务内容。',
].join('\n');

/** Simple task store backed by a JSON file (temporary until super-agent wiring). */
export class LocalTaskSource {
  constructor(home) {
    this.file = path.join(home, 'voice-tasks.json');
    try {
      this.data = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      this.data = { tasks: [] };
    }
  }

  _save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  list(keyword) {
    const tasks = this.data.tasks || [];
    const rows = keyword ? tasks.filter((t) => t.title.includes(keyword)) : tasks;
    return rows.slice(-20).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress: t.progress || 0,
    }));
  }

  today() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = (this.data.tasks || []).filter((t) => t.status !== 'done' && t.due === today);
    return rows.length ? rows.map((t) => ({ title: t.title, due: t.due, status: t.status })) : [];
  }

  create(description) {
    const now = new Date();
    const task = {
      id: 'task-' + randomUUID().slice(0, 8),
      title: description,
      status: 'running',
      progress: 0,
      due: now.toISOString().slice(0, 10),
      createdAt: now.toISOString(),
    };
    this.data.tasks.push(task);
    this._save();
    return task;
  }
}

export class VoiceRealtimeService {
  constructor(options = {}) {
    this.home = options.home;
    this.apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY || '';
    this.voice = options.voice || 'Tina';
    this.instructions = options.instructions || DEFAULT_INSTRUCTIONS;
    this.tasks = options.tasks || (this.home ? new LocalTaskSource(this.home) : null);
    this.startTask = options.startTask;
    this.createSession = options.createSession || ((opts) => new RealtimeSession(opts));
    this.log = options.log || (() => {});
    this.calls = new Map(); // callId -> {terminalId, session, sender, seq}
  }

  get available() { return Boolean(this.apiKey); }

  _renew(callId, call) {
    clearTimeout(call.expiry);
    call.expiry = setTimeout(() => this._finish(callId, call, 'timeout'), 20000);
    call.expiry.unref?.();
  }

  _finish(callId, call, reason, close = true) {
    if (this.calls.get(callId) !== call) return;
    this.calls.delete(callId);
    clearTimeout(call.expiry);
    if (close) call.session.close();
    call.sender('ended', { callId, reason });
  }

  _tools() {
    return [
      {
        type: 'function',
        name: 'query_status',
        description: '查询用户当前的任务/项目列表与进度',
        parameters: { type: 'object', properties: { keyword: { type: 'string' } } },
      },
      {
        type: 'function',
        name: 'today_plan',
        description: '查询用户今天的安排',
        parameters: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'start_task',
        description: '把用户要求的一件事交给后台执行：后台会新开一个独立对话处理，并返回受理结果',
        parameters: {
          type: 'object',
          properties: { description: { type: 'string', description: '任务内容' } },
          required: ['description'],
        },
      },
    ];
  }

  async _runTool(name, args) {
    if (name === 'query_status') return { projects: this.tasks ? this.tasks.list(args.keyword) : [] };
    if (name === 'today_plan') {
      const rows = this.tasks ? this.tasks.today() : [];
      return { today: rows.length ? rows : '今天没有已安排的任务' };
    }
    if (name === 'start_task') {
      if (!args.description || typeof args.description !== 'string') throw new Error('任务内容不能为空');
      const task = this.tasks.create(args.description.trim());
      return { accepted: true, taskId: task.id, message: `已经帮你新开了一个对话：${task.title}` };
    }
    throw new Error('未知工具: ' + name);
  }

  /** Called by relay-adapter with a verified peer identity. */
  async request(message, sender) {
    const payload = message.payload || {};
    try {
      if (message.method === 'start') return await this.start(message.from, payload, sender);
      if (message.method === 'audio') return this.pushAudio(message.from, payload);
      if (message.method === 'stop') return this.stop(message.from, payload);
      if (message.method === 'state') {
        if (!payload.callId) return {
          protocol: 'audoter.voice.v1', available: this.available,
          inputRate: 16000, outputRate: 24000, planning: typeof this.startTask === 'function',
        };
        const call = this.calls.get(payload.callId);
        const owned = call?.terminalId === message.from;
        if (owned) this._renew(payload.callId, call);
        return { ok: true, active: owned };
      }
      return { error: { code: 'UNSUPPORTED', message: '不支持的语音操作' } };
    } catch (e) {
      return { error: { code: 'VOICE_ERROR', message: String((e && e.message) || e) } };
    }
  }

  async start(terminalId, payload, sender) {
    if (!this.available) throw new Error('终端未配置实时语音');
    const callId = typeof payload.callId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(payload.callId)
      ? payload.callId
      : 'call-' + randomUUID().slice(0, 8);
    if (this.calls.size >= 4) throw new Error('通话数已达上限');
    if (this.calls.has(callId)) throw new Error('通话编号已被使用');
    if ([...this.calls.values()].some((c) => c.terminalId === terminalId)) throw new Error('当前终端已有一通电话');
    const assistant = payload.mode === 'assistant';
    if (assistant && typeof this.startTask !== 'function') throw Error('终端暂不支持语音派活');
    const conversationOnly = payload.mode === 'conversation';
    const active = () => this.calls.get(callId) === call;
    const send = (method, data = {}) => {
      if (active()) sender(method, { callId, ...data });
    };
    const dispatch = (name, args, toolCallId) => {
      const instruction = typeof args?.description === 'string' ? args.description.trim() : '';
      if (!active() || name !== 'start_task' || !instruction || instruction.length > 4000 ||
          typeof toolCallId !== 'string' || !toolCallId || toolCallId.length > 160) {
        throw Error('未收到可执行的任务');
      }
      const key = instruction.normalize('NFKC').replace(/[\s\p{P}]/gu, '').toLowerCase();
      const existing = call.submissions.get(toolCallId) ?? call.turnSubmissions.get(call.turn) ??
        call.submittedInstructions.get(key);
      if (existing) {
        call.submissions.set(toolCallId, existing);
        return existing;
      }
      const result = (async () => {
        send('task.planning');
        try {
          const task = await this.startTask(instruction, 'voice-' + randomUUID(), active);
          send('task.accepted', task);
          return { accepted: true, ...task, message: '独立对话已受理，用户可以继续当前通话。' };
        } catch {
          call.submittedInstructions.delete(key);
          send('task.failed');
          return { accepted: false, message: '任务未确认受理，请如实告知用户。' };
        }
      })();
      call.submissions.set(toolCallId, result);
      call.turnSubmissions.set(call.turn, result);
      call.submittedInstructions.set(key, result);
      return result;
    };
    const session = this.createSession({
      apiKey: this.apiKey,
      voice: this.voice,
      instructions: assistant
        ? '你是用户的 AuDoter 宠物助理，用自然简短的中文听用户说话并回应。用户讨论计划时，先帮助拆解和澄清。只有用户明确要求开始执行时才调用 start_task。每次用户发言最多调用一次，description 包含本轮所有明确委派的目标与约束。相同任务已受理时直接复述回执，禁止重复提交。根据工具回执如实说明是否受理，不把受理说成完成。派活后继续当前语音通话。'
        : conversationOnly ? '用简短自然的口语和用户对话。涉及会话、权限或项目操作时，只解释能力范围。' : this.instructions,
      tools: conversationOnly ? [] : assistant ? this._tools().filter(({ name }) => name === 'start_task') : this._tools(),
      onAudio: (data) => send('audio', { data, seq: ++call.seq }),
      onTranscript: (text) => send('transcript', { role: 'assistant', text: text.slice(0, 2000) }),
      onUserTranscript: (text) => send('transcript', { role: 'user', text: text.slice(0, 2000) }),
      onTool: assistant ? dispatch : conversationOnly ? null : (name, args) => this._runTool(name, args),
      onEvent: (event) => {
        if (event.type === 'input_audio_buffer.speech_started') send('listening');
        if (event.type === 'input_audio_buffer.speech_stopped') {
          call.turn++;
          send('speech.ended');
        }
        if (event.type === 'response.done') send('turn.done');
      },
      onError: () => send('error', { message: '实时语音服务中断，请重试' }),
      onClosed: () => this._finish(callId, call, 'remote', false),
    });
    const call = {
      terminalId, session, sender, seq: 0, turn: 0,
      submissions: new Map(), turnSubmissions: new Map(), submittedInstructions: new Map(),
    };
    this.calls.set(callId, call);
    this._renew(callId, call);
    try {
      await session.connect();
      if (this.calls.get(callId) !== call) throw new Error('通话已取消');
    } catch (error) {
      this._finish(callId, call, 'error');
      throw error;
    }
    send('ready');
    this.log('call started', callId, 'terminal', terminalId);
    return { accepted: true, callId };
  }

  pushAudio(terminalId, payload) {
    const call = this.calls.get(payload.callId);
    if (!call || call.terminalId !== terminalId) return { error: { code: 'NOT_FOUND', message: '通话不存在或已结束' } };
    if (typeof payload.data !== 'string' || payload.data.length > 96000) return { error: { code: 'INVALID', message: '音频分片无效' } };
    const audio = Buffer.from(payload.data, 'base64');
    if (!audio.length || audio.length % 2 !== 0 || audio.toString('base64') !== payload.data) {
      return { error: { code: 'INVALID', message: '音频分片无效' } };
    }
    if (call.session.appendAudio(payload.data) === false) throw new Error('实时语音连接已断开');
    this._renew(payload.callId, call);
    return { accepted: true };
  }

  stop(terminalId, payload) {
    const call = this.calls.get(payload.callId);
    if (!call) return { closed: true };
    if (call.terminalId !== terminalId) return { error: { code: 'FORBIDDEN', message: '通话不属于当前终端' } };
    this._finish(payload.callId, call, 'user');
    return { closed: true };
  }

  disconnectTerminal(terminalId) {
    if (!terminalId) return;
    for (const [callId, call] of this.calls) {
      if (call.terminalId !== terminalId) continue;
      this._finish(callId, call, 'disconnect');
    }
  }

  close() {
    for (const [callId, call] of this.calls) this._finish(callId, call, 'host');
  }
}
