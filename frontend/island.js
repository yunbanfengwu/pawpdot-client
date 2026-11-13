const host = window.pawpdotIslandHost;
const island = document.querySelector('#island');
const summary = document.querySelector('#summary');
const activities = document.querySelector('#activities');
const itemsList = document.querySelector('#items');
const closeButton = document.querySelector('#collapse');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canHover = matchMedia('(hover: hover) and (pointer: fine)');
const statusLabels = { info: '', running: '运行中', success: '已完成', error: '需要关注' };
const icons = { info: '·', running: '◷', success: '✓', error: '!' };
const size = { width: 154, height: 42, widthVelocity: 0, heightVelocity: 0 };
let items = [];
let expanded = false;
let pinned = false;
let pointerInside = false;
let hoverTimer, leaveTimer, frame;
let targetWidth = size.width;
let targetHeight = size.height;
let requestedWidth = 202;
let requestedHeight = 42;

function applySettings() {
  const root = document.documentElement;
  root.dataset.islandTheme = 'dark';
  island.style.backgroundColor = '#000000';
  island.style.backgroundImage = 'none';
  island.style.backgroundSize = '';
  island.style.backgroundPosition = '';
}

function requestBounds(width, height) {
  if (requestedWidth === width && requestedHeight === height) return;
  requestedWidth = width;
  requestedHeight = height;
  host.resize(width, height);
}

function draw() {
  const shoulder = size.height > 65 ? Math.min(28, 22 + (size.height - 65) / 22) : 22;
  const width = Math.min(size.width, Math.max(112, innerWidth - shoulder * 2));
  const height = Math.min(size.height, innerHeight);
  const left = (innerWidth - width) / 2;
  const right = left + width;
  const radius = Math.min(24, height * .38);
  const neck = Math.min(shoulder * .72, height - radius - 1);
  island.style.clipPath = 'path("M ' + (left - shoulder) + ' 0 ' +
    'C ' + (left - shoulder * .36) + ' 0 ' + left + ' ' + neck * .45 + ' ' + left + ' ' + neck +
    ' V ' + (height - radius) + ' Q ' + left + ' ' + height + ' ' + (left + radius) + ' ' + height +
    ' H ' + (right - radius) + ' Q ' + right + ' ' + height + ' ' + right + ' ' + (height - radius) +
    ' V ' + neck + ' C ' + right + ' ' + neck * .45 + ' ' + (right + shoulder * .36) + ' 0 ' + (right + shoulder) + ' 0 Z")';
  island.style.setProperty('--island-body-width', width + 'px');
  const reveal = Math.max(0, Math.min(1, (height - 52) / 92));
  summary.style.opacity = String(1 - reveal);
  activities.style.opacity = String(reveal);
}

function settle() {
  size.width = targetWidth;
  size.height = targetHeight;
  size.widthVelocity = size.heightVelocity = 0;
  requestBounds(Math.ceil(targetWidth + (expanded ? 56 : 48)), targetHeight);
  draw();
}

function animate() {
  if (frame) return;
  if (reduceMotion.matches) { settle(); return; }
  let previous;
  const advance = time => {
    const dt = previous ? Math.min((time - previous) / 1000, .033) : 1 / 60;
    previous = time;
    // The same geometry retains its velocity when the pointer reverses direction.
    const steps = Math.ceil(dt * 240);
    const step = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      size.widthVelocity += ((targetWidth - size.width) * 620 - size.widthVelocity * 49) * step;
      size.heightVelocity += ((targetHeight - size.height) * 620 - size.heightVelocity * 49) * step;
      size.width += size.widthVelocity * step;
      size.height += size.heightVelocity * step;
    }
    draw();
    if (Math.abs(size.width - targetWidth) < .4 && Math.abs(size.height - targetHeight) < .4 &&
        Math.abs(size.widthVelocity) < 4 && Math.abs(size.heightVelocity) < 4) {
      frame = undefined;
      settle();
    } else {
      frame = requestAnimationFrame(advance);
    }
  };
  frame = requestAnimationFrame(advance);
}

function resizeIsland() {
  const active = items.find(item => item.status === 'running') ?? items[0];
  targetWidth = expanded ? 460 : active ? 282 : 154;
  targetHeight = expanded ? 260 : 42;
  requestBounds(Math.max(requestedWidth, targetWidth + (expanded ? 56 : 48)),
    Math.max(requestedHeight, targetHeight));
  animate();
}

function setExpanded(value, keyboard = false) {
  if (expanded === value) return;
  expanded = value;
  summary.setAttribute('aria-expanded', String(value));
  activities.inert = !value;
  activities.setAttribute('aria-hidden', String(!value));
  summary.inert = value;
  if (keyboard) {
    if (frame) cancelAnimationFrame(frame);
    frame = undefined;
    resizeIsland();
    if (frame) cancelAnimationFrame(frame);
    frame = undefined;
    settle();
    (value ? closeButton : summary).focus();
  } else {
    resizeIsland();
  }
}

function close(returnFocus = false) {
  clearTimeout(hoverTimer);
  clearTimeout(leaveTimer);
  pinned = false;
  setExpanded(false, returnFocus);
  if (returnFocus) host.returnFocus();
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function render({ context, items: incoming }) {
  items = incoming;
  const active = items.find(item => item.status === 'running') ?? items[0];
  document.querySelector('#summary-title').textContent = active?.title ?? 'PawPdot';
  document.querySelector('#indicator').dataset.status = active?.status ?? 'info';
  const status = document.querySelector('#summary-status');
  const progress = document.querySelector('#summary-progress');
  const percentage = active?.progress;
  progress.hidden = percentage == null;
  if (percentage != null) progress.value = percentage;
  status.textContent = percentage == null ? statusLabels[active?.status] ?? '' : percentage + '%';
  status.hidden = !status.textContent;
  document.querySelector('#chevron').hidden = Boolean(active);
  summary.setAttribute('aria-label', active ? '展开活动，' + active.title + ' ' + status.textContent : '展开活动');
  const page = document.querySelector('#current-page');
  page.textContent = '当前：' + context.label;
  page.title = context.label;

  const focusedKey = document.activeElement?.dataset.activityKey;
  itemsList.replaceChildren(...items.map(item => {
    const row = make('article', 'message');
    row.dataset.status = item.status;
    const icon = make('span', 'message-icon', icons[item.status]);
    icon.setAttribute('aria-hidden', 'true');
    const title = make('span', 'message-title', item.title);
    title.title = item.title;
    const detail = make('span', 'message-detail', [item.source, item.detail || statusLabels[item.status]].filter(Boolean).join(' / '));
    detail.title = detail.textContent;
    const amount = make('span', 'message-progress', item.progress == null ? '' : item.progress + '%');
    row.append(icon, title, amount, detail);
    if (item.canOpen) {
      const open = make('button', 'message-action', '查看');
      open.type = 'button';
      open.dataset.activityKey = item.key;
      open.setAttribute('aria-label', '查看' + item.title);
      open.addEventListener('click', () => {
        close();
        host.open(item.key);
      });
      row.append(open);
    }
    if (item.progress != null) {
      const meter = make('progress');
      meter.max = 100;
      meter.value = item.progress;
      meter.setAttribute('aria-label', item.title + '进度');
      row.append(meter);
    }
    return row;
  }));
  if (!items.length) itemsList.append(make('p', 'empty', '暂无活动'));
  if (focusedKey && expanded) {
    const nextFocus = [...itemsList.querySelectorAll('button')].find(button => button.dataset.activityKey === focusedKey);
    (nextFocus ?? closeButton).focus({ preventScroll: true });
  }
  resizeIsland();
}

island.addEventListener('pointerenter', event => {
  if (!canHover.matches || event.pointerType !== 'mouse') return;
  pointerInside = true;
  clearTimeout(leaveTimer);
  clearTimeout(hoverTimer);
  if (size.height > 42 && !expanded) setExpanded(true);
  else hoverTimer = setTimeout(() => setExpanded(true), 200);
});
island.addEventListener('pointerleave', event => {
  if (event.pointerType !== 'mouse') return;
  pointerInside = false;
  clearTimeout(hoverTimer);
  if (!pinned) leaveTimer = setTimeout(() => {
    if (!pointerInside && !pinned) close();
  }, 120);
});
summary.addEventListener('click', event => {
  clearTimeout(hoverTimer);
  pinned = true;
  setExpanded(true, event.detail === 0);
  if (event.detail) closeButton.focus({ preventScroll: true });
});
closeButton.addEventListener('click', event => {
  close(event.detail === 0);
  if (event.detail) host.returnFocus();
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.key === 'F6') {
    event.preventDefault();
    close(true);
  }
});
window.addEventListener('blur', () => { if (!pointerInside) close(); });
window.addEventListener('resize', draw);
host.onSnapshot(render);
host.onFocus(() => (expanded ? closeButton : summary).focus());
host.onSettings(applySettings);
host.getSettings().then(applySettings).catch(() => {});
draw();
host.ready();

