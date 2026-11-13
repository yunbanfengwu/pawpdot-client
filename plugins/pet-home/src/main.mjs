import { createWorld } from './scene.mjs';

const byId = id => document.getElementById(id);
const panel = byId('panel');
let snapshot, busy = false, selected = null, editing = false, activePanel = '', timer, messageTimer;
let dead = false, polling = false, clockOffset = 0;
const channel = new BroadcastChannel('pawpdot-pet-home');
const petChannel = new BroadcastChannel('pawpdot-pet');

function message(text) {
  byId('message').textContent = text;
  byId('message').hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { byId('message').hidden = true; }, 4000);
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, callback, primary = false) {
  const node = element('button', text, primary ? 'primary' : '');
  node.type = 'button';
  node.disabled = busy;
  node.addEventListener('click', callback);
  return node;
}

async function api(input) {
  const response = await fetch('/api/pawpdot/pet-home', input
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) }
    : { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw Error('家园服务尚未就绪，请确认主宠物插件已启用');
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '家园暂不可用');
  return result;
}

const world = createWorld(byId('scene'), {
  onStatus: text => { byId('behavior').textContent = text; },
  onSelection: id => selectFurniture(id),
  onPlace: (id, x, z) => {
    const item = snapshot.home.items.find(item => item.id === id);
    if (item) void mutate({ action: 'place', itemId: id, x, z, rotation: item.rotation });
  },
  onPet: () => { byId('pet-actions').hidden = !byId('pet-actions').hidden; },
});

async function apply(next) {
  const before = snapshot?.home?.revision;
  const beforePet = snapshot?.pet?.id;
  const wasTraveling = Boolean(snapshot?.home?.trip);
  const returnedHome = wasTraveling && !next.home?.trip;
  snapshot = next;
  clockOffset = next.now - Date.now();
  byId('pet-name').textContent = next.pet ? next.pet.name + '的家' : '你的伙伴，自己的小世界';
  byId('empty').hidden = Boolean(next.pet);
  byId('wallet').hidden = !next.home;
  byId('coins').textContent = next.home?.coins ?? 0;
  byId('retry').hidden = true;
  document.documentElement.dataset.ambience = next.home?.ambience ?? 'day';
  byId('ambience').disabled = !next.pet || busy;
  byId('ambience').textContent = { day: '切换暮色', evening: '切换雨夜', rain: '切换日光' }[next.home?.ambience ?? 'day'];
  byId('furnish').disabled = !next.pet || busy || Boolean(next.home?.trip);
  byId('travel').disabled = !next.pet || busy || Boolean(next.home?.trip);
  byId('trip-status').hidden = !next.home?.trip;
  const location = next.destinations.find(entry => entry.id === next.home?.trip?.destination);
  byId('location').textContent = location?.name ?? '阳光小屋';
  if (returnedHome) {
    // Returning early or finishing a trip must dismiss the travel dialog.
    // Otherwise the home scene is rebuilt underneath an already-open travel
    // catalog, making both views appear at once.
    panel.close();
    activePanel = '';
    finishEdit();
  } else if (beforePet !== next.pet?.id || location) finishEdit();
  await world.setState(next);
  if (!returnedHome && panel.open && (before !== next.home?.revision || beforePet !== next.pet?.id)) renderPanel();
  document.documentElement.dataset.worldReady = 'true';
  updateCountdown();
}

async function refresh() {
  if (dead || polling) return;
  polling = true;
  try { await apply(await api()); }
  catch (error) { message(error.message); if (!snapshot) byId('retry').hidden = false; }
  finally {
    polling = false;
    clearTimeout(timer);
    if (!dead) timer = setTimeout(refresh, snapshot?.home?.trip ? 2500 : 12000);
  }
}

async function mutate(input) {
  if (busy || !snapshot?.pet) return false;
  busy = true;
  const request = { ...input, requestId: crypto.randomUUID(), companionId: snapshot.pet.id, revision: snapshot.home.revision };
  document.querySelectorAll('dialog button:not(#close-panel)').forEach(node => { node.disabled = true; });
  try {
    let result;
    try { result = await api(request); }
    catch (error) {
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
      result = await api(request);
    }
    busy = false;
    await apply(result);
    channel.postMessage('changed');
    if (input.action === 'buy') message('家具已放入仓库，选择它来摆放');
    if (input.action === 'place') message('家具位置已保存');
    if (input.action === 'travel') { panel.close(); finishEdit(); message('出发了，旅行期间也可以去工作'); }
    return true;
  } catch (error) { message(error.message); await refresh(); return false; }
  finally { busy = false; if (panel.open) renderPanel(); }
}

function selectFurniture(id) {
  const item = snapshot?.home?.items.find(item => item.id === id);
  if (!item) return;
  selected = id; editing = true;
  world.edit(true, id);
  byId('selection').hidden = false;
  byId('pet-actions').hidden = true;
  byId('selection-name').textContent = snapshot.furniture.find(entry => entry.id === item.type).name + ' · 点地面摆放';
}

function finishEdit() {
  selected = null; editing = false;
  world.edit(false);
  byId('selection').hidden = true;
}

function renderFurniture() {
  const content = byId('panel-content');
  const list = element('div', '', 'catalog');
  for (const item of snapshot.furniture) {
    const card = element('article');
    const image = element('img');
    image.src = 'assets/' + item.model + '.webp'; image.alt = item.name;
    card.append(image, element('h3', item.name), element('p', item.price + ' 旅途币'));
    const buy = button('添置', () => mutate({ action: 'buy', type: item.id }), true);
    buy.disabled = busy || snapshot.home.coins < item.price;
    card.append(buy); list.append(card);
  }
  const inventory = element('section', '', 'inventory');
  inventory.append(element('h3', '我的家具'));
  const items = element('div', '', 'inventory-list');
  for (const item of snapshot.home.items) {
    const name = snapshot.furniture.find(entry => entry.id === item.type).name;
    items.append(button(name + (item.placed ? ' · 调整' : ' · 摆放'), () => { panel.close(); selectFurniture(item.id); }));
  }
  inventory.append(items); content.append(list, inventory);
}

function renderTravel() {
  const content = byId('panel-content');
  const list = element('div', '', 'destinations');
  const images = { forest: 'tree-pinedefaulta', coast: 'rock-smalla', hills: 'tree-oak' };
  for (const destination of snapshot.destinations) {
    const card = element('article', '', 'destination');
    const image = element('img'); image.src = 'assets/' + images[destination.id] + '.webp'; image.alt = destination.name;
    const description = element('div');
    description.append(element('h3', destination.name), element('p', destination.description), element('small', Math.round(destination.duration / 1000) + ' 秒 · 带回 ' + destination.reward + ' 旅途币'));
    const start = button('出发', () => mutate({ action: 'travel', destination: destination.id }), true);
    start.disabled = busy || Boolean(snapshot.home.trip);
    card.append(image, description, start); list.append(card);
  }
  const journal = element('div', '', 'journal');
  for (const destination of snapshot.destinations) {
    const count = snapshot.home.souvenirs[destination.id];
    if (count) journal.append(element('span', destination.souvenir + ' × ' + count));
  }
  content.append(list, journal);
}

function renderPanel() {
  byId('panel-content').replaceChildren();
  if (!snapshot?.home) return;
  byId('panel-title').textContent = activePanel === 'furniture' ? '给家添一点喜欢' : '一起去看新风景';
  byId('panel-description').textContent = activePanel === 'furniture'
    ? '添置后放入仓库。选择家具，再点击房间地面摆放，位置会自动保存。'
    : '旅行结束会带回纪念品和旅途币。离开首页去工作，也会按时完成。';
  if (activePanel === 'furniture') renderFurniture(); else renderTravel();
}

function openPanel(kind) {
  if (!snapshot?.pet) return parent.postMessage({ type: 'pawpdot:pet-market' }, location.origin);
  activePanel = kind; renderPanel();
  if (!panel.open) panel.showModal();
}

function updateCountdown() {
  const trip = snapshot?.home?.trip;
  if (!trip) return;
  const remaining = Math.max(0, Math.ceil((trip.endsAt - Date.now() - clockOffset) / 1000));
  byId('trip-text').textContent = remaining ? '还有 ' + remaining + ' 秒回家' : '正在带着纪念品回家';
  if (!remaining && !polling) void refresh();
}

byId('furnish').onclick = () => openPanel('furniture');
byId('travel').onclick = () => openPanel('travel');
byId('market').onclick = byId('adopt').onclick = () => parent.postMessage({ type: 'pawpdot:pet-market' }, location.origin);
byId('work').onclick = () => { world.act('idle'); parent.postMessage({ type: 'pawpdot:work' }, location.origin); };
byId('expand').textContent = new URLSearchParams(location.search).has('full') ? '返回对话' : '专注家园';
byId('expand').onclick = () => parent.postMessage({ type: 'pawpdot:expand-world' }, location.origin);
byId('ambience').onclick = () => mutate({ action: 'ambience', ambience: {day:'evening',evening:'rain',rain:'day'}[snapshot.home.ambience ?? 'day'] });
byId('retry').onclick = refresh;
byId('close-panel').onclick = () => panel.close();
byId('finish-edit').onclick = finishEdit;
byId('rotate').onclick = () => {
  const item = snapshot.home.items.find(item => item.id === selected);
  if (item) void mutate({ action: 'place', itemId: item.id, x: item.x, z: item.z, rotation: (item.rotation + 1) % 4 });
};
byId('put-away').onclick = async () => { if (await mutate({ action: 'store', itemId: selected })) finishEdit(); };
byId('return').onclick = () => mutate({ action: 'return' });
document.querySelectorAll('[data-pet-action]').forEach(node => { node.onclick = () => { world.act(node.dataset.petAction); byId('pet-actions').hidden = true; }; });
channel.onmessage = petChannel.onmessage = refresh;
const countdown = setInterval(updateCountdown, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin) return;
  if (event.data?.type === 'pawpdot:window-drag' || event.data?.type === 'pawpdot:window-resize') {
    world.setPaused(Boolean(event.data.dragging ?? event.data.resizing));
    return;
  }
  if (event.data?.type !== 'pawpdot:scene-obstacles') return;
  const rects = event.data.rects;
  if (!Array.isArray(rects) || rects.length > 64) return;
  world.setObstacles(rects.filter(rect => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)));
});
window.addEventListener('pagehide', () => {
  dead = true; clearTimeout(timer); clearTimeout(messageTimer); clearInterval(countdown);
  channel.close(); petChannel.close(); world.dispose();
});
window.pawpdotWorld = { stats: world.stats };
parent.postMessage({ type: 'pawpdot:scene-ready' }, location.origin);
void refresh();
