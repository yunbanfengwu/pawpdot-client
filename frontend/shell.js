const root = document.documentElement;
const state = new URLSearchParams(location.search).get('state');
if (state === 'chrome') root.dataset.chrome = '';
root.dataset.workbenchTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const maximize = document.querySelector('#maximize');
const [maximizeIcon, restoreIcon] = maximize.querySelectorAll('svg');

maximize.addEventListener('click', () => window.pawpdotWindow.toggleMaximize());
window.pawpdotWindow.onWindowLayout(inset => {
  root.style.setProperty('--trailing-inset', inset + 'px');
});
window.pawpdotWindow.onWindowState(maximized => {
  root.toggleAttribute('data-pawpdot-maximized', maximized);
  const label = maximized ? '还原' : '最大化';
  maximize.setAttribute('aria-label', label);
  maximize.title = label;
  maximizeIcon.toggleAttribute('hidden', maximized);
  restoreIcon.toggleAttribute('hidden', !maximized);
});

window.pawpdotWindow.onWorkbenchTheme(theme => {
  root.dataset.workbenchTheme = theme;
});

window.pawpdotWindow.onWorkbenchReady(() => {
  document.body.style.visibility = 'hidden';
  document.querySelector('.launch-content').hidden = true;
  document.querySelector('.titlebar').inert = true;
});

const caption = document.querySelector('.titlebar-drag');
let pressed;
let moved = false;

caption.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  pressed = { id: event.pointerId, x: event.screenX, y: event.screenY };
  moved = false;
  caption.setPointerCapture(event.pointerId);
  window.pawpdotWindow.startDrag();
});
function moveWindow(event) {
  if (event.pointerId !== pressed?.id) return;
  const dx = event.screenX - pressed.x;
  const dy = event.screenY - pressed.y;
  moved ||= Math.max(Math.abs(dx), Math.abs(dy)) > 4;
  if (moved) window.pawpdotWindow.moveDrag(dx, dy);
}
caption.addEventListener('pointermove', moveWindow);
caption.addEventListener('pointerup', moveWindow);
caption.addEventListener('lostpointercapture', event => {
  if (event.pointerId !== pressed?.id) return;
  pressed = undefined;
  window.pawpdotWindow.endDrag();
});
caption.addEventListener('dblclick', () => {
  if (!moved) window.pawpdotWindow.toggleMaximize();
});

document.querySelector('#minimize').addEventListener('click', () => window.pawpdotWindow.minimize());
document.querySelector('#close').addEventListener('click', () => window.pawpdotWindow.close());

if (state === 'error') {
  document.querySelector('#status').textContent = '无法启动本地工作台';
  const retry = document.querySelector('#retry');
  retry.hidden = false;
  retry.addEventListener('click', () => window.pawpdotWindow.retry());
}
