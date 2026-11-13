import {RELAY_PROTOCOL,MAX_DELIVERY_BYTES,canonical,terminalId,validateEnvelope} from './envelope.mjs';
// Any client can implement the same contract. This SDK uses WebSocket and an
// injected signing function; it has no Node, Harness, UI or business dependency.
export class RelayClient {
  constructor({url,terminalId:id,sign,WebSocketImpl=globalThis.WebSocket,onRequest,onEvent,onCancel}){
    const address=new URL(url);if(!['wss:','ws:'].includes(address.protocol)||address.username||address.password||address.search||address.hash||address.protocol==='ws:'&&!['127.0.0.1','localhost','[::1]'].includes(address.hostname))throw Error('远程中继必须使用 WSS');
    if(!terminalId(id)||typeof sign!=='function')throw Error('终端身份无效');
    Object.assign(this,{url,terminalId:id,sign,WebSocketImpl,onRequest,onEvent,onCancel});this.pending=new Map();this.confirmations=new Map();this.context=null;this.closed=false;this.generation=0;
  }
  async signed(value){return{...value,signature:await this.sign(canonical(value))};}
  async connect(){
    if(this.ws&&[0,1].includes(this.ws.readyState))throw Error('终端已连接');this.closed=false;const generation=++this.generation;
    return new Promise((resolve,reject)=>{
      let authenticated=false;const ws=this.ws=new this.WebSocketImpl(this.url),timer=setTimeout(()=>{ws.close();reject(Error('中继连接超时'));},12000);this.serial=Promise.resolve();
      const active=()=>generation===this.generation&&this.ws===ws;
      this.abortConnect=()=>{clearTimeout(timer);if(!authenticated)reject(Object.assign(Error('连接已取消'),{code:'UNKNOWN'}));};
      ws.addEventListener('message',event=>{this.serial=this.serial.then(async()=>{
        if(!active())return;const raw=String(event.data);if(new TextEncoder().encode(raw).length>MAX_DELIVERY_BYTES)throw Error('中继接收帧过大');const value=JSON.parse(raw);
        if(value.protocol!==RELAY_PROTOCOL)throw Error('中继协议不兼容');
        if(value.type==='challenge'){
          const frame=await this.signed({protocol:RELAY_PROTOCOL,type:'auth',terminalId:this.terminalId,challengeId:value.id,challenge:value.challenge,timestamp:Date.now(),nonce:crypto.randomUUID()});if(active())ws.send(JSON.stringify(frame));return;
        }
        if(value.type==='ready'){
          if(value.terminalId!==this.terminalId)throw Error('终端认证不匹配');authenticated=true;clearTimeout(timer);this.context=value.context;resolve(value.context);return;
        }
        if(value.type==='error'){
          const error=Object.assign(Error(value.error?.message||'中继请求失败'),{code:value.error?.code});
          if(!authenticated){clearTimeout(timer);reject(error);ws.close();return;}
          const pending=this.pending.get(value.id);if(pending){this.pending.delete(value.id);clearTimeout(pending.timer);pending.reject(error);}const confirmed=this.confirmations.get(value.id);if(confirmed){this.confirmations.delete(value.id);clearTimeout(confirmed.timer);confirmed.reject(error);}return;
        }
        if(value.type==='receipt'){const confirmed=this.confirmations.get(value.id);if(confirmed){this.confirmations.delete(value.id);clearTimeout(confirmed.timer);confirmed.resolve(value);}return;}
        if(value.type==='control-result'){
          const pending=this.pending.get(value.id);if(pending?.to==='00000000-0000-0000-0000-000000000000'&&pending.service==='relay.registry'){clearTimeout(pending.timer);this.pending.delete(value.id);pending.resolve(value.payload);}return;
        }
        if(value.type!=='delivery'||!authenticated)return;
        const message=validateEnvelope(value.message);if(message.to!==this.terminalId)throw Error('中继目标不匹配');
        if(message.type==='response'){
          const pending=this.pending.get(message.replyTo);if(!pending||pending.to!==message.from||pending.service!==message.service||pending.method!==message.method)return;
          clearTimeout(pending.timer);this.pending.delete(message.replyTo);pending.resolve(message.payload);return;
        }
        if(message.type==='event'){await this.onEvent?.(message,value.identity);return;}
        if(message.type==='cancel'){await this.onCancel?.(message,value.identity);return;}
        if(message.type==='request'){
          // Do not block transport serialization while the business works:
          // cancellation/events and other users' requests must keep flowing.
          void (async()=>{
            try{const payload=this.onRequest?await this.onRequest(message,value.identity):{error:{code:'UNSUPPORTED',message:'终端未提供该业务服务'}};if(active())await this.send({type:'response',to:message.from,service:message.service,method:message.method,replyTo:message.id,payload});}
            catch{try{if(active())await this.send({type:'response',to:message.from,service:message.service,method:message.method,replyTo:message.id,payload:{error:{code:'BUSINESS_ERROR',message:'目标终端处理失败'}}});}catch{}}
          })();
        }
      }).catch(error=>{clearTimeout(timer);if(!authenticated)reject(error);if(active())ws.close();});});
      ws.addEventListener('error',()=>{if(active()&&!authenticated){clearTimeout(timer);reject(Error('无法连接中继'));}});
      ws.addEventListener('close',()=>{clearTimeout(timer);if(!active())return;this.context=null;if(!authenticated)reject(Error('中继认证或连接失败'));this.failPending();});
    });
  }
  async send({id=crypto.randomUUID(),type,to,service,method,replyTo,payload}){
    if(!this.context||this.ws.readyState!==1)throw Error('终端未连接');
    const ws=this.ws,generation=this.generation;
    const frame=await this.signed({protocol:RELAY_PROTOCOL,id,type,from:this.terminalId,to,service,method,...(replyTo?{replyTo}:{}),payload,timestamp:Date.now(),nonce:crypto.randomUUID()});
    if(generation!==this.generation||this.ws!==ws||!this.context||ws.readyState!==1)throw Object.assign(Error('连接已变更，操作未发送'),{code:'UNKNOWN'});
    validateEnvelope(frame);ws.send(JSON.stringify(frame));return id;
  }
  request({to,service,method,payload,id=crypto.randomUUID(),timeout=60000}){
    if(this.pending.has(id))return Promise.reject(Error('此请求ID正在处理中'));
    return new Promise((resolve,reject)=>{const row={resolve,reject,to,service,method};const timer=row.timer=setTimeout(()=>{if(this.pending.get(id)===row)this.pending.delete(id);reject(Object.assign(Error('响应超时，执行结果未知'),{code:'UNKNOWN'}));},timeout);this.pending.set(id,row);void this.send({id,type:'request',to,service,method,payload}).catch(error=>{clearTimeout(timer);if(this.pending.get(id)===row)this.pending.delete(id);reject(error);});});
  }
  sendConfirmed(message){const id=message.id||crypto.randomUUID();if(this.confirmations.has(id))return Promise.reject(Error('此消息ID正在等待确认'));return new Promise((resolve,reject)=>{const row={resolve,reject};const timer=row.timer=setTimeout(()=>{if(this.confirmations.get(id)===row)this.confirmations.delete(id);reject(Error('转发确认超时'));},15000);this.confirmations.set(id,row);void this.send({...message,id}).catch(error=>{clearTimeout(timer);if(this.confirmations.get(id)===row)this.confirmations.delete(id);reject(error);});});}
  failPending(){for(const item of [...this.pending.values(),...this.confirmations.values()]){clearTimeout(item.timer);item.reject(Object.assign(Error('连接中断，执行结果未知；不会自动重发'),{code:'UNKNOWN'}));}this.pending.clear();this.confirmations.clear();}
  close(){this.closed=true;this.context=null;this.abortConnect?.();++this.generation;this.failPending();this.ws?.close(1000,'client closed');}
}
