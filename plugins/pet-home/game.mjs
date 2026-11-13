import { randomUUID } from 'node:crypto';
import { furniture, destinations, validPlacement } from './catalog.mjs';

const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const starter = () => ({ revision: 0, coins: 120, ambience: 'day', trip: null, journeys: [], souvenirs: {}, requests: [], items: [
  { id: randomUUID(), type: 'sofa', x: -1.3, z: -1.9, rotation: 0, placed: true },
  { id: randomUUID(), type: 'plant', x: 2.9, z: -2, rotation: 0, placed: true },
  { id: randomUUID(), type: 'rug', x: -.6, z: .3, rotation: 0, placed: true },
  { id: randomUUID(), type: 'table', x: -1.3, z: -.3, rotation: 0, placed: true },
  { id: randomUUID(), type: 'shelf', x: -3.1, z: -1.6, rotation: 1, placed: true },
  { id: randomUUID(), type: 'lamp', x: 2.8, z: 1.8, rotation: 0, placed: true },
] });

export function createHomeGame(store, companion, now = Date.now) {
  async function snapshot() {
    const pet = companion.getSnapshot().companion;
    if (!pet) return { pet: null, home: null, furniture, destinations, now: now() };
    await store.update(state => {
      state.homes ??= {};
      const home = state.homes[pet.id] ??= starter();
      const trip = home.trip;
      if (!trip || trip.endsAt > now()) return;
      const destination = destinations.find(entry => entry.id === trip.destination);
      home.coins += destination.reward;
      home.souvenirs[destination.id] = (home.souvenirs[destination.id] ?? 0) + 1;
      home.journeys.unshift({ ...trip, returnedAt: trip.endsAt, souvenir: destination.souvenir });
      home.journeys = home.journeys.slice(0, 50);
      home.trip = null;
      home.revision++;
    });
    return { pet, home: store.snapshot().homes[pet.id], furniture, destinations, now: now() };
  }

  return {
    snapshot,
    async act(input) {
      const current = await snapshot();
      if (!current.pet) fail('请先领养宠物');
      if (input.companionId !== current.pet.id) fail('当前宠物已切换，请刷新后重试', 409);
      if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) fail('请求编号无效');
      await store.update(state => {
        const home = state.homes[current.pet.id];
        if (home.requests.includes(input.requestId)) return;
        if (input.action === 'buy') {
          const item = furniture.find(item => item.id === input.type);
          if (!item) fail('家具不存在');
          if (home.items.length >= 80) fail('家具仓库已满');
          if (home.coins < item.price) fail('旅途币不足，完成旅行后可获得');
          home.coins -= item.price;
          home.items.push({ id: randomUUID(), type: item.id, x: 0, z: 0, rotation: 0, placed: false });
        } else if (input.action === 'place' || input.action === 'store') {
          if (input.revision !== home.revision) fail('房间已在其他窗口更新，请重试', 409);
          const item = home.items.find(item => item.id === input.itemId);
          if (!item) fail('家具不存在');
          if (input.action === 'store') item.placed = false;
          else {
            if (![input.x, input.z].every(Number.isFinite) || !Number.isInteger(input.rotation) || input.rotation < 0 || input.rotation > 3) fail('摆放位置无效');
            const next = { ...item, x: Math.round(input.x * 4) / 4, z: Math.round(input.z * 4) / 4, rotation: input.rotation, placed: true };
            if (!validPlacement(next, home.items)) fail('这里放不下，换个空位试试');
            Object.assign(item, next);
          }
        } else if (input.action === 'travel') {
          if (home.trip) fail('宠物正在旅行');
          const destination = destinations.find(entry => entry.id === input.destination);
          if (!destination) fail('目的地不存在');
          home.trip = { id: randomUUID(), destination: destination.id, startedAt: now(), endsAt: now() + destination.duration };
        } else if (input.action === 'ambience') {
          if (!['day', 'evening', 'rain'].includes(input.ambience)) fail('氛围不存在');
          home.ambience = input.ambience;
        } else if (input.action === 'return') {
          // Returning early keeps the room available and grants no completion reward.
          home.trip = null;
        } else fail('操作不存在');
        home.revision++;
        home.requests.push(input.requestId);
        home.requests = home.requests.slice(-100);
      });
      return snapshot();
    },
  };
}
