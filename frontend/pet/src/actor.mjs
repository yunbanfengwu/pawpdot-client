import { AnimationMixer, Box3, Group, Vector3, LoopOnce, LoopRepeat, MathUtils } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function loadCompanion(pet, height = .82) {
  const response = await fetch(pet.profile);
  if (!response.ok) throw Error('宠物动作配置读取失败');
  const profile = await response.json();
  const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(pet.model);
  const model = asset.scene;
  const bounds = new Box3().setFromObject(model, true);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);
  const alignment = new Group();
  alignment.add(model);
  alignment.rotation.y = profile.modelHeading ?? 0;
  const root = new Group();
  root.add(alignment);
  root.scale.setScalar(height / size.y);
  model.traverse(object => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  const mixer = new AnimationMixer(model);
  const clips = new Map(asset.animations.map(clip => [clip.name, clip]));
  const find = (...names) => names.find(name => clips.has(name)) ?? profile.rest;
  const actions = {
    idle: profile.rest,
    walk: find('walk', 'Walk'),
    run: find('run', 'Gallop', 'Run'),
    eat: find('eat', 'Eating'),
    sleep: find('sleep', 'Idle_2_HeadLow', 'Idle'),
    sit: find('sit', 'Idle_2', 'Idle'),
    jump: find('jump', 'Jump_ToIdle', 'Idle'),
  };
  let active;
  let current = 'idle';
  const api = {
    root, mixer, clips: [...clips.keys()], actions,
    play(action, once = false) {
      const name = clips.has(action) ? action : actions[action];
      if (!clips.has(name)) return false;
      const next = mixer.clipAction(clips.get(name));
      if (next === active && !once) return true;
      next.reset().setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      next.setEffectiveWeight(1).play();
      if (active && active !== next) { active.crossFadeTo(next, .22, false); }
      active = next;
      current = action;
      return true;
    },
    update(dt, speed = 0) {
      // Gait playback follows actual movement speed, including slowing near a target.
      if (active && ['walk', 'run'].includes(current)) active.timeScale = MathUtils.clamp(speed / (current === 'run' ? 1.3 : .62), .15, 1.8);
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      const resources = new Set();
      model.traverse(object => {
        if (object.geometry) resources.add(object.geometry);
        if (object.skeleton) resources.add(object.skeleton);
        for (const material of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) {
          resources.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
        }
      });
      for (const resource of resources) resource.dispose();
      root.removeFromParent();
    },
  };
  api.play('idle');
  mixer.update(0);
  return api;
}
