import fs from 'node:fs';
import path from 'node:path';
import {sign as cryptoSign} from 'node:crypto';
import {RelayClient} from '../../../shared/relay/client.mjs';
import {createRelayIdentity,signFrame} from '../../../shared/relay/node-identity.mjs';
import {BOOTSTRAP_PROTOCOL,GATEWAY_ID} from '../../../shared/relay/enrollment.mjs';
import {randomUUID} from 'node:crypto';
export class PhoneRelayConnector{
  constructor(home,adapter,{authorize}={}){
    this.authorize=authorize;
    this.home=home;this.adapter=adapter;this.client=null;this.stopped=false;this.enabled=true;this.pending=null;this.generation=0;this.controller=null;this.error='';this.status='connecting';this.gateway='';this.terminalId='';
    this.settings=path.join(home,'relay-settings.json');if(fs.existsSync(this.settings))this.enabled=JSON.parse(fs.readFileSync(this.settings,'utf8')).enabled!==false;if(!this.enabled)this.status='disabled';
    const file=path.join(home,'relay-terminal.json');if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(createRelayIdentity()),{flag:'wx',mode:0o600});this.identity=JSON.parse(fs.readFileSync(file,'utf8'));
    this.timer=setInterval(()=>void this.connect(),30000);this.timer.unref();
  }
  view(){return{protocol:'audoter.relay.v1',status:this.status,error:this.error,gateway:this.gateway,terminalId:this.terminalId};}
  async connect(label=this.adapter.core.view().label.slice(0,80)){ 
    if(this.stopped||!this.enabled)return;if(this.pending)return this.pending;
    const generation=++this.generation,controller=this.controller=new AbortController();
    return this.pending=this.perform(label,generation,controller.signal).catch(error=>{if(this.stopped||!this.enabled||generation!==this.generation)return;this.error=error.status?error.message:'统一中继暂不可用，正在重连';this.status='offline';}).finally(()=>{this.pending=null;});
  }
  async perform(label,generation,signal){
    const active=()=>!this.stopped&&this.enabled&&generation===this.generation;
    const origin=process.env.AUDOTER_RELAY_CONTROL_ORIGIN,key=process.env.AUDOTER_RELAY_BRIDGE_KEY,assignmentId=process.env.AUDOTER_RELAY_ASSIGNMENT_ID;
    let authorized;
    if(this.authorize){authorized=await this.authorize({publicKey:this.identity.publicKey,label,signal});}
    else{
      if(!origin||!key||!assignmentId){this.status='unconfigured';this.error='请从 AuDoter 账号空间打开手机连接';return;}
      const grantResponse=await fetch(origin+'/audoter-relay-internal/grant',{method:'POST',headers:{origin,'content-type':'application/json','x-audoter-relay':key},body:JSON.stringify({assignmentId,publicKey:this.identity.publicKey,label}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
      authorized=await grantResponse.json();if(!active())return;if(!grantResponse.ok){this.client?.close();this.adapter.disconnect();throw Object.assign(Error(authorized.error||'当前账号不能连接手机'),{status:grantResponse.status});}
    }
    if(!active())return;
    const proof=signFrame({protocol:BOOTSTRAP_PROTOCOL,type:'enroll',grant:authorized.grant,timestamp:Date.now(),nonce:randomUUID()},this.identity.privateKey);
    const response=await fetch(authorized.gateway+'/relay/v1/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(proof),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});const enrolled=await response.json();if(!active())return;if(!response.ok)throw Object.assign(Error(enrolled.error?.message||'终端登记失败'),{status:response.status});
    if(!active())return;this.gateway=authorized.gateway;this.terminalId=enrolled.terminalId;this.adapter.terminalId=enrolled.terminalId;
    if(this.client?.context&&this.client.terminalId===this.terminalId&&this.client.url===this.gateway.replace(/^http/,'ws')+'/relay/v1/connect'){this.status='online';this.error='';return;}
    this.client?.close();this.adapter.disconnect();
    const client=new RelayClient({url:this.gateway.replace(/^http/,'ws')+'/relay/v1/connect',terminalId:this.terminalId,sign:text=>cryptoSign(null,Buffer.from(text),this.identity.privateKey).toString('base64url'),onRequest:(message,identity)=>this.adapter.request(message,identity)});
    this.client=client;this.adapter.client=client;await client.connect();client.ws.addEventListener('close',()=>{if(this.client===client&&this.enabled&&!this.stopped){this.status='offline';this.adapter.disconnect();}});if(!active()){client.close();return;}this.status='online';this.error='';
  }
  async control(method,payload={}){if(!this.client?.context){await this.connect();}if(!this.client?.context)throw Object.assign(Error(this.error||'中继尚未连接'),{status:503});return this.client.request({to:GATEWAY_ID,service:'relay.registry',method,payload,timeout:10000});}
  async invite(){const invite=await this.control('invite.create');return{...invite,url:'audoter://relay?gateway='+encodeURIComponent(this.gateway)+'&code='+invite.code};}
  async setEnabled(enabled){this.enabled=enabled;fs.writeFileSync(this.settings,JSON.stringify({enabled}),{mode:0o600});if(!enabled){++this.generation;this.controller?.abort();this.client?.close();this.client=null;this.adapter.disconnect();this.status='disabled';}else{await this.pending;await this.connect();}}
  async close(){this.stopped=true;++this.generation;this.controller?.abort();clearInterval(this.timer);this.client?.close();this.client=null;this.adapter.close();await this.pending;}
}
