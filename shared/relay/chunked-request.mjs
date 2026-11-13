import {randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';

export const MAX_REQUEST_CHUNK_BYTES = 60000;
const methods = new Set(['upload.open','upload.part','upload.commit']);
const uuid = value => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const fault = (code,message,status=400,outcome='not-sent') =>
  Object.assign(Error(message),{code,status,outcome,retryable:false});
const validScope = value => typeof value==='string' && value.length>0 && value.length<=1024 &&
  !/[\u0000-\u001f\u007f]/.test(value);

function fields(value,allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key=>!allowed.includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))) {
    throw fault('INVALID_UPLOAD','请求分片格式无效');
  }
}

/** Incoming JSON-call upload transport, compatible with the current phone wire.
 * Caller authenticates every envelope first and supplies its own opaque scope.
 * No scope, identity, bearer or dispatch authority is taken from uploaded JSON.
 * Dispatch receives (parsedJSON,{scope,signal}); cancellation is cooperative and
 * never claims to undo an action already handed to the application.
 */
export class ChunkedRequestReceiver {
  #uploads=new Map();
  #pending=new Map();
  #reserved=0;
  #buffered=0;
  #closed=false;

  constructor({maxBytes=4*1024*1024,maxUploads=8,ttlMs=60000,now=Date.now,dispatch}={}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>64*1024*1024 ||
        !Number.isSafeInteger(maxUploads) || maxUploads<1 || maxUploads>128 ||
        maxBytes*maxUploads>128*1024*1024 || !Number.isSafeInteger(ttlMs) ||
        ttlMs<1 || ttlMs>300000 || typeof now!=='function' ||
        (dispatch!==undefined && typeof dispatch!=='function')) {
      throw fault('INVALID_UPLOAD_CONFIG','请求分片接收配置无效');
    }
    Object.assign(this,{maxBytes,maxUploads,ttlMs,now,dispatch});
    this.maxParts=Math.max(128,Math.ceil(maxBytes/MAX_REQUEST_CHUNK_BYTES));
  }

  get stats() {
    return Object.freeze({uploads:this.#uploads.size,dispatching:this.#pending.size,
      reservedBytes:this.#reserved,bufferedBytes:this.#buffered,closed:this.#closed});
  }

  #time() {
    const value=this.now();
    if (!Number.isFinite(value) || value<0) throw fault('INVALID_UPLOAD_CONFIG','分片时钟不可用');
    return value;
  }

  #wipe(row) {
    for (const part of row.parts) { part.fill(0);this.#buffered-=part.length; }
    row.parts.length=0;
  }

  #release(row) {
    if (row.released) return;
    row.released=true;this.#wipe(row);this.#reserved-=row.limit;
  }

  #clean(now) {
    for (const [id,row] of this.#uploads) if (now>=row.expiresAt) {
      this.#uploads.delete(id);this.#release(row);
    }
  }

  #owned(id,scope) {
    if (!uuid(id)) throw fault('INVALID_UPLOAD','上传标识无效');
    const row=this.#uploads.get(id);
    if (!row || row.scope!==scope) throw fault('INVALID_UPLOAD','上传不存在、已过期或不属于当前连接');
    return row;
  }

  async handle(method,payload,context={}) {
    if (!methods.has(method)) return {handled:false};
    if (this.#closed) throw fault('UPLOAD_CLOSED','分片接收器已关闭',503);
    fields(context,['scope','dispatch']);
    const {scope,dispatch=this.dispatch}=context;
    if (!validScope(scope) ||
        (dispatch!==undefined && typeof dispatch!=='function')) {
      throw fault('INVALID_UPLOAD','上传连接上下文无效');
    }
    const now=this.#time();this.#clean(now);
    if (method==='upload.open') {
      fields(payload,['bytes']);
      if (!Number.isSafeInteger(payload.bytes) || payload.bytes<1 || payload.bytes>this.maxBytes) {
        throw fault('UPLOAD_TOO_LARGE','请求传输大小超限',413);
      }
      if (this.#uploads.size+this.#pending.size>=this.maxUploads ||
          this.#reserved+payload.bytes>this.maxBytes*this.maxUploads) {
        throw fault('UPLOAD_BUSY','请求传输繁忙，请等待当前请求结束',429);
      }
      const id=randomUUID();
      this.#uploads.set(id,{scope,limit:payload.bytes,size:0,parts:[],expiresAt:now+this.ttlMs,
        controller:new AbortController(),cancelled:false,released:false});
      this.#reserved+=payload.bytes;
      return {handled:true,value:{id}};
    }
    if (method==='upload.part') {
      fields(payload,['id','index','data']);
      const row=this.#owned(payload.id,scope);
      if (!Number.isSafeInteger(payload.index) || payload.index!==row.parts.length ||
          row.parts.length>=this.maxParts || typeof payload.data!=='string' ||
          !payload.data.length || payload.data.length>80000 || payload.data.length%4!==0) {
        throw fault('INVALID_UPLOAD','请求分片顺序、数量或内容无效');
      }
      const part=Buffer.from(payload.data,'base64');
      if (!part.length || part.length>MAX_REQUEST_CHUNK_BYTES || part.toString('base64')!==payload.data) {
        part.fill(0);throw fault('INVALID_UPLOAD','请求分片编码无效');
      }
      if (row.size+part.length>row.limit) {
        part.fill(0);this.#uploads.delete(payload.id);this.#release(row);
        throw fault('UPLOAD_TOO_LARGE','请求分片超过声明大小',413);
      }
      row.parts.push(part);row.size+=part.length;this.#buffered+=part.length;
      return {handled:true,value:{accepted:true}};
    }
    fields(payload,['id']);
    const row=this.#owned(payload.id,scope);
    if (row.size!==row.limit) throw fault('INVALID_UPLOAD','请求尚未传输完整');
    // Consume before parsing/dispatch. Repeated/concurrent commits cannot call
    // the application twice, including after an unknown dispatch failure.
    this.#uploads.delete(payload.id);this.#pending.set(payload.id,row);
    let bytes,parsed;
    try {
      bytes=Buffer.concat(row.parts,row.size);this.#wipe(row);
      try { parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
      catch (_) { throw fault('INVALID_UPLOAD_JSON','请求正文不是有效的 UTF-8 JSON'); }
      finally { bytes.fill(0);bytes=undefined; }
      if (typeof dispatch!=='function') throw fault('UPLOAD_DISPATCH_UNAVAILABLE','请求处理器尚未就绪',503);
      let work;
      try {
        work=dispatch(parsed,{scope,signal:row.controller.signal});
        parsed=undefined;
        const value=await work;
        if (row.cancelled || this.#closed) throw Error('Scope closed');
        return {handled:true,value};
      } catch (_) {
        throw fault('UNKNOWN','请求已提交但结果未确认；不会自动重放',503,'unknown');
      }
    } finally {
      if (bytes) bytes.fill(0);
      parsed=undefined;
      this.#pending.delete(payload.id);this.#release(row);
    }
  }

  closeScope(scope) {
    if (!validScope(scope)) throw fault('INVALID_UPLOAD','上传连接上下文无效');
    let uploadsClosed=0,dispatchesAborted=0;
    for (const [id,row] of this.#uploads) if (row.scope===scope) {
      this.#uploads.delete(id);this.#release(row);uploadsClosed++;
    }
    for (const row of this.#pending.values()) if (row.scope===scope && !row.cancelled) {
      row.cancelled=true;row.controller.abort();this.#wipe(row);dispatchesAborted++;
    }
    // Pending dispatches keep their reservation until settled. The receiver
    // cannot erase objects retained by an application or undo its side effects.
    return {uploadsClosed,dispatchesAborted};
  }

  close() {
    this.#closed=true;
    for (const row of this.#uploads.values()) this.#release(row);
    this.#uploads.clear();
    for (const row of this.#pending.values()) if (!row.cancelled) {
      row.cancelled=true;row.controller.abort();this.#wipe(row);
    }
  }
}
