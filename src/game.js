// Lights on the Lot — Milestone 1
import * as THREE from '../vendor/three.module.min.js';
import { RGBELoader } from '../vendor/addons/RGBELoader.js';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';

const SAVE_KEY = 'wm.lights-on-the-lot.v2';
const SAVE_KEY_LEGACY = 'wm.lights-on-the-lot.v1';
// Open street south of the gate, in the entrance lane, clear of parked cars and ride pads.
const SAFE_SPAWN = { x: 0, z: 20.5, heading: -Math.PI / 2 };
const VEHICLE_SCALE = 1.35; // 3D models need presence under the iso camera next to painted sprites

const TRAILER_STAGING = { x: 7.2, z: 20.5, heading: -Math.PI / 2 };
const $ = (id) => document.getElementById(id);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const fmtHour = (h) => {
  h = ((h % 24) + 24) % 24;
  const hr = Math.floor(h);
  const m = Math.floor((h - hr) * 60);
  const ap = hr >= 12 ? 'PM' : 'AM';
  const h12 = ((hr + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
};
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- renderer / bloom ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a7c8);
scene.fog = new THREE.FogExp2(0xc5d4e4, 0.0035);

const camera = new THREE.OrthographicCamera(-20, 20, 12, -12, -200, 400);
camera.rotation.order = 'YXZ';
const ISO_YAW = Math.PI / 4;
const ISO_PITCH = Math.atan(1 / Math.sqrt(2));

const clock = new THREE.Clock();

// Compact bloom: bright-pass + dual blur + composite (tone map in composite)
function makeRT(w, h, extra = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    ...extra
  });
}
const fsTri = new THREE.BufferGeometry();
fsTri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fsTri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const vsFS = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;

const brightMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, threshold: { value: 0.85 } },
  vertexShader: vsFS,
  fragmentShader: `
    uniform sampler2D tDiffuse;uniform float threshold;varying vec2 vUv;
    void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb;
      float l=dot(c,vec3(0.2126,0.7152,0.0722));
      float m=max(0.0,l-threshold);
      gl_FragColor=vec4(c*m*1.6,1.0);
    }`
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) } },
  vertexShader: vsFS,
  fragmentShader: `
    uniform sampler2D tDiffuse;uniform vec2 dir;varying vec2 vUv;
    void main(){
      vec3 a=vec3(0.0);
      a+=texture2D(tDiffuse,vUv-dir*3.2307).rgb*0.0702;
      a+=texture2D(tDiffuse,vUv-dir*1.3846).rgb*0.3162;
      a+=texture2D(tDiffuse,vUv).rgb*0.2270;
      a+=texture2D(tDiffuse,vUv+dir*1.3846).rgb*0.3162;
      a+=texture2D(tDiffuse,vUv+dir*3.2307).rgb*0.0702;
      gl_FragColor=vec4(a,1.0);
    }`
});
const compMat = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null },
    bloomStr: { value: 0.7 }, exposure: { value: 1.05 }
  },
  vertexShader: vsFS,
  fragmentShader: `
    uniform sampler2D tDiffuse,tBloom;uniform float bloomStr,exposure;varying vec2 vUv;
    vec3 ACES(vec3 x){const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);}
    void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb+texture2D(tBloom,vUv).rgb*bloomStr;
      c=ACES(c*exposure);
      c=pow(c,vec3(1.0/2.2));
      gl_FragColor=vec4(c,1.0);
    }`
});
const fsScene = new THREE.Scene();
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsMesh = new THREE.Mesh(fsTri, brightMat);
fsMesh.frustumCulled = false;
fsScene.add(fsMesh);

let rtScene, rtBright, rtBlurA, rtBlurB;
function allocTargets() {
  const w = Math.max(2, canvas.width);
  const h = Math.max(2, canvas.height);
  const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
  if (rtScene) { rtScene.dispose(); rtBright.dispose(); rtBlurA.dispose(); rtBlurB.dispose(); }
  rtScene = makeRT(w, h);
  rtBright = makeRT(bw, bh, { depthBuffer: false });
  rtBlurA = makeRT(bw, bh, { depthBuffer: false });
  rtBlurB = makeRT(bw, bh, { depthBuffer: false });
}
function renderBloom() {
  if (!rtScene) { renderer.setRenderTarget(null); renderer.clear(); return; }
  renderer.setRenderTarget(rtScene);
  renderer.clear();
  renderer.render(scene, camera);

  fsMesh.material = brightMat;
  brightMat.uniforms.tDiffuse.value = rtScene.texture;
  renderer.setRenderTarget(rtBright);
  renderer.clear();
  renderer.render(fsScene, fsCam);

  const bw = rtBright.width, bh = rtBright.height;
  // two blur passes
  for (let i = 0; i < 2; i++) {
    fsMesh.material = blurMat;
    blurMat.uniforms.tDiffuse.value = (i === 0 ? rtBright : rtBlurB).texture;
    blurMat.uniforms.dir.value.set((1 + i) / bw, 0);
    renderer.setRenderTarget(rtBlurA);
    renderer.clear();
    renderer.render(fsScene, fsCam);
    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    blurMat.uniforms.dir.value.set(0, (1 + i) / bh);
    renderer.setRenderTarget(rtBlurB);
    renderer.clear();
    renderer.render(fsScene, fsCam);
  }
  fsMesh.material = compMat;
  compMat.uniforms.tDiffuse.value = rtScene.texture;
  compMat.uniforms.tBloom.value = rtBlurB.texture;
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(fsScene, fsCam);
}

/* ---------- state ---------- */
const G = {
  mode: 'title', // title | play | settings | ringtoss
  hour: 15,
  timeScale: 1 / 18, // 1 real sec ≈ 3.3 game minutes; a full day ~ 7 min
  cash: 0,
  tickets: 0,
  day: 1,
  muted: false,
  assist: false,
  placed: { ferris: false, food: false, booth: false },
  currentJob: 'ferris', // ferris | food | booth | done
  hooked: true,
  blocking: false,
  open: false,
  follow: true,
  zoom: 16,
  pan: new THREE.Vector3(0, 0, 4),
  hint: '',
  hintT: 0,
  setupT: 0,
  setupKind: null
};

/* ---------- input ---------- */
const input = {
  steer: 0, drive: 0, reverse: 0,
  keys: Object.create(null),
  pointers: new Map(),
  wheelDragging: false
};

/* ---------- loading ---------- */
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const assets = { tex: {}, spr: {}, ui: {}, models: {} };
const gltfLoader = new GLTFLoader(manager);
const TEX_ANISO = 8;

function loadTex(path, { srgb = true, repeat = 1, wrap = true } = {}) {
  const t = loader.load(path);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(repeat, repeat);
  t.anisotropy = TEX_ANISO;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}
function pbr(stem, opts = {}) {
  const rep = opts.repeat || 1;
  const mat = new THREE.MeshStandardMaterial({
    map: loadTex(`assets/textures/${stem}.jpg`, { repeat: rep }),
    normalMap: loadTex(`assets/textures/${stem}_n.jpg`, { srgb: false, repeat: rep }),
    roughnessMap: loadTex(`assets/textures/${stem}_r.jpg`, { srgb: false, repeat: rep }),
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    envMapIntensity: opts.env ?? 0.8,
    side: opts.side || THREE.FrontSide
  });
  if (opts.normalScale) mat.normalScale.set(opts.normalScale, opts.normalScale);
  return mat;
}
function spriteMap(path) {
  const t = loader.load(path);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.premultiplyAlpha = false;
  return t;
}

manager.onProgress = (url, loaded, total) => {
  const p = total ? loaded / total : 1;
  $('loadFill').style.width = `${Math.round(p * 100)}%`;
};


/* ---------- painted isometric sprites ---------- */
const SPR_FILES = [
  'ferris_00.png','ferris_01.png','ferris_night.png',
  'food_stand.png','food_stand_night.png','ring_booth.png','ring_booth_night.png','booth_close.png',
  'tree_oak.png','kiosk.png','car_blue.png','car_cream.png','string_lights.png',
  'trash.png','cones.png','balloons.png','generator.png','crates.png','barrel.png','barriers.png',
  'pool_warm.png','pool_amber.png','pool_ruby.png','pool_head.png','glow_warm.png','glow_ruby.png'
];
for (const ch of ['a','b','c']) {
  const n = ch === 'a' ? 3 : 8;
  for (let i = 0; i < n; i++) {
    SPR_FILES.push(`person_${ch}_${i}.png`, `person_${ch}_${i}f.png`);
  }
}

function loadSpr(file) {
  if (assets.spr[file]) return assets.spr[file];
  const tex = loader.load('assets/sprites/' + file);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = TEX_ANISO;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  assets.spr[file] = tex;
  return tex;
}
function loadModel(name, path) {
  gltfLoader.load(path, (gltf) => { assets.models[name] = gltf.scene; }, undefined, (err) => {
    console.error('GLB failed', name, path, err);
  });
}

function preloadArt() {
  for (const f of SPR_FILES) loadSpr(f);
  loadModel('truck', 'assets/models/truck.glb');
  loadModel('trailer_ferris', 'assets/models/trailer_ferris.glb');
  loadModel('trailer_food', 'assets/models/trailer_food.glb');
  loadModel('trailer_booth', 'assets/models/trailer_booth.glb');
  const rgbe = new RGBELoader();
  const bakeWhenReady = (which, tex) => {
    assets[which] = tex;
    if (!lights.pmrem) return;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const env = lights.pmrem.fromEquirectangular(tex).texture;
    if (which === 'hdrDay') { lights.envDay = env; if ((G._lampF || 0) < 0.55) scene.environment = env; }
    else { lights.envNight = env; if ((G._lampF || 0) >= 0.55) scene.environment = env; }
  };
  rgbe.load('assets/hdri/venice_sunset_1k.hdr', (tex) => bakeWhenReady('hdrDay', tex), undefined, (e) => console.warn('HDRI day', e));
  rgbe.load('assets/hdri/moonless_golf_1k.hdr', (tex) => bakeWhenReady('hdrNight', tex), undefined, (e) => console.warn('HDRI night', e));
}

function sprMat(map, { additive = false, alphaTest = 0.14 } = {}) {
  return new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: !additive,
    depthTest: true,
    alphaTest: additive ? 0.0 : alphaTest,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: true
  });
}
function texAspect(map) {
  const im = map && map.image;
  return (im && im.height) ? im.width / im.height : 1;
}
function isoSprite(map, worldH, opts = {}) {
  const mat = sprMat(map, opts);
  const spr = new THREE.Sprite(mat);
  spr.scale.set(worldH * texAspect(map), worldH, 1);
  spr.center.set(opts.cx ?? 0.5, opts.cy ?? 0.0);
  spr.position.y = opts.y ?? 0;
  spr.renderOrder = opts.order ?? 2;
  spr.userData.dayMap = map;
  spr.userData.nightMap = opts.nightMap || null;
  spr.userData.worldH = worldH;
  spr.userData.tintable = opts.tintable !== false;
  if (opts.parent) opts.parent.add(spr);
  else scene.add(spr);
  return spr;
}
function lightPool(map, w, d, parent, x, z, y = 0.04) {
  const mat = new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 1;
  (parent || scene).add(m);
  nightLights.push({ pool: m, poolMat: mat });
  return m;
}

// heading 0 = +Z (screen down-left) → sw; π/2 = +X (down-right) → se; π = -Z (up-right) → ne; -π/2 = -X (up-left) → nw
function dir4(heading) {
  const a = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(a / (Math.PI / 2)) % 4;
}
const TRUCK_DIR = ['truck_sw.png', 'truck_se.png', 'truck_ne.png', 'truck_nw.png'];
const TRAILER_DIR = ['trailer_sw.png', 'trailer_se.png', 'trailer_n.png', 'trailer_ne.png'];

function setDirSprite(spr, files, heading) {
  const i = dir4(heading);
  const tex = loadSpr(files[i]);
  if (spr.material.map !== tex) {
    spr.material.map = tex;
    spr.material.needsUpdate = true;
    const h = spr.userData.worldH;
    spr.scale.set(h * texAspect(tex), h, 1);
  }
  spr.userData.dayMap = tex;
}

function applySpriteTint(obj, color) {
  if (!obj) return;
  obj.traverse?.((c) => {
    if (c.isSprite && c.material && c.userData.tintable !== false && !c.material.blending) {
      c.material.color.copy(color);
    } else if (c.isSprite && c.material && c.userData.tintable !== false && c.material.blending === THREE.NormalBlending) {
      c.material.color.copy(color);
    }
  });
  if (obj.isSprite && obj.material && obj.userData.tintable !== false) obj.material.color.copy(color);
}

function swapDayNight(spr, lampF) {
  if (!spr || !spr.userData) return;
  const night = spr.userData.nightMap;
  const day = spr.userData.dayMap;
  if (!night || !day) return;
  const use = lampF > 0.55 ? night : day;
  if (spr.material.map !== use) {
    spr.material.map = use;
    spr.material.needsUpdate = true;
  }
}


const M = {}; // materials
const lights = {};
const world = { pads: {}, pathBoxes: [], obstacles: [], lamps: [], trees: [] };
const rides = { ferris: null, food: null, booth: null };
const vehicle = {};
const crowds = [];
const nightLights = []; // {light, bulb, baseInt}

function buildMaterials() {
  M.asphalt = pbr('asphalt', { repeat: 8, roughness: 0.95, normalScale: 1.1, color: 0xc8c8c8 });
  M.grass = pbr('grass', { repeat: 10, roughness: 0.95, normalScale: 1.4, color: 0xe8f0d8 });
  M.concrete = pbr('concrete', { repeat: 3, roughness: 0.9, normalScale: 0.8 });
  M.wood = pbr('wood', { repeat: 2, roughness: 0.85, normalScale: 1.0 });
  M.awning = pbr('awning', { repeat: 2, roughness: 0.8, normalScale: 0.6 });
  M.metal = pbr('metal', { repeat: 2, roughness: 0.35, metalness: 0.85, env: 1.2, normalScale: 0.5 });
  M.paint = pbr('paint_red', { repeat: 1, roughness: 0.28, metalness: 0.15, env: 1.0, normalScale: 0.35 });
  M.tire = pbr('tire', { repeat: 1, roughness: 0.9, metalness: 0.0, normalScale: 1.6 });
  M.boothBack = new THREE.MeshStandardMaterial({
    map: loadTex('assets/textures/booth_back.jpg', { wrap: false }),
    roughness: 0.7, metalness: 0.05, envMapIntensity: 0.5
  });
  M.glass = new THREE.MeshStandardMaterial({
    color: 0x1a222c, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.55, envMapIntensity: 1.4
  });
  M.gold = new THREE.MeshStandardMaterial({
    color: 0xd4b15a, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.3
  });
  M.emissiveAmber = new THREE.MeshStandardMaterial({
    color: 0xffcc77, emissive: 0xffaa44, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1
  });
  M.emissiveRed = new THREE.MeshStandardMaterial({
    color: 0xff5533, emissive: 0xff2200, emissiveIntensity: 0, roughness: 0.4
  });
  M.shadowBlob = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false
  });
  M.pad = new THREE.MeshStandardMaterial({
    color: 0xc9a227, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.55,
    emissive: 0x6a4a10, emissiveIntensity: 0.15
  });
  M.line = new THREE.MeshStandardMaterial({
    map: spriteMap('assets/sprites/paint_line.png'),
    transparent: true, alphaTest: 0.2, roughness: 0.9, metalness: 0, depthWrite: false
  });
  M.tree = new THREE.MeshStandardMaterial({
    map: spriteMap('assets/sprites/tree.png'), transparent: true, alphaTest: 0.35,
    roughness: 0.9, metalness: 0, side: THREE.DoubleSide
  });
  M.gondola = new THREE.MeshStandardMaterial({
    map: spriteMap('assets/sprites/gondola.png'), transparent: true, alphaTest: 0.3,
    roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide, envMapIntensity: 0.8
  });
  M.foodSign = new THREE.MeshStandardMaterial({
    map: spriteMap('assets/sprites/food_sign.png'), transparent: true, alphaTest: 0.3,
    roughness: 0.7, metalness: 0, side: THREE.DoubleSide
  });
  M.people = ['a', 'b', 'c', 'd'].map((k) => new THREE.MeshStandardMaterial({
    map: spriteMap(`assets/sprites/person_${k}.png`), transparent: true, alphaTest: 0.35,
    roughness: 0.85, metalness: 0, side: THREE.DoubleSide
  }));
}

function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx, sy, sz, parent = scene, cast = true, recv = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (sx) m.scale.set(sx, sy ?? sx, sz ?? sx);
  m.castShadow = cast;
  m.receiveShadow = recv;
  parent.add(m);
  return m;
}

/* ---------- camera ---------- */
let _rtW = 0, _rtH = 0;
function applyCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const z = G.zoom;
  const aspect = w / Math.max(1, h);
  camera.left = -z * aspect;
  camera.right = z * aspect;
  camera.top = z;
  camera.bottom = -z;
  camera.near = -250;
  camera.far = 400;
  camera.updateProjectionMatrix();
  if (canvas.width !== _rtW || canvas.height !== _rtH) {
    _rtW = canvas.width; _rtH = canvas.height;
    allocTargets();
  }
  updateCamPos();
}
function updateCamPos() {
  const d = 90;
  const cy = Math.sin(ISO_PITCH), ch = Math.cos(ISO_PITCH);
  camera.position.set(
    G.pan.x + Math.sin(ISO_YAW) * ch * d,
    G.pan.y + cy * d,
    G.pan.z + Math.cos(ISO_YAW) * ch * d
  );
  camera.lookAt(G.pan.x, 0.4, G.pan.z);
}

/* ---------- lighting / sky / day-night ---------- */
function buildSkyAndLights() {
  const skyGeo = new THREE.SphereGeometry(220, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      tDay: { value: loadTex('assets/textures/sky_day.jpg', { wrap: false }) },
      tNight: { value: loadTex('assets/textures/sky_night.jpg', { wrap: false }) },
      mixN: { value: 0 }
    },
    vertexShader: `varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      uniform sampler2D tDay,tNight;uniform float mixN;varying vec3 vP;
      void main(){
        vec2 uv=vec2(atan(vP.x,vP.z)/6.2831853+0.5, clamp(vP.y*0.55+0.42,0.0,1.0));
        vec3 day=texture2D(tDay,uv).rgb;
        vec3 nig=texture2D(tNight,uv).rgb;
        // lift the night sky so stars and the carnival horizon really read
        nig=nig*1.15+vec3(0.02,0.03,0.08);
        vec3 c=mix(day,nig,mixN);
        gl_FragColor=vec4(c,1.0);
      }`
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  lights.sky = sky;

  lights.hemi = new THREE.HemisphereLight(0xffe2c4, 0x3a2a1c, 0.9);
  scene.add(lights.hemi);
  lights.sun = new THREE.DirectionalLight(0xffd7a0, 2.8);
  lights.sun.castShadow = true;
  lights.sun.shadow.mapSize.set(2048, 2048);
  lights.sun.shadow.bias = -0.00035;
  lights.sun.shadow.normalBias = 0.06;
  lights.sun.shadow.radius = 3;
  const s = lights.sun.shadow.camera;
  s.left = -36; s.right = 36; s.top = 36; s.bottom = -36; s.near = 1; s.far = 140;
  scene.add(lights.sun);
  scene.add(lights.sun.target);
  lights.fill = new THREE.DirectionalLight(0x8aa4c8, 0.28);
  lights.fill.position.set(-30, 20, -20);
  scene.add(lights.fill);
  lights.ambient = new THREE.AmbientLight(0x2a241c, 0.12);
  scene.add(lights.ambient);

  lights.pmrem = new THREE.PMREMGenerator(renderer);
  const bakeEnv = (hdr, fallbackHemi) => {
    if (hdr) {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      return lights.pmrem.fromEquirectangular(hdr).texture;
    }
    const envScene = new THREE.Scene();
    envScene.add(new THREE.HemisphereLight(fallbackHemi, 0x4a3a28, 1.4));
    return lights.pmrem.fromScene(envScene, 0.04, 8, 80).texture;
  };
  lights.envDay = bakeEnv(assets.hdrDay, 0xffd8b0);
  lights.envNight = bakeEnv(assets.hdrNight, 0x334866);
  scene.environment = lights.envDay;
}

function addNightLight(x, y, z, color, intensity, distance, decay = 2, real = false) {
  let L = null;
  if (real) {
    L = new THREE.PointLight(color, 0, distance, decay);
    L.position.set(x, y, z);
    scene.add(L);
  }
  const bulbMat = new THREE.SpriteMaterial({
    map: loadSpr('glow_warm.png'),
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    color: new THREE.Color(color)
  });
  const bulb = new THREE.Sprite(bulbMat);
  bulb.position.set(x, y, z);
  bulb.scale.set(0.7, 0.7, 1);
  bulb.renderOrder = 6;
  scene.add(bulb);
  const rec = { light: L, bulb, bulbMat, baseInt: intensity, color };
  nightLights.push(rec);
  return rec;
}

function setAtmosphere(hour) {
  const h = ((hour % 24) + 24) % 24;
  const dayF = smooth(5.6, 7.0, h) * (1 - smooth(17.4, 18.8, h));
  const duskF = smooth(16.8, 18.0, h) * (1 - smooth(19.2, 20.6, h));
  const dawnF = smooth(5.2, 6.4, h) * (1 - smooth(7.0, 8.2, h));
  const nightF = 1 - smooth(5.4, 6.8, h) * (1 - smooth(18.0, 19.4, h));
  const lampF = clamp(nightF + duskF * 0.9 + dawnF * 0.5, 0, 1);
  const goldF = clamp(duskF + dawnF * 0.6 + dayF * smooth(15.5, 16.5, h) * (1 - smooth(17.2, 18.2, h)), 0, 1);

  const elev = (h < 6 || h > 19) ? -0.12 : Math.sin(((h - 6) / 13) * Math.PI);
  const az = ((h - 6) / 12) * Math.PI;
  const sunDist = 60;
  lights.sun.position.set(Math.cos(az) * sunDist, Math.max(2, elev * 70 + 6), Math.sin(az) * sunDist * 0.6);
  lights.sun.target.position.set(0, 0, 0);

  // Warm golden-hour key, not grey-green
  const sunCol = new THREE.Color().setRGB(
    lerp(0.55, 1.0, dayF + duskF * 0.2),
    lerp(0.62, 0.90, dayF) * (1 - duskF * 0.15) + duskF * 0.62,
    lerp(0.85, 0.62, 1 - dayF) * (1 - duskF) + duskF * 0.28
  );
  if (duskF > 0.05) sunCol.setRGB(1.0, 0.62 + 0.2 * (1 - duskF), 0.28 + 0.2 * (1 - duskF));
  if (dayF > 0.7 && h < 16.5) sunCol.setRGB(1.0, 0.93, 0.78);
  if (dayF > 0.7 && h >= 16.5) sunCol.setRGB(1.0, 0.82, 0.52);
  lights.sun.color.copy(sunCol);
  lights.sun.intensity = nightF > 0.85 ? 0.08 : (0.55 + dayF * 2.4 + duskF * 2.1);
  lights.hemi.intensity = 0.08 + dayF * 0.85 + duskF * 0.40;
  lights.hemi.color.set(dayF > 0.5 && duskF < 0.4 ? 0xffe6c8 : (duskF > 0.25 ? 0xffb078 : 0x3a4a78));
  lights.hemi.groundColor.set(dayF > 0.3 ? 0x5a4030 : 0x161018);
  lights.fill.color.set(duskF > 0.3 ? 0xff8a50 : 0x88a8d0);
  lights.fill.intensity = 0.04 + dayF * 0.18 + duskF * 0.22;
  lights.ambient.intensity = 0.06 + dayF * 0.16 + lampF * 0.08;

  const fogDay = new THREE.Color(0xe8d2b0);
  const fogDusk = new THREE.Color(0xc86840);
  const fogNight = new THREE.Color(0x140820);
  const fog = fogDay.clone().lerp(fogDusk, duskF).lerp(fogNight, nightF * 0.85);
  scene.fog.color.copy(fog);
  scene.fog.density = 0.00115 + nightF * 0.0010; // keep the sky visible
  scene.background.copy(nightF > 0.6 ? new THREE.Color(0x1a0a28) : fog);

  lights.sky.material.uniforms.mixN.value = clamp(nightF * 0.85 + duskF * 0.9, 0, 1);

  if (lights.envDay && lights.envNight) {
    scene.environment = lampF > 0.55 ? lights.envNight : lights.envDay;
  }

  const expo = 1.15 + duskF * 0.18 - nightF * 0.02;
  renderer.toneMappingExposure = expo;
  compMat.uniforms.exposure.value = expo;
  compMat.uniforms.bloomStr.value = 0.22 + lampF * 1.15 + duskF * 0.35;
  brightMat.uniforms.threshold.value = 0.72 - lampF * 0.28;

  for (const n of nightLights) {
    if (n.light) n.light.intensity = n.baseInt * lampF;
    if (n.bulbMat) {
      n.bulbMat.opacity = 0.15 + lampF * 0.95;
      n.bulb.scale.setScalar(0.45 + lampF * 1.1);
    }
    if (n.poolMat) n.poolMat.opacity = lampF * (n.poolBoost || 1.15);
  }
  if (rides.ferris) rides.ferris.setLights(lampF);
  if (rides.food) rides.food.setLights(lampF);
  if (rides.booth) rides.booth.setLights(lampF);

  // tint painted sprites with time-of-day so they sit in the light
  const tint = new THREE.Color(1, 1, 1);
  if (duskF > 0.15) tint.setRGB(1.05, 0.82, 0.62);
  else if (dayF > 0.5) tint.setRGB(1.02, 0.97, 0.90);
  else tint.setRGB(0.22 + lampF * 0.12, 0.24 + lampF * 0.10, 0.40);
  const live = new THREE.Color(1, 0.95, 0.85); // rides at night keep warmth
  if (vehicle.truck) applySpriteTint(vehicle.truck.group, tint);
  if (vehicle.trailer) applySpriteTint(vehicle.trailer.group, tint);
  for (const g of crowds) applySpriteTint(g.group, tint);
  for (const s of (world.isoSprites || [])) {
    const keep = s.userData && s.userData.keepLit;
    applySpriteTint(s, (keep && lampF > 0.4) ? live : tint);
  }

  G._dayF = dayF; G._nightF = nightF; G._lampF = lampF; G._duskF = duskF;
}

const LOT = { x0: -18, x1: 18, z0: -16, z1: 14 }; // asphalt rectangle
const STREET_Z1 = 26;

function addBlobShadow(parent, sx, sz, opacity = 0.28) {
  const s = mesh(new THREE.CircleGeometry(1, 20), M.shadowBlob, {
    y: 0.03, rx: -Math.PI / 2, sx, sy: 1, sz, parent, cast: false, recv: false
  });
  s.material = M.shadowBlob.clone();
  s.material.opacity = opacity;
  return s;
}

function buildFence(x0, x1, z, gap) {
  // rail fence along z=const, gap {x0,x1} or null
  const posts = [];
  for (let x = x0; x <= x1 + 0.01; x += 2.2) {
    if (gap && x > gap.x0 + 0.2 && x < gap.x1 - 0.2) continue;
    posts.push(x);
    mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.15, 8), M.wood, { x, y: 0.58, z });
  }
  const rail = (y) => {
    let start = x0;
    const segs = gap ? [[x0, gap.x0], [gap.x1, x1]] : [[x0, x1]];
    for (const [a, b] of segs) {
      if (b - a < 0.4) continue;
      const mid = (a + b) / 2, len = b - a;
      mesh(new THREE.BoxGeometry(len, 0.06, 0.05), M.metal, { x: mid, y, z });
    }
  };
  rail(0.45); rail(0.85);
}

function buildLot() {
  world.isoSprites = [];
  // grass ground (large)
  mesh(new THREE.PlaneGeometry(90, 90), M.grass, { y: 0, rx: -Math.PI / 2, recv: true, cast: false });

  // street south of lot
  mesh(new THREE.PlaneGeometry(90, 16), M.asphalt, {
    z: (LOT.z1 + STREET_Z1) / 2, y: 0.01, rx: -Math.PI / 2, recv: true, cast: false
  });
  M.asphalt; // already repeat 8 — street uses same mat; slight z fight avoided with y=0.01

  // parking lot asphalt
  const lotW = LOT.x1 - LOT.x0, lotD = LOT.z1 - LOT.z0;
  mesh(new THREE.PlaneGeometry(lotW, lotD), M.asphalt, {
    x: (LOT.x0 + LOT.x1) / 2, z: (LOT.z0 + LOT.z1) / 2, y: 0.02, rx: -Math.PI / 2, recv: true, cast: false
  });

  // concrete curbs around lot (leave south entrance)
  const curbH = 0.14, curbT = 0.28;
  const midX = 0, midZ = (LOT.z0 + LOT.z1) / 2;
  // north, east, west full; south with gap
  const addCurb = (x, z, w, d) => mesh(new THREE.BoxGeometry(w, curbH, d), M.concrete, { x, y: curbH / 2 + 0.02, z, recv: true, cast: true });
  addCurb(midX, LOT.z0 - curbT / 2, lotW + curbT * 2, curbT); // north
  addCurb(LOT.x0 - curbT / 2, midZ, curbT, lotD); // west
  addCurb(LOT.x1 + curbT / 2, midZ, curbT, lotD); // east
  // south curbs split around entrance 8m wide
  const gapW = 8;
  const side = (lotW - gapW) / 2;
  addCurb(LOT.x0 + side / 2, LOT.z1 + curbT / 2, side, curbT);
  addCurb(LOT.x1 - side / 2, LOT.z1 + curbT / 2, side, curbT);

  // fences
  buildFence(LOT.x0, LOT.x1, LOT.z0 - 0.2, null);
  buildFence(LOT.x0, LOT.x1, LOT.z1 + 0.2, { x0: -4, x1: 4 });
  // east/west fences as posts+rails along z
  for (const x of [LOT.x0 - 0.2, LOT.x1 + 0.2]) {
    for (let z = LOT.z0; z <= LOT.z1 + 0.01; z += 2.2) {
      mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.15, 8), M.wood, { x, y: 0.58, z });
    }
    for (const y of [0.45, 0.85]) {
      mesh(new THREE.BoxGeometry(0.05, 0.06, lotD), M.metal, { x, y, z: midZ });
    }
  }

  // walking path — slightly lighter worn strip down the middle (paint lines as edges)
  const pathW = 4.4;
  world.path = { x: 0, z0: LOT.z0 + 1, z1: LOT.z1, half: pathW / 2 };
  // path edge lines
  const addLine = (x, z, len, rotY) => {
    const m = mesh(new THREE.PlaneGeometry(len, 0.16), M.line, {
      x, y: 0.035, z, rx: -Math.PI / 2, ry: rotY, recv: false, cast: false
    });
    m.renderOrder = 1;
    return m;
  };
  addLine(-pathW / 2, (world.path.z0 + world.path.z1) / 2, world.path.z1 - world.path.z0, Math.PI / 2);
  addLine(pathW / 2, (world.path.z0 + world.path.z1) / 2, world.path.z1 - world.path.z0, Math.PI / 2);

  // faded parking stalls along west and east (not on the midway)
  for (let i = 0; i < 5; i++) {
    const z = LOT.z1 - 3.2 - i * 5.2;
    if (z < LOT.z0 + 2) continue;
    addLine(-16, z, 6.5, 0);
    addLine(16, z, 6.5, 0);
  }

  // pads
  function makePad(id, x, z, w, d, heading, label) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    scene.add(group);
    const slab = mesh(new THREE.BoxGeometry(w, 0.06, d), M.concrete, { y: 0.04, parent: group, recv: true, cast: false });
    // outline
    const outline = mesh(new THREE.PlaneGeometry(w + 0.3, d + 0.3), M.pad, {
      y: 0.075, rx: -Math.PI / 2, parent: group, recv: false, cast: false
    });
    outline.material = M.pad.clone();
    // heading chevron
    const chev = mesh(new THREE.ConeGeometry(0.28, 0.08, 3), M.gold, {
      y: 0.09, rx: 0, ry: heading, parent: group, recv: false, cast: false
    });
    chev.rotation.x = -Math.PI / 2;
    chev.position.set(Math.sin(heading) * (d * 0.28), 0.09, Math.cos(heading) * (d * 0.28));
    const pad = { id, x, z, w, d, heading, group, outline, chev, label };
    world.pads[id] = pad;
    return pad;
  }
  // Ferris on the west, facing the midway (+X). Trailer backs in heading west (-X) or along -X? 
  // Marked heading is the trailer heading when parked: we'll use heading = 0 (north, -Z? heading 0 = +Z south in our convention)
  // heading 0 = +Z (south). For a west pad, backing in from the path, trailer likely heads west (-X), heading = -PI/2
  makePad('ferris', -11.2, -3.0, 10.2, 8.4, -Math.PI / 2, 'FERRIS');
  makePad('food', 11.0, -1.5, 5.4, 4.6, Math.PI / 2, 'FOOD');
  makePad('booth', 11.0, 7.2, 5.2, 4.4, Math.PI / 2, 'GAMES');

  // street lamps
  function lamp(x, z, real) {
    mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.2, 8), M.metal, { x, y: 2.6, z });
    mesh(new THREE.BoxGeometry(0.7, 0.08, 0.2), M.metal, { x, y: 5.25, z });
    addNightLight(x, 5.05, z, 0xffc888, 5.5, 14, 2, !!real);
    world.lamps.push({ x, z });
  }
  lamp(-17.5, 13.5, true); lamp(17.5, 13.5, false);
  lamp(-17.5, -15, false); lamp(17.5, -15, true);
  lamp(0, 20.5, true); lamp(-12, 20.5, false); lamp(12, 20.5, false);

  // trees around the grass
  function tree(x, z, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const h = 7.4 * s;
    const spr = isoSprite(loadSpr('tree_oak.png'), h, { parent: g, order: 3, alphaTest: 0.25 });
    addBlobShadow(g, 1.1 * s, 1.1 * s, 0.32);
    scene.add(g);
    world.trees.push(g);
    (world.isoSprites || (world.isoSprites = [])).push(spr);
    world.obstacles.push({ x, z, r: 0.7 * s });
  }
  const treeSpots = [
    [-22, -8, 1.15], [-24, 2, 0.95], [-23, 12, 1.05],
    [22, -10, 1.2], [24, 1, 0.9], [23, 12, 1.1],
    [-16, -20, 1.3], [-8, -21, 0.85], [6, -21, 1.1], [16, -20, 0.95],
    [-28, 18, 1.0], [28, 18, 1.15], [0, -24, 1.4]
  ];
  for (const [x, z, s] of treeSpots) tree(x, z, s);

  // obstacles: curbs/fences as AABBs for the vehicle (lot interior is free except trees)
  // outer fence boxes
  world.obstacles.push(
    { aabb: { x0: LOT.x0 - 0.5, x1: LOT.x1 + 0.5, z0: LOT.z0 - 0.6, z1: LOT.z0 } }, // north fence
    { aabb: { x0: LOT.x0 - 0.6, x1: LOT.x0, z0: LOT.z0, z1: LOT.z1 } },
    { aabb: { x0: LOT.x1, x1: LOT.x1 + 0.6, z0: LOT.z0, z1: LOT.z1 } },
    { aabb: { x0: LOT.x0, x1: -4, z0: LOT.z1, z1: LOT.z1 + 0.6 } },
    { aabb: { x0: 4, x1: LOT.x1, z0: LOT.z1, z1: LOT.z1 + 0.6 } }
  );


  world.isoSprites = world.isoSprites || [];
  function prop(file, x, z, h, opts = {}) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const spr = isoSprite(loadSpr(file), h, { parent: g, order: opts.order ?? 4, alphaTest: opts.alphaTest ?? 0.16 });
    if (opts.keepLit) spr.userData.keepLit = true;
    if (opts.shadow !== false) addBlobShadow(g, opts.sw || h * 0.22, opts.sd || h * 0.18, opts.sop || 0.24);
    scene.add(g);
    world.isoSprites.push(spr);
    if (opts.block) world.obstacles.push({ x, z, r: opts.block });
    return spr;
  }
  // ticket kiosk at the entrance
  prop('kiosk.png', -6.5, 13.2, 3.4, { keepLit: true, block: 1.1, sw: 1.2, sd: 1.0 });
  addNightLight(-6.5, 2.4, 13.2, 0xffd8a0, 2.2, 6, 2, false);
  lightPool(loadSpr('pool_warm.png'), 5.5, 4.5, scene, -6.5, 13.6, 0.045);
  world.obstacles.push({ aabb: { x0: -7.6, x1: -5.4, z0: 12.3, z1: 14.1 } });

  // parked cars along the street — kept out of the entrance lane (x ≈ -6..8, z ≈ 16..24)
  prop('car_blue.png', -22.0, 19.6, 1.85, { block: 1.3, sw: 1.5, sd: 1.1 });
  prop('car_cream.png', 22.2, 19.8, 1.8, { block: 1.3, sw: 1.5, sd: 1.1 });
  prop('car_blue.png', 22.0, 23.2, 1.75, { block: 1.2, sw: 1.4, sd: 1.0 });
  prop('car_cream.png', -21.8, 23.4, 1.7, { block: 1.2, sw: 1.4, sd: 1.0 });

  // midway / ride-adjacent props
  prop('trash.png', 8.2, 5.4, 1.15, { block: 0.3 });
  prop('trash.png', -6.0, 8.5, 1.1, { block: 0.3 });
  prop('trash.png', 8.4, -5.2, 1.15, { block: 0.3 });
  prop('cones.png', 3.6, 13.0, 0.85, { block: 0.25, sw: 0.7, sd: 0.4 });
  prop('cones.png', -3.4, 13.1, 0.85, { block: 0.25, sw: 0.7, sd: 0.4 });
  prop('balloons.png', 9.6, 9.4, 2.4, { keepLit: true, shadow: false, order: 6 });
  prop('generator.png', -16.4, -7.2, 1.35, { block: 0.6 });
  prop('crates.png', -16.6, 1.5, 1.2, { block: 0.6 });
  prop('barrel.png', -15.4, -0.4, 1.15, { block: 0.35 });
  prop('barriers.png', 6.4, 12.6, 1.15, { block: 0.4, sw: 1.4, sd: 0.3 });
  prop('crates.png', 14.6, 4.6, 1.15, { block: 0.5 });

  // string lights between lamp posts (painted sagging strand)
  function hangLights(x, z, h = 3.4) {
    const g = new THREE.Group();
    g.position.set(x, 4.4, z);
    const spr = isoSprite(loadSpr('string_lights.png'), h, { parent: g, cy: 0.5, y: 0, order: 8, additive: false });
    spr.center.set(0.5, 0.5);
    spr.userData.keepLit = true;
    spr.userData.tintable = false;
    scene.add(g);
    world.isoSprites.push(spr);
    (world.hangSpr || (world.hangSpr = [])).push(spr, g);
    // glow overlay
    const gl = isoSprite(loadSpr('glow_warm.png'), 2.2, { parent: g, cy: 0.5, y: 0, additive: true, order: 9, tintable: false });
    gl.center.set(0.5, 0.5);
    gl.material.opacity = 0;
    nightLights.push({ bulb: gl, bulbMat: gl.material, baseInt: 1, color: 0xffc070 });
  }
  hangLights(-8.5, 13.6, 3.8);
  hangLights(8.5, 13.6, 3.8);
  hangLights(0, -15.2, 4.2);
  hangLights(-12, -8, 3.6);
  hangLights(12, 2.5, 3.6);
}



function padOnTarget(pad, x, z, heading) {
  const dx = x - pad.x, dz = z - pad.z;
  const dist = Math.hypot(dx, dz);
  const ah = Math.abs(angDiff(heading, pad.heading));
  const ah2 = Math.abs(angDiff(heading, pad.heading + Math.PI));
  const ang = Math.min(ah, ah2);
  return { dist, ang, ok: dist < 1.65 && ang < 0.32 };
}

function footprintBlocksPath(kind) {
  // if a ride was set up overlapping the midway corridor
  const r = rides[kind];
  if (!r || !r.placed) return false;
  const p = r.footprint;
  const path = world.path;
  const xOverlap = Math.abs(p.x - path.x) < (p.hw + path.half) - 0.15;
  const zOverlap = p.z + p.hd > path.z0 && p.z - p.hd < path.z1;
  return xOverlap && zOverlap;
}

function updateBlocking() {
  G.blocking = ['ferris', 'food', 'booth'].some(footprintBlocksPath);
  const el = $('warn');
  if (G.blocking) {
    el.textContent = 'THE MIDWAY IS BLOCKED — guests are turning away';
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}


/* ---------- vehicles ---------- */
function makeWheel(radius, width, parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const tire = mesh(new THREE.CylinderGeometry(radius, radius, width, 20), M.tire, {
    rz: Math.PI / 2, parent: g
  });
  const rim = mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 16), M.metal, {
    rz: Math.PI / 2, parent: g, recv: false
  });
  const cap = mesh(new THREE.CircleGeometry(radius * 0.32, 16), M.metal, {
    rz: Math.PI / 2, parent: g, x: width * 0.52 + 0.01, recv: false
  });
  const cap2 = mesh(new THREE.CircleGeometry(radius * 0.32, 16), M.metal, {
    rz: -Math.PI / 2, parent: g, x: -(width * 0.52 + 0.01), recv: false
  });
  parent.add(g);
  return g;
}

function instanceModel(src) {
  if (!src) return new THREE.Group();
  const root = src.clone(true);
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

function collectVehicleParts(root) {
  const parts = { steers: [], wheels: [], heads: [], tails: [], revs: [], cabs: [], markers: [] };
  root.traverse((o) => {
    const n = o.name || '';
    if (n.startsWith('steer_')) parts.steers.push(o);
    if (n.startsWith('wheel_') && !n.includes('_hub') && o.isMesh) parts.wheels.push(o);
    if (n.startsWith('light_head')) parts.heads.push(o);
    if (n.startsWith('light_tail')) parts.tails.push(o);
    if (n.startsWith('light_rev')) parts.revs.push(o);
    if (n.startsWith('light_cab')) parts.cabs.push(o);
    if (n.startsWith('light_marker')) parts.markers.push(o);
  });
  return parts;
}

function setLamp(objs, intensity) {
  for (const o of objs) {
    o.traverse((c) => {
      const mats = c.isMesh ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
      for (const m of mats) {
        if (m && m.emissive) m.emissiveIntensity = intensity;
      }
    });
  }
}

function addBlobShadowMesh(parent, w, d) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.scale.set(w, d, 1);
  m.renderOrder = 1;
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function buildTruck() {
  const g = new THREE.Group();
  scene.add(g);
  const model = instanceModel(assets.models.truck);
  model.scale.setScalar(VEHICLE_SCALE);
  g.add(model);
  const parts = collectVehicleParts(g);
  const S = VEHICLE_SCALE;
  lightPool(loadSpr('pool_head.png'), 5.6 * S, 3.8 * S, g, 0, 3.4 * S, 0.05).userData.isHead = true;
  addBlobShadowMesh(g, 1.5 * S, 2.8 * S);
  vehicle.truck = {
    group: g, model, parts, sprite: null,
    x: SAFE_SPAWN.x, z: SAFE_SPAWN.z, heading: SAFE_SPAWN.heading, speed: 0, steer: 0,
    wheelbase: 3.35 * S, width: 2.48 * S, length: 5.7 * S, hitchOff: 3.22 * S,
    track: 1.92 * S, wheelR: 0.52 * S
  };
}

function trailerKindSpec(kind) {
  // hitchOff = origin (deck center) to coupler; axle = hitch-to-axle length; length = overall
  const S = VEHICLE_SCALE;
  if (kind === 'ferris') return { length: 8.2 * S, width: 2.35 * S, tongue: 1.7 * S, axle: 6.70 * S, hitchOff: 4.95 * S };
  if (kind === 'food') return { length: 6.45 * S, width: 2.35 * S, tongue: 1.45 * S, axle: 4.95 * S, hitchOff: 3.95 * S };
  return { length: 6.1 * S, width: 2.35 * S, tongue: 1.4 * S, axle: 4.60 * S, hitchOff: 3.75 * S };
}

function buildTrailer(kind) {
  if (vehicle.trailer && vehicle.trailer.group) scene.remove(vehicle.trailer.group);
  const spec = trailerKindSpec(kind);
  const g = new THREE.Group();
  scene.add(g);
  const src = assets.models['trailer_' + kind] || assets.models.trailer_ferris;
  const model = instanceModel(src);
  model.scale.setScalar(VEHICLE_SCALE);
  g.add(model);
  const parts = collectVehicleParts(g);
  addBlobShadowMesh(g, 1.4 * VEHICLE_SCALE, spec.length * 0.42);
  vehicle.trailer = {
    group: g, model, parts, sprite: null, kind,
    x: 0, z: 0, heading: 0,
    length: spec.length, width: spec.width, tongue: spec.tongue, axle: spec.axle,
    hitchOff: spec.hitchOff, wheelR: 0.48, cargo: { visible: true }
  };
  return vehicle.trailer;
}

function hitchWorld() {
  const t = vehicle.truck;
  const back = t.hitchOff;
  return {
    x: t.x - Math.sin(t.heading) * back,
    z: t.z - Math.cos(t.heading) * back
  };
}

function updateVehicleLights() {
  const t = vehicle.truck;
  const night = G._lampF || 0;
  const reversing = !!(t && (t.speed < -0.2 || (G.mode === 'play' && input.reverse && !input.drive)));
  if (t && t.parts) {
    setLamp(t.parts.heads, 0.2 + night * 2.3);
    setLamp(t.parts.tails, 0.2 + night * 2.0);
    setLamp(t.parts.revs, reversing ? 2.6 : 0.0);
    setLamp(t.parts.cabs, 0.35 + night * 2.4);
  }
  const tr = vehicle.trailer;
  if (tr && tr.parts && tr.group.visible) {
    setLamp(tr.parts.tails, 0.2 + night * 2.2);
    setLamp(tr.parts.markers, 0.25 + night * 2.6);
  }
}

function syncVehicleMeshes() {
  const t = vehicle.truck;
  if (!t || !t.group) return;
  t.group.position.set(t.x, 0, t.z);
  t.group.rotation.y = t.heading;
  const tr = vehicle.trailer;
  if (tr && tr.group.visible) {
    tr.group.position.set(tr.x, 0, tr.z);
    tr.group.rotation.y = tr.heading;
  }
  t.group.traverse((c) => {
    if (c.userData && c.userData.isHead && c.material) {
      c.material.opacity = (G._lampF || 0) * 0.95;
    }
  });
  updateVehicleLights();
}

function placeTrailerOnHitch() {
  const t = vehicle.truck, tr = vehicle.trailer;
  if (!tr) return;
  const h = hitchWorld();
  tr.x = h.x - Math.sin(tr.heading) * tr.hitchOff;
  tr.z = h.z - Math.cos(tr.heading) * tr.hitchOff;
}

function obbHitsCircle(x, z, hw, hl, heading, cx, cz, r) {
  const s = Math.sin(heading), c = Math.cos(heading);
  const dx = cx - x, dz = cz - z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = clamp(lx, -hw, hw);
  const qz = clamp(lz, -hl, hl);
  return Math.hypot(lx - qx, lz - qz) < r;
}

function obbHitsAabb(x, z, hw, hl, heading, a) {
  const s = Math.sin(heading), c = Math.cos(heading);
  const corners = [];
  for (const [lx, lz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl]]) {
    corners.push([x + lx * c + lz * s, z + lz * c - lx * s]);
  }
  const aabb = [[a.x0, a.z0], [a.x1, a.z0], [a.x1, a.z1], [a.x0, a.z1]];
  const axes = [[1, 0], [0, 1], [c, -s], [s, c]];
  for (const [ax, ay] of axes) {
    let mn0 = Infinity, mx0 = -Infinity, mn1 = Infinity, mx1 = -Infinity;
    for (const [px, pz] of corners) {
      const d = px * ax + pz * ay;
      if (d < mn0) mn0 = d; if (d > mx0) mx0 = d;
    }
    for (const [px, pz] of aabb) {
      const d = px * ax + pz * ay;
      if (d < mn1) mn1 = d; if (d > mx1) mx1 = d;
    }
    if (mx0 < mn1 || mx1 < mn0) return false;
  }
  return true;
}

function collideAt(x, z, halfW, halfL, heading) {
  const s = Math.sin(heading), c = Math.cos(heading);
  for (const [lx, lz] of [[halfW, halfL], [-halfW, halfL], [halfW, -halfL], [-halfW, -halfL]]) {
    const wx = x + lx * c + lz * s;
    const wz = z + lz * c - lx * s;
    if (wx < -34 || wx > 34 || wz < -28 || wz > 30) return true;
  }
  const pad = 0.12;
  for (const o of world.obstacles) {
    if (o.r) {
      if (obbHitsCircle(x, z, halfW, halfL, heading, o.x, o.z, o.r + pad)) return true;
    } else if (o.aabb) {
      if (obbHitsAabb(x, z, halfW, halfL, heading, o.aabb)) return true;
    }
  }
  for (const k of ['ferris', 'food', 'booth']) {
    const r = rides[k];
    if (!r || !r.placed) continue;
    const p = r.footprint;
    if (obbHitsAabb(x, z, halfW, halfL, heading, {
      x0: p.x - p.hw, x1: p.x + p.hw, z0: p.z - p.hd, z1: p.z + p.hd
    })) return true;
  }
  return false;
}

function truckHalf() {
  const t = vehicle.truck;
  return { hw: t.width * 0.48, hl: t.length * 0.48 };
}
function trailerBox(tr) {
  tr = tr || vehicle.trailer;
  if (!tr) return null;
  const hl = tr.length * 0.5;
  const shift = tr.hitchOff - hl;
  const s = Math.sin(tr.heading), c = Math.cos(tr.heading);
  return {
    x: tr.x + s * shift,
    z: tr.z + c * shift,
    hw: tr.width * 0.48,
    hl,
    heading: tr.heading
  };
}
function trailerHalf(tr) {
  const b = trailerBox(tr);
  return b ? { hw: b.hw, hl: b.hl } : null;
}
function truckCollides(x, z, heading) {
  const t = vehicle.truck;
  if (!t) return false;
  const h = truckHalf();
  return collideAt(x ?? t.x, z ?? t.z, h.hw, h.hl, heading ?? t.heading);
}
function trailerCollides(tr) {
  tr = tr || vehicle.trailer;
  if (!tr || !tr.group || !tr.group.visible) return false;
  const b = trailerBox(tr);
  return collideAt(b.x, b.z, b.hw, b.hl, b.heading);
}
function vehicleIsStuck() {
  return truckCollides() || trailerCollides();
}

function tryPoseClear(x, z, heading, hooked) {
  const t = vehicle.truck;
  const ox = t.x, oz = t.z, oh = t.heading;
  let trx, trz, trh;
  const tr = vehicle.trailer;
  if (tr) { trx = tr.x; trz = tr.z; trh = tr.heading; }
  t.x = x; t.z = z; t.heading = heading; t.speed = 0; t.steer = 0;
  if (hooked && tr) {
    tr.heading = heading;
    placeTrailerOnHitch();
  }
  const ok = !truckCollides() && !(hooked && trailerCollides());
  if (!ok) {
    t.x = ox; t.z = oz; t.heading = oh;
    if (tr && trx !== undefined) { tr.x = trx; tr.z = trz; tr.heading = trh; }
  }
  return ok;
}

function spawnTruckSafe(opts = {}) {
  const t = vehicle.truck;
  if (!t) return;
  t.speed = 0; t.steer = 0;
  vehicle.jackknife = false;
  vehicle.stuckT = 0;
  const hooked = opts.hooked !== undefined ? !!opts.hooked : !!G.hooked;
  const candidates = [
    SAFE_SPAWN,
    { x: -2.4, z: 20.6, heading: -Math.PI / 2 },
    { x: 1.8, z: 20.6, heading: -Math.PI / 2 },
    { x: -1.5, z: 18.8, heading: Math.PI },
    { x: 2.2, z: 18.8, heading: Math.PI },
    { x: 0, z: 22.4, heading: -Math.PI / 2 }
  ];
  let placed = false;
  for (const c of candidates) {
    if (tryPoseClear(c.x, c.z, c.heading, hooked)) { placed = true; break; }
  }
  if (!placed) {
    t.x = SAFE_SPAWN.x; t.z = SAFE_SPAWN.z; t.heading = SAFE_SPAWN.heading;
    if (hooked && vehicle.trailer) {
      vehicle.trailer.heading = t.heading;
      placeTrailerOnHitch();
    }
  }
  if (opts.follow !== false) {
    G.follow = true;
    G.pan.set(t.x, 0, t.z);
  }
  if (t.group) syncVehicleMeshes();
}

function evictIfStuck(announce) {
  if (!vehicle.truck || !vehicleIsStuck()) return false;
  spawnTruckSafe();
  if (announce !== false) setHint('Truck moved to the entrance — it was stuck in a ride.');
  return true;
}

function resetTruckToEntrance() {
  spawnTruckSafe({ hooked: G.hooked, follow: true });
  setHint('Truck reset to the lot entrance.');
  if (G.mode === 'play') save();
}

vehicle.jackknife = false;

function stepVehicle(dt) {
  if (G.mode !== 'play' || G.setupKind) return;
  const t = vehicle.truck;
  const wantDrive = input.drive ? 1 : (input.reverse ? -1 : 0);
  const kD = input.keys.KeyW || input.keys.ArrowUp;
  const kR = input.keys.KeyS || input.keys.ArrowDown || input.keys.KeyR;
  const kL = input.keys.KeyA || input.keys.ArrowLeft;
  const kRi = input.keys.KeyD || input.keys.ArrowRight;
  let steerIn = input.steer;
  if (kL) steerIn -= 1;
  if (kRi) steerIn += 1;
  steerIn = clamp(steerIn, -1, 1);
  let throttle = wantDrive;
  if (kD) throttle = 1;
  if (kR) throttle = -1;

  // Bicycle-model truck: steer angle limited and reduced at speed
  const maxSteer = 0.62;
  const speedFade = 1 / (1 + Math.abs(t.speed) * 0.09);
  const steerTarget = steerIn * maxSteer * speedFade;
  t.steer = lerp(t.steer, steerTarget, 1 - Math.pow(0.0008, dt));

  const maxSpd = throttle < 0 ? 5.2 : 8.5;
  const acc = throttle < 0 ? 6.5 : 8.0;
  const want = throttle * maxSpd;
  if (throttle === 0) t.speed = lerp(t.speed, 0, 1 - Math.pow(0.04, dt));
  else t.speed += clamp(want - t.speed, -acc * dt * 1.4, acc * dt);

  // Jackknife: must pull forward — no more reverse while folded
  if (vehicle.jackknife && t.speed < 0) t.speed = Math.max(t.speed, -0.12);

  const wb = t.wheelbase;
  // Input: positive steer = wheel/keys to the right (clockwise HUD).
  // Y-up right-handed, heading 0 = +Z: driver's left is +X, and heading+
  // swings the nose toward +X (left). Yaw must therefore oppose tan(steer).
  const yawRate = -(t.speed * Math.tan(t.steer)) / wb;
  const nxHeading = t.heading + yawRate * dt;
  const nx = t.x + Math.sin(nxHeading) * t.speed * dt;
  const nz = t.z + Math.cos(nxHeading) * t.speed * dt;

  const h = truckHalf();
  const curHit = collideAt(t.x, t.z, h.hw, h.hl, t.heading);
  const hitTruck = collideAt(nx, nz, h.hw, h.hl, nxHeading);
  if (hitTruck && !curHit) {
    t.speed *= -0.15;
    audio.thump && audio.thump();
  } else if (hitTruck && curHit) {
    const hitX = collideAt(nx, t.z, h.hw, h.hl, nxHeading);
    const hitZ = collideAt(t.x, nz, h.hw, h.hl, nxHeading);
    if (!hitX) { t.x = nx; t.heading = wrapPi(nxHeading); }
    else if (!hitZ) { t.z = nz; t.heading = wrapPi(nxHeading); }
  } else {
    t.x = nx; t.z = nz; t.heading = wrapPi(nxHeading);
  }

  // Front wheels visibly steer (Ackermann); all wheels roll
  if (t.parts) {
    const track = t.track || 1.92;
    const st = t.steer;
    t.parts.steers.forEach((node) => {
      if (Math.abs(st) < 1e-4) { node.rotation.y = 0; return; }
      const r = wb / Math.tan(st);
      const side = node.position.x < 0 ? 1 : -1;
      // Positive rotation.y points a +Z-facing wheel toward +X (driver's left),
      // so the visual angle is opposite the (right-positive) steer input.
      node.rotation.y = -Math.atan(wb / (r + side * track * 0.5));
    });
    const roll = (t.speed * dt) / (t.wheelR || 0.52);
    t.parts.wheels.forEach((w) => { w.rotateX(roll); });
  }

  const tr = vehicle.trailer;
  if (G.hooked && tr && tr.group.visible) {
    // Real hitch velocity (includes yaw swing behind the rear axle) and
    // kinematic trailer: φ̇ = (v_hitch · n_perp) / L, L = hitch-to-axle.
    const appliedYaw = (t.heading === wrapPi(nxHeading) || (!hitTruck)) ? yawRate : 0;
    const dH = t.hitchOff;
    const vhx = t.speed * Math.sin(t.heading) - dH * Math.cos(t.heading) * appliedYaw;
    const vhz = t.speed * Math.cos(t.heading) + dH * Math.sin(t.heading) * appliedYaw;
    const L = Math.max(1.4, tr.axle);
    const phi = tr.heading;
    const phiDot = (vhx * Math.cos(phi) - vhz * Math.sin(phi)) / L;
    tr.heading = wrapPi(tr.heading + phiDot * dt);

    const JACK = 1.40; // ~80 degrees
    const psi = angDiff(tr.heading, t.heading);
    if (Math.abs(psi) > JACK) {
      tr.heading = wrapPi(t.heading + Math.sign(psi) * JACK);
      if (!vehicle.jackknife) {
        vehicle.jackknife = true;
        setHint('JACKKNIFE — pull forward to straighten.');
      }
    } else if (Math.abs(psi) < 0.65 && t.speed > 0.45) {
      vehicle.jackknife = false;
    }
    placeTrailerOnHitch();

    const b = trailerBox(tr);
    if (collideAt(b.x, b.z, b.hw, b.hl, b.heading)) {
      if (!curHit) {
        t.speed *= -0.2;
        audio.thump && audio.thump();
      }
    }
    if (tr.parts) {
      const rollT = (t.speed * dt) / (tr.wheelR || 0.48);
      tr.parts.wheels.forEach((w) => { w.rotateX(rollT); });
    }
  }

  const jk = $('jackknife');
  if (vehicle.jackknife) jk.classList.remove('hidden');
  else jk.classList.add('hidden');

  if (vehicleIsStuck()) {
    vehicle.stuckT = (vehicle.stuckT || 0) + dt;
    if (vehicle.stuckT > 0.6) evictIfStuck(true);
  } else {
    vehicle.stuckT = 0;
  }

  for (const id of Object.keys(world.pads)) {
    const pad = world.pads[id];
    const active = G.assist && G.currentJob === id && !G.placed[id];
    pad.outline.material.opacity = active ? 0.8 : 0.35;
    pad.outline.material.emissiveIntensity = active ? (0.4 + Math.sin(performance.now() * 0.006) * 0.3) : 0.12;
  }
}

function tryHook() {
  if (G.hooked || !vehicle.trailer || !vehicle.trailer.group.visible) return false;
  const h = hitchWorld();
  const tr = vehicle.trailer;
  const tongueX = tr.x + Math.sin(tr.heading) * tr.hitchOff;
  const tongueZ = tr.z + Math.cos(tr.heading) * tr.hitchOff;
  const d = Math.hypot(h.x - tongueX, h.z - tongueZ);
  const a = Math.abs(angDiff(vehicle.truck.heading, tr.heading));
  if (d < 1.35 && a < 0.55) {
    G.hooked = true;
    placeTrailerOnHitch();
    audio.clank && audio.clank();
    setHint('Hooked. Back it onto the marked pad.');
    return true;
  }
  setHint('Close enough? Get the hitch over the tongue.');
  return false;
}

function spawnNextTrailer(kind) {
  G.currentJob = kind;
  G.hooked = false;
  const tr = buildTrailer(kind);
  // park at the street staging area, east of the clear entrance lane
  tr.x = TRAILER_STAGING.x; tr.z = TRAILER_STAGING.z; tr.heading = TRAILER_STAGING.heading;
  tr.group.visible = true;
  tr.cargo.visible = true;
  setHint(kind === 'food' ? 'Hook the food-stand trailer and back it onto its pad.'
    : kind === 'booth' ? 'Hook the game-booth trailer and back it onto its pad.'
    : 'Back the Ferris wheel onto the west pad.');
}


/* ---------- rides ---------- */
function buildFerris(x, z, heading) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = 0; // painted iso already faces the camera
  g.visible = false;
  g.scale.set(0.02, 0.02, 0.02);
  scene.add(g);
  const day0 = loadSpr('ferris_00.png');
  const day1 = loadSpr('ferris_01.png');
  const night = loadSpr('ferris_night.png');
  const spr = isoSprite(day0, 13.2, { parent: g, order: 5, nightMap: night });
  spr.userData.day0 = day0;
  spr.userData.day1 = day1;
  spr.userData.keepLit = true;
  lightPool(loadSpr('pool_warm.png'), 16, 12, scene, x, z, 0.045);
  lightPool(loadSpr('pool_ruby.png'), 10, 8, scene, x + 0.6, z - 0.4, 0.046);
  const glow = isoSprite(loadSpr('glow_warm.png'), 10, { parent: g, additive: true, cy: 0.45, y: 6.2, order: 6, tintable: false });
  glow.material.opacity = 0;
  glow.userData.tintable = false;
  glow.center.set(0.5, 0.45);
  let spin = 0;
  const rec = {
    group: g, spr, placed: false, glow,
    footprint: { x, z, hw: 5.0, hd: 4.0 },
    gondolas: [],
    tick(dt) {
      if (!this.placed) return;
      spin += dt * 0.35;
      const lamp = G._lampF || 0;
      if (lamp > 0.55) {
        spr.material.map = night;
      } else {
        spr.material.map = (Math.sin(spin * 4) > 0) ? day0 : day1;
      }
      spr.material.needsUpdate = true;
    },
    setLights(lampF) {
      glow.material.opacity = lampF * 0.65;
      glow.scale.set(8 + lampF * 8, 8 + lampF * 8, 1);
      swapDayNight(spr, lampF);
    }
  };
  rides.ferris = rec;
}

function buildFood(x, z, heading) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.visible = false;
  g.scale.set(0.02, 0.02, 0.02);
  scene.add(g);
  const day = loadSpr('food_stand.png');
  const night = loadSpr('food_stand_night.png');
  const spr = isoSprite(day, 5.6, { parent: g, order: 5, nightMap: night });
  spr.userData.keepLit = true;
  lightPool(loadSpr('pool_amber.png'), 8, 6.5, scene, x - 0.8, z + 0.6, 0.045);
  const rec = {
    group: g, spr, placed: false,
    footprint: { x, z, hw: 2.5, hd: 2.2 },
    tick() {},
    setLights(lampF) { swapDayNight(spr, lampF); }
  };
  rides.food = rec;
}

function buildBooth(x, z, heading) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.visible = false;
  g.scale.set(0.02, 0.02, 0.02);
  scene.add(g);
  const day = loadSpr('ring_booth.png');
  const night = loadSpr('ring_booth_night.png');
  const spr = isoSprite(day, 5.8, { parent: g, order: 5, nightMap: night });
  spr.userData.keepLit = true;
  const close = isoSprite(loadSpr('booth_close.png'), 4.8, { parent: g, order: 8 });
  close.visible = false;
  close.userData.keepLit = true;
  lightPool(loadSpr('pool_warm.png'), 7.5, 6, scene, x - 0.8, z + 0.8, 0.045);
  const rec = {
    group: g, spr, close, placed: false,
    footprint: { x, z, hw: 2.4, hd: 2.1 },
    tick() {},
    setLights(lampF) { swapDayNight(spr, lampF); }
  };
  rides.booth = rec;
}

function placeRide(kind, instant) {
  const pad = world.pads[kind];
  const tr = vehicle.trailer;
  let x = pad.x, z = pad.z, heading = pad.heading;
  if (!instant && tr) { x = tr.x; z = tr.z; heading = tr.heading; }
  let rec = rides[kind];
  if (kind === 'ferris') rec = rec || buildFerris(x, z, heading);
  if (kind === 'food') rec = rec || buildFood(x, z, heading);
  if (kind === 'booth') rec = rec || buildBooth(x, z, heading);
  rec.group.position.set(x, 0, z);
  rec.group.rotation.y = kind === 'ferris' ? heading + Math.PI / 2 : heading;
  rec.footprint.x = x; rec.footprint.z = z;
  rec.group.visible = true;
  if (world.pads[kind] && world.pads[kind].chev) world.pads[kind].chev.visible = false;
  if (instant) {
    rec.group.scale.set(1, 1, 1);
    rec.placed = true;
    G.placed[kind] = true;
    if (tr && tr.kind === kind) { tr.group.visible = false; tr.cargo.visible = false; }
    G.hooked = false;
    if (G.mode === 'play') evictIfStuck(true);
  } else {
    rec.group.scale.set(0.02, 0.02, 0.02);
    rec.placed = false;
    G.setupKind = kind;
    G.setupT = 0;
    if (tr) tr.cargo.visible = false;
    G.hooked = false;
    audio.hydraulics && audio.hydraulics();
  }
  updateBlocking();
}

function tickSetup(dt) {
  if (!G.setupKind) return;
  const kind = G.setupKind;
  G.setupT += dt;
  const rec = rides[kind];
  const t = clamp(G.setupT / 3.4, 0, 1);
  const e = 1 - Math.pow(1 - t, 3);
  rec.group.scale.setScalar(e);
  rec.group.position.y = (1 - e) * 1.2;
  if (t >= 1) {
    rec.group.position.y = 0;
    rec.group.scale.set(1, 1, 1);
    rec.placed = true;
    G.placed[kind] = true;
    G.setupKind = null;
    if (vehicle.trailer) vehicle.trailer.group.visible = false;
    audio.cash && audio.cash();
    if (kind === 'ferris') spawnNextTrailer('food');
    else if (kind === 'food') spawnNextTrailer('booth');
    else {
      G.currentJob = 'done';
      G.open = true;
      setHint('The midway is open. Tap the ring-toss booth to play. Earn cash from the crowd.');
    }
    updateBlocking();
    evictIfStuck(true);
  }
}

function canSetup() {
  if (G.mode !== 'play' || G.setupKind || !G.hooked) return false;
  const kind = G.currentJob;
  if (!world.pads[kind] || G.placed[kind]) return false;
  const tr = vehicle.trailer;
  if (!tr) return false;
  const chk = padOnTarget(world.pads[kind], tr.x, tr.z, tr.heading);
  return chk.ok && Math.abs(vehicle.truck.speed) < 0.55;
}

function trySetup() {
  if (!canSetup()) {
    if (G.hooked && world.pads[G.currentJob] && !G.placed[G.currentJob]) {
      const tr = vehicle.trailer;
      const chk = padOnTarget(world.pads[G.currentJob], tr.x, tr.z, tr.heading);
      if (!chk.ok) setHint(`Not on the pad yet — line it up. ${chk.dist.toFixed(1)} m off, ${(chk.ang * 180 / Math.PI).toFixed(0)}°`);
    }
    return;
  }
  placeRide(G.currentJob, false);
  setHint('Setting up…');
}


/* ---------- crowds ---------- */
function spawnGuest() {
  const kinds = ['b', 'c', 'a'];
  const kind = kinds[Math.floor(Math.random() * (Math.random() < 0.75 ? 2 : 3))];
  const g = new THREE.Group();
  const h = 1.62 + Math.random() * 0.18;
  const spr = isoSprite(loadSpr(`person_${kind}_0.png`), h, { parent: g, order: 7, alphaTest: 0.2 });
  addBlobShadow(g, 0.3, 0.3, 0.22);
  scene.add(g);
  const guest = {
    group: g, sprite: spr, kind, h,
    x: (Math.random() - 0.5) * 3, z: 16 + Math.random() * 2,
    heading: Math.PI,
    speed: 1.05 + Math.random() * 0.55,
    state: 'enter',
    wait: 0, target: null, dest: null, paid: false, tix: false,
    walkT: Math.random(), walkFrame: 0, rideSeat: null
  };
  g.position.set(guest.x, 0, guest.z);
  crowds.push(guest);
  return guest;
}

function midwayClear() {
  return !G.blocking;
}

function pickDest(g) {
  const opts = [];
  if (rides.ferris && rides.ferris.placed) opts.push({ kind: 'ride', x: rides.ferris.footprint.x + 3.2, z: rides.ferris.footprint.z, next: 'ride' });
  if (rides.food && rides.food.placed) opts.push({ kind: 'eat', x: rides.food.footprint.x - 2.4, z: rides.food.footprint.z, next: 'eat' });
  if (rides.booth && rides.booth.placed) opts.push({ kind: 'play', x: rides.booth.footprint.x - 2.4, z: rides.booth.footprint.z, next: 'play' });
  opts.push({ kind: 'wander', x: (Math.random() - 0.5) * 8, z: -2 + Math.random() * 8, next: 'walk' });
  if (!midwayClear()) {
    // can't go deep into the lot
    return { kind: 'leave', x: (Math.random() - 0.5) * 3, z: 17, next: 'leave' };
  }
  return opts[Math.floor(Math.random() * opts.length)];
}

function stepCrowds(dt) {
  const want = G.open || G.placed.ferris || G.placed.food || G.placed.booth
    ? (midwayClear() ? 18 : 8) : 0;
  if (crowds.length < want && Math.random() < dt * 2.4) spawnGuest();

  for (let i = crowds.length - 1; i >= 0; i--) {
    const g = crowds[i];
    if (!g.dest) g.dest = pickDest(g);
    const dx = g.dest.x - g.x, dz = g.dest.z - g.z;
    const dist = Math.hypot(dx, dz);
    if (g.state === 'ride' && g.wait > 0) {
      g.wait -= dt;
      if (g.wait <= 0) {
        g.state = 'walk'; g.dest = pickDest(g);
        if (!g.paid) { G.cash += 6; g.paid = true; audio.cash && audio.cash(); }
      }
      continue;
    }
    if (g.state === 'eat' || g.state === 'play' || g.state === 'queue') {
      g.wait -= dt;
      if (g.wait <= 0) {
        if (g.state === 'eat' && !g.paid) { G.cash += 4 + Math.floor(Math.random() * 4); g.paid = true; audio.cash && audio.cash(); }
        if (g.state === 'play' && !g.tix) { /* npc plays, a little cash */ G.cash += 2; g.tix = true; }
        g.state = Math.random() < 0.35 ? 'leave' : 'walk';
        g.dest = g.state === 'leave' ? { x: (Math.random() - 0.5) * 3, z: 18, next: 'leave' } : pickDest(g);
        g.paid = false;
      }
      // bob idle
      g.group.position.y = Math.sin(performance.now() * 0.004 + i) * 0.02;
      g.group.position.set(g.x, g.group.position.y, g.z);
      continue;
    }
    if (dist < 0.55) {
      if (g.dest.next === 'leave' || g.state === 'leave') {
        scene.remove(g.group);
        crowds.splice(i, 1);
        continue;
      }
      if (g.dest.next === 'ride') { g.state = 'ride'; g.wait = 8 + Math.random() * 6; }
      else if (g.dest.next === 'eat') { g.state = 'eat'; g.wait = 3 + Math.random() * 2; }
      else if (g.dest.next === 'play') { g.state = 'play'; g.wait = 2 + Math.random() * 2; }
      else { g.state = 'walk'; g.dest = pickDest(g); }
      continue;
    }
    const spd = g.speed;
    g.heading = Math.atan2(dx, dz);
    g.x += Math.sin(g.heading) * spd * dt;
    g.z += Math.cos(g.heading) * spd * dt;
    // blocked midway: if trying to cross center and blocked, turn back
    if (G.blocking && Math.abs(g.x) < 2.2 && g.z < 8 && g.dest.z < 8) {
      g.state = 'leave';
      g.dest = { x: (Math.random() - 0.5) * 3, z: 18, next: 'leave' };
    }
    const bob = Math.abs(Math.sin(performance.now() * 0.008 * spd + i)) * 0.05;
    g.group.position.set(g.x, bob, g.z);
    g.walkT = (g.walkT || 0) + dt * spd * 2.2;
    g.walkFrame = (g.walkT % 1 < 0.5) ? 0 : 1;
    if (g.sprite) setWalkerFrame(g);
  }
}

function setWalkerFrame(g) {
  const hx = Math.sin(g.heading), hz = Math.cos(g.heading);
  const toward = hx + hz;
  const right = hx - hz;
  const flip = right > 0;
  const back = toward < 0;
  let fi;
  if (g.kind === 'a') fi = g.walkFrame; // 0-1 only
  else fi = (back ? 6 : 0) + g.walkFrame;
  const file = `person_${g.kind}_${fi}${flip ? 'f' : ''}.png`;
  const tex = assets.spr[file] || loadSpr(file);
  if (g.sprite.material.map !== tex) {
    g.sprite.material.map = tex;
    g.sprite.material.needsUpdate = true;
    g.sprite.scale.set(g.h * texAspect(tex), g.h, 1);
  }
}


const _look = new THREE.Vector3();
function updateBillboards() {
  // Painted iso sprites and THREE.Sprite nodes already face the camera.
}

/* ---------- ring toss ---------- */
const RT = { ringsLeft: 3, hits: 0, bottles: [], flying: null, dragging: false, start: null, camSave: null };

function buildRingTossScene() {
  // bottles already on the booth texture; we spawn 3D bottles in front of the booth for the minigame
}

function makeBottle(x, z, color) {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.15, metalness: 0.05, transmission: 0.35, thickness: 0.4,
    transparent: true, opacity: 0.92, envMapIntensity: 1.1
  });
  mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.38, 14), glass, { y: 0.22, parent: g, recv: false });
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), glass, { y: 0.46, parent: g, recv: false });
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), M.metal, { y: 0.53, parent: g, recv: false });
  g.position.set(x, 1.12, z);
  return g;
}

function openRingToss() {
  if (!rides.booth || !rides.booth.placed || G.mode !== 'play') return;
  G.mode = 'ringtoss';
  $('ringtoss').classList.remove('hidden');
  $('hud').classList.add('hidden');
  RT.ringsLeft = 3; RT.hits = 0; RT.flying = null;
  $('rtRings').textContent = '3';
  $('rtHits').textContent = '0';
  RT.camSave = { zoom: G.zoom, pan: G.pan.clone(), follow: G.follow };
  G.follow = false;
  const booth = rides.booth.group;
  const p = rides.booth.footprint;
  // tight playable close-up: painted booth fills the frame
  G.pan.set(p.x - 2.4, 1.35, p.z - 1.8);
  G.zoom = 4.15;
  applyCamera();
  if (vehicle.truck) vehicle.truck.group.visible = false;
  if (vehicle.trailer) vehicle.trailer.group.visible = false;
  if (rides.booth.spr) rides.booth.spr.visible = false;
  if (rides.booth.close) { rides.booth.close.visible = true; rides.booth.close.scale.set(5.8 * texAspect(rides.booth.close.material.map), 5.8, 1); }
  if (world.hangSpr) world.hangSpr.forEach((s) => { s.visible = false; });
  for (const g of crowds) g.group.visible = false;
  if (!RT.group) {
    RT.group = new THREE.Group();
    booth.add(RT.group);
    const colors = [0xc4282a, 0x1c6e4a, 0x1e4d9c, 0xd4a017, 0x7a2ea0, 0xe8e0d0];
    RT.bottles = [];
    for (let i = 0; i < 6; i++) {
      const b = makeBottle(0, 0, colors[i]);
      // on the counter, facing the player
      b.position.set((i - 2.5) * 0.42, 1.2, 0.95);
      RT.group.add(b);
      const wp = b.getWorldPosition(new THREE.Vector3());
      RT.bottles.push({ mesh: b, x: wp.x, y: wp.y, z: wp.z, hit: false });
    }
  } else {
    RT.group.visible = true;
    for (const b of RT.bottles) {
      b.hit = false; b.mesh.visible = true;
      const wp = b.mesh.getWorldPosition(new THREE.Vector3());
      b.x = wp.x; b.y = wp.y; b.z = wp.z;
    }
  }
  audio.chime && audio.chime();
}

function closeRingToss() {
  G.mode = 'play';
  $('ringtoss').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (RT.camSave) {
    G.zoom = RT.camSave.zoom;
    G.pan.copy(RT.camSave.pan);
    G.follow = RT.camSave.follow;
    applyCamera();
  }
  if (RT.group) RT.group.visible = false;
  if (vehicle.truck) vehicle.truck.group.visible = true;
  if (rides.booth && rides.booth.spr) rides.booth.spr.visible = true;
  if (rides.booth && rides.booth.close) rides.booth.close.visible = false;
  if (world.hangSpr) world.hangSpr.forEach((s) => { s.visible = true; });
  for (const g of crowds) g.group.visible = true;
  if (RT.flying && RT.flying.mesh) scene.remove(RT.flying.mesh);
  RT.flying = null;
  setHint(`Tickets: ${G.tickets}`);
}

function throwRing(dirX, dirY, power) {
  if (RT.flying || RT.ringsLeft <= 0) return;
  RT.ringsLeft--;
  $('rtRings').textContent = String(RT.ringsLeft);
  const p = rides.booth.footprint;
  const booth = rides.booth.group;
  const fwd = new THREE.Vector3(0, 0, 1).applyEuler(booth.rotation);
  const start = { x: p.x + fwd.x * 2.4, y: 1.45, z: p.z + fwd.z * 2.4 };
  const meshR = mesh(new THREE.TorusGeometry(0.13, 0.025, 10, 20), new THREE.MeshStandardMaterial({
    color: 0xd43a2f, roughness: 0.35, metalness: 0.05
  }), { x: start.x, y: start.y, z: start.z, recv: false });
  const vx = -fwd.x * (2.2 + power * 5);
  const vy = 2.0 + power * 3.2 + dirY * 2;
  const vz = -fwd.z * (2.2 + power * 5) + dirX * 3.5;
  RT.flying = { mesh: meshR, x: meshR.position.x, y: meshR.position.y, z: meshR.position.z, vx, vy, vz, t: 0 };
  audio.throw && audio.throw();
}

function stepRingToss(dt) {
  const f = RT.flying;
  if (!f) return;
  f.t += dt;
  f.vy -= 9.2 * dt;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.z += f.vz * dt;
  f.mesh.position.set(f.x, f.y, f.z);
  f.mesh.rotation.x += dt * 8;
  f.mesh.rotation.y += dt * 3;
  // hits
  for (const b of RT.bottles) {
    if (b.hit) continue;
    const d = Math.hypot(f.x - b.x, f.z - b.z);
    if (d < 0.16 && f.y > b.y + 0.2 && f.y < b.y + 0.7 && f.vy < 0.5) {
      b.hit = true;
      RT.hits++;
      $('rtHits').textContent = String(RT.hits);
      G.tickets += 3;
      audio.hit && audio.hit();
      // ring sits
      f.mesh.position.set(b.x, b.y + 0.52, b.z);
      f.mesh.rotation.set(Math.PI / 2, 0, 0);
      RT.flying = null;
      if (RT.ringsLeft <= 0) setTimeout(() => { if (G.mode === 'ringtoss') closeRingToss(); }, 1200);
      return;
    }
  }
  if (f.y < 0.8 || f.t > 3.2) {
    scene.remove(f.mesh);
    RT.flying = null;
    audio.miss && audio.miss();
    if (RT.ringsLeft <= 0) setTimeout(() => { if (G.mode === 'ringtoss') closeRingToss(); }, 800);
  }
}


/* ---------- audio (original WebAudio, 120 Hz high-pass, mute) ---------- */
const audio = { ctx: null, master: null, music: null, sfx: null, want: false, step: 0, next: 0 };

function acEnsure() {
  if (audio.ctx) return audio.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = G.muted ? 0 : 0.9;
  master.connect(ctx.destination);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 120;
  const music = ctx.createGain();
  music.gain.value = 0.22;
  music.connect(hp); hp.connect(master);
  const sfx = ctx.createGain();
  sfx.gain.value = 0.6;
  sfx.connect(master);
  audio.ctx = ctx; audio.master = master; audio.music = music; audio.sfx = sfx; audio.hp = hp;
  return ctx;
}
function setMuted(m) {
  G.muted = m;
  if (audio.master) audio.master.gain.setTargetAtTime(m ? 0 : 0.9, audio.ctx.currentTime, 0.05);
  $('btnMute').classList.toggle('muted', m);
  $('btnMute').textContent = m ? '×' : '♪';
  $('optSound').checked = !m;
}
function mf(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function tone(type, f, t, dur, vol, dest, q) {
  const ctx = audio.ctx; if (!ctx || G.muted) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}
function calliope(t, midi, vel) {
  const f = mf(midi);
  tone('sine', f, t, 0.35, vel, audio.music);
  tone('sine', f * 2.005, t, 0.25, vel * 0.35, audio.music);
  tone('triangle', f * 3.01, t, 0.12, vel * 0.12, audio.music);
}
function tickMusic() {
  const ctx = audio.ctx; if (!ctx || !audio.want) return;
  const now = ctx.currentTime;
  if (audio.next < now - 1) audio.next = now + 0.05;
  // original waltz in F, 3/4, cheerful carnival — not a copyrighted melody
  const roots = [65, 65, 69, 62, 65, 70, 67, 62]; // F F A D F Bb G D
  while (audio.next < now + 0.35) {
    const beat = audio.step % 3;
    const bar = Math.floor(audio.step / 3) % roots.length;
    const r = roots[bar];
    if (!G.muted) {
      if (beat === 0) {
        calliope(audio.next, r, 0.09);
        calliope(audio.next, r + 4, 0.05);
        tone('sine', mf(r - 12), audio.next, 0.55, 0.06, audio.music);
      } else if (beat === 1) {
        calliope(audio.next, r + 7, 0.05);
      } else {
        calliope(audio.next, r + (bar % 2 ? 12 : 9), 0.055);
      }
    }
    audio.step++;
    audio.next += 0.28;
  }
}
audio.clank = () => {
  if (!acEnsure() || G.muted) return;
  const t = audio.ctx.currentTime;
  tone('square', 180, t, 0.08, 0.08, audio.sfx);
  tone('triangle', 90, t, 0.12, 0.1, audio.sfx);
};
audio.thump = () => {
  if (!acEnsure() || G.muted) return;
  const t = audio.ctx.currentTime;
  tone('sine', 70, t, 0.12, 0.12, audio.sfx);
};
audio.cash = () => {
  if (!acEnsure() || G.muted) return;
  const t = audio.ctx.currentTime;
  tone('sine', 880, t, 0.08, 0.06, audio.sfx);
  tone('sine', 1320, t + 0.06, 0.1, 0.05, audio.sfx);
};
audio.hydraulics = () => {
  if (!acEnsure() || G.muted) return;
  const t = audio.ctx.currentTime;
  tone('sawtooth', 90, t, 0.8, 0.03, audio.sfx);
  tone('sine', 140, t + 0.2, 0.5, 0.04, audio.sfx);
};
audio.chime = () => {
  if (!acEnsure() || G.muted) return;
  const t = audio.ctx.currentTime;
  [72, 76, 79].forEach((m, i) => tone('sine', mf(m), t + i * 0.08, 0.25, 0.05, audio.sfx));
};
audio.throw = () => {
  if (!acEnsure() || G.muted) return;
  tone('triangle', 240, audio.ctx.currentTime, 0.1, 0.05, audio.sfx);
};
audio.hit = () => {
  if (!acEnsure() || G.muted) return;
  const t = audio.ctx.currentTime;
  tone('sine', 520, t, 0.08, 0.07, audio.sfx);
  tone('sine', 780, t + 0.07, 0.12, 0.06, audio.sfx);
};
audio.miss = () => {
  if (!acEnsure() || G.muted) return;
  tone('sine', 160, audio.ctx.currentTime, 0.12, 0.04, audio.sfx);
};

/* ---------- UI / hint / save ---------- */

function hideTitle() {
  const el = $('title');
  if (el) {
    el.classList.add('hidden');
    el.style.setProperty('display', 'none', 'important');
  }
}
function showTitleEl() {
  const el = $('title');
  if (el) {
    el.classList.remove('hidden');
    el.style.removeProperty('display');
  }
}

function setHint(msg, hold = 4.5) {
  G.hint = msg; G.hintT = hold;
  const el = $('hint');
  el.textContent = msg || '';
  el.style.opacity = msg ? '1' : '0';
}

function updateHUD() {
  $('hudCash').textContent = `$${G.cash}`;
  $('hudTickets').textContent = String(G.tickets);
  $('hudClock').textContent = fmtHour(G.hour);
  $('hudDayLbl').textContent = `DAY ${Math.max(1, G.day | 0)}`;
  $('btnHook').classList.toggle('hidden', !(G.mode === 'play' && !G.hooked && vehicle.trailer && vehicle.trailer.group.visible && !G.placed[G.currentJob] && G.currentJob !== 'done'));
  $('btnSetup').classList.toggle('hidden', !canSetup());
  if (G.hintT > 0) {
    G.hintT -= 0.016;
    if (G.hintT <= 0) { G.hint = ''; $('hint').style.opacity = '0'; }
  }
}

function serialize() {
  const t = vehicle.truck, tr = vehicle.trailer;
  return {
    cash: G.cash, tickets: G.tickets, hour: G.hour, day: G.day,
    muted: G.muted, assist: G.assist,
    placed: { ...G.placed }, currentJob: G.currentJob, hooked: G.hooked, open: G.open,
    truck: t ? { x: t.x, z: t.z, heading: t.heading } : null,
    trailer: tr && tr.group.visible ? { kind: tr.kind, x: tr.x, z: tr.z, heading: tr.heading } : null,
    footprints: ['ferris', 'food', 'booth'].reduce((o, k) => {
      if (rides[k] && rides[k].placed) o[k] = { x: rides[k].footprint.x, z: rides[k].footprint.z, rot: rides[k].group.rotation.y };
      return o;
    }, {})
  };
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) {}
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function validNum(n) { return typeof n === 'number' && Number.isFinite(n); }
function saveLooksValid(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.truck && (!validNum(s.truck.x) || !validNum(s.truck.z) || !validNum(s.truck.heading))) return false;
  if (s.hour != null && !validNum(s.hour)) return false;
  if (s.day != null && (!validNum(s.day) || s.day < 1 || s.day > 999)) return false;
  return true;
}

function resetRidesHidden() {
  for (const k of ['ferris', 'food', 'booth']) {
    if (rides[k]) {
      rides[k].placed = false;
      rides[k].group.visible = false;
      rides[k].group.scale.set(0.02, 0.02, 0.02);
    }
  }
  G.placed = { ferris: false, food: false, booth: false };
  G.open = false;
  G.blocking = false;
  updateBlocking();
}

function newGame() {
  G.mode = 'play';
  G.hour = 15;
  G.day = 1;
  G.cash = 0;
  G.tickets = 0;
  G.follow = true;
  G.zoom = 16;
  resetRidesHidden();
  while (crowds.length) { scene.remove(crowds.pop().group); }
  spawnNextTrailer('ferris');
  G.hooked = true;
  spawnTruckSafe({ hooked: true, follow: true });
  vehicle.jackknife = false;
  const t = vehicle.truck;
  setAtmosphere(G.hour);
  hideTitle();
  $('settings').classList.add('hidden');
  $('hud').classList.remove('hidden');
  setHint('Back the Ferris-wheel trailer onto the west pad. Mind the jackknife.');
  save();
}

function continueGame() {
  const s = loadSave();
  if (!s || !saveLooksValid(s)) return newGame();
  G.mode = 'play';
  G.hour = s.hour ?? 15;
  G.day = s.day ?? 1;
  G.cash = s.cash ?? 0;
  G.tickets = s.tickets ?? 0;
  G.assist = !!s.assist;
  G.currentJob = s.currentJob || 'ferris';
  G.hooked = !!s.hooked;
  G.open = !!s.open;
  G.follow = true;
  resetRidesHidden();
  while (crowds.length) { scene.remove(crowds.pop().group); }
  if (s.footprints) {
    for (const k of Object.keys(s.footprints)) {
      const f = s.footprints[k];
      const pad = world.pads[k];
      placeRide(k, true);
      rides[k].group.position.set(f.x, 0, f.z);
      rides[k].group.rotation.y = f.rot;
      rides[k].footprint.x = f.x; rides[k].footprint.z = f.z;
    }
  }
  const t = vehicle.truck;
  if (s.truck) { t.x = s.truck.x; t.z = s.truck.z; t.heading = s.truck.heading; t.speed = 0; }
  if (s.trailer && s.trailer.kind && !G.placed[s.trailer.kind]) {
    buildTrailer(s.trailer.kind);
    vehicle.trailer.x = s.trailer.x; vehicle.trailer.z = s.trailer.z; vehicle.trailer.heading = s.trailer.heading;
    vehicle.trailer.group.visible = true;
    G.currentJob = s.trailer.kind;
  } else if (!G.placed.ferris) {
    spawnNextTrailer('ferris'); G.hooked = true; vehicle.trailer.heading = t.heading; placeTrailerOnHitch();
  } else if (!G.placed.food) spawnNextTrailer('food');
  else if (!G.placed.booth) spawnNextTrailer('booth');
  if (G.hooked && vehicle.trailer) placeTrailerOnHitch();
  if (!validNum(t.x) || !validNum(t.z) || !validNum(t.heading) || vehicleIsStuck()) {
    spawnTruckSafe({ hooked: G.hooked, follow: true });
    setHint('Welcome back — truck was moved to the entrance so it is not stuck.');
  } else {
    G.pan.set(t.x, 0, t.z);
    setHint('Welcome back.');
  }
  setAtmosphere(G.hour);
  updateBlocking();
  hideTitle();
  $('settings').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('optAssist').checked = G.assist;
  save();
}

function showTitle(force) {
  if (!force && G.mode === 'play' && ready) {
    console.warn("showTitle blocked during play", new Error().stack);
    return;
  }
  G.mode = 'title';
  $('hud').classList.add('hidden');
  $('settings').classList.add('hidden');
  $('ringtoss').classList.add('hidden');
  showTitleEl();
  const has = !!loadSave();
  $('btnContinue').classList.toggle('hidden', !has);
  // attract: dusk, everything set up
  G.hour = 18.55;
  G.follow = false;
  G.zoom = 12.0;
  G.pan.set(-5.5, 0, 2.4);
  resetRidesHidden();
  placeRide('ferris', true);
  placeRide('food', true);
  placeRide('booth', true);
  // use pad positions
  for (const k of ['ferris', 'food', 'booth']) {
    const pad = world.pads[k];
    rides[k].group.position.set(pad.x, 0, pad.z);
    rides[k].group.rotation.y = k === 'ferris' ? pad.heading + Math.PI / 2 : pad.heading;
    rides[k].footprint.x = pad.x; rides[k].footprint.z = pad.z;
    rides[k].group.scale.set(1, 1, 1);
  }
  if (vehicle.trailer) vehicle.trailer.group.visible = false;
  const t = vehicle.truck;
  t.x = 2; t.z = 16.5; t.heading = 0; t.speed = 0;
  G.open = true;
  setAtmosphere(G.hour);
  applyCamera();
}

/* ---------- input handlers ---------- */
function bindInput() {
  const touchy = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (touchy) document.body.classList.add('touch');

  window.addEventListener('keydown', (e) => {
    input.keys[e.code] = true;
    if (e.code === 'KeyE') { if (canSetup()) trySetup(); else tryHook(); }
    if (e.code === 'Escape') {
      if (G.mode === 'ringtoss') closeRingToss();
      else if (G.mode === 'settings') closeSettings();
      else if (G.mode === 'play') openSettings();
    }
    if (e.code === 'KeyM') setMuted(!G.muted);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });

  // wheel
  const pad = $('wheelPad');
  const wheelEl = $('wheel');
  const setSteerFrom = (cx) => {
    const r = pad.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    input.steer = clamp((cx - mid) / (r.width * 0.42), -1, 1);
    wheelEl.style.transform = `rotate(${input.steer * 90}deg)`;
  };
  const listen = (el, type, fn) => el.addEventListener(type, fn, { passive: false });
  const onWheel = (ev) => {
    ev.preventDefault();
    const pt = ev.touches ? ev.touches[0] : ev;
    setSteerFrom(pt.clientX);
    G.follow = true;
  };
  const endWheel = (ev) => {
    if (ev) ev.preventDefault();
    input.steer = 0; input.wheelDragging = false; wheelEl.style.transform = 'rotate(0deg)';
  };
  listen(pad, 'pointerdown', (e) => {
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    input.wheelDragging = true; onWheel(e); acEnsure(); audio.want = true;
  });
  listen(pad, 'pointermove', (e) => { if (input.wheelDragging) onWheel(e); });
  listen(pad, 'pointerup', endWheel);
  listen(pad, 'pointercancel', endWheel);
  listen(pad, 'touchstart', (e) => { input.wheelDragging = true; onWheel(e); acEnsure(); audio.want = true; });
  listen(pad, 'touchmove', (e) => { if (input.wheelDragging) onWheel(e); });
  listen(pad, 'touchend', endWheel);
  listen(pad, 'touchcancel', endWheel);

  const holdBtn = (el, key) => {
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerId != null) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      input[key] = 1;
      el.classList.add('on');
      acEnsure(); audio.want = true; G.follow = true;
    };
    const off = (e) => {
      if (e) e.preventDefault();
      input[key] = 0;
      el.classList.remove('on');
    };
    // Do not listen for pointerleave — iOS Safari often fires it while the finger is still down,
    // which cancelled D/R after one frame and made the truck feel stuck.
    listen(el, 'pointerdown', on);
    listen(el, 'pointerup', off);
    listen(el, 'pointercancel', off);
    listen(el, 'touchstart', on);
    listen(el, 'touchend', off);
    listen(el, 'touchcancel', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  holdBtn($('pDrive'), 'drive');
  holdBtn($('pRev'), 'reverse');
  const touchRoot = $('touch');
  if (touchRoot) touchRoot.addEventListener('contextmenu', (e) => e.preventDefault());

  // canvas pan / pinch / click
  const pointers = input.pointers;
  let lastPinch = 0, panStart = null, lastTap = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    acEnsure(); audio.want = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) panStart = { x: e.clientX, y: e.clientY, panx: G.pan.x, panz: G.pan.z };
    if (G.mode === 'ringtoss' && !RT.flying) {
      RT.dragging = true; RT.start = { x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (G.mode === 'ringtoss' && RT.dragging) return;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinch) {
        const sc = d / lastPinch;
        G.zoom = clamp(G.zoom / sc, 6, 32);
        applyCamera();
      }
      lastPinch = d;
      G.follow = false;
    } else if (pointers.size === 1 && panStart && Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) > 8) {
      // pan in ground plane along iso axes
      const dx = (e.clientX - panStart.x) / window.innerHeight * G.zoom * 2.4;
      const dy = (e.clientY - panStart.y) / window.innerHeight * G.zoom * 2.4;
      // iso yaw 45°
      G.pan.x = panStart.panx - dx * Math.cos(ISO_YAW) - dy * Math.sin(ISO_YAW);
      G.pan.z = panStart.panz + dx * Math.sin(ISO_YAW) - dy * Math.cos(ISO_YAW);
      G.follow = false;
    }
  });
  const endPtr = (e) => {
    if (G.mode === 'ringtoss' && RT.dragging && RT.start) {
      const dx = e.clientX - RT.start.x, dy = e.clientY - RT.start.y;
      const power = clamp(Math.hypot(dx, dy) / 180, 0.15, 1);
      if (dy > 12) throwRing(dx / 180, -dy / 220, power);
      RT.dragging = false; RT.start = null;
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinch = 0;
    if (pointers.size === 0) panStart = null;
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    G.zoom = clamp(G.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 6, 32);
    applyCamera();
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    if (G.mode !== 'play') return;
    // raycast booth
    if (!rides.booth || !rides.booth.placed) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(rides.booth.group, true);
    if (hits.length) openRingToss();
  });

  $('btnPlay').addEventListener('click', () => { acEnsure(); audio.want = true; newGame(); });
  $('btnContinue').addEventListener('click', () => { acEnsure(); audio.want = true; continueGame(); });
  $('btnMute').addEventListener('click', () => { acEnsure(); setMuted(!G.muted); save(); });
  $('btnSettings').addEventListener('click', openSettings);
  $('btnSettingsDone').addEventListener('click', closeSettings);
  $('btnToTitle').addEventListener('click', () => { save(); closeSettings(); showTitle(true); });
  $('optSound').addEventListener('change', () => { acEnsure(); setMuted(!$('optSound').checked); save(); });
  $('optAssist').addEventListener('change', () => { G.assist = $('optAssist').checked; save(); });
  $('btnSetup').addEventListener('click', trySetup);
  $('btnHook').addEventListener('click', tryHook);
  $('btnRtClose').addEventListener('click', closeRingToss);
  const onUnstuck = () => {
    closeSettings();
    if (G.mode !== 'play') return;
    resetTruckToEntrance();
  };
  $('btnUnstuck').addEventListener('click', onUnstuck);
  $('btnResetTruck').addEventListener('click', onUnstuck);
}

function openSettings() {
  if (G.mode === 'ringtoss') return;
  $('settings').classList.remove('hidden');
  $('optSound').checked = !G.muted;
  $('optAssist').checked = G.assist;
  G._prevMode = G.mode;
  G.mode = 'settings';
}
function closeSettings() {
  $('settings').classList.add('hidden');
  G.mode = G._prevMode || 'play';
}

/* ---------- loop / boot ---------- */
let saveAcc = 0;
function tick(dt) {
  dt = clamp(dt, 0, 0.05);
  if (G.mode === 'play' || G.mode === 'title' || G.mode === 'ringtoss') {
    const before = G.hour;
    G.hour += dt * G.timeScale * (G.mode === 'title' ? 0.25 : 1);
    if (before < 24 && G.hour >= 24) {
      G.hour -= 24;
      if (G.mode === 'play') G.day = (G.day | 0) + 1;
    }
    if (!Number.isFinite(G.day) || G.day < 1) G.day = 1;
    setAtmosphere(G.hour);
  }
  if (G.mode === 'play') {
    stepVehicle(dt);
    tickSetup(dt);
    stepCrowds(dt);
    if (G.follow && vehicle.truck) {
      G.pan.x = lerp(G.pan.x, vehicle.truck.x, 1 - Math.pow(0.02, dt));
      G.pan.z = lerp(G.pan.z, vehicle.truck.z, 1 - Math.pow(0.02, dt));
    }
    saveAcc += dt;
    if (saveAcc > 2.5) { saveAcc = 0; save(); }
  }
  if (G.mode === 'ringtoss') stepRingToss(dt);
  if (rides.ferris) rides.ferris.tick(dt);
  if (rides.food) rides.food.tick(dt);
  if (rides.booth) rides.booth.tick(dt);
  syncVehicleMeshes();
  updateBillboards();
  updateCamPos();
  if (G.mode === 'play' || G.mode === 'ringtoss') updateHUD();
  if (audio.ctx && audio.want) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    tickMusic();
  }
}

let ready = false;
function frame() {
  const dt = clock.getDelta();
  if (ready) tick(dt);
  renderBloom();
  requestAnimationFrame(frame);
}

manager.onLoad = () => {
  if (ready) { console.warn("onLoad ignored (already booted)"); return; }
  buildSkyAndLights();
  buildLot();
  buildTruck();
  buildFerris(world.pads.ferris.x, world.pads.ferris.z, world.pads.ferris.heading);
  buildFood(world.pads.food.x, world.pads.food.z, world.pads.food.heading);
  buildBooth(world.pads.booth.x, world.pads.booth.z, world.pads.booth.heading);
  applyCamera();
  bindInput();
  showTitle();
  ready = true;
  $('loading').classList.add('hidden');
  exposeDebug();
};

window.addEventListener('resize', applyCamera);

/* ---------- debug API for Playwright ---------- */
function exposeDebug() {
  window.LOT = {
    get ready() { return ready; },
    G, newGame, continueGame, showTitle, save, loadSave, applyCamera, placeTrailerOnHitch, hitchWorld, camera,
    screenSwing(oldHeading) {
      const t = vehicle.truck;
      const s0 = Math.sin(oldHeading), c0 = Math.cos(oldHeading);
      const s1 = Math.sin(t.heading), c1 = Math.cos(t.heading);
      const left = { x: c0, z: -s0 };
      const toScreen = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
      };
      const origin = toScreen(t.x, 1.0, t.z);
      const oldNose = toScreen(t.x + s0 * 3, 1.0, t.z + c0 * 3);
      const newNose = toScreen(t.x + s1 * 3, 1.0, t.z + c1 * 3);
      const leftPt = toScreen(t.x + left.x * 3, 1.0, t.z + left.z * 3);
      const dx = newNose.x - oldNose.x, dy = newNose.y - oldNose.y;
      const lx = leftPt.x - origin.x, ly = leftPt.y - origin.y;
      return dx * lx + dy * ly;
    },
    steerDebug() {
      const t = vehicle.truck;
      const s = Math.sin(t.heading), c = Math.cos(t.heading);
      const fwd = { x: s, z: c };
      const left = { x: c, z: -s };
      const toScreen = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
      };
      const origin = toScreen(t.x, 1.0, t.z);
      const nose = toScreen(t.x + fwd.x * 3, 1.0, t.z + fwd.z * 3);
      const leftPt = toScreen(t.x + left.x * 3, 1.0, t.z + left.z * 3);
      const wheelY = (t.parts && t.parts.steers || []).map((n) => n.rotation.y);
      return {
        heading: t.heading, steer: t.steer, speed: t.speed,
        fwd, left, origin, nose, leftPt, wheelY,
        inputSteer: input.steer
      };
    },

    SAFE_SPAWN, spawnTruckSafe, evictIfStuck, resetTruckToEntrance, vehicleIsStuck, collideAt, input, vehicle,
    truckPose() {
      const t = vehicle.truck;
      const tr = vehicle.trailer;
      return {
        x: t.x, z: t.z, heading: t.heading, speed: t.speed,
        stuck: vehicleIsStuck(),
        trailer: tr && tr.group && tr.group.visible ? { x: tr.x, z: tr.z, heading: tr.heading, kind: tr.kind } : null
      };
    },
    setHour(h) { G.hour = h; setAtmosphere(h); },
    setMuted,
    hideUI(v) {
      $('hud').classList.toggle('hidden', !!v);
      if (v || G.mode !== 'title') hideTitle();
      else showTitleEl();
      $('loading').classList.add('hidden');
    },
    poseDayLot() {
      newGame(); G.day = 1;
      G.hour = 15.0; setAtmosphere(G.hour);
      hideTitle(); G.follow = false; G.zoom = 15; G.pan.set(-1, 0, 6.5); applyCamera();
      setHint('Back the Ferris-wheel trailer onto the west pad. Mind the jackknife.');
      updateHUD();
    },
    poseBacking() {
      newGame();
      G.hour = 15.2; setAtmosphere(G.hour);
      const t = vehicle.truck, pad = world.pads.ferris;
      // truck in the aisle, trailer angled toward the pad — mid-backup
      t.x = -3.5; t.z = -3.0; t.heading = Math.PI * 0.15; t.speed = 0; t.steer = -0.45;
      G.hooked = true;
      vehicle.trailer.heading = t.heading - 0.55;
      placeTrailerOnHitch();
      hideTitle(); G.follow = false; G.zoom = 11; G.pan.set(-7, 0, -3); applyCamera();
      G.day = 1; setHint('Straighten out — a jackknife means pull forward.');
      updateHUD();
    },
    poseFerris() {
      newGame();
      placeRide('ferris', true);
      placeRide('food', true);
      const pad = world.pads.ferris;
      rides.ferris.group.position.set(pad.x, 0, pad.z);
      G.currentJob = 'food';
      G.hour = 16.2; setAtmosphere(G.hour);
      hideTitle(); G.follow = false; G.zoom = 11.5; G.pan.set(-8, 0, -3); applyCamera();
      G.open = true; G.day = 1;
      setHint('Ferris wheel is up. Crowds are coming. Keep the midway clear.');
      G.cash = 42; G.tickets = 4;
      for (let i = 0; i < 18; i++) spawnGuest();
      updateHUD();
    },
    poseNight() {
      newGame();
      placeRide('ferris', true);
      placeRide('food', true);
      placeRide('booth', true);
      if (vehicle.trailer) vehicle.trailer.group.visible = false;
      const t = vehicle.truck; t.x = 2; t.z = 10; t.heading = -0.4;
      G.hour = 20.2; setAtmosphere(G.hour);
      G.open = true; G.currentJob = 'done'; G.day = 1;
      hideTitle(); G.follow = false; G.zoom = 13.5; G.pan.set(-2.5, 0, 0.5); applyCamera();
      setHint('Night on the lot. Tap the ring-toss booth to play.');
      G.cash = 86; G.tickets = 14;
      for (let i = 0; i < 24; i++) spawnGuest();
      updateHUD();
    },
    poseDusk() {
      newGame();
      placeRide('ferris', true);
      placeRide('food', true);
      placeRide('booth', true);
      if (vehicle.trailer) vehicle.trailer.group.visible = false;
      const t = vehicle.truck; t.x = 4; t.z = 12; t.heading = -0.6;
      G.hour = 18.45; setAtmosphere(G.hour);
      G.open = true; G.currentJob = 'done'; G.day = 1;
      hideTitle(); G.follow = false; G.zoom = 12.2; G.pan.set(-3, 0, 1); applyCamera();
      setHint('Golden hour on the lot.');
      G.cash = 64; G.tickets = 9;
      for (let i = 0; i < 20; i++) spawnGuest();
      updateHUD();
    },
    openRingToss, closeRingToss,
    placeAll() {
      placeRide('ferris', true);
      placeRide('food', true);
      placeRide('booth', true);
      G.currentJob = 'done'; G.open = true; G.hooked = false;
      if (vehicle.trailer) vehicle.trailer.group.visible = false;
      updateBlocking();
    }
  };
}

function boot() {
  preloadArt();
  buildMaterials();
}
boot();
requestAnimationFrame(frame);
