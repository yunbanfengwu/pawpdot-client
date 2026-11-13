import {
  ACESFilmicToneMapping, Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Color, CylinderGeometry, DirectionalLight,
  Fog, Group, HemisphereLight, InstancedMesh, MathUtils, Mesh, MeshStandardMaterial,
  Object3D, OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, PMREMGenerator, Raycaster, Scene,
  SphereGeometry, Vector2, Vector3, WebGLRenderer, PointLight, LineSegments, LineBasicMaterial,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { loadCompanion } from '../../../frontend/pet/src/actor.mjs';
import { furniture, footprint } from '../catalog.mjs';
import { woodTexture, weaveTexture } from './materials.mjs';

export function createWorld(canvas, { onStatus, onSelection, onPlace, onPet }) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.15));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new Scene();
  // Keep the home scene visually continuous with the shell's white surface.
  // The room, furniture and lighting still provide the depth; the horizon
  // should not introduce a separate green panel behind the world.
  scene.background = null;
  scene.fog = new Fog('#ffffff', 24, 50);
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, .04);
  scene.environment = environmentMap.texture; scene.environmentIntensity = .32;
  environment.dispose(); pmrem.dispose();
  const camera = new OrthographicCamera(-8, 8, 6, -6, .1, 100);
  camera.position.set(11, 10, 13);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, .25, 0);
  controls.enablePan = false;
  controls.minZoom = .75;
  controls.maxZoom = 1.65;
  controls.minPolarAngle = .55;
  controls.maxPolarAngle = 1.22;
  controls.enableDamping = true;
  controls.mouseButtons.LEFT = null;
  controls.update();
  const hemisphere = new HemisphereLight(0xf0f7ff, 0xc4b897, 1.5); scene.add(hemisphere);
  const sun = new DirectionalLight(0xffe6bd, 3.4);
  sun.position.set(-4, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: .5, far: 30 });
  sun.shadow.normalBias = .035;
  sun.shadow.bias = -.0001;
  scene.add(sun);
  const fill = new DirectionalLight(0xc5dfff, 1.1);
  fill.position.set(5, 4, -5);
  scene.add(fill);
  const windowLight = new PointLight(0xffd396, 0, 12, 2); windowLight.position.set(.9, 2, -2.3); scene.add(windowLight);
  const roomLight = new PointLight(0xffddb1, 0, 10, 2); roomLight.position.set(-2, 2.8, 1); scene.add(roomLight);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const ao = new SSAOPass(scene, camera, 512, 512, 12);
  ao.kernelRadius = .32; ao.minDistance = .001; ao.maxDistance = .12;
  const output = new OutputPass();
  const bloom = new UnrealBloomPass(new Vector2(512,512), .22, .4, 1.1);
  composer.addPass(renderPass); composer.addPass(ao); composer.addPass(bloom); composer.addPass(output);
  const stage = new Group();
  const furnishings = new Group();
  scene.add(stage, furnishings);
  const loader = new GLTFLoader();
  const assets = new Map();
  const materials = new Map();
  const material = (color, roughness = .8) => {
    const key = color + ':' + roughness;
    if (!materials.has(key)) materials.set(key, new MeshStandardMaterial({ color, roughness }));
    return materials.get(key);
  };
  const cream = material('#f4eedc');
  const trim = material('#f9f7e9');
  const wood = material('#bc916d');
  const moss = material('#a5b191');
  const grain = woodTexture(), weave = weaveTexture();
  const texturedWood = material('#e8d4b0'); texturedWood.map = grain; texturedWood.roughness = .68;
  const fabric = material('#d6aa97'); fabric.map = weave; fabric.roughness = .96;
  const darkFabric = material('#b3917b'); darkFabric.map = weave;
  const rainPositions = new Float32Array(240 * 6);
  for (let index = 0; index < 240; index++) {
    const x = Math.sin(index * 79.1) * 8, z = Math.cos(index * 31.7) * 6;
    rainPositions.set([x, (index % 13) * .42, z, x-.04, (index % 13) * .42+.18, z], index*6);
  }
  const rainGeometry = new BufferGeometry(); rainGeometry.setAttribute('position', new Float32BufferAttribute(rainPositions, 3));
  const rainMaterial = new LineBasicMaterial({ color: '#becfdd', transparent: true, opacity: .2, depthWrite: false });
  const rain = new LineSegments(rainGeometry, rainMaterial); rain.visible = false; scene.add(rain);
  let actor, state, location = '', generation = 0, furnitureGeneration = 0, furnitureSignature = '';
  let editing = false, selected = null, disposed = false, path = [], activityTime = 0, restUntil = 3;
  let behavior = 'idle', yaw = 0, frame, last = 0, nextFrame = 0, elapsed = 0, paused = false, resizePending = false, atmosphereKey = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const movement = new Vector3();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let obstacles = [];
  const projected = new Vector3();
  const floor = new Mesh(new PlaneGeometry(8, 6), material('#fff'));
  floor.rotation.x = -Math.PI / 2;
  floor.material.visible = false;
  scene.add(floor);

  function box(parent, size, position, surface, radius = 0) {
    const mesh = new Mesh(radius ? new RoundedBoxGeometry(...size, 2, radius) : new BoxGeometry(...size), surface);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.generated = true;
    parent.add(mesh);
    return mesh;
  }

  async function model(name) {
    if (!assets.has(name)) assets.set(name, loader.loadAsync('assets/' + name + '.glb').then(asset => asset.scene));
    return assets.get(name);
  }

  async function prop(parent, name, x, z, width, rotation = 0, y = 0) {
    const version = parent.userData.version;
    const source = await model(name);
    if (disposed || !parent.parent || parent.userData.version !== version) return;
    const root = new Group();
    const object = source.clone(true);
    const bounds = new Box3().setFromObject(object);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    object.position.set(-center.x, -bounds.min.y, -center.z);
    root.add(object);
    root.scale.setScalar(width / Math.max(size.x, size.z));
    root.rotation.y = rotation;
    root.position.set(x, y, z);
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      const style = surface => surface.name === 'carpet' ? fabric : surface.name === 'carpetDarker' ? darkFabric : surface;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(style) : style(mesh.material);
    });
    parent.add(root);
    return root;
  }

  function clear(group) {
    group.userData.version = (group.userData.version ?? 0) + 1;
    // Shared GLB geometry stays in the asset cache until the renderer is disposed.
    for (const child of [...group.children]) {
      child.removeFromParent();
      child.traverse(object => { if (object.userData.generated && object.geometry) object.geometry.dispose(); });
    }
  }

  function buildHome() {
    scene.background = null;
    box(stage, [12.3, .3, 9.1], [0, -.63, .25], material('#aab797'), .4);
    box(stage, [8.8, .35, 6.8], [0, -.24, 0], wood, .12);
    const floorboards = new InstancedMesh(new BoxGeometry(.49, .08, 6.35), texturedWood, 17);
    const dummy = new Object3D();
    for (let index = 0; index < 17; index++) {
      dummy.position.set(-4 + index * .5, -.025, 0);
      dummy.updateMatrix();
      floorboards.setMatrixAt(index, dummy.matrix);
      floorboards.setColorAt(index, new Color(index % 3 === 0 ? '#e7d1af' : index % 3 === 1 ? '#d9bd96' : '#e2c8a3'));
    }
    floorboards.receiveShadow = true;
    floorboards.userData.generated = true;
    stage.add(floorboards);
    box(stage, [.18, 2.6, 6.7], [-4.24, 1.25, 0], moss, .025);
    box(stage, [8.5, 2.6, .18], [0, 1.25, -3.25], cream, .025);
    box(stage, [8.5, .13, .15], [0, .09, -3.12], trim);
    box(stage, [.15, .13, 6.6], [-4.1, .09, 0], trim);
    // A recessed window and its frame give the sunlight a visible architectural source.
    box(stage, [2.3, 1.4, .06], [.9, 1.65, -3.13], material('#a9c9cc'));
    for (const x of [-.35, .9, 2.15]) box(stage, [.09, 1.58, .16], [x, 1.65, -3.04], trim);
    for (const y of [.86, 1.65, 2.44]) box(stage, [2.58, .09, .16], [.9, y, -3.04], trim);
    box(stage, [2.8, .12, .42], [.9, .85, -2.98], wood, .025);
    box(stage, [.08, 1.1, 1], [-4.1, 1.7, -1.4], wood);
    box(stage, [.1, .88, .78], [-4.04, 1.7, -1.4], material('#eee2bc'));
    // Garden plants frame the cutaway without covering the room or its controls.
    void prop(stage, 'tree-oak', -5.1, -2.8, 1.6, 0, -.4).catch(reportAssetError);
    void prop(stage, 'tree-pinedefaulta', 4.9, -3.8, 1.3).catch(reportAssetError);
    void prop(stage, 'pottedplant', -4.9, 2.3, .9).catch(reportAssetError);
    for (const [x, z, size] of [[-5.1,.4,.75],[-4.9,1.5,.6],[4.9,-2,.65],[4.9,2,.6]]) {
      void prop(stage, 'plant-bush', x, z, size, 0, -.42).catch(reportAssetError);
      void prop(stage, 'flower-yellowa', x + .3, z + .4, .3, 0, -.42).catch(reportAssetError);
    }
    for (let index = 0; index < 4; index++) box(stage, [.65, .06, .48], [4.8, -.43, 1.5 - index * .75], material('#e0dbbd'), .1);
    // Small everyday objects establish scale and give the home a lived-in composition.
    box(stage, [1.2, .08, .3], [-4, 1.32, 1.1], wood, .02).rotation.y = Math.PI / 2;
    for (let index = 0; index < 5; index++) box(stage, [.16, .3 + index % 2 * .08, .2], [-3.94, 1.5, .72 + index * .16], material(['#b3b99f','#bdb295','#a1b0aa','#d1b6a0','#d4c5a4'][index]), .01);
    const sunArt = new Mesh(new SphereGeometry(.19, 24, 16), material('#d1a465'));
    sunArt.scale.x = .08; sunArt.position.set(-3.97, 1.8, -1.4); stage.add(sunArt);
  }

  function buildTravel(destination) {
    const coast = destination === 'coast';
    const hills = destination === 'hills';
    const ground = material(coast ? '#dfcfa9' : hills ? '#b6ba85' : '#a5b795');
    scene.background.set(coast ? '#e1edf0' : hills ? '#f0e6d6' : '#e4ecdf');
    box(stage, [9, .45, 7], [0, -.3, 0], ground, .18);
    box(stage, [3.8, .025, 7], [coast ? -2.5 : .1, -.055, 0], material(coast ? '#89b7bc' : '#d1c1a0'), .03);
    const tree = hills ? 'tree-oak' : 'tree-pinedefaulta';
    for (const [x, z, size] of [[-3.1,-2.4,1.5],[2.9,-2.4,1.4],[3.2,2.3,1.2],[-3,2.2,1.1]]) {
      void prop(stage, coast ? 'rock-smalla' : tree, x, z, coast ? .7 : size).catch(reportAssetError);
    }
    void prop(stage, 'tent-smallopen', 2.7, -.8, 1.45).catch(reportAssetError);
    if (coast) for (let index = 0; index < 4; index++) {
      box(stage, [.04, .015, 5.8], [-3.4 + index * .3, -.03, 0], material('#c7dfe0'));
    }
  }

  function reportAssetError(error) { onStatus('部分场景资源未加载，请重新打开家园'); console.error(error); }

  async function updateFurniture(items) {
    const revision = ++furnitureGeneration;
    clear(furnishings);
    for (const item of items.filter(item => item.placed)) {
      const definition = furniture.find(entry => entry.id === item.type);
      const object = await prop(furnishings, definition.model, item.x, item.z, Math.max(...definition.size), item.rotation * Math.PI / 2, definition.walkable ? .025 : 0);
      if (disposed || revision !== furnitureGeneration) { object?.removeFromParent(); return; }
      if (object) object.userData.itemId = item.id;
    }
  }

  async function setState(next) {
    state = next;
    const nextLocation = next.home?.trip?.destination ?? 'home';
    if (nextLocation !== location) {
      location = nextLocation;
      clear(stage);
      clear(furnishings);
      furnitureSignature = '';
      path = [];
      if (actor) actor.root.position.set(0, 0, 1);
      if (location === 'home') buildHome(); else buildTravel(location);
    }
    const signature = location === 'home' ? JSON.stringify(next.home?.items ?? []) : 'away';
    if (signature !== furnitureSignature) {
      furnitureSignature = signature;
      if (location === 'home') await updateFurniture(next.home?.items ?? []); else { ++furnitureGeneration; clear(furnishings); }
      ensureSpace();
    }
    if (next.pet?.id === actor?.companionId) return;
    const request = ++generation;
    actor?.dispose();
    actor = null;
    if (!next.pet) return;
    const loaded = await loadCompanion(next.pet, .78);
    if (disposed || request !== generation) return loaded.dispose();
    actor = loaded;
    actor.companionId = next.pet.id;
    actor.root.position.set(0, 0, 1);
    actor.root.rotation.y = .7;
    scene.add(actor.root);
    ensureSpace();
    behavior = 'idle';
    onStatus('正在家里放松');
  }

  function atmosphere() {
    const ambience = state?.home?.ambience ?? 'day';
    const key = location + ':' + ambience;
    if (key === atmosphereKey) return;
    atmosphereKey = key;
    const night = ambience !== 'day';
    const background = ambience === 'rain' ? '#293748' : night ? '#495463' : location === 'coast' ? '#e1edf0' : location === 'hills' ? '#f0e6d6' : null;
    if (background) scene.background = new Color(background); else scene.background = null;
    scene.fog.color.set(background ?? '#ffffff');
    scene.environmentIntensity = night ? .18 : .32;
    hemisphere.intensity = night ? .6 : 1.5;
    sun.color.set(night ? '#9eafdb' : '#ffe6bd'); sun.intensity = night ? .55 : 3.4;
    fill.intensity = night ? .5 : 1.1;
    windowLight.intensity = night && location === 'home' ? 14 : 0;
    roomLight.intensity = night ? 16 : 0;
    const glass = material('#a9c9cc'); glass.emissive.set(night ? '#ffc580' : '#000000'); glass.emissiveIntensity = night ? .8 : 0;
    rain.visible = ambience === 'rain' && !reduced;
  }

  function blocked(x, z) {
    if (x < -3.5 || x > 3.5 || z < -2.5 || z > 2.5) return true;
    projected.set(x, .4, z).project(camera);
    const screenX = (projected.x + 1) / 2, screenY = (1 - projected.y) / 2;
    // UI rectangles are supplied by the host in normalized viewport coordinates.
    if (obstacles.some(rect => screenX > rect.x - .035 && screenX < rect.x + rect.width + .035 && screenY > rect.y - .055 && screenY < rect.y + rect.height + .055)) return true;
    if (location !== 'home') {
      if (location === 'coast' && x < -.4) return true;
      if (Math.abs(x - 2.7) < .95 && Math.abs(z + .8) < .85) return true;
      return [[-3.1,-2.4],[2.9,-2.4],[3.2,2.3],[-3,2.2]].some(([tx,tz]) => Math.hypot(x-tx,z-tz) < .65);
    }
    return (state?.home?.items ?? []).some(item => {
      if (!item.placed || furniture.find(entry => entry.id === item.type).walkable) return false;
      const [width, depth] = footprint(item);
      return Math.abs(x - item.x) < width / 2 + .27 && Math.abs(z - item.z) < depth / 2 + .27;
    });
  }

  function ensureSpace() {
    if (!actor) return;
    if (!blocked(actor.root.position.x, actor.root.position.z)) { actor.root.visible = true; return; }
    let nearest = null, distance = Infinity;
    for (let x = -3.5; x <= 3.5; x += .25) for (let z = -2.5; z <= 2.5; z += .25) {
      if (blocked(x, z)) continue;
      const candidate = new Vector3(x, 0, z);
      const length = candidate.distanceToSquared(actor.root.position);
      if (length < distance) { distance = length; nearest = candidate; }
    }
    actor.root.visible = Boolean(nearest);
    if (nearest) actor.root.position.copy(nearest);
    path = [];
  }

  function findPath(target) {
    if (!actor || blocked(target.x, target.z)) return [];
    const cell = .25;
    const encode = (x, z) => x + ',' + z;
    const startX = Math.round(actor.root.position.x / cell), startZ = Math.round(actor.root.position.z / cell);
    const goalX = Math.round(target.x / cell), goalZ = Math.round(target.z / cell);
    const start = encode(startX, startZ), goal = encode(goalX, goalZ);
    const queue = [[startX, startZ]];
    const parents = new Map([[start, null]]);
    for (let index = 0; index < queue.length; index++) {
      const [x, z] = queue[index];
      const key = encode(x, z);
      if (key === goal) {
        const result = [];
        let current = key;
        while (parents.get(current) !== null) {
          const [px, pz] = current.split(',').map(Number);
          result.unshift(new Vector3(px * cell, 0, pz * cell));
          current = parents.get(current);
        }
        return result;
      }
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, nz = z + dz, next = encode(nx, nz);
        if (parents.has(next) || blocked(nx * cell, nz * cell)) continue;
        parents.set(next, key);
        queue.push([nx, nz]);
      }
    }
    return [];
  }

  function walkTo(point) {
    const next = findPath(point);
    if (!next.length) return false;
    path = next;
    behavior = 'walk';
    actor.play('walk');
    onStatus(location === 'home' ? '在家里走走' : '探索沿途的风景');
    return true;
  }

  let down;
  function pointerDown(event) { down = { x: event.clientX, y: event.clientY }; }
  function pointerUp(event) {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7 || event.button !== 0) return;
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (editing) {
      const hit = raycaster.intersectObjects(furnishings.children, true)[0];
      if (hit && !selected) {
        let object = hit.object;
        while (object && !object.userData.itemId) object = object.parent;
        if (object) { selected = object.userData.itemId; onSelection(selected); return; }
      }
      const ground = raycaster.intersectObject(floor)[0];
      if (selected && ground) onPlace(selected, ground.point.x, ground.point.z);
    } else {
      if (actor && raycaster.intersectObject(actor.root, true).length) { path = []; actor.play('idle'); onPet(); return; }
      const hit = raycaster.intersectObject(floor)[0];
      if (hit) walkTo(hit.point);
    }
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);

  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    const halfHeight = Math.max(5.15, 7.7 / aspect);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.updateProjectionMatrix();
    if (paused) { resizePending = true; return; }
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function tick(now) {
    if (paused) { frame = undefined; return; }
    frame = requestAnimationFrame(tick);
    if (now < nextFrame || document.hidden) { last = now; return; }
    nextFrame = now + 1000 / 30;
    const dt = Math.min((now - (last || now)) / 1000, .075);
    last = now;
    elapsed += dt;
    atmosphere();
    if (rain.visible) {
      const positions = rainGeometry.attributes.position.array;
      for (let index = 0; index < 240; index++) {
        const offset = index * 6;
        const insideHouse = location === 'home' && Math.abs(positions[offset]) < 4.4 && Math.abs(positions[offset+2]) < 3.4;
        let y = positions[offset+1] - dt * 4;
        if (y < -.5) y = 5.5;
        positions[offset+1] = insideHouse ? 50 : y; positions[offset+4] = insideHouse ? 50 : y + .18;
      }
      rainGeometry.attributes.position.needsUpdate = true;
    }
    controls.update();
    let speed = 0;
    if (actor) {
      ensureSpace();
      if (path.length && !editing) {
        const target = path[0];
        movement.subVectors(target, actor.root.position);
        const distance = movement.length();
        speed = .62;
        if (distance < speed * dt) { actor.root.position.copy(target); path.shift(); }
        else actor.root.position.addScaledVector(movement.normalize(), speed * dt);
        if (movement.lengthSq() > 0) {
          const heading = Math.atan2(movement.x, movement.z);
          yaw += Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) * Math.min(1, dt * 10);
          actor.root.rotation.y = yaw;
        }
        if (!path.length) { behavior = 'idle'; actor.play('idle'); restUntil = elapsed + 3; onStatus('享受自己的时光'); }
      } else if (!editing && !reduced && elapsed > restUntil) {
        activityTime++;
        if (activityTime % 3 === 0) {
          behavior = 'sleep'; actor.play('sleep'); restUntil = elapsed + 9; onStatus('打个小盹');
        } else if (!walkTo(new Vector3((Math.random() - .5) * 6, 0, (Math.random() - .5) * 4))) restUntil = elapsed + 1;
      }
      actor.update(dt, speed);
    }
    // Before the first snapshot arrives, treat the empty location as a day
    // home too; otherwise the post-processing chain can paint one opaque frame
    // before the transparent home state is ready.
    const homeDay = (location === '' || location === 'home') &&
      (state?.home?.ambience ?? 'day') === 'day';
    if (homeDay) renderer.render(scene, camera); else composer.render(dt);
  }
  frame = requestAnimationFrame(tick);

  return {
    setState,
    setPaused(value) {
      const next = Boolean(value);
      if (next === paused) return;
      paused = next;
      if (paused) {
        cancelAnimationFrame(frame);
        frame = undefined;
      } else {
        last = 0;
        nextFrame = 0;
        if (resizePending) { resizePending = false; resize(); }
        frame = requestAnimationFrame(tick);
      }
    },
    setObstacles(rectangles) { obstacles = rectangles; path = []; ensureSpace(); },
    edit(value, itemId = null) { editing = value; selected = itemId; path = []; actor?.play('idle'); },
    act(action) { path = []; behavior = action; actor?.play(action, action === 'jump'); restUntil = elapsed + (action === 'sleep' ? 15 : 5); onStatus({ sleep: '休息一会儿', eat: '享用小零食', jump: '和你玩一会儿', idle: '在这里陪着你' }[action]); },
    stats: () => ({ renderer: renderer.info.render, pet: actor?.companionId, clips: actor?.clips, behavior, location, obstacles, position: actor?.root.position.toArray(), running: !document.hidden }),
    dispose() {
      disposed = true; ++generation; ++furnitureGeneration;
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); actor?.dispose();
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp);
      const resources = new Set();
      scene.traverse(object => {
        if (object.geometry) resources.add(object.geometry);
        for (const item of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) {
          resources.add(item);
          for (const value of Object.values(item)) if (value?.isTexture) resources.add(value);
        }
      });
      for (const asset of assets.values()) void asset.then(object => object.traverse(mesh => {
        mesh.geometry?.dispose();
        for (const item of !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const value of Object.values(item)) if (value?.isTexture) value.dispose();
          item.dispose();
        }
      })).catch(() => {});
      for (const resource of resources) resource.dispose();
      for (const surface of materials.values()) surface.dispose();
      grain.dispose(); weave.dispose(); environmentMap.dispose();
      ao.dispose(); bloom.dispose(); output.dispose(); renderPass.dispose(); composer.dispose();
      sun.shadow.map?.dispose(); renderer.dispose();
    },
  };
}
