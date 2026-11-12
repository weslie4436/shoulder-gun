import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const MAG = 15;
const WALK = 2.4;
const RUN = 5.2;
const CROUCH = 1.35;
const AIM_WALK = 1.55;
const CROUCH_AIM = 1.05;
const LOWER_BONE = /^DEF-(hips|thigh|shin|foot|toe)/;

const stage = document.getElementById("stage");
const gate = document.getElementById("gate");
const stanceEl = document.getElementById("stance");
const ammoEl = document.getElementById("ammo");
const hitsEl = document.getElementById("hits");
const sightEl = document.getElementById("sight");
const touchRoot = document.getElementById("touch");
const promptEl = document.getElementById("prompt");
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
const canLock = "requestPointerLock" in Element.prototype;
let usingTouch = coarsePointer || !canLock;

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarsePointer ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.style.touchAction = "none";
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14110e);
scene.fog = new THREE.Fog(0x14110e, 12, 42);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 80);
const lookProxy = new THREE.Object3D();
scene.add(lookProxy);
const lookControls = new PointerLockControls(lookProxy, renderer.domElement);

const player = new THREE.Group();
player.position.set(0, 0, 8);
scene.add(player);

const keys = new Set();
const mouse = { aim: false, fire: false };
let yaw = 0;
let pitch = 0.12;
let ammo = MAG;
let reloading = false;
let cool = 0;
let hits = 0;
let stance = "待機";
let camReady = false;
let audioCtx = null;
let gunBytes = null;
let gunBuffer = null;
let stepCarry = 0;
let shotUntil = 0;
let reloadUntil = 0;
let knifeMode = false;
let slashUntil = 0;
let busyUntil = 0;
let motion = null;
let ladderUp = true;
let ladderAnim = null;
let pendingAct = null;
let blade = null;
let ladderMesh = null;
let slashMark = null;
const solids = [];
const vaultMeshes = [];
const VAULT_H = 1;
const LOFT_Y = 2.8;
const SLASH_ARC = (120 * Math.PI) / 180;
const SLASH_REACH = 1.65;
const loftBox = { minX: -11.3, maxX: -7.1, minZ: 2.15, maxZ: 5.15 };
const ladderAnchor = new THREE.Vector3(-9.2, 0, 5.9);
let soleY = null;
let aimTwist = 0;
let smoothEye = 1.6;
const playing = new Set();
const aimWorldQ = new THREE.Quaternion();
const aimParentQ = new THREE.Quaternion();
const aimDelta = new THREE.Quaternion();
const aimPitchTurn = new THREE.Quaternion();
const aimSampleA = new THREE.Quaternion();
const aimSampleB = new THREE.Quaternion();
const aimRight = new THREE.Vector3();
const axisY = new THREE.Vector3(0, 1, 0);
const spineQuatTrack = new Map();

const clock = new THREE.Clock();
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2(0, 0);
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const wish = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();
const headWorld = new THREE.Vector3();
const footProbe = new THREE.Vector3();

const flash = new THREE.PointLight(0xffc58a, 0, 6, 2);
scene.add(flash);
const tracer = makeTracer();
scene.add(tracer);

const targets = [];
let mixer;
let actions = {};
let model;
let rifle;
let hand;

boot().catch((err) => {
  gate.querySelector("p").textContent = "載入失敗";
  gate.querySelector("small").textContent = String(err);
});

async function boot() {
  lights();
  range();
  const manny = await load("./assets/human/AnimationLibrary_Godot_Standard.gltf");
  model = manny.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        o.material.metalness = 0.04;
        o.material.roughness = 0.72;
      }
    }
  });
  player.add(model);

  mixer = new THREE.AnimationMixer(model);
  const clips = manny.animations.map((c) => cleanClip(c, model));
  const byName = (name) => {
    const clip = clips.find((c) => c.name === name);
    if (!clip) throw new Error("缺少動作 " + name);
    return clip;
  };
  actions = {
    idle: act(byName("Idle_Loop"), true),
    walk: act(byName("Walk_Loop"), true),
    run: act(byName("Sprint_Loop"), true),
    crouch: act(byName("Crouch_Idle_Loop"), true),
    sneak: act(byName("Crouch_Fwd_Loop"), true),
    aim: act(byName("Pistol_Aim_Neutral"), true),
    shoot: act(byName("Pistol_Shoot"), false),
    reload: act(byName("Pistol_Reload"), false),
    aimLower: act(partClip(byName("Pistol_Aim_Neutral"), true, "AimLower"), true),
    walkLower: act(partClip(byName("Walk_Loop"), true, "WalkLower"), true),
    runLower: act(partClip(byName("Sprint_Loop"), true, "RunLower"), true),
    crouchLower: act(partClip(byName("Crouch_Idle_Loop"), true, "CrouchLower"), true),
    sneakLower: act(partClip(byName("Crouch_Fwd_Loop"), true, "SneakLower"), true),
    aimUpper: act(partClip(byName("Pistol_Aim_Neutral"), false, "AimUpper"), true),
    shootUpper: act(partClip(byName("Pistol_Shoot"), false, "ShootUpper"), false),
    reloadUpper: act(partClip(byName("Pistol_Reload"), false, "ReloadUpper"), false),
    idleLower: act(partClip(byName("Idle_Loop"), true, "IdleLower"), true),
    swordIdle: act(partClip(byName("Sword_Idle"), false, "SwordIdle"), true),
    swordAtk: act(partClip(byName("Sword_Attack"), false, "SwordAtk"), false),
  };
  mixer.addEventListener("finished", (e) => {
    if (e.action === actions.reload || e.action === actions.reloadUpper) {
      ammo = MAG;
      reloading = false;
      paintHud();
    }
  });

  hand = model.getObjectByName("DEF-handR");
  rifle = await loadPistol();
  rifle.visible = false;
  if (hand) hand.add(rifle);
  else player.add(rifle);
  await loadGunshot();

  actions.idle.reset().setEffectiveWeight(1).play();
  playing.add("idle");
  if (hand) seatPistol();
  blade = makeKnife();
  if (hand) hand.add(blade);
  else player.add(blade);
  if (hand) seatInHand(blade, actions.swordIdle);
  blade.visible = false;
  actions.idle.reset().setEffectiveWeight(1).play();
  playing.add("idle");
  mixer.update(0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 2.3 || size.y < 1.4) model.scale.setScalar(1.8 / size.y);
  const hips = model.getObjectByName("DEF-hips");
  hips.getWorldPosition(footProbe);
  model.position.x -= footProbe.x - player.position.x;
  model.position.z -= footProbe.z - player.position.z;
  model.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(model);
  model.position.y -= grounded.min.y;
  model.updateMatrixWorld(true);
  soleY = lowerFootY();
  bindInput();
  paintHud();
  cameraFollow(0.016, false);
  renderer.render(scene, camera);
  renderer.setAnimationLoop(tick);
}

function load(url) {
  return loader.loadAsync(url);
}

function cleanClip(clip, root) {
  const names = new Set();
  root.traverse((o) => {
    if (o.name) names.add(o.name);
  });
  const copy = clip.clone();
  copy.tracks = copy.tracks.filter((track) => {
    const node = track.name.split(".")[0];
    if (!names.has(node)) return false;
    if (node === "root" || node === "Rig") return false;
    return true;
  });
  return copy;
}

function partClip(clip, lower, name) {
  const copy = clip.clone();
  copy.name = name;
  copy.tracks = copy.tracks.filter((track) => {
    const bone = track.name.split(".")[0];
    const isLower = LOWER_BONE.test(bone);
    return lower ? isLower : !isLower;
  });
  return copy;
}

function act(clip, loop) {
  const action = mixer.clipAction(clip);
  action.enabled = true;
  if (loop) action.setLoop(THREE.LoopRepeat, Infinity);
  else {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  return action;
}

const LOCO_SYNC = {
  walkLower: "walk",
  runLower: "run",
  sneakLower: "sneak",
  crouchLower: "crouch",
  aimLower: "aim",
};

function hold(names) {
  const want = new Set(names);
  const times = {};
  for (const [name, action] of Object.entries(actions)) {
    if (action.isRunning()) times[name] = action.time;
  }
  for (const [name, action] of Object.entries(actions)) {
    if (want.has(name)) {
      action.stopFading();
      if (!action.isRunning()) {
        action.enabled = true;
        action.reset().play();
        const sync = LOCO_SYNC[name];
        if (sync && times[sync] != null) action.time = times[sync];
      }
      action.setEffectiveWeight(1);
      playing.add(name);
    } else if (playing.has(name) || action.isRunning()) {
      action.stopFading();
      action.setEffectiveWeight(0);
      action.stop();
      playing.delete(name);
    }
  }
}

function kick(name) {
  const action = actions[name];
  action.reset().stopFading().setEffectiveWeight(1).play();
  playing.add(name);
}

function lights() {
  const hemi = new THREE.HemisphereLight(0xe7d3a8, 0x2a2118, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe1b0, 1.15);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  const shadow = coarsePointer ? 1024 : 2048;
  sun.shadow.mapSize.set(shadow, shadow);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  scene.add(sun);
  for (const x of [-6, 0, 6]) {
    const lamp = new THREE.PointLight(0xffc27a, 2.2, 11, 1.6);
    lamp.position.set(x, 4.2, -2);
    scene.add(lamp);
  }
}

function range() {
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x3a3228,
    roughness: 0.92,
    metalness: 0.04,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.88 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(28, 6, 0.4), wallMat);
  back.position.set(0, 3, -14);
  back.receiveShadow = true;
  back.castShadow = true;
  scene.add(back);

  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3b, roughness: 0.8 });
  for (let i = 0; i < 5; i += 1) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.5), crateMat);
    crate.position.set(-8 + i * 4, 0.7, -11.6);
    crate.castShadow = true;
    crate.receiveShadow = true;
    crate.userData.hp = 3;
    scene.add(crate);
    targets.push(crate);
  }

  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.6, roughness: 0.35 })
  );
  rail.position.set(0, 3.4, 0.2);
  scene.add(rail);
  buildCourse();
}

function buildCourse() {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.88 });
  const plaster = new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 0.9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 3), wood);
  deck.position.set(-9.2, LOFT_Y, 3.65);
  deck.receiveShadow = true;
  deck.castShadow = true;
  scene.add(deck);

  const loftWall = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 0.16), plaster);
  loftWall.position.set(-9.2, LOFT_Y + 0.73, 2.22);
  scene.add(loftWall);

  ladderMesh = makeLadder(2.95);
  ladderMesh.position.copy(ladderAnchor);
  ladderMesh.rotation.x = 0.28;
  scene.add(ladderMesh);

  addSolid(boxSolid(1.2, 5.4, 0.86, 1.14, 0, VAULT_H), plaster, true);
  const windowX = 8.35;
  addSolid(boxSolid(windowX - 0.14, windowX + 0.14, -2.2, -0.55, 0, 2.5), plaster, false);
  addSolid(boxSolid(windowX - 0.14, windowX + 0.14, 0.55, 2.4, 0, 2.5), plaster, false);
  addSolid(boxSolid(windowX - 0.14, windowX + 0.14, -0.55, 0.55, 0, VAULT_H), plaster, true);
  addSolid(boxSolid(windowX - 0.14, windowX + 0.14, -0.55, 0.55, VAULT_H + 0.9, 2.5), plaster, false);

  const dummy = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.3, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3b, roughness: 0.8 })
  );
  dummy.position.set(1.4, 0.65, 6.4);
  dummy.castShadow = true;
  dummy.userData.hp = 3;
  scene.add(dummy);
  targets.push(dummy);

  slashMark = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0 })
  );
  scene.add(slashMark);
}

function boxSolid(minX, maxX, minZ, maxZ, y0, y1) {
  return { minX, maxX, minZ, maxZ, y0, y1 };
}

function addSolid(box, material, vault) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(box.maxX - box.minX, box.y1 - box.y0, box.maxZ - box.minZ),
    material
  );
  mesh.position.set((box.minX + box.maxX) / 2, (box.y0 + box.y1) / 2, (box.minZ + box.maxZ) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.vault = vault;
  scene.add(mesh);
  solids.push(box);
  if (vault) vaultMeshes.push(mesh);
}

function makeLadder(height) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4424, roughness: 0.86 });
  const rail = new THREE.BoxGeometry(0.06, height, 0.045);
  const left = new THREE.Mesh(rail, wood);
  left.position.set(-0.22, height / 2, 0);
  const right = new THREE.Mesh(rail, wood);
  right.position.set(0.22, height / 2, 0);
  group.add(left, right);
  const rungGeo = new THREE.BoxGeometry(0.5, 0.035, 0.04);
  const steps = Math.max(6, Math.round(height / 0.28));
  for (let i = 0; i < steps; i += 1) {
    const rung = new THREE.Mesh(rungGeo, wood);
    rung.position.set(0, 0.18 + (i * (height - 0.28)) / steps, 0);
    group.add(rung);
  }
  return group;
}

function makeKnife() {
  const knife = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.09, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.72 })
  );
  handle.position.y = 0.02;
  const steel = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.16, 0.004),
    new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.62, roughness: 0.28 })
  );
  steel.position.y = 0.145;
  knife.add(handle, steel);
  knife.visible = false;
  return knife;
}

function seatInHand(obj, pose) {
  for (const name of [...playing]) {
    actions[name].stop();
    playing.delete(name);
  }
  pose.reset().setEffectiveWeight(1).play();
  mixer.update(0.35);
  model.updateMatrixWorld(true);
  const handPos = new THREE.Vector3();
  const forearmPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  model.getObjectByName("DEF-forearmR").getWorldPosition(forearmPos);
  const barrel = handPos.clone().sub(forearmPos).normalize();
  const down = new THREE.Vector3(0, -1, 0);
  const grip = down.clone().addScaledVector(barrel, -down.dot(barrel)).normalize();
  const side = new THREE.Vector3().crossVectors(barrel, grip).normalize();
  const basis = new THREE.Matrix4().makeBasis(side, barrel, grip);
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(basis);
  const parentQ = hand.getWorldQuaternion(new THREE.Quaternion());
  obj.quaternion.copy(parentQ.invert()).multiply(worldQ);
  const seat = handPos.clone().addScaledVector(barrel, 0.02).addScaledVector(grip, -0.004);
  obj.position.copy(hand.worldToLocal(seat));
  pose.stop();
}

async function loadPistol() {
  const mesh = await new OBJLoader().loadAsync("./assets/gun/pistol.obj");
  const steel = new THREE.MeshStandardMaterial({
    color: 0x6e7278,
    metalness: 0.35,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
  mesh.traverse((o) => {
    if (o.isMesh) {
      o.material = steel;
      o.castShadow = true;
    }
  });
  const raw = new THREE.Box3().setFromObject(mesh);
  const size = raw.getSize(new THREE.Vector3());
  const center = raw.getCenter(new THREE.Vector3());
  mesh.position.sub(center);
  const length = Math.max(size.x, size.y, size.z);
  const scale = 0.16 / length;
  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.rotation.x = -Math.PI / 2;
  pivot.scale.setScalar(scale);
  pivot.position.set(0, length * scale * 0.42, 0);
  const gun = new THREE.Group();
  gun.add(pivot);
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, length * scale * 0.92, 0);
  gun.add(muzzle);
  return gun;
}

function seatPistol() {
  for (const name of [...playing]) {
    actions[name].stop();
    playing.delete(name);
  }
  actions.aim.reset().setEffectiveWeight(1).play();
  mixer.update(0.4);
  model.updateMatrixWorld(true);

  const handPos = new THREE.Vector3();
  const forearmPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  model.getObjectByName("DEF-forearmR").getWorldPosition(forearmPos);
  const barrel = handPos.clone().sub(forearmPos).normalize();
  const down = new THREE.Vector3(0, -1, 0);
  const grip = down.clone().addScaledVector(barrel, -down.dot(barrel)).normalize();
  const side = new THREE.Vector3().crossVectors(barrel, grip).normalize();
  const basis = new THREE.Matrix4().makeBasis(side, barrel, grip);
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(basis);
  const parentQ = hand.getWorldQuaternion(new THREE.Quaternion());
  rifle.quaternion.copy(parentQ.invert()).multiply(worldQ);
  const seat = handPos.clone().addScaledVector(barrel, 0.025).addScaledVector(grip, -0.006);
  rifle.position.copy(hand.worldToLocal(seat));

  actions.aim.stop();
  actions.idle.reset().setEffectiveWeight(1).play();
  playing.add("idle");
  mixer.update(0);
}

async function loadGunshot() {
  const res = await fetch("./assets/sfx/cz-shot.wav");
  if (!res.ok) throw new Error("槍聲載入失敗");
  gunBytes = await res.arrayBuffer();
  const ctx = audio();
  if (!ctx) return;
  try {
    gunBuffer = await ctx.decodeAudioData(gunBytes.slice(0));
  } catch {
    gunBuffer = null;
  }
}

function makeTracer() {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(0, 0, 1),
  ]);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 })
  );
  line.frustumCulled = false;
  return line;
}

function createRenderer() {
  const options = [
    { antialias: !coarsePointer, powerPreference: "high-performance" },
    { antialias: false, powerPreference: "default" },
  ];
  let lastError;
  for (const option of options) {
    try {
      return new THREE.WebGLRenderer(option);
    } catch (err) {
      lastError = err;
    }
  }
  gate.querySelector("p").textContent = "這個瀏覽器開不了畫面";
  gate.querySelector("small").textContent = "需要 WebGL。請更新 Safari 後再試。";
  throw lastError;
}

function fitScreen() {
  const view = window.visualViewport;
  const width = view ? view.width : innerWidth;
  const height = view ? view.height : innerHeight;
  const kb = view ? Math.max(0, innerHeight - view.height) : 0;
  document.documentElement.style.setProperty("--kb", kb + "px");
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function markEntered() {
  document.body.classList.add("is-locked");
  primeAudio();
}

function enterWithTouch() {
  usingTouch = true;
  document.body.classList.add("is-touch");
  touchRoot.hidden = false;
  markEntered();
}

function bindInput() {
  gate.addEventListener("pointerdown", (e) => {
    if (usingTouch || !canLock) {
      e.preventDefault();
      enterWithTouch();
      return;
    }
    try {
      lookControls.lock();
    } catch {
      enterWithTouch();
    }
  });
  lookControls.addEventListener("lock", markEntered);
  document.addEventListener("pointerlockerror", () => enterWithTouch());
  lookControls.addEventListener("unlock", () => {
    if (usingTouch) return;
    document.body.classList.remove("is-locked");
    mouse.aim = false;
    mouse.fire = false;
    syncAimChrome();
  });
  addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === "KeyR") startReload();
    if (e.code === "KeyV") toggleKnife();
    if (e.code === "KeyE") doPrompt();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("mousedown", (e) => {
    if (!lookControls.isLocked) return;
    if (e.button === 2) {
      mouse.aim = true;
      syncAimChrome();
    }
    if (e.button === 0) mouse.fire = true;
  });
  addEventListener("mouseup", (e) => {
    if (e.button === 2) {
      mouse.aim = false;
      syncAimChrome();
    }
    if (e.button === 0) mouse.fire = false;
  });
  addEventListener("contextmenu", (e) => e.preventDefault());
  addEventListener("mousemove", (e) => {
    if (!lookControls.isLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.002;
    clampPitch();
  });
  addEventListener("touchmove", (e) => {
    if (document.body.classList.contains("is-locked")) e.preventDefault();
  }, { passive: false });
  addEventListener("gesturestart", (e) => e.preventDefault());
  bindTouch();
  addEventListener("resize", fitScreen);
  if (window.visualViewport) visualViewport.addEventListener("resize", fitScreen);
  fitScreen();
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    document.body.classList.remove("is-locked");
    gate.hidden = false;
    gate.querySelector("p").textContent = "畫面中斷";
    gate.querySelector("small").textContent = "請重新整理這頁。";
  });
}

function clampPitch() {
  const lim = mouse.aim ? 0.7 : 0.95;
  pitch = Math.max(-lim, Math.min(lim, pitch));
}

function bindTouch() {
  const stick = document.getElementById("stick");
  const knob = stick.querySelector("i");
  const stickKeys = new Set();
  let lookId = null;
  let lookX = 0;
  let lookY = 0;
  let stickId = null;
  let stickOrigin = { x: 0, y: 0 };

  let aimTap = null;
  touchRoot.addEventListener("pointerdown", (e) => {
    if (!usingTouch || !document.body.classList.contains("is-locked")) return;
    if (e.target.closest("#stick")) return;
    const btn = e.target.closest("button");
    if (btn && btn.id !== "btn-aim") return;
    lookId = e.pointerId;
    lookX = e.clientX;
    lookY = e.clientY;
    aimTap = btn ? { x: e.clientX, y: e.clientY, dragged: false } : null;
    touchRoot.setPointerCapture(e.pointerId);
  });
  touchRoot.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    const dx = e.clientX - lookX;
    const dy = e.clientY - lookY;
    if (aimTap && Math.hypot(e.clientX - aimTap.x, e.clientY - aimTap.y) > 12) {
      aimTap.dragged = true;
      if (!mouse.aim) setAim(true);
    }
    if (aimTap && !aimTap.dragged) return;
    lookX = e.clientX;
    lookY = e.clientY;
    yaw -= dx * 0.0055;
    pitch -= dy * 0.005;
    clampPitch();
  });
  const endLook = (e) => {
    if (e.pointerId !== lookId) return;
    if (aimTap && !aimTap.dragged) setAim(!mouse.aim);
    lookId = null;
    aimTap = null;
  };
  touchRoot.addEventListener("pointerup", endLook);
  touchRoot.addEventListener("pointercancel", endLook);

  function applyStick(x, y) {
    const max = 42;
    const len = Math.hypot(x, y) || 1;
    const clamped = Math.min(len, max);
    knob.style.transform = `translate(${(x / len) * clamped}px, ${(y / len) * clamped}px)`;
    for (const code of stickKeys) keys.delete(code);
    stickKeys.clear();
    if (clamped < 12) return;
    if (y < -8) stickKeys.add("KeyW");
    if (y > 8) stickKeys.add("KeyS");
    if (x < -8) stickKeys.add("KeyA");
    if (x > 8) stickKeys.add("KeyD");
    for (const code of stickKeys) keys.add(code);
  }

  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const rect = stick.getBoundingClientRect();
    stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    applyStick(e.clientX - stickOrigin.x, e.clientY - stickOrigin.y);
  });
  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    applyStick(e.clientX - stickOrigin.x, e.clientY - stickOrigin.y);
  });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    applyStick(0, 0);
  };
  stick.addEventListener("pointerup", endStick);
  stick.addEventListener("pointercancel", endStick);

  holdPad(document.getElementById("btn-fire"), () => {
    mouse.fire = true;
  }, () => {
    mouse.fire = false;
  });
  const sprintBtn = document.getElementById("btn-sprint");
  sprintBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (keys.has("ShiftLeft")) {
      keys.delete("ShiftLeft");
      sprintBtn.classList.remove("is-on");
    } else {
      keys.add("ShiftLeft");
      sprintBtn.classList.add("is-on");
    }
  });
  document.getElementById("btn-knife").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleKnife();
  });
  document.getElementById("btn-use").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    doPrompt();
  });
  const crouchBtn = document.getElementById("btn-crouch");
  crouchBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (keys.has("KeyC")) {
      keys.delete("KeyC");
      crouchBtn.classList.remove("is-on");
    } else {
      keys.add("KeyC");
      crouchBtn.classList.add("is-on");
    }
  });
  document.getElementById("btn-reload").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startReload();
  });
}

function holdPad(button, down, up) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    button.setPointerCapture(e.pointerId);
    button.classList.add("is-on");
    down();
  });
  const end = () => {
    button.classList.remove("is-on");
    up();
  };
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
}

function setAim(on) {
  mouse.aim = on;
  syncAimChrome();
}

function syncAimChrome() {
  document.body.classList.toggle("is-aiming", mouse.aim);
  sightEl.hidden = !mouse.aim;
  const aimBtn = document.getElementById("btn-aim");
  if (aimBtn) aimBtn.classList.toggle("is-on", mouse.aim);
}

function movingNow() {
  return keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
}

function startReload() {
  if (knifeMode || reloading || ammo === MAG) return;
  reloading = true;
  const layered = mouse.aim || keys.has("KeyC") || movingNow();
  const name = layered ? "reloadUpper" : "reload";
  reloadUntil = performance.now() + actions[name].getClip().duration * 1000 + 80;
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const crouch = keys.has("KeyC");
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  wish.set(0, 0, 0);
  if (keys.has("KeyW")) wish.z -= 1;
  if (keys.has("KeyS")) wish.z += 1;
  if (keys.has("KeyA")) wish.x -= 1;
  if (keys.has("KeyD")) wish.x += 1;
  const busy = performance.now() < busyUntil || motion;
  if (busy) wish.set(0, 0, 0);
  const moving = wish.lengthSq() > 0;
  if (moving) wish.normalize();

  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  move.addScaledVector(right, wish.x);
  move.addScaledVector(forward, -wish.z);

  let speed = WALK;
  if (crouch && mouse.aim) speed = CROUCH_AIM;
  else if (mouse.aim) speed = AIM_WALK;
  else if (crouch) speed = CROUCH;
  else if (sprint && moving) speed = RUN;
  if (!motion) {
    player.position.addScaledVector(move, speed * dt);
    keepOut(player.position);
    player.position.x = THREE.MathUtils.clamp(player.position.x, -12, 12);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -12, 12);
    const floor = standHeight(player.position.x, player.position.z, player.position.y);
    const drop = player.position.y - floor;
    if (drop > 0.04) player.position.y = Math.max(floor, player.position.y - 9 * dt);
    else player.position.y = floor;
  } else {
    stepMotion(dt);
  }
  stepLadder(dt);

  const aimingNow = mouse.aim || performance.now() < shotUntil;
  const faceDir = moving && !aimingNow ? move : forward;
  const targetYaw = Math.atan2(faceDir.x, faceDir.z);
  if (aimingNow) {
    player.rotation.y = dampAngle(player.rotation.y, targetYaw, moving ? 5 : 16, dt);
    aimTwist = Math.atan2(Math.sin(targetYaw - player.rotation.y), Math.cos(targetYaw - player.rotation.y));
    aimTwist = THREE.MathUtils.clamp(aimTwist, -1.05, 1.05);
  } else {
    player.rotation.y = dampAngle(player.rotation.y, targetYaw, 8, dt);
    aimTwist = 0;
  }

  if (reloading && performance.now() >= reloadUntil) finishReload();
  if (mouse.fire && !busy) {
    if (knifeMode) trySlash();
    else tryShoot();
  }
  refreshPrompt();
  chooseClip(moving, crouch, sprint, speed);
  if (rifle) rifle.visible = !knifeMode && (mouse.aim || reloading || performance.now() < shotUntil);
  if (blade) blade.visible = knifeMode;
  if (slashMark) slashMark.material.opacity = Math.max(0, slashMark.material.opacity - dt * 3.2);
  footsteps(moving, crouch, sprint, speed, dt);
  mixer.update(dt);
  applyAimLook();
  if (player.position.y < 0.2 && !motion) plantFeet(dt);
  model.updateMatrixWorld(true);
  cameraFollow(dt, moving);
  cool = Math.max(0, cool - dt);
  flash.intensity = Math.max(0, flash.intensity - dt * 28);
  tracer.material.opacity = Math.max(0, tracer.material.opacity - dt * 4);
  renderer.render(scene, camera);
}

function chooseClip(moving, crouch, sprint, speed) {
  const shooting = performance.now() < shotUntil;
  const slashing = performance.now() < slashUntil;
  const aiming = mouse.aim || shooting;
  let names = ["idle"];
  let label = "待機";
  if (knifeMode && !reloading) {
    let lower = "idleLower";
    if (crouch) lower = moving ? "sneakLower" : "crouchLower";
    else if (moving && sprint && !mouse.aim) lower = "runLower";
    else if (moving) lower = "walkLower";
    else if (mouse.aim) lower = "aimLower";
    names = [lower, slashing ? "swordAtk" : "swordIdle"];
    if (slashing) label = "揮刀";
    else if (mouse.aim) label = "持刀瞄準";
    else label = moving ? (crouch ? "蹲走持刀" : "持刀") : "持刀";
    const stride = lower === "sneakLower" ? 0.75 : lower === "runLower" ? 1.45 : 1.05;
    const loco = actions[lower];
    if (moving && (lower === "walkLower" || lower === "sneakLower" || lower === "runLower")) {
      loco.timeScale = loco.getClip().duration / ((2 * stride) / Math.max(speed, 0.25));
    } else {
      loco.timeScale = 1;
    }
  } else if (aiming || (reloading && (crouch || moving))) {
    let lower = "aimLower";
    if (crouch) lower = moving ? "sneakLower" : "crouchLower";
    else if (moving && sprint && !mouse.aim && !shooting) lower = "runLower";
    else if (moving) lower = "walkLower";
    const upper = reloading ? "reloadUpper" : shooting ? "shootUpper" : "aimUpper";
    names = [lower, upper];
    if (reloading) label = crouch ? "蹲著裝彈" : moving ? "邊走邊裝彈" : "裝彈";
    else if (shooting) label = crouch ? "蹲射" : "射擊";
    else if (crouch) label = moving ? "蹲走瞄準" : "蹲著瞄準";
    else label = moving ? "瞄準移動" : "瞄準";
    const stride = lower === "sneakLower" ? 0.75 : lower === "runLower" ? 1.45 : 1.05;
    const loco = actions[lower];
    if (moving && (lower === "walkLower" || lower === "sneakLower" || lower === "runLower")) {
      const cycle = (2 * stride) / Math.max(speed, 0.25);
      loco.timeScale = loco.getClip().duration / cycle;
    } else {
      loco.timeScale = 1;
    }
  } else if (reloading) {
    names = ["reload"];
    label = "裝彈";
  } else if (shooting) {
    names = ["shoot"];
    label = "射擊";
  } else if (mouse.aim) {
    names = ["aim"];
    label = moving ? "瞄準移動" : "瞄準";
  } else if (crouch && moving) {
    names = ["sneak"];
    label = "蹲走";
  } else if (crouch) {
    names = ["crouch"];
    label = "蹲下";
  } else if (moving && sprint) {
    names = ["run"];
    label = "跑步";
  } else if (moving) {
    names = ["walk"];
    label = "走路";
  }
  hold(names);
  if (stance !== label) {
    stance = label;
    stanceEl.textContent = stance;
  }
}

function cameraFollow(dt, moving) {
  const head = model && model.getObjectByName("DEF-head");
  let rawEye = 1.62;
  if (head) {
    head.getWorldPosition(headWorld);
    rawEye = headWorld.y;
  }
  const eyeGap = Math.abs(rawEye - smoothEye);
  const eyeLambda = eyeGap > 0.12 ? 9 : moving && mouse.aim ? 1.5 : 7;
  smoothEye = THREE.MathUtils.damp(smoothEye, rawEye, eyeLambda, dt);
  const eye = smoothEye;
  const back = mouse.aim ? 1.15 : 3.2;
  const side = mouse.aim ? 0.42 : 0.7;
  const height = eye + (mouse.aim ? 0.06 : 0.28);
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  camPos.copy(player.position);
  camPos.addScaledVector(right, side);
  camPos.addScaledVector(forward, -back);
  camPos.y = height;
  const lookDist = mouse.aim ? 10 : 7;
  lookAt.copy(player.position);
  lookAt.addScaledVector(forward, lookDist);
  lookAt.y = eye + pitch * (mouse.aim ? 5.5 : 3.2);
  if (!camReady) {
    camera.position.copy(camPos);
    camReady = true;
  } else {
    camera.position.lerp(camPos, 1 - Math.exp(-12 * dt));
  }
  camera.lookAt(lookAt);
  camera.fov = THREE.MathUtils.damp(camera.fov, mouse.aim ? 42 : 58, 8, dt);
  camera.updateProjectionMatrix();
}

function tryShoot() {
  if (knifeMode || !mouse.aim || reloading || cool > 0 || performance.now() < busyUntil) return;
  if (ammo <= 0) {
    startReload();
    return;
  }
  ammo -= 1;
  cool = 0.28;
  shotUntil = performance.now() + 320;
  kick("shootUpper");
  playGun();
  paintHud();

  const muzzle = rifle.getObjectByName("muzzle");
  muzzle.getWorldPosition(muzzleWorld);
  flash.position.copy(muzzleWorld);
  flash.intensity = 8;

  raycaster.setFromCamera(ndc, camera);
  const hitscan = raycaster.intersectObjects(targets, false);
  const end = muzzleWorld.clone().add(raycaster.ray.direction.clone().multiplyScalar(28));
  if (hitscan.length) {
    const hit = hitscan[0];
    end.copy(hit.point);
    hurtTarget(hit.object);
  }
  const pos = tracer.geometry.attributes.position;
  pos.setXYZ(0, muzzleWorld.x, muzzleWorld.y, muzzleWorld.z);
  pos.setXYZ(1, end.x, end.y, end.z);
  pos.needsUpdate = true;
  tracer.material.opacity = 0.9;
}

function paintHud() {
  ammoEl.textContent = ammo + " / " + MAG;
}

function footsteps(moving, crouch, sprint, speed, dt) {
  if (!moving) {
    stepCarry = 0;
    return;
  }
  const running = sprint && !crouch && !mouse.aim;
  const stride = running ? 1.35 : crouch ? 0.8 : 1.1;
  stepCarry += speed * dt;
  if (stepCarry < stride) return;
  stepCarry = 0;
  playFoot(running ? "run" : crouch ? "crouch" : "walk");
}

function audio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function primeAudio() {
  const ctx = audio();
  if (!ctx || !gunBytes || gunBuffer) return;
  ctx.decodeAudioData(gunBytes.slice(0)).then((buf) => {
    gunBuffer = buf;
  }).catch(() => {});
}

function burst(freq, dur, gain, kind) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const count = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < count; i += 1) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.setValueAtTime(freq, t);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
  noise.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);
  noise.start(t);
  noise.stop(t + dur);
}

function playFoot(kind) {
  if (kind === "run") burst(220, 0.07, 0.42, "lowpass");
  else if (kind === "crouch") burst(140, 0.05, 0.12, "lowpass");
  else burst(170, 0.06, 0.26, "lowpass");
}

function playGun() {
  if (!gunBuffer) return;
  const ctx = audio();
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = gunBuffer;
  const amp = ctx.createGain();
  amp.gain.value = 0.9;
  src.connect(amp);
  amp.connect(ctx.destination);
  src.start();
}

function lowerFootY() {
  let low = Infinity;
  for (const name of ["DEF-footL", "DEF-footR"]) {
    const bone = model.getObjectByName(name);
    if (!bone) continue;
    bone.getWorldPosition(footProbe);
    if (footProbe.y < low) low = footProbe.y;
  }
  return Number.isFinite(low) ? low : 0;
}

function plantFeet(dt) {
  if (soleY == null) return;
  const gap = lowerFootY() - soleY;
  if (Math.abs(gap) < 0.025) return;
  const fix = THREE.MathUtils.clamp(gap, -0.25 * dt, 0.25 * dt);
  model.position.y -= fix;
}

function finishReload() {
  if (!reloading) return;
  reloading = false;
  ammo = MAG;
  paintHud();
}

function applyAimLook() {
  if (!mouse.aim && performance.now() >= shotUntil) return;
  const chest = model.getObjectByName("DEF-spine003");
  const track = chestTrack(knifeMode ? actions.swordIdle : actions.aimUpper);
  if (!chest || !track) return;
  sampleTrackQuat(track, 0, chest.quaternion);
  const aimAngle = Math.atan2(pitch * 5.5 - 0.06, 11.15);
  const lift = keys.has("KeyC") ? 0.55 : 0;
  aimRight.set(Math.cos(player.rotation.y), 0, -Math.sin(player.rotation.y));
  aimDelta.setFromAxisAngle(axisY, aimTwist);
  aimPitchTurn.setFromAxisAngle(aimRight, -(aimAngle + lift));
  aimDelta.multiply(aimPitchTurn);
  tiltBone(chest, aimDelta);
}

function chestTrack(action) {
  const clip = action.getClip();
  if (!spineQuatTrack.has(clip)) {
    spineQuatTrack.set(
      clip,
      clip.tracks.find((track) => track.name === "DEF-spine003.quaternion") || null
    );
  }
  return spineQuatTrack.get(clip);
}

function sampleTrackQuat(track, time, target) {
  const times = track.times;
  const values = track.values;
  const last = times.length - 1;
  if (last <= 0) return target.fromArray(values, 0);
  const span = times[last];
  const t = span > 0 ? THREE.MathUtils.euclideanModulo(time, span) : 0;
  let i = 0;
  while (i < last - 1 && times[i + 1] < t) i += 1;
  const denom = times[i + 1] - times[i] || 1;
  const u = THREE.MathUtils.clamp((t - times[i]) / denom, 0, 1);
  aimSampleA.fromArray(values, i * 4);
  aimSampleB.fromArray(values, (i + 1) * 4);
  return target.copy(aimSampleA).slerp(aimSampleB, u);
}

function tiltBone(bone, deltaWorld) {
  bone.getWorldQuaternion(aimWorldQ);
  aimParentQ.copy(aimWorldQ).invert();
  aimParentQ.multiply(deltaWorld).multiply(aimWorldQ);
  bone.quaternion.multiply(aimParentQ);
}

function toggleKnife() {
  if (reloading || performance.now() < busyUntil) return;
  knifeMode = !knifeMode;
  const btn = document.getElementById("btn-knife");
  if (btn) btn.classList.toggle("is-on", knifeMode);
  if (rifle) rifle.visible = !knifeMode && (mouse.aim || reloading || performance.now() < shotUntil);
  if (blade) blade.visible = knifeMode;
}

function trySlash() {
  if (cool > 0 || performance.now() < busyUntil) return;
  cool = 0.5;
  slashUntil = performance.now() + 520;
  kick("swordAtk");
  if (slashMark) {
    slashMark.position.copy(player.position).addScaledVector(forward, 0.85);
    slashMark.position.y += 1.15;
    slashMark.rotation.y = yaw;
    slashMark.material.opacity = 0.85;
  }
  const origin = player.position.clone();
  origin.y += 1.15;
  for (const target of targets) {
    const to = target.position.clone().sub(origin);
    to.y = 0;
    const dist = to.length();
    if (dist > SLASH_REACH || dist < 0.05) continue;
    const angle = Math.acos(THREE.MathUtils.clamp(forward.dot(to.normalize()), -1, 1));
    if (angle <= SLASH_ARC / 2) hurtTarget(target);
  }
}

function hurtTarget(object) {
  if (!object.userData || object.userData.hp == null || object.userData.hp <= 0) return;
  object.userData.hp -= 1;
  object.material = object.material.clone();
  object.material.color.setHex(object.userData.hp <= 0 ? 0x4a2018 : 0xb5522a);
  if (object.userData.hp <= 0) {
    object.scale.y = 0.2;
    object.position.y = 0.12;
  }
  hits += 1;
  hitsEl.textContent = String(hits);
}

function insideLoft(x, z) {
  return x > loftBox.minX && x < loftBox.maxX && z > loftBox.minZ && z < loftBox.maxZ;
}

function standHeight(x, z, y) {
  if (insideLoft(x, z) && y > 1.5) return LOFT_Y;
  return 0;
}

function keepOut(pos) {
  for (let pass = 0; pass < 4; pass += 1) {
    let blocked = false;
    for (const box of solids) {
      const head = pos.y + 1.65;
      if (head < box.y0 + 0.05 || pos.y > box.y1 - 0.25) continue;
      if (pos.x <= box.minX || pos.x >= box.maxX || pos.z <= box.minZ || pos.z >= box.maxZ) continue;
      blocked = true;
      const left = pos.x - box.minX;
      const right = box.maxX - pos.x;
      const south = pos.z - box.minZ;
      const north = box.maxZ - pos.z;
      if (Math.min(left, right) < Math.min(south, north)) pos.x += left < right ? -left - 0.05 : right + 0.05;
      else pos.z += south < north ? -south - 0.05 : north + 0.05;
    }
    if (!blocked) break;
  }
}

function startMotion(to, dur, arc) {
  motion = { from: player.position.clone(), to, t: 0, dur, arc };
  busyUntil = performance.now() + dur * 1000 + 40;
}

function stepMotion(dt) {
  motion.t += dt;
  const u = Math.min(1, motion.t / motion.dur);
  const k = u * u * (3 - 2 * u);
  player.position.lerpVectors(motion.from, motion.to, k);
  if (motion.arc) player.position.y += Math.sin(Math.PI * u) * motion.arc;
  if (u >= 1) {
    player.position.copy(motion.to);
    motion = null;
  }
}

function stepLadder(dt) {
  if (!ladderAnim || !ladderMesh) return;
  ladderAnim.t += dt;
  const u = Math.min(1, ladderAnim.t / ladderAnim.dur);
  ladderMesh.rotation.x = ladderAnim.from + (ladderAnim.to - ladderAnim.from) * u;
  if (u >= 1) {
    ladderUp = ladderAnim.up;
    ladderAnim = null;
  }
}

function climbUp() {
  if (!ladderUp) return;
  startMotion(new THREE.Vector3(ladderAnchor.x, LOFT_Y, 4.45), 1.15, 0);
}

function climbDown() {
  if (!ladderUp) return;
  startMotion(new THREE.Vector3(ladderAnchor.x, 0, ladderAnchor.z + 0.9), 1.15, 0);
}

function kickLadder() {
  if (!ladderUp || !ladderMesh) return;
  busyUntil = performance.now() + 480;
  ladderAnim = { from: ladderMesh.rotation.x, to: -1.15, t: 0, dur: 0.42, up: false };
}

function raiseLadder() {
  if (ladderUp || !ladderMesh) return;
  busyUntil = performance.now() + 480;
  ladderAnim = { from: ladderMesh.rotation.x, to: 0.28, t: 0, dur: 0.42, up: true };
}

function vaultAhead() {
  const dest = player.position.clone().addScaledVector(forward, 1.25);
  dest.y = 0;
  startMotion(dest, 0.55, 0.62);
}

function nearVault() {
  const origin = player.position.clone();
  origin.y += 0.72;
  raycaster.set(origin, forward);
  const hits = raycaster.intersectObjects(vaultMeshes, false);
  if (!hits.length || hits[0].distance > 0.95) return null;
  return hits[0].object;
}

function currentAction() {
  if (performance.now() < busyUntil || motion) return null;
  const spot = player.position;
  if (Math.hypot(spot.x - ladderAnchor.x, spot.z - (ladderAnchor.z + 0.75)) < 1.2 && spot.y < 1.1) {
    return ladderUp ? { text: "爬上", run: climbUp } : { text: "架起梯子", run: raiseLadder };
  }
  if (
    insideLoft(spot.x, spot.z) &&
    spot.y > LOFT_Y - 0.45 &&
    Math.hypot(spot.x - ladderAnchor.x, spot.z - ladderAnchor.z) < 1.9
  ) {
    if (!ladderUp) return null;
    if (spot.z > 4.7) return { text: "爬下", run: climbDown };
    return { text: "踢下梯子", run: kickLadder };
  }
  if (nearVault()) return { text: "翻越", run: vaultAhead };
  return null;
}

function refreshPrompt() {
  pendingAct = currentAction();
  const use = document.getElementById("btn-use");
  if (!pendingAct) {
    promptEl.hidden = true;
    if (use) use.hidden = true;
    return;
  }
  promptEl.hidden = false;
  promptEl.textContent = (usingTouch ? "" : "E  ") + pendingAct.text;
  if (use) use.hidden = !usingTouch;
}

function doPrompt() {
  if (performance.now() < busyUntil || motion) return;
  if (!pendingAct) pendingAct = currentAction();
  if (pendingAct) pendingAct.run();
}

function dampAngle(cur, target, lambda, dt) {
  let diff = THREE.MathUtils.euclideanModulo(target - cur + Math.PI, Math.PI * 2) - Math.PI;
  return cur + diff * (1 - Math.exp(-lambda * dt));
}
