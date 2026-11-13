import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, Mesh, OrthographicCamera,
  PCFSoftShadowMap, PlaneGeometry, Scene, ShadowMaterial, WebGLRenderer } from 'three';
import { loadCompanion } from './actor.mjs';
import { pets } from '../catalog.mjs';

const canvas = document.querySelector('canvas');
const params = new URLSearchParams(location.search);
const thumbnail = params.has('thumbnail');
const still = thumbnail || params.has('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const preview = params.has('preview');
let renderer, actor, frame, observer, last = 0;

async function start() {
  const pet = pets.find(pet => pet.id === params.get('pet')) ?? pets[1];
  renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  if (thumbnail || preview) scene.background = new Color('#edf1e8');
  const camera = new OrthographicCamera(-2, 2, 1.55, -1.55, .1, 40);
  camera.position.set(3, 2.1, 5); camera.lookAt(0, .5, 0);
  scene.add(new HemisphereLight(0xe8f2ff, 0xb6aa90, 2));
  const key = new DirectionalLight(0xffe4bc, 3.5); key.position.set(-3, 5, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.normalBias = .025; scene.add(key);
  const rim = new DirectionalLight(0xc2d8ff, 1.7); rim.position.set(2, 3, -4); scene.add(rim);
  const floor = new Mesh(new PlaneGeometry(20, 20), new ShadowMaterial({ opacity: .18 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.005; floor.receiveShadow = true; scene.add(floor);
  actor = await loadCompanion(pet, 1.25); scene.add(actor.root); actor.root.rotation.y = .4;
  function draw() { renderer.render(scene, camera); }
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(width, height, false);
    const half = Math.max(1.25, 1.9 / (width / height));
    camera.top = half; camera.bottom = -half; camera.left = -half * width / height; camera.right = -camera.left;
    camera.updateProjectionMatrix(); draw();
  }
  observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (document.hidden || now - last < 1000 / 30) return;
    actor.update(Math.min((now - (last || now)) / 1000, .07), .62); last = now; draw();
  }
  if (!still) frame = requestAnimationFrame(tick);
  if (preview) {
    const controls = document.createElement('nav'); controls.setAttribute('aria-label', '预览动作'); controls.className = 'actions';
    for (const [action, label] of [['idle','待机'],['walk','走路'],['run','奔跑'],['eat','进食'],['sleep','休息'],['jump','跳跃']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.onclick = () => { actor.play(action, action === 'jump'); if (still) { actor.update(.4, .62); draw(); } };
      controls.append(button);
    }
    document.body.append(controls);
  }
  window.petPreview = { clips: actor.clips, select: action => actor.play(action), capture: () => { draw(); return canvas.toDataURL('image/png'); } };
  document.documentElement.dataset.petReady = pet.id;
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame); observer.disconnect(); actor.dispose();
    floor.geometry.dispose(); floor.material.dispose(); key.shadow.map?.dispose(); renderer.dispose();
  });
}
start().catch(error => {
  document.documentElement.dataset.petError = error.message;
  const status = document.createElement('p'); status.setAttribute('role', 'alert'); status.textContent = '宠物未能加载，请重新打开预览'; document.body.append(status);
  console.error(error);
});
