import { randomUUID } from 'node:crypto';
import { pets } from './catalog.mjs';

export async function createCompanionService(store) {
  const listeners = new Set();
  const games = new Map();
  await store.update(state => {
    state.version = 2;
    state.companions ??= [];
    // The first homepage experience is the prepared indoor room with the small cat.
    // Keep an existing selection untouched, but give a fresh profile a visible companion.
    if (!state.selected && state.companions.length === 0) state.selected = 'toy-cat';
    if (state.selected && pets.some(pet => pet.id === state.selected) && !state.companions.some(pet => pet.species === state.selected)) {
      state.companions.push({ id: randomUUID(), species: state.selected, adoptedAt: new Date().toISOString() });
    }
  });
  const snapshot = () => {
    const state = store.snapshot();
    const companions = state.companions.map(companion => ({ ...pets.find(pet => pet.id === companion.species), ...companion }));
    return { version: 2, selected: state.selected ?? null, pets, companions,
      companion: companions.find(pet => pet.species === state.selected) ?? null,
      games: [...games.values()] };
  };
  return {
    getSnapshot: snapshot,
    async adopt(species) {
      if (!pets.some(pet => pet.id === species)) throw Object.assign(Error('请选择可领养的宠物'), { status: 400 });
      await store.update(state => {
        if (!state.companions.some(pet => pet.species === species)) {
          state.companions.push({ id: randomUUID(), species, adoptedAt: new Date().toISOString() });
        }
        state.selected = species;
      });
      for (const listen of listeners) listen();
      return snapshot();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    registerGame(game) {
      games.set(game.id, { id: game.id, title: game.title, href: game.href });
      return () => games.delete(game.id);
    },
  };
}
