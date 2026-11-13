import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRelayIdentity, signFrame} from './node-identity.mjs';
import {ENROLL_PROTOCOL, verifyGrant} from './enrollment.mjs';
test('签发授权拒绝倒置有效期、到期边界、超长租约、错误签发方及正文篡改', () => {
  const issuer = createRelayIdentity(), terminal = createRelayIdentity(), now = Date.now();
  const input = {protocol: ENROLL_PROTOCOL, authorityId: 'test-authority', actorId: randomUUID(), tenantId: randomUUID(), spaceId: randomUUID(), publicKey: terminal.publicKey, label: '合成终端', clientType: 'custom', issuedAt: now, expiresAt: now + 120000, nonce: randomUUID()};
  const valid = signFrame(input, issuer.privateKey); assert.equal(verifyGrant(valid, issuer.publicKey, now).expiresAt, now + 120000);
  for (const fields of [{issuedAt: now + 5000, expiresAt: now + 1000}, {expiresAt: now}, {expiresAt: now + 120001}]) assert.throws(() => verifyGrant(signFrame({...input, ...fields}, issuer.privateKey), issuer.publicKey, now));
  assert.throws(() => verifyGrant(valid, terminal.publicKey, now));
  assert.throws(() => verifyGrant({...valid, actorId: randomUUID()}, issuer.publicKey, now));
});
