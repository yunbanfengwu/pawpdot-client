// Dedicated child owns ssh; IPC disconnect also runs when Harness is terminated
// on Windows, where SIGTERM does not run JavaScript shutdown handlers.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [configFile,address,localPort]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
let ssh,timer,stopping=false;
const publish=state=>{if(process.connected)process.send({state});};
function start(){
  if(stopping)return;publish('connecting');let ready=false;
  const args=['-v','-N','-T','-i',config.keyPath,'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','UserKnownHostsFile="'+config.knownHostsPath.replaceAll('\\','/')+'"','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=12',
    '-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-R',`127.0.0.1:${config.remotePort}:${address}:${localPort}`,`${config.user}@${config.host}`];
  ssh=spawn(process.platform==='win32'?path.join(process.env.SystemRoot,'System32/OpenSSH/ssh.exe'):'ssh',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  ssh.stderr.on('data',chunk=>{if(!ready&&chunk.toString().includes('remote forward success')){ready=true;publish('connected');}});
  ssh.on('error',()=>publish('retrying'));
  ssh.once('close',()=>{ssh=null;if(stopping)return;publish('retrying');timer=setTimeout(start,10000);});
}
function stop(){if(stopping)return;stopping=true;clearTimeout(timer);const child=ssh;if(child){child.once('close',()=>process.exit());child.kill();setTimeout(()=>process.exit(),2000).unref();}else process.exit();}
process.on('message',message=>{if(message?.action==='stop')stop();});process.once('disconnect',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
start();
