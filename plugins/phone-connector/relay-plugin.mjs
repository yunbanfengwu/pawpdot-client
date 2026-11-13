import http from 'node:http';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import QRCode from './vendor/qrcode.cjs';
import {DirectHost,HarnessDirectoryAdapter} from './lib/direct-host.mjs';
import {directHandler,jsonBody} from './lib/direct-http.mjs';
import {createHarnessHttp} from './lib/harness-http.mjs';
import {MobileImageMessages} from './lib/images.mjs';
import {HarnessRelayAdapter} from './lib/relay-adapter.mjs';
import {PhoneRelayConnector} from './lib/connector.mjs';
import {TerminalUiRegistry} from '../../shared/terminal-ui/registry.mjs';
import {GATEWAY_ID} from '../../shared/relay/enrollment.mjs';
import {VoiceRealtimeService} from '../voice-call/voice-service.mjs';
export const inject=['webServer','clientModules','connection','typertGateway','sessionController','workspaceController','agents'];
export function apply(ctx){
  if(!process.env.DSH_HOME)throw Error('手机连接需要隔离执行目录');
  // The relay authenticates the peer and space. Business extensions must still
  // authorize their own records inside each handler, using this verified actor.
  const terminalUi=new TerminalUiRegistry({terminalId:GATEWAY_ID,authorize:({identity})=>Boolean(identity?.userId&&identity?.spaceId)});
  ctx.provide('terminalUi',terminalUi);
  ctx.effect(()=>()=>terminalUi.close());
  const home=path.join(process.env.DSH_HOME,'audoter/phone'),directory=new HarnessDirectoryAdapter(ctx),core=new DirectHost(home,directory);
  // 实时语音通话：配置在 <home>/voice-call/config.json（apiKey / voice / instructions），
  // 环境变量 DASHSCOPE_API_KEY 优先。服务通过 relay-adapter 的 audoter.voice 分发接入。
  const voiceHome=path.join(home,'voice-call');
  let voiceConfig={};try{voiceConfig=JSON.parse(readFileSync(path.join(voiceHome,'config.json'),'utf8'));}catch{voiceConfig={};}
  const voice=new VoiceRealtimeService({home:voiceHome,apiKey:process.env.DASHSCOPE_API_KEY||voiceConfig.apiKey,voice:voiceConfig.voice,instructions:voiceConfig.instructions,startTask:directory.startVoiceTask.bind(directory),log:(...args)=>console.log('[voice-call]',...args)});
  ctx.inject(['speechToText'],scope=>{directory.speech=scope.speechToText;scope.effect(()=>()=>{directory.speech=null;});});
  core.mobileImages=new MobileImageMessages({core,prompt:request=>ctx.sessionController.prompt(request,AbortSignal.timeout(30000))});
  core.harnessHttp=createHarnessHttp(ctx,core,jsonBody);const handler=directHandler(core),server=http.createServer(handler);
  let connector,adapter,disposed=false;
  const ready=(async()=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});if(disposed){server.close();return;}adapter=new HarnessRelayAdapter(core,'http://127.0.0.1:'+server.address().port);adapter.terminalUi=terminalUi;adapter.voice=voice;connector=new PhoneRelayConnector(home,adapter);void connector.connect();})();
  ctx.effect(()=>()=>{disposed=true;void connector?.close();voice.close();core.harnessHttp.dispose();handler.dispose();server.closeAllConnections();server.close();});
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/api/audoter/phone',handler:async(req,res)=>{
    if(!ctx.connection.authorizeIndex(req,res))return;
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
    if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${ctx.webServer.port}`||req.method==='POST'&&!req.headers.origin)return send(403,{error:'请求来源不匹配'});
    const suffix=new URL(req.url,'http://localhost').pathname.slice('/api/audoter/phone'.length);
    try{
      if(req.method==='GET'&&suffix==='/style.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8','cache-control':'no-store'});return res.end(await readFile(new URL('./phone.css',import.meta.url)));}
      await ready;if(!connector)return send(503,{error:'手机连接正在初始化'});
      if(req.method==='GET'&&!suffix){let devices=[];if(connector.client?.context)try{devices=(await connector.control('terminal.list')).terminals;}catch{}return send(200,{...connector.view(),label:core.view().label,devices});}
      if(req.method!=='POST')return send(404,{error:'接口不存在'});const input=await jsonBody(req);
      if(suffix==='/pair'){
        if(Object.keys(input).some(key=>key!=='label')||typeof input.label!=='string'||!input.label.trim()||input.label.length>80)return send(400,{error:'终端名称需为1至80个字符'});
        core.store.change(value=>{value.label=input.label.trim();});await connector.setEnabled(true);const invite=await connector.invite();
        const svg=await QRCode.toString(invite.url,{type:'svg',width:300,margin:4,errorCorrectionLevel:'M'});return send(200,{...invite,image:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
      }
      if(suffix==='/revoke')return send(200,await connector.control('terminal.revoke',{terminalId:input.terminalId}));
      if(suffix==='/disconnect'){await connector.setEnabled(false);return send(200,{stopped:true});}
      if(suffix==='/reconnect'){await connector.setEnabled(true);return send(200,connector.view());}
      return send(410,{error:'旧直连和专用隧道配置已停用，请使用统一网关连接码'});
    }catch(error){send(error.status||503,{error:error.status?error.message:'手机连接暂未完成，请稍后重试'});}
  }}));
}
