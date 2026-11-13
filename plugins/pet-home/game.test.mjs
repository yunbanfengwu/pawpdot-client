import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../../frontend/pet/storage.mjs';
import { createCompanionService } from '../../frontend/pet/core.mjs';
import { createHomeGame } from './game.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pawpdot-pet-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const coreStore = await openStore(join(directory, 'pet.json'), { selected: 'fox' });
  const pet = await createCompanionService(coreStore);
  const file = join(directory, 'home.json');
  const store = await openStore(file, { version: 1, homes: {} });
  let now = 1000000;
  const game = createHomeGame(store, pet, () => now);
  const command = async values => {
    const state = await game.snapshot();
    return { companionId: state.pet.id, revision: state.home.revision, requestId: randomUUID(), ...values };
  };
  return { game, pet, store, file, command, time: value => { now = value; } };
}

test('legacy adoption keeps one identity and each pet owns a separate home', async t => {
  const { game, pet } = await fixture(t);
  const fox = await game.snapshot();
  await pet.adopt('toy-cat');
  const cat = await game.snapshot();
  assert.notEqual(cat.pet.id, fox.pet.id);
  await pet.adopt('fox');
  assert.equal((await game.snapshot()).pet.id, fox.pet.id);
});

test('concurrent retries charge once and purchases survive reopening', async t => {
  const { game, pet, file, command } = await fixture(t);
  const before = await game.snapshot();
  const purchase = await command({ action: 'buy', type: 'plant' });
  await Promise.all([game.act(purchase), game.act(purchase)]);
  const reopened = createHomeGame(await openStore(file, {}), pet);
  const state = await reopened.snapshot();
  assert.equal(state.home.coins, 108);
  assert.equal(state.home.items.length, before.home.items.length + 1);
});

test('invalid placement and stale edits preserve furniture and coins', async t => {
  const { game, command } = await fixture(t);
  const before = await game.snapshot();
  await assert.rejects(game.act(await command({ action: 'place', itemId: before.home.items[0].id, x: 20, z: 20, rotation: 0 })), /放不下/);
  await assert.rejects(game.act(await command({ action: 'store', itemId: before.home.items[0].id, revision: -1 })), /其他窗口/);
  assert.deepEqual((await game.snapshot()).home, before.home);
});

test('offline travel rewards settle once even across concurrent snapshots', async t => {
  const { game, command, time } = await fixture(t);
  await game.act(await command({ action: 'travel', destination: 'forest' }));
  assert.equal((await game.snapshot()).home.coins, 120);
  time(1060001);
  await Promise.all([game.snapshot(), game.snapshot(), game.snapshot()]);
  const home = (await game.snapshot()).home;
  assert.equal(home.coins, 145);
  assert.equal(home.souvenirs.forest, 1);
  assert.equal(home.journeys.length, 1);
  assert.equal(home.trip, null);
});

test('switching pets rejects a delayed command from another pet', async t => {
  const { game, pet, command } = await fixture(t);
  const purchase = await command({ action: 'buy', type: 'sofa' });
  await pet.adopt('toy-cat');
  await assert.rejects(game.act(purchase), /已切换/);
  assert.equal((await game.snapshot()).home.coins, 120);
});
