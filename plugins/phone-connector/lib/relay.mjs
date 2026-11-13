import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DirectFault} from './direct-host.mjs';
export class RelayTunnel {
  constructor(home){this.file=path.join(home,'relay.json');this.child=null;this.state='stopped';this.target='';this.disposed=false;this.generation=0;}
  config(){
    if(!fs.existsSync(this.file))return null;
    const value=JSON.parse(fs.readFileSync(this.file,'utf8')),base=new URL(value.base);
    if(value.version!==1||!/[a-zA-Z0-9]/.test(value.host)||!/^[a-zA-Z0-9.-]+$/.test(value.host)||!/^[a-zA-Z0-9_-]+$/.test(value.user)||
      !Number.isInteger(value.remotePort)||value.remotePort<1024||value.remotePort>65535||base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/api/teamseek/direct/')||
      ![value.keyPath,value.knownHostsPath].every(file=>typeof file==='string'&&path.isAbsolute(file)&&fs.existsSync(file)))throw new DirectFault(503,'中继配置不可用，请检查受保护的本机配置');
    return value;
  }
  view(){try{const config=this.config();return{configured:!!config,base:config?.base||'',state:this.state};}catch{return{configured:false,base:'',state:'configuration-error'};}}
  bootstrap(core){
    const config=this.config();if(!config?.bootstrap)return;
    core.configure({label:core.view().label==='我的 AuDoter'?'AuDoter':core.view().label,routes:[{kind:'relay',base:config.base}]});
    delete config.bootstrap;const temporary=this.file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,this.file);
  }
  async start(listener,routes){
    const generation=++this.generation;
    const config=this.config(),enabled=routes.some(row=>row.kind==='relay'&&row.base===config?.base);
    if(!config||!enabled||!listener.running){await this.stop();return;}
    const target=new URL(listener.base);if(this.child&&this.target===target.host)return;
    await this.stop(false);if(this.disposed||generation!==this.generation)return;
    this.target=target.host;this.state='connecting';
    const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH','COMSPEC','PATHEXT','SYSTEMDRIVE','USERNAME','USERDOMAIN','PROGRAMDATA','ALLUSERSPROFILE','PROGRAMFILES','PROGRAMFILES(X86)','PROCESSOR_ARCHITECTURE']);
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
    if(process.versions.electron)env.ELECTRON_RUN_AS_NODE='1';
    const child=spawn(process.execPath,[fileURLToPath(new URL('./relay-supervisor.mjs',import.meta.url)),this.file,target.hostname,target.port],{windowsHide:true,env,stdio:['ignore','ignore','ignore','ipc']});
    this.child=child;child.on('message',message=>{if(this.child===child&&['connecting','connected','retrying'].includes(message?.state))this.state=message.state;});
    child.on('error',()=>{if(this.child===child)this.state='unavailable';});child.once('exit',()=>{if(this.child===child){this.child=null;this.state='stopped';}});
  }
  async stop(invalidate=true){
    if(invalidate)this.generation++;
    const child=this.child;this.child=null;this.target='';this.state='stopped';if(!child)return;
    await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},3500);child.once('exit',()=>{clearTimeout(timer);resolve();});if(child.connected)child.send({action:'stop'},()=>{});else child.kill();});
  }
  async dispose(){this.disposed=true;await this.stop();}
}
export async function verifyRelay(core){
  for(const row of core.view().routes.filter(row=>row.kind==='relay')){
    let matches=false;
    const deadline=Date.now()+20000;
    while(Date.now()<deadline)try{
      const response=await fetch(new URL('identity',row.base),{redirect:'error',signal:AbortSignal.timeout(3000)});
      const identity=await response.json();matches=response.ok&&identity.instanceId===core.identity().instanceId&&identity.protocol==='teamseek.direct.v1';if(matches)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }catch{await new Promise(resolve=>setTimeout(resolve,500));}
    if(!matches)throw new DirectFault(503,'中继尚未连接到当前 AuDoter，请稍后重试或检查中继配置');
  }
}
