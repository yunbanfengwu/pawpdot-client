import {randomUUID,randomBytes,createHash} from 'node:crypto';
const fault=(status,message)=>Object.assign(Error(message),{status});
export class HarnessRelayAdapter{
  constructor(core,origin){this.core=core;this.origin=origin;this.devices=new Map();this.streams=new Map();this.uploads=new Map();this.downloads=new Map();this.client=null;this.terminalId='';core.trustedTokens=new Map();core.trustedDevices=new Map();}
  device(peer){
    if(!this.devices.has(peer)){const token=randomBytes(32).toString('base64url'),device={id:peer,label:'统一中继终端',access:'harness-control'};this.devices.set(peer,token);this.core.trustedDevices.set(peer,device);this.core.trustedTokens.set(createHash('sha256').update(token).digest('hex'),device);}return this.devices.get(peer);
  }
  path(input){if(typeof input!=='string'||input.length>2000||/\\|\.\.|#|^\//.test(input))throw fault(400,'业务路径无效');const url=new URL(input,'http://localhost/');if(url.origin!=='http://localhost'||! /^(identity|config|directory|harness-ticket|voice|image-message|messages(?:\/ack|\/open)?|harness\/(?:exchange|directory|engine|command|desktop|uplink|stream|native-file|media-image|diagnostics|graph)|harness\/rpc\/[a-zA-Z0-9_$./-]+)$/.test(url.pathname.slice(1)))throw fault(400,'不支持的终端接口');return input;}
  authorization(peer,input){
    const path=this.path(input.path),deviceToken=this.device(peer);
    if(path.startsWith('harness/')&&path!=='harness/exchange'){
      const web=this.core.web(input.bearer);if(web.deviceId!==peer)throw fault(403,'网页凭据不属于当前终端');return input.bearer;
    }
    if(path==='harness/exchange'){
      const ticket=this.core.tickets.get(createHash('sha256').update(String(input.body?.ticket||'')).digest('hex'));if(ticket?.deviceId!==peer)throw fault(403,'票据不属于当前终端');
    }
    return deviceToken;
  }
  async fetch(peer,input,signal){
    const token=this.authorization(peer,input),url=this.origin+'/api/teamseek/direct/'+input.path;
    return fetch(url,{method:input.body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,origin:this.origin,...(input.body===undefined?{}:{'content-type':'application/json'})},...(input.body===undefined?{}:{body:JSON.stringify(input.body)}),signal});
  }
  clean(){const now=Date.now();for(const map of [this.uploads,this.downloads])for(const[id,row]of map)if(row.expiresAt<now)map.delete(id);}
  async call(peer,input){if((this.activeCalls||0)>=8)throw fault(429,'终端处理繁忙');this.activeCalls=(this.activeCalls||0)+1;try{return await this.performCall(peer,input);}finally{this.activeCalls--;}}
  async performCall(peer,input){
    this.clean();const response=await this.fetch(peer,input,AbortSignal.timeout(95000)),parts=[];let bytes=0;
    for await(const part of response.body){bytes+=part.length;if(bytes>40*1024*1024)throw fault(413,'终端响应过大');parts.push(part);}
    let body=Buffer.concat(parts),contentType=response.headers.get('content-type')||'application/octet-stream';
    if(response.ok&&contentType.includes('application/json')&&['identity','config','harness/exchange'].includes(input.path)){
      const value=JSON.parse(body);if(value.instanceId)value.instanceId=this.terminalId;if(input.path==='identity'){value.protocol='audoter.direct.v1';if(this.voice?.available)value.capabilities={...value.capabilities,voiceRealtime:true};}if(input.path==='config')value.protocol='audoter.harness.v1';body=Buffer.from(JSON.stringify(value));
    }
    const meta={status:response.status,contentType};if(body.length<64000)return{...meta,data:body.toString('base64')};
    const total=[...this.downloads.values()].reduce((sum,row)=>sum+row.bytes.length,0);if(this.downloads.size>=8||total+body.length>64*1024*1024)throw fault(429,'文件传输繁忙');
    const id=randomUUID();this.downloads.set(id,{peer,bytes:body,expiresAt:Date.now()+120000});return{...meta,downloadId:id,bytes:body.length};
  }
  async request(message,identity){
    if(message.service==='audoter.ui'&&this.terminalUi){this.terminalUi.terminalId=this.terminalId;return this.terminalUi.request(message,identity);}
    if(message.service==='audoter.voice'&&this.voice){
      if(!identity?.userId||!identity?.spaceId)return{error:{code:'DENIED',message:'语音通话需要已授权的终端'}};
      const client=this.client;
      let outgoing=Promise.resolve(),queued=0;
      const sender=(method,payload)=>{
        if(client!==this.client||!client?.context)return;
        if(queued>=64){this.voice.disconnectTerminal(message.from);return;}
        queued++;
        outgoing=outgoing.then(()=>client.send({type:'event',to:message.from,service:'audoter.voice',method,payload}))
          .catch(()=>this.voice.disconnectTerminal(message.from)).finally(()=>{queued--;});
      };
      return this.voice.request(message,sender);
    }
    if(message.service!=='audoter.harness')return{error:{code:'UNSUPPORTED',message:'终端未提供该服务'}};
    const peer=message.from,input=message.payload;
    try{
      if(message.method==='call')return await this.call(peer,input);
      if(message.method==='upload.open'){
        this.clean();if(!Number.isInteger(input.bytes)||input.bytes<1||input.bytes>4000000||this.uploads.size>=8)throw fault(413,'请求传输超限');const id=randomUUID();this.uploads.set(id,{peer,limit:input.bytes,parts:[],size:0,expiresAt:Date.now()+60000});return{id};
      }
      if(message.method==='upload.part'){
        const row=this.uploads.get(input.id);if(!row||row.peer!==peer||row.expiresAt<Date.now()||row.parts.length>=128||input.index!==row.parts.length||typeof input.data!=='string'||input.data.length>90000)throw fault(400,'请求分片无效');const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.toString('base64')!==input.data)throw fault(400,'请求分片无效');row.size+=bytes.length;if(row.size>row.limit){this.uploads.delete(input.id);throw fault(413,'请求超限');}row.parts.push(bytes);return{accepted:true};
      }
      if(message.method==='upload.commit'){
        const row=this.uploads.get(input.id);if(!row||row.peer!==peer||row.expiresAt<Date.now()||row.size!==row.limit)throw fault(400,'请求尚未完整');this.uploads.delete(input.id);return await this.call(peer,JSON.parse(Buffer.concat(row.parts)));
      }
      if(message.method==='download.part'){
        const row=this.downloads.get(input.id);if(!row||row.peer!==peer||row.expiresAt<Date.now()||!Number.isInteger(input.offset)||input.offset<0||input.offset>=row.bytes.length)throw fault(400,'文件传输无效');const chunk=row.bytes.subarray(input.offset,input.offset+98304);return{offset:input.offset,data:chunk.toString('base64')};
      }
      if(message.method==='download.close'){if(this.downloads.get(input.id)?.peer===peer)this.downloads.delete(input.id);return{closed:true};}
      if(message.method==='stream.open'){
        if(typeof input.streamId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.streamId)||this.streams.size>=32)throw fault(400,'实时流无效');
        const key=peer+':'+input.streamId;if(this.streams.has(key))throw fault(409,'实时流已存在');const abort=new AbortController();this.streams.set(key,abort);
        let response;try{response=await this.fetch(peer,{path:'harness/stream',bearer:input.bearer,body:input.body},abort.signal);}catch(error){this.streams.delete(key);abort.abort();throw error;}if(!response.ok){this.streams.delete(key);abort.abort();throw fault(response.status,'实时流未打开');}
        void (async()=>{let seq=0;try{for await(const bytes of response.body){for(let i=0;i<bytes.length;i+=48000)await this.client.sendConfirmed({type:'event',to:peer,service:'audoter.harness',method:'stream.data',payload:{streamId:input.streamId,seq:seq++,data:Buffer.from(bytes.subarray(i,i+48000)).toString('base64')}});}}catch{}finally{this.streams.delete(key);abort.abort();try{await this.client.send({type:'event',to:peer,service:'audoter.harness',method:'stream.end',payload:{streamId:input.streamId}});}catch{}}})();return{opened:true};
      }
      if(message.method==='stream.close'){this.streams.get(peer+':'+input.streamId)?.abort();return{closed:true};}
      throw fault(400,'不支持的业务操作');
    }catch(error){return{error:{code:'TERMINAL_ERROR',status:error.status||503,message:error.status?error.message:'终端暂时无法完成操作'}};}
  }
  disconnect(){for(const abort of this.streams.values())abort.abort();this.streams.clear();this.uploads.clear();this.downloads.clear();this.voice?.close();this.core.harnessHttp.disconnect();this.core.close();}
  close(){this.disconnect();this.devices.clear();this.core.trustedTokens.clear();this.core.trustedDevices.clear();}
}
