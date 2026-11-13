import {generateKeyPairSync,createPublicKey,sign,verify,randomUUID} from 'node:crypto';
import {canonical,unsigned,RelayFault} from './envelope.mjs';
export function createRelayIdentity() {
  const {publicKey,privateKey} = generateKeyPairSync('ed25519');
  return {publicKey: publicKey.export({type:'spki',format:'pem'}).toString(), privateKey: privateKey.export({type:'pkcs8',format:'pem'}).toString()};
}
export function publicIdentity(pem) {
  try { const key=createPublicKey(pem); if(key.asymmetricKeyType!=='ed25519')throw Error(); return key; }
  catch { throw new RelayFault('INVALID_KEY','终端需要 Ed25519 公钥'); }
}
export function signFrame(value, privateKey) { return {...unsigned(value),signature:sign(null,Buffer.from(canonical(unsigned(value))),privateKey).toString('base64url')}; }
export function verifyFrame(value, publicKey) {
  try { return verify(null,Buffer.from(canonical(unsigned(value))),publicIdentity(publicKey),Buffer.from(value.signature,'base64url')); }
  catch { return false; }
}
export const frameId = () => randomUUID();
