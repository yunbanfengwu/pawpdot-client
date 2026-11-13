import {canonical,unsigned,strictObject,terminalId,RelayFault} from './envelope.mjs';
import {verifyFrame,publicIdentity} from './node-identity.mjs';
export const GATEWAY_ID='00000000-0000-0000-0000-000000000000';
export const ENROLL_PROTOCOL='audoter.relay.enroll.v1',BOOTSTRAP_PROTOCOL='audoter.relay.bootstrap.v1';
export function verifyGrant(grant,publicKey,now=Date.now()){
  strictObject(grant,['protocol','authorityId','actorId','tenantId','spaceId','publicKey','label','clientType','issuedAt','expiresAt','nonce','signature']);
  if(grant.protocol!==ENROLL_PROTOCOL||typeof grant.authorityId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(grant.authorityId)||![grant.actorId,grant.tenantId,grant.spaceId,grant.nonce].every(terminalId)||
    typeof grant.label!=='string'||!grant.label.trim()||grant.label.length>80||!/^[a-zA-Z][a-zA-Z0-9_.-]{0,59}$/.test(grant.clientType||'')||
    !Number.isSafeInteger(grant.issuedAt)||!Number.isSafeInteger(grant.expiresAt)||grant.issuedAt>now+10000||grant.expiresAt<=now||grant.expiresAt<=grant.issuedAt||grant.expiresAt-grant.issuedAt>120000||
    typeof grant.publicKey!=='string'||grant.publicKey.length>4096||!verifyFrame(grant,publicKey))throw new RelayFault('AUTH','终端登记授权无效或已过期',401);
  publicIdentity(grant.publicKey);return grant;
}
export function verifyBootstrap(input,type,publicKey,now=Date.now()){
  const keys=type==='enroll'?['protocol','type','grant','nonce','timestamp','signature']:type==='claim'?['protocol','type','code','publicKey','label','clientType','nonce','timestamp','signature']:['protocol','type','code'];
  strictObject(input,keys);if(input.protocol!==BOOTSTRAP_PROTOCOL||input.type!==type)throw new RelayFault('INVALID','接入协议无效');
  if(type==='offer'){if(!/^[A-Za-z0-9_-]{22}$/.test(input.code||''))throw new RelayFault('INVALID','连接码无效');return;}
  if(!terminalId(input.nonce)||!Number.isSafeInteger(input.timestamp)||Math.abs(input.timestamp-now)>30000||!verifyFrame(input,publicKey))throw new RelayFault('AUTH','接入签名无效',401);
}
export {canonical,unsigned};
