// Bailian RealTime bridge for qwen3.8-omni-flash-realtime (WebSocket).
// Self-contained: only needs global WebSocket (Node >= 22).
// Protocol note: event names follow the OpenAI Realtime API naming used by the
// console sample (response.audio.delta, conversation.item.input_audio_transcription.completed, ...).
// The smoke test is exploratory and logs raw server events to confirm exact shapes.

const DEFAULT_MODEL = "qwen3.8-omni-flash-realtime";
const DEFAULT_VOICE = "Tina";

export class RealtimeSession {
  constructor(options = {}) {
    this.model = options.model || DEFAULT_MODEL;
    this.voice = options.voice || DEFAULT_VOICE;
    this.instructions = options.instructions || "";
    this.tools = options.tools || [];
    this.wsUrl = options.wsUrl || "wss://ws-8f1eu0skruhsj6c9.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime";
    this.apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY || "";
    this.onAudio = options.onAudio || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onUserTranscript = options.onUserTranscript || (() => {});
    this.onTool = options.onTool || null; // async (name, args) => result
    this.onError = options.onError || (() => {});
    this.onClosed = options.onClosed || (() => {});
    this.onEvent = options.onEvent || (() => {});
    this.toolCalls = new Set();
    this.ws = null;
    this.ready = false;
    this._readyPromise = null;
    this._resolveReady = null;
    this._rejectReady = null;
  }

  connect() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
      const url = `${this.wsUrl}?model=${encodeURIComponent(this.model)}`;
      try {
        this.ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      } catch (e) {
        reject(e);
        return;
      }
      this.ws.addEventListener("message", (ev) => {
        this._onMessage(ev.data).catch((e) => this.onError(e));
      });
      this.ws.addEventListener("error", (ev) => {
        reject(new Error("ws error: " + (ev.message || "unknown")));
        this.onError(ev);
      });
      this.ws.addEventListener("close", (ev) => {
        this.ready = false;
        reject(new Error('实时语音连接已关闭'));
        this.onClosed(ev);
      });
    });
    this._readyPromise.catch(() => {});
    return this._readyPromise;
  }

  _sessionPayload() {
    const session = {
      output_modalities: ["audio", "text"],
      voice: this.voice,
      instructions: this.instructions,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      turn_detection: { type: 'server_vad' },
    };
    if (this.tools.length) session.tools = this.tools;
    return session;
  }

  async _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    } catch {
      return;
    }
    this.onEvent(msg);
    switch (msg.type) {
      case "session.created":
        this.send({ type: 'session.update', session: this._sessionPayload() });
        break;
      case "session.updated":
        if (!this.ready) {
          this.ready = true;
          this._resolveReady && this._resolveReady(this);
        }
        break;
      case "response.audio.delta":
        this.onAudio(msg.delta);
        break;
      case "response.audio_transcript.done":
        this.onTranscript(msg.transcript || "");
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.onUserTranscript(msg.transcript || "");
        break;
      case "response.function_call_arguments.done": {
        const id = msg.call_id;
        if (typeof id !== "string" || !id || this.toolCalls.has(id)) break;
        this.toolCalls.add(id);
        const result = await this._runTool(msg.name, msg.arguments || "{}", id);
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: id,
            output: result,
          },
        });
        this.send({ type: "response.create" });
        break;
      }
      case "error":
        if (!this.ready) this._rejectReady?.(new Error('实时语音模型配置未确认'));
        this.onError(msg.error || msg);
        break;
      default:
        break;
    }
  }

  async _runTool(name, args, toolCallId) {
    if (!this.onTool) return JSON.stringify({ error: "no tool handler" });
    let parsed = {};
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = { raw: args };
    }
    try {
      const result = await this.onTool(name, parsed, toolCallId);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ error: String((e && e.message) || e) });
    }
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  appendAudio(base64Pcm16) {
    return this.send({ type: "input_audio_buffer.append", audio: base64Pcm16 });
  }

  askText(text) {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    return this.send({ type: "response.create" });
  }

  close() {
    try {
      this.ws && this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
