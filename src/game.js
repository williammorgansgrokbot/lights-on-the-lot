// Lights on the Lot — FarmVille-style carnival builder
import * as THREE from '../vendor/three.module.min.js';
import { RGBELoader } from '../vendor/addons/RGBELoader.js';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';
import { KTX2Loader } from '../vendor/addons/KTX2Loader.js';
import { MeshoptDecoder } from '../vendor/addons/meshopt_decoder.module.js';
import { clone as cloneSkinned } from '../vendor/addons/SkeletonUtils.js';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';

const SAVE_KEY = 'wm.lights-on-the-lot.v4';
const TILE = 2;
const DEFAULT_ZOOM = 14;
const START_CASH = 520;
const START_EXTENT = 5;
const XP_LEVELS = [0, 80, 200, 400, 700, 1100];
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmtHour = (h) => {
  const x = ((h % 24) + 24) % 24;
  const hr = Math.floor(x);
  const m = Math.floor((x - hr) * 60);
  const ap = hr >= 12 ? 'PM' : 'AM';
  const h12 = ((hr + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
};
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const quality = {
  shadow: 2048,
  bloomScale: 1,
  dpr: Math.min(2, window.devicePixelRatio || 1)
};
renderer.setPixelRatio(quality.dpr);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

function makeRT(w, h, extra = {}) {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, ...extra });
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
  uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, bloomStr: { value: 0.7 }, exposure: { value: 1.05 } },
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
  const w = Math.max(2, canvas.width), h = Math.max(2, canvas.height);
  const bs = quality.bloomScale == null ? 1 : quality.bloomScale;
  const bw = Math.max(2, Math.round(w * bs)), bh = Math.max(2, Math.round(h * bs));
  if (rtScene) { rtScene.dispose(); rtBright.dispose(); rtBlurA.dispose(); rtBlurB.dispose(); }
  rtScene = makeRT(w, h);
  rtBright = makeRT(bw, bh, { depthBuffer: false });
  rtBlurA = makeRT(bw, bh, { depthBuffer: false });
  rtBlurB = makeRT(bw, bh, { depthBuffer: false });
}
function preferredShadow() {
  const dpr = window.devicePixelRatio || 1;
  return (window.innerWidth >= 1800 || (dpr >= 2 && window.innerWidth >= 1440)) ? 4096 : 2048;
}
function applyShadowSize(size) {
  if (!lights.sun) return;
  const s = size || quality.shadow;
  quality.shadow = s;
  if (lights.sun.shadow.mapSize.x === s) return;
  lights.sun.shadow.mapSize.set(s, s);
  if (lights.sun.shadow.map) { lights.sun.shadow.map.dispose(); lights.sun.shadow.map = null; }
}
function tuneQuality(fps) {
  // Headless or a stalled first frame is not a real Mac fps; don't drop quality on it.
  if (!fps || fps < 8) return;
  G._qLow = (G._qLow || 0) + (fps < 42 ? 1 : 0);
  G._qHi = (G._qHi || 0) + (fps > 56 ? 1 : 0);
  if (fps >= 42) G._qLow = 0;
  if (fps <= 56) G._qHi = 0;
  if (G._qLow >= 4) {
    G._qLow = 0;
    if (quality.bloomScale > 0.55) {
      quality.bloomScale = 0.5;
      allocTargets();
    } else if (quality.shadow > 2048) {
      applyShadowSize(2048);
    }
  } else if (G._qHi >= 8) {
    G._qHi = 0;
    if (quality.shadow < preferredShadow()) applyShadowSize(preferredShadow());
    else if (quality.bloomScale < 1) { quality.bloomScale = 1; allocTargets(); }
  }
}
function renderBloom() {
  if (!rtScene) { renderer.setRenderTarget(null); renderer.clear(); return; }
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
  fsMesh.material = brightMat; brightMat.uniforms.tDiffuse.value = rtScene.texture;
  renderer.setRenderTarget(rtBright); renderer.clear(); renderer.render(fsScene, fsCam);
  const bw = rtBright.width, bh = rtBright.height;
  for (let i = 0; i < 2; i++) {
    fsMesh.material = blurMat;
    blurMat.uniforms.tDiffuse.value = (i === 0 ? rtBright : rtBlurB).texture;
    blurMat.uniforms.dir.value.set((1 + i) / bw, 0);
    renderer.setRenderTarget(rtBlurA); renderer.clear(); renderer.render(fsScene, fsCam);
    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    blurMat.uniforms.dir.value.set(0, (1 + i) / bh);
    renderer.setRenderTarget(rtBlurB); renderer.clear(); renderer.render(fsScene, fsCam);
  }
  fsMesh.material = compMat;
  compMat.uniforms.tDiffuse.value = rtScene.texture;
  compMat.uniforms.tBloom.value = rtBlurB.texture;
  renderer.setRenderTarget(null); renderer.clear(); renderer.render(fsScene, fsCam);
  G.drawCalls = renderer.info.render.calls;
  G.drawTris = renderer.info.render.triangles;
}

const CATALOG = {
  path:      { id:'path', name:'Path', tab:'paths', cost:10, income:0, cap:0, unlock:1, w:1, d:1, model:'path_tile', icon:'path', build:0.4 },
  ferris:    { id:'ferris', name:'Ferris Wheel', tab:'rides', cost:280, income:3.2, cap:64, unlock:1, w:3, d:3, model:'ride_ferris', icon:'ferris', build:2.4 },
  superloop: { id:'superloop', name:'Super Loop', tab:'rides', cost:480, income:5.6, cap:96, unlock:3, w:3, d:3, model:'ride_superloop', icon:'superloop', build:2.8 },
  carousel:  { id:'carousel', name:'Carousel', tab:'rides', cost:320, income:3.8, cap:72, unlock:2, w:3, d:3, model:'ride_carousel', icon:'carousel', build:2.4 },
  tilt:      { id:'tilt', name:'Tilt-A-Whirl', tab:'rides', cost:360, income:4.2, cap:80, unlock:3, w:3, d:3, model:'ride_tilt', icon:'tilt', build:2.4 },
  bumper:    { id:'bumper', name:'Bumper Cars', tab:'rides', cost:420, income:4.6, cap:88, unlock:4, w:3, d:3, model:'ride_bumper', icon:'bumper', build:2.6 },
  corndog:   { id:'corndog', name:'Corn Dogs', tab:'food', cost:80, income:1.3, cap:28, unlock:1, w:2, d:2, model:'vendor_corndog', icon:'corndog', food:'dog', build:1.6 },
  funnelcake:{ id:'funnelcake', name:'Funnel Cake', tab:'food', cost:90, income:1.4, cap:30, unlock:1, w:2, d:2, model:'vendor_funnelcake', icon:'funnelcake', food:'cake', build:1.6 },
  cotton:    { id:'cotton', name:'Cotton Candy', tab:'food', cost:110, income:1.6, cap:34, unlock:2, w:2, d:2, model:'vendor_cotton', icon:'cotton', food:'cotton', build:1.6 },
  lemonade:  { id:'lemonade', name:'Lemonade', tab:'food', cost:100, income:1.5, cap:32, unlock:2, w:2, d:2, model:'vendor_lemonade', icon:'lemonade', food:'lemon', build:1.6 },
  popcorn:   { id:'popcorn', name:'Popcorn', tab:'food', cost:140, income:1.8, cap:38, unlock:3, w:2, d:2, model:'vendor_popcorn', icon:'popcorn', food:'pop', build:1.6 },
  turkey:    { id:'turkey', name:'Turkey Legs', tab:'food', cost:160, income:2.0, cap:42, unlock:3, w:2, d:2, model:'vendor_turkey', icon:'turkey', food:'leg', build:1.6 },
  pizza:     { id:'pizza', name:'Pizza', tab:'food', cost:180, income:2.2, cap:46, unlock:4, w:2, d:2, model:'vendor_pizza', icon:'pizza', food:'pizza', build:1.6 },
  ringtoss:  { id:'ringtoss', name:'Ring Toss', tab:'games', cost:120, income:1.1, cap:24, unlock:1, w:2, d:2, model:'booth_ring', icon:'ringtoss', playable:true, build:1.6 },
  expand:    { id:'expand', name:'Expand Lot', tab:'paths', cost:250, income:0, cap:0, unlock:1, w:0, d:0, model:null, icon:'path', special:'expand' }
};
const CATALOG_ORDER = ['ferris','superloop','carousel','tilt','bumper','corndog','funnelcake','cotton','lemonade','popcorn','turkey','pizza','ringtoss','path','expand'];

const EXPAND_COSTS = [250, 500, 900, 1500];

const TEVY = 'assets/models/tevy/';
const ART = {
  path:      { procedural: 'path' },
  ferris:    { model: 'tevy/ferris-wheel', scale: 0.28, axis: 'z', nightColor: 0xffc878, nightY: 4.8 },
  superloop: { model: 'tevy/coaster-loop', scale: 0.46, train: 'tevy/coaster-train', nightColor: 0x66ffaa, nightY: 3.6 },
  carousel:  { model: 'tevy/carousel', scale: 0.42, nightColor: 0xffd28a, nightY: 3.2 },
  tilt:      { model: 'ride_tilt', scale: 1.0, nightColor: 0xff9a4a, nightY: 2.2 },
  bumper:    { model: 'tevy/bumper-cars', scale: 0.30, nightColor: 0x7ec8ff, nightY: 2.4 },
  corndog:   { parts: [
    { model: 'tevy/hot-dog-cart', scale: 1.15 },
    { model: 'tevy/chalkboard-sign', x: 1.05, z: 1.05, ry: -0.25, scale: 1, sign: 'corndog' },
    { model: 'tevy/food-stool', x: -0.95, z: 0.7, ry: 0.4, scale: 1 }
  ], steam: [0, 1.7, -0.15], nightColor: 0xffc070 },
  funnelcake:{ parts: [
    { model: 'tevy/bakers-awning-stall', scale: 1.2, ry: Math.PI },
    { model: 'tevy/donut-glazed', x: -0.25, y: 1.12, z: 0.45, scale: 1.6 },
    { model: 'tevy/donut-pink', x: 0.28, y: 1.12, z: 0.35, scale: 1.4 },
    { model: 'tevy/chalkboard-sign', x: 1.05, z: 1.15, ry: 0.3, scale: 1, sign: 'funnelcake' }
  ], steam: [0, 1.8, 0.2], nightColor: 0xffd8a0 },
  cotton:    { parts: [
    { model: 'tevy/street-food-stall-cart', scale: 1.05, ry: Math.PI },
    { model: 'tevy/red-lantern', x: 0, y: 0.15, z: 0.15, scale: 0.85 },
    { model: 'tevy/chalkboard-sign', x: 1.15, z: 1.0, ry: -0.2, scale: 1, sign: 'cotton' }
  ], steam: [0, 2.0, 0], nightColor: 0xff8ac8 },
  lemonade:  { parts: [
    { model: 'tevy/bakers-awning-stall', scale: 1.15, ry: Math.PI },
    { model: 'tevy/cooler-box', x: 0.85, z: 0.55, ry: 0.4, scale: 0.9 },
    { model: 'tevy/soda-crate', x: -0.8, z: 0.5, scale: 0.85 },
    { model: 'tevy/chalkboard-sign', x: -1.1, z: 1.15, ry: 0.2, scale: 1, sign: 'lemonade' }
  ], nightColor: 0xfff27a },
  popcorn:   { parts: [
    { model: 'tevy/street-food-stall-cart', scale: 1.05 },
    { model: 'tevy/chalkboard-sign', x: 1.15, z: 1.05, ry: -0.15, scale: 1, sign: 'popcorn' },
    { model: 'tevy/food-stool', x: -1.0, z: 0.55, scale: 1 }
  ], steam: [0, 2.0, 0.1], nightColor: 0xffe08a },
  turkey:    { parts: [
    { model: 'tevy/street-food-stall-cart', scale: 1.08, ry: Math.PI * 0.5 },
    { model: 'tevy/wooden-barrel', x: -1.15, z: 0.4, scale: 0.7 },
    { model: 'tevy/chalkboard-sign', x: 1.2, z: 1.0, ry: -0.3, scale: 1, sign: 'turkey' }
  ], steam: [0, 1.9, 0], nightColor: 0xff8a50 },
  pizza:     { parts: [
    { model: 'tevy/pizza-oven', x: -0.55, scale: 0.95 },
    { model: 'tevy/pepperoni-pizza', x: 0.55, y: 1.05, z: 0.25, scale: 1.8 },
    { model: 'tevy/pizza-peel', x: 0.85, y: 1.02, z: -0.1, ry: 0.6, scale: 1 },
    { model: 'tevy/chalkboard-sign', x: 1.15, z: 1.15, ry: 0.25, scale: 1, sign: 'pizza' }
  ], nightColor: 0xff7040 },
  ringtoss:  { parts: [
    { model: 'tevy/cloth-merchants-stall', scale: 1.25, ry: Math.PI },
    { model: 'tevy/chalkboard-sign', x: 1.15, z: 1.05, ry: -0.2, scale: 1, sign: 'ringtoss' }
  ], nightColor: 0x7ad0ff }
};


const G = {
  mode: 'title', hour: 14, timeScale: 1 / 16,
  cash: 0, xp: 0, level: 1, day: 1, muted: false,
  zoom: DEFAULT_ZOOM, pan: new THREE.Vector3(0, 0, 2),
  hint: '', hintT: 0, lotExtent: START_EXTENT, expandCount: 0,
  tab: 'rides', buildKind: null, moving: null, selected: null
};

const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const assets = { tex: {}, spr: {}, ui: {}, models: {}, clips: {} };
const gltfLoader = new GLTFLoader(manager);
const TEX_ANISO = 8;
const M = {};
const lights = {};
const world = { isoSprites: [], lamps: [], trees: [], lotMesh: null, fence: [], grid: null, shell: [] };
const nightLights = [];
const buildings = [];
const occup = new Map();
const crowds = [];
let ready = false;
let nextId = 1;

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
    roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff, envMapIntensity: opts.env ?? 0.8
  });
  if (opts.normalScale) mat.normalScale.set(opts.normalScale, opts.normalScale);
  return mat;
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
function loadUi(file) {
  const tex = loader.load('assets/ui/icons/' + file);
  tex.colorSpace = THREE.SRGBColorSpace;
  assets.ui[file] = tex;
  return tex;
}

function loadModel(name, path) {
  gltfLoader.load(path, (gltf) => {
    assets.models[name] = gltf.scene;
    if (gltf.animations && gltf.animations.length) assets.clips[name] = gltf.animations;
  }, undefined, (err) => console.error('GLB failed', name, path, err));
}

const SPR_FILES = [
  'tree_oak.png','kiosk.png','balloons.png','crates.png','barrel.png',
  'pool_warm.png','pool_amber.png','pool_ruby.png','glow_warm.png','glow_ruby.png','booth_close.png'
];
for (const ch of ['a','b','c']) {
  const n = ch === 'a' ? 3 : 8;
  for (let i = 0; i < n; i++) SPR_FILES.push(`person_${ch}_${i}.png`, `person_${ch}_${i}f.png`);
}


function preloadArt() {
  const ktx2 = new KTX2Loader(manager).setTranscoderPath('vendor/addons/basis/').detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  for (const f of SPR_FILES) loadSpr(f);
  loadUi('coin.png');
  for (const k of CATALOG_ORDER) loadUi(CATALOG[k].icon + '.png');
  const models = {
    'tevy/ferris-wheel': TEVY + 'ferris-wheel.glb',
    'tevy/carousel': TEVY + 'carousel.glb',
    'tevy/bumper-cars': TEVY + 'bumper-cars.glb',
    'tevy/coaster-loop': TEVY + 'coaster-loop.glb',
    'tevy/coaster-train': TEVY + 'coaster-train.glb',
    'tevy/hot-dog-cart': TEVY + 'hot-dog-cart.glb',
    'tevy/street-food-stall-cart': TEVY + 'street-food-stall-cart.glb',
    'tevy/bakers-awning-stall': TEVY + 'bakers-awning-stall.glb',
    'tevy/street-food-counter': TEVY + 'street-food-counter.glb',
    'tevy/pizza-oven': TEVY + 'pizza-oven.glb',
    'tevy/pepperoni-pizza': TEVY + 'pepperoni-pizza.glb',
    'tevy/cloth-merchants-stall': TEVY + 'cloth-merchants-stall.glb',
    'tevy/newsstand-kiosk': TEVY + 'newsstand-kiosk.glb',
    'tevy/chalkboard-sign': TEVY + 'chalkboard-sign.glb',
    'tevy/cooler-box': TEVY + 'cooler-box.glb',
    'tevy/soda-crate': TEVY + 'soda-crate.glb',
    'tevy/donut-glazed': TEVY + 'donut-glazed.glb',
    'tevy/donut-chocolate': TEVY + 'donut-chocolate.glb',
    'tevy/donut-pink': TEVY + 'donut-pink.glb',
    'tevy/red-lantern': TEVY + 'red-lantern.glb',
    'tevy/food-stool': TEVY + 'food-stool.glb',
    'tevy/pizza-peel': TEVY + 'pizza-peel.glb',
    'tevy/park-bench': TEVY + 'park-bench.glb',
    'tevy/string-lights': TEVY + 'string-lights.glb',
    'tevy/street-lamp': TEVY + 'street-lamp.glb',
    'tevy/city-street-lamp': TEVY + 'city-street-lamp.glb',
    'tevy/waste-bin': TEVY + 'waste-bin.glb',
    'tevy/crowd-barrier': TEVY + 'crowd-barrier.glb',
    'tevy/concrete-planter': TEVY + 'concrete-planter.glb',
    'tevy/geranium': TEVY + 'geranium.glb',
    'tevy/picnic-table': TEVY + 'picnic-table.glb',
    'tevy/corner-flag': TEVY + 'corner-flag.glb',
    'tevy/hanging-banner': TEVY + 'hanging-banner.glb',
    'tevy/bollard': TEVY + 'bollard.glb',
    'tevy/hedge': TEVY + 'hedge.glb',
    'tevy/ginkgo-tree': TEVY + 'ginkgo-tree.glb',
    'tevy/young-spruce': TEVY + 'young-spruce.glb',
    'tevy/rope-barrier': TEVY + 'rope-barrier.glb',
    'tevy/potted-pine': TEVY + 'potted-pine.glb',
    'tevy/wooden-barrel': TEVY + 'wooden-barrel.glb',
    'tevy/casual-walker': TEVY + 'casual-walker.glb',
    'tevy/dog-walker': TEVY + 'dog-walker.glb',
    'tevy/road-worker': TEVY + 'road-worker.glb',
    'ride_tilt': 'assets/models/ride_tilt.glb',
    'prop_balloons': 'assets/models/prop_balloons.glb',
    'prop_bunting': 'assets/models/prop_bunting.glb'
  };
  for (const [n, p] of Object.entries(models)) loadModel(n, p);
  for (const k of ['corndog','funnelcake','cotton','lemonade','popcorn','turkey','pizza','ringtoss','tickets']) {
    const t = loader.load(`assets/textures/signs/${k}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = TEX_ANISO;
    assets.ui['sign_' + k] = t;
  }
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
    map, transparent: true, depthWrite: !additive, depthTest: true,
    alphaTest: additive ? 0.0 : alphaTest,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: true
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
  spr.renderOrder = opts.order ?? 5;
  if (opts.parent) opts.parent.add(spr); else scene.add(spr);
  return spr;
}
function lightPool(map, w, d, parent, x, z, y = 0.04) {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 2;
  (parent || scene).add(m);
  nightLights.push({ pool: m, poolMat: mat, poolBoost: 1.15 });
  return m;
}


function buildMaterials() {
  M.asphalt = pbr('asphalt_lines', { repeat: 6, roughness: 0.95, normalScale: 1.15, color: 0xffffff });
  M.midway = pbr('midway', { repeat: 2, roughness: 0.92, normalScale: 1.2, color: 0xffffff });
  M.grass = pbr('grass', { repeat: 12, roughness: 0.95, normalScale: 1.4, color: 0xe8f0d8 });
  M.concrete = pbr('concrete', { repeat: 3, roughness: 0.9, normalScale: 0.8 });
  M.wood = pbr('wood', { repeat: 2, roughness: 0.85, normalScale: 1.0 });
  M.metal = pbr('metal', { repeat: 2, roughness: 0.35, metalness: 0.85, env: 1.2, normalScale: 0.5 });
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd4b15a, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.3 });
  M.shadowBlob = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  M.ghostOk = new THREE.MeshStandardMaterial({ color: 0x44cc66, transparent: true, opacity: 0.38, depthWrite: false, roughness: 0.6 });
  M.ghostNo = new THREE.MeshStandardMaterial({ color: 0xcc3344, transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.6 });
  M.sign = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.35 });
}

function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx, sy, sz, parent = scene, cast = true, recv = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (sx) m.scale.set(sx, sy ?? sx, sz ?? sx);
  m.castShadow = cast; m.receiveShadow = recv;
  parent.add(m);
  return m;
}
function addBlobShadow(parent, sx, sz, opacity = 0.28) {
  const s = mesh(new THREE.CircleGeometry(1, 16), M.shadowBlob, {
    y: 0.03, rx: -Math.PI / 2, sx, sy: 1, sz, parent, cast: false, recv: false
  });
  s.material = M.shadowBlob.clone();
  s.material.opacity = opacity;
  return s;
}

let _rtW = 0, _rtH = 0;
function applyCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const z = G.zoom, aspect = w / Math.max(1, h);
  camera.left = -z * aspect; camera.right = z * aspect;
  camera.top = z; camera.bottom = -z;
  camera.near = -250; camera.far = 400;
  camera.updateProjectionMatrix();
  if (canvas.width !== _rtW || canvas.height !== _rtH) {
    _rtW = canvas.width; _rtH = canvas.height; allocTargets();
  }
  updateCamPos();
}
function updateCamPos() {
  const d = 90, cy = Math.sin(ISO_PITCH), ch = Math.cos(ISO_PITCH);
  camera.position.set(G.pan.x + Math.sin(ISO_YAW) * ch * d, G.pan.y + cy * d, G.pan.z + Math.cos(ISO_YAW) * ch * d);
  camera.lookAt(G.pan.x, 0.4, G.pan.z);
}

function buildSkyAndLights() {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
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
        vec3 nig=texture2D(tNight,uv).rgb*1.15+vec3(0.02,0.03,0.08);
        gl_FragColor=vec4(mix(day,nig,mixN),1.0);
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 48, 24), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky); lights.sky = sky;
  lights.hemi = new THREE.HemisphereLight(0xffe2c4, 0x3a2a1c, 0.9); scene.add(lights.hemi);
  lights.sun = new THREE.DirectionalLight(0xffd7a0, 2.8);
  lights.sun.castShadow = true;
  quality.shadow = preferredShadow();
  lights.sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  lights.sun.shadow.bias = -0.00035;
  lights.sun.shadow.normalBias = 0.06;
  const s = lights.sun.shadow.camera;
  s.left = -40; s.right = 40; s.top = 40; s.bottom = -40; s.near = 1; s.far = 160;
  scene.add(lights.sun); scene.add(lights.sun.target);
  lights.fill = new THREE.DirectionalLight(0x8aa4c8, 0.28);
  lights.fill.position.set(-30, 20, -20); scene.add(lights.fill);
  lights.ambient = new THREE.AmbientLight(0x2a241c, 0.12); scene.add(lights.ambient);
  lights.pmrem = new THREE.PMREMGenerator(renderer);
  const bakeEnv = (hdr, fallbackHemi) => {
    if (hdr) { hdr.mapping = THREE.EquirectangularReflectionMapping; return lights.pmrem.fromEquirectangular(hdr).texture; }
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
    L.position.set(x, y, z); scene.add(L);
  }
  const bulbMat = new THREE.SpriteMaterial({
    map: loadSpr('glow_warm.png'), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(color)
  });
  const bulb = new THREE.Sprite(bulbMat);
  bulb.position.set(x, y, z); bulb.scale.set(0.7, 0.7, 1); bulb.renderOrder = 6;
  scene.add(bulb);
  const rec = { light: L, bulb, bulbMat, baseInt: intensity, color };
  nightLights.push(rec);
  return rec;
}

function applySpriteTint(obj, color) {
  if (!obj) return;
  obj.traverse?.((c) => {
    if (c.isSprite && c.material && !c.userData.keepLit) c.material.color.copy(color);
  });
  if (obj.isSprite && obj.material && !obj.userData.keepLit) obj.material.color.copy(color);
}

function setAtmosphere(hour) {
  const h = ((hour % 24) + 24) % 24;
  const dayF = smooth(5.6, 7.0, h) * (1 - smooth(17.4, 18.8, h));
  const duskF = smooth(16.8, 18.0, h) * (1 - smooth(19.2, 20.6, h));
  const dawnF = smooth(5.2, 6.4, h) * (1 - smooth(7.0, 8.2, h));
  const nightF = 1 - smooth(5.4, 6.8, h) * (1 - smooth(18.0, 19.4, h));
  const lampF = clamp(nightF + duskF * 0.9 + dawnF * 0.5, 0, 1);
  const elev = (h < 6 || h > 19) ? -0.12 : Math.sin(((h - 6) / 13) * Math.PI);
  const az = ((h - 6) / 12) * Math.PI;
  lights.sun.position.set(Math.cos(az) * 60, Math.max(2, elev * 70 + 6), Math.sin(az) * 36);
  lights.sun.target.position.copy(G.pan);
  const sunCol = new THREE.Color().setRGB(1, 0.93, 0.78);
  if (duskF > 0.05) sunCol.setRGB(1.0, 0.62 + 0.2 * (1 - duskF), 0.28 + 0.2 * (1 - duskF));
  if (dayF > 0.7 && h >= 16.5) sunCol.setRGB(1.0, 0.82, 0.52);
  if (nightF > 0.7) sunCol.setRGB(0.45, 0.55, 0.85);
  lights.sun.color.copy(sunCol);
  lights.sun.intensity = nightF > 0.85 ? 0.08 : (0.55 + dayF * 2.4 + duskF * 2.1);
  lights.hemi.intensity = 0.08 + dayF * 0.85 + duskF * 0.40;
  lights.hemi.color.set(dayF > 0.5 && duskF < 0.4 ? 0xffe6c8 : (duskF > 0.25 ? 0xffb078 : 0x3a4a78));
  lights.hemi.groundColor.set(dayF > 0.3 ? 0x5a4030 : 0x161018);
  lights.fill.color.set(duskF > 0.3 ? 0xff8a50 : 0x88a8d0);
  lights.fill.intensity = 0.04 + dayF * 0.18 + duskF * 0.22;
  lights.ambient.intensity = 0.06 + dayF * 0.16 + lampF * 0.08;
  const fog = new THREE.Color(0xe8d2b0).lerp(new THREE.Color(0xc86840), duskF).lerp(new THREE.Color(0x140820), nightF * 0.85);
  scene.fog.color.copy(fog);
  scene.fog.density = 0.00115 + nightF * 0.0010;
  scene.background.copy(nightF > 0.6 ? new THREE.Color(0x1a0a28) : fog);
  lights.sky.material.uniforms.mixN.value = clamp(nightF * 0.85 + duskF * 0.9, 0, 1);
  if (lights.envDay && lights.envNight) scene.environment = lampF > 0.55 ? lights.envNight : lights.envDay;
  const expo = 1.15 + duskF * 0.18 - nightF * 0.02;
  renderer.toneMappingExposure = expo;
  compMat.uniforms.exposure.value = expo;
  compMat.uniforms.bloomStr.value = 0.22 + lampF * 1.15 + duskF * 0.35;
  brightMat.uniforms.threshold.value = 0.72 - lampF * 0.28;
  for (const n of nightLights) {
    if (n.light) n.light.intensity = n.baseInt * lampF;
    if (n.bulbMat) { n.bulbMat.opacity = 0.15 + lampF * 0.95; n.bulb.scale.setScalar(0.45 + lampF * 1.1); }
    if (n.poolMat) n.poolMat.opacity = lampF * (n.poolBoost || 1.15);
  }
  const tint = new THREE.Color(1, 1, 1);
  if (duskF > 0.15) tint.setRGB(1.05, 0.82, 0.62);
  else if (dayF > 0.5) tint.setRGB(1.02, 0.97, 0.90);
  else tint.setRGB(0.35 + lampF * 0.2, 0.36 + lampF * 0.16, 0.5);
  for (const g of crowds) applySpriteTint(g.group, tint);
  for (const s of (world.isoSprites || [])) {
    const keep = s.userData && s.userData.keepLit;
    applySpriteTint(s, (keep && lampF > 0.4) ? new THREE.Color(1, 0.95, 0.85) : tint);
  }
  G._dayF = dayF; G._nightF = nightF; G._lampF = lampF; G._duskF = duskF;
}

function keyOf(cx, cz) { return cx + ',' + cz; }
function worldToCell(x, z) { return { cx: Math.round(x / TILE), cz: Math.round(z / TILE) }; }
function cellWorld(cx, cz) { return { x: cx * TILE, z: cz * TILE }; }
function owned(cx, cz) { return Math.max(Math.abs(cx), Math.abs(cz)) <= G.lotExtent; }
function lotSize() { return (G.lotExtent * 2 + 1) * TILE; }

function cellsFor(kind, cx, cz, rot = 0) {
  const cat = CATALOG[kind];
  if (!cat || cat.special) return [];
  let w = cat.w, d = cat.d;
  if (rot % 2 === 1) { w = cat.d; d = cat.w; }
  const ox = Math.floor((w - 1) / 2), oz = Math.floor((d - 1) / 2);
  const out = [];
  for (let ix = 0; ix < w; ix++) for (let iz = 0; iz < d; iz++) out.push({ cx: cx + ix - ox, cz: cz + iz - oz });
  return out;
}

function resetInstPool(bucket) {
  const pool = instPools[bucket];
  if (!pool) return;
  for (const name of Object.keys(pool)) {
    const rec = pool[name];
    for (const im of rec.ims) scene.remove(im);
    delete pool[name];
  }
}

function clearLotShell() {
  resetInstPool('shell');
  for (const o of (world.shell || [])) scene.remove(o);
  world.shell = [];
  for (let i = nightLights.length - 1; i >= 0; i--) {
    if (nightLights[i]._shell) {
      if (nightLights[i].light) scene.remove(nightLights[i].light);
      if (nightLights[i].bulb) scene.remove(nightLights[i].bulb);
      if (nightLights[i].pool) scene.remove(nightLights[i].pool);
      nightLights.splice(i, 1);
    }
  }
}

function buildFenceRun(x0, x1, z, gap) {
  const posts = [];
  for (let x = x0; x <= x1 + 0.01; x += 1.6) {
    if (gap && x > gap.x0 && x < gap.x1) continue;
    posts.push(x);
    world.shell.push(mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.15, 8), M.wood, { x, y: 0.58, z }));
  }
  for (const yRail of [0.35, 0.75]) {
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i], b = posts[i + 1];
      if (b - a > 2.2) continue;
      world.shell.push(mesh(new THREE.BoxGeometry(b - a, 0.06, 0.05), M.metal, { x: (a + b) / 2, y: yRail, z }));
    }
  }
}


function rebuildLotShell() {
  clearLotShell();
  const S = lotSize();
  const grass = mesh(new THREE.PlaneGeometry(110, 110), M.grass, { y: 0, rx: -Math.PI / 2, recv: true, cast: false });
  world.shell.push(grass);
  const lot = mesh(new THREE.PlaneGeometry(S, S), M.asphalt, { y: 0.01, rx: -Math.PI / 2, recv: true, cast: false });
  world.lotMesh = lot; world.shell.push(lot);
  const half = G.lotExtent * TILE + TILE * 0.5;
  const curbH = 0.18;
  const addCurb = (x, z, w, d) => world.shell.push(mesh(new THREE.BoxGeometry(w, curbH, d), M.concrete, { x, y: curbH / 2 + 0.02, z }));
  addCurb(0, -half - 0.2, S + 0.8, 0.4);
  addCurb(-half - 0.2, 0, 0.4, S + 0.8);
  addCurb(half + 0.2, 0, 0.4, S + 0.8);
  const gapW = TILE * 3;
  const side = (S - gapW) / 2;
  if (side > 0.4) {
    addCurb(-(gapW / 2 + side / 2), half + 0.2, side, 0.4);
    addCurb( (gapW / 2 + side / 2), half + 0.2, side, 0.4);
  }

  // 3D crowd barriers along the fence line, with a gate opening to the south
  const placeDec = (name, x, z, scale = 1, ry = 0, y = 0) => {
    const g = cloneModel(name, scale);
    if (!g) return null;
    g.position.set(x, y, z);
    g.rotation.y = ry;
    scene.add(g);
    world.shell.push(g);
    return g;
  };
  const instDec = (name, x, z, scale = 1, ry = 0, y = 0, shadows = false) => {
    addInstance('shell', name, x, z, scale, ry, y, shadows, 128);
  };
  const step = 3.2;
  for (const zWall of [-half, half]) {
    for (let x = -half + 0.4; x <= half - 0.4; x += step) {
      if (zWall === half && Math.abs(x) < gapW / 2 + 0.4) continue;
      instDec('tevy/crowd-barrier', x, zWall, 0.95, zWall > 0 ? Math.PI : 0);
    }
  }
  for (const xWall of [-half, half]) {
    for (let z = -half + 0.4; z <= half - 0.4; z += step) {
      instDec('tevy/crowd-barrier', xWall, z, 0.95, xWall > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  // Entrance: ticket kiosk, rope, flags, bollards
  const kx = -gapW / 2 - 2.1, kz = half - 0.15;
  placeDec('tevy/newsstand-kiosk', kx, kz, 0.85, Math.PI);
  const sign = placeDec('tevy/chalkboard-sign', kx + 1.15, kz + 0.7, 1.0, 0.15);
  if (sign) addSignBoard(sign, 'tickets');
  placeDec('tevy/rope-barrier', gapW * 0.15, half + 0.15, 1.0, 0);
  instDec('tevy/bollard', -gapW / 2 + 0.2, half + 0.35, 1.0, 0);
  instDec('tevy/bollard',  gapW / 2 - 0.2, half + 0.35, 1.0, 0);
  instDec('tevy/corner-flag', -gapW / 2 - 0.6, half + 0.2, 1.35, 0);
  instDec('tevy/corner-flag',  gapW / 2 + 0.6, half + 0.2, 1.35, 0.2);
  const kl = addNightLight(kx, 2.15, kz, 0xffd8a0, 2.4, 8, 2, false); kl._shell = true;
  lightPool(loadSpr('pool_warm.png'), 4.2, 3.4, scene, kx, kz, 0.045);
  nightLights[nightLights.length - 1]._shell = true;

  // Corner lamps (real city/street lamps, scaled to carnival height)
  const corners = [[-half + 1.1, -half + 1.1, true], [half - 1.1, -half + 1.1, false],
                   [-half + 1.1, half - 1.1, false], [half - 1.1, half - 1.1, true]];
  corners.forEach(([x, z, real], i) => {
    placeDec('tevy/street-lamp', x, z, 0.55, i * 0.7);
    const rec = addNightLight(x, 4.3, z, 0xffc888, 6.0, 14, 2, !!real);
    rec._shell = true;
    lightPool(loadSpr('pool_warm.png'), 7, 6, scene, x, z, 0.04);
    nightLights[nightLights.length - 1]._shell = true;
    instDec('tevy/potted-pine', x + (x > 0 ? -1.1 : 1.1), z + (z > 0 ? -1.1 : 1.1), 1.1, i);
  });

  // Interior lot edge decor: benches, bins, planters, bunting stands, balloon clusters, flags
  const inner = half - 1.4;
  const edgeDecor = [
    ['tevy/park-bench', -inner + 1.5, -inner, 1, 0],
    ['tevy/park-bench',  inner - 1.5, -inner, 1, 0],
    ['tevy/park-bench', -inner, 0.5, 1, Math.PI / 2],
    ['tevy/park-bench',  inner, -0.5, 1, -Math.PI / 2],
    ['tevy/park-bench', -inner + 4.2, inner - 0.3, 1, Math.PI],
    ['tevy/waste-bin', -inner + 3.2, -inner + 0.2, 1, 0],
    ['tevy/waste-bin',  inner - 3.2, -inner + 0.2, 1, 0.4],
    ['tevy/waste-bin', -inner + 0.3, inner - 3.6, 1, 0.2],
    ['tevy/geranium', -inner + 0.3, -2.5, 1.1, 0.2],
    ['tevy/geranium',  inner - 0.3, 2.2, 1.1, 0.8],
    ['tevy/geranium', -inner + 2.8, inner - 0.4, 1.05, 1.3],
    ['tevy/concrete-planter', -inner + 0.4, 3.4, 0.45, 0],
    ['tevy/concrete-planter',  inner - 0.4, -3.4, 0.45, 0.3],
    ['tevy/concrete-planter', inner - 0.4, 4.6, 0.45, 0.6],
    ['prop_balloons', -inner + 2.2, inner - 1.6, 1.0, 0.2],
    ['prop_balloons',  inner - 2.4, inner - 1.4, 1.05, 1.1],
    ['prop_balloons', -2.2, -inner + 0.8, 0.95, 0.5],
    ['prop_balloons',  3.4, inner - 0.9, 1.0, 0.8],
    ['prop_bunting', 0, -inner + 0.15, 1.0, 0],
    ['prop_bunting', -inner + 0.15, -2, 1.0, Math.PI / 2],
    ['prop_bunting',  inner - 0.15, 2, 1.0, Math.PI / 2],
    ['prop_bunting', 0, inner - 0.15, 1.0, 0],
    ['tevy/corner-flag', -inner, -inner, 1.4, 0.4],
    ['tevy/corner-flag',  inner, -inner, 1.4, -0.3],
    ['tevy/corner-flag', -inner, inner - 0.2, 1.35, 0.1],
    ['tevy/corner-flag',  inner, inner - 0.2, 1.35, -0.2]
  ];
  for (const [n, x, z, sc, ry] of edgeDecor) instDec(n, x, z, sc, ry);
  placeDec('tevy/hanging-banner', -inner + 0.2, inner - 2.4, 0.85, Math.PI / 2);
  placeDec('tevy/picnic-table', inner - 2.6, 0.8, 0.9, 0.2);
  // festoon lights on stands along the north fence (not strung across the lot)
  for (const x of [-inner + 3, 0, inner - 3]) {
    const sl = placeDec('tevy/string-lights', x, -inner + 0.35, 0.9, 0, 1.8);
    if (sl) sl.rotation.z = 0.05;
  }

  if (world.grid) scene.remove(world.grid);
  const div = G.lotExtent * 2 + 1;
  const grid = new THREE.GridHelper(S, div, 0xc9a050, 0x8a7040);
  grid.position.y = 0.03;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.visible = !!G.buildKind || !!G.moving;
  scene.add(grid);
  world.grid = grid; world.shell.push(grid);

  const sc = lights.sun.shadow.camera;
  const ext = Math.max(28, S * 0.7);
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
}


function plantDecor() {
  for (const t of world.trees || []) scene.remove(t);
  world.trees = [];
  resetInstPool('trees');
  const spots = [
    [-24, -10, 0.85, 0.2], [-28, 2, 0.7, 1.1], [-25, 16, 0.8, 0.4],
    [24, -12, 0.9, 2.0], [28, 2, 0.72, 0.6], [25, 16, 0.82, 1.4],
    [-18, -26, 0.95, 0.3], [0, -28, 1.05, 0.9], [18, -26, 0.78, 2.2],
    [-30, 20, 0.7, 0.1], [30, 20, 0.88, 1.7], [10, 28, 0.75, 0.5], [-10, 28, 0.8, 2.4],
    [-26, -16, 0.8, 0.6], [26, -16, 0.88, 1.3], [-34, -4, 0.65, 0.9], [34, 10, 0.7, 0.2],
    [-16, 30, 0.9, 1.8], [16, 30, 0.76, 0.4], [6, -32, 0.92, 1.0], [-6, -32, 0.7, 0.3],
    [-22, -20, 0.55, 0.0, 'tevy/young-spruce'], [22, -20, 0.6, 0.8, 'tevy/young-spruce'],
    [-32, 8, 0.5, 1.2, 'tevy/young-spruce'], [32, -6, 0.55, 0.4, 'tevy/young-spruce'],
    [-34, 24, 0.6, 2.1, 'tevy/young-spruce'], [34, 16, 0.58, 0.7, 'tevy/young-spruce']
  ];
  for (const rec of spots) {
    const [x, z, sc, ry] = rec;
    const name = rec[4] || 'tevy/ginkgo-tree';
    addInstance('trees', name, x, z, sc, ry, 0, true, 48);
  }
  for (const [x, z, ry] of [[-20, 0, Math.PI / 2], [20, 0, Math.PI / 2], [0, -20, 0], [-20, 12, Math.PI / 2], [20, -12, Math.PI / 2], [12, -20, 0]]) {
    addInstance('trees', 'tevy/hedge', x, z, 1.1, ry, 0, false, 16);
  }
}



function addSignBoard(parent, key, off = { x: 0, y: 0.62, z: 0.26 }) {
  const tex = assets.ui['sign_' + key];
  if (!tex) return;
  const mat = M.sign.clone();
  mat.map = tex;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.82), mat);
  m.position.set(off.x || 0, off.y ?? 0.62, off.z ?? 0.26);
  m.castShadow = false;
  parent.add(m);
  return m;
}

function buildArt(kind) {
  const spec = ART[kind];
  const cat = CATALOG[kind];
  if (!spec || spec.procedural === 'path') {
    const g = new THREE.Group();
    const tile = mesh(new THREE.BoxGeometry(TILE * 0.96, 0.07, TILE * 0.96), M.midway, {
      y: 0.04, parent: g, cast: false, recv: true
    });
    mesh(new THREE.BoxGeometry(TILE * 0.98, 0.03, TILE * 0.98), M.concrete, {
      y: 0.015, parent: g, cast: false, recv: true
    });
    return g;
  }
  const root = new THREE.Group();
  const parts = spec.parts;
  if (parts) {
    for (const p of parts) {
      const m = cloneModel(p.model, p.scale ?? 1, { shadows: false, shareMaterials: true });
      if (!m) continue;
      m.position.set(p.x || 0, p.y || 0, p.z || 0);
      m.rotation.y = p.ry || 0;
      if (p.sign) addSignBoard(m, p.sign);
      root.add(m);
    }
  } else if (spec.model) {
    const isRide = ['ferris','superloop','carousel','tilt','bumper'].includes(kind);
    const m = cloneModel(spec.model, spec.scale ?? 1, { shadows: isRide, shareMaterials: !isRide });
    if (m) root.add(m);
  }
  if (spec.steam) {
    const holder = new THREE.Group();
    holder.name = 'steam';
    holder.position.set(spec.steam[0], spec.steam[1], spec.steam[2]);
    root.add(holder);
  }
  return root;
}
const KEEP_NODE = /^(wheel|gondola_\d+|seat_(inner|outer)_\d+|car_\d+|platform|canopy|arm)$/i;
function modelIsSkinned(root) {
  let s = false;
  root.traverse((o) => { if (o.isSkinnedMesh) s = true; });
  return s;
}
function mergeStaticByMaterial(root) {
  if (!root || modelIsSkinned(root)) return;
  for (const c of [...root.children]) mergeStaticByMaterial(c);
  const meshKids = [];
  for (const c of root.children) {
    if (c.isMesh && !c.isSkinnedMesh && !KEEP_NODE.test(c.name) && !Array.isArray(c.material)) meshKids.push(c);
  }
  if (meshKids.length < 2) return;
  const groups = new Map();
  for (const m of meshKids) {
    const key = m.material;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    const geoms = [];
    for (const mesh of list) {
      mesh.updateMatrix();
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrix);
      geoms.push(g);
    }
    let merged = null;
    try { merged = mergeGeometries(geoms, false); } catch (err) { merged = null; }
    geoms.forEach((g) => g.dispose());
    if (!merged) continue;
    const nm = new THREE.Mesh(merged, mat);
    nm.name = (list[0].name || 'mesh') + '_merged';
    nm.castShadow = list.some((m) => m.castShadow);
    nm.receiveShadow = list.some((m) => m.receiveShadow);
    for (const mesh of list) root.remove(mesh);
    root.add(nm);
  }
}
function optimizeAllModels() {
  for (const root of Object.values(assets.models)) {
    if (!root) continue;
    mergeStaticByMaterial(root);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        o.geometry.computeBoundingSphere();
      }
    });
  }
}

const _dummy = new THREE.Object3D();
const instPools = { shell: {}, trees: {} };
function addInstance(bucket, name, x, z, scale, ry, y, shadows, maxCount) {
  let rec = instPools[bucket][name];
  if (!rec) {
    const tmp = cloneModel(name, 1, { shareMaterials: true, shadows: !!shadows });
    if (!tmp) return;
    tmp.updateMatrixWorld(true);
    const ims = [];
    tmp.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      const im = new THREE.InstancedMesh(geo, o.material, maxCount || 96);
      im.castShadow = !!shadows;
      im.receiveShadow = true;
      im.count = 0;
      im.frustumCulled = false;
      im.name = 'inst_' + name;
      scene.add(im);
      ims.push(im);
    });
    rec = instPools[bucket][name] = { ims, count: 0 };
  }
  if (!rec.ims.length) return;
  const max = rec.ims[0].instanceMatrix.array.length / 16;
  if (rec.count >= max) return;
  const i = rec.count++;
  _dummy.position.set(x, y || 0, z);
  _dummy.rotation.set(0, ry || 0, 0);
  _dummy.scale.setScalar(scale == null ? 1 : scale);
  _dummy.updateMatrix();
  for (const im of rec.ims) {
    im.setMatrixAt(i, _dummy.matrix);
    im.count = rec.count;
    im.instanceMatrix.needsUpdate = true;
  }
}

function cloneModel(name, scale = 1, opts = {}) {
  const src = assets.models[name];
  if (!src) return null;
  const share = opts.shareMaterials !== false;
  const shadows = !!opts.shadows;
  let skinned = false;
  src.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
  const c = skinned ? cloneSkinned(src) : src.clone(true);
  c.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = shadows;
      o.receiveShadow = true;
      if (!share && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      }
    }
  });
  if (scale && scale !== 1) c.scale.setScalar(scale);
  return c;
}
function footprintCenter(kind, cx, cz, rot) {
  const cells = cellsFor(kind, cx, cz, rot);
  let x = 0, z = 0;
  for (const c of cells) { x += c.cx; z += c.cz; }
  const n = Math.max(1, cells.length);
  return { x: (x / n) * TILE, z: (z / n) * TILE };
}


function hookParts(b, root, opts = {}) {
  const parts = { bulbs: [], gondolas: [], horses: [], seats: [], cars: [], steam: [], signs: [], emi: [], wheel: null, arm: null, car: null, platform: null, canopy: null };
  const axis = (ART[b.kind] && ART[b.kind].axis) || 'x';
  parts.wheelAxis = axis;
  root.traverse((o) => {
    const n = o.name || '';
    if (n === 'wheel') parts.wheel = o;
    if (n === 'arm' || (o.userData && o.userData.role === 'arm')) parts.arm = o;
    if (n === 'car' && !/^car_\d/.test(n)) parts.car = o;
    if (n === 'platform' || (o.userData && o.userData.role === 'platform')) parts.platform = o;
    if (n === 'canopy') parts.canopy = o;
    if (/^gondola_\d+$/.test(n)) parts.gondolas.push(o);
    if (/^seat_(inner|outer)_\d+$/.test(n)) {
      o.userData.baseY = o.position.y;
      parts.seats.push(o);
      parts.horses.push(o);
    }
    if (/^car_\d+$/.test(n)) parts.cars.push(o);
    if (n === 'steam' || (o.userData && o.userData.role === 'steam')) parts.steam.push(o);
    if (n === 'sign' || (o.userData && o.userData.role === 'sign')) parts.signs.push(o);
    if (/bulb/i.test(n)) parts.bulbs.push(o);
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if (mat && mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.05) parts.emi.push(mat);
      }
    }
  });
  if (b.kind === 'superloop' && !parts.arm) {
    const rail = root.getObjectByName('loop_vertical_red') || root.getObjectByName('loop_vertical');
    const host = (rail && rail.parent) ? rail.parent : root;
    const arm = new THREE.Group();
    arm.name = 'arm';
    // The tevy loop lives in the XY plane. Snap the arm to the rail mesh center.
    let radius = 8.15;
    if (rail) {
      arm.position.copy(rail.position);
      if (rail.geometry) {
        rail.geometry.computeBoundingBox();
        const bb = rail.geometry.boundingBox;
        if (bb) {
          const geoCenter = bb.getCenter(new THREE.Vector3());
          const size = bb.getSize(new THREE.Vector3());
          const rLocal = Math.max(size.x, size.y) * 0.5 - Math.min(size.x, size.y, size.z) * 0.18;
          const scl = Math.max(rail.scale.x || 1, 0.001);
          if (rLocal > 1) radius = rLocal * scl;
          if (geoCenter.length() > 0.15) {
            const wc = geoCenter.clone();
            rail.localToWorld(wc);
            host.worldToLocal(wc);
            arm.position.copy(wc);
          }
        }
      }
    } else {
      arm.position.set(-1.59, 8.75, 6.99);
    }
    parts.armAxis = 'z';
    const train = cloneModel('tevy/coaster-train', 1, { shadows: true });
    let car = null;
    if (train) {
      const srcCar = train.getObjectByName('car_1');
      if (srcCar) {
        const holder = new THREE.Group();
        srcCar.parent.remove(srcCar);
        holder.add(srcCar);
        srcCar.position.set(0, 0, 0);
        car = holder;
      } else car = train;
      // host is already scaled by ART.superloop.scale; radius is in unscaled host space.
      // Rotate so the car's long axis is tangent to the loop; scale up so it reads on a Mac screen.
      car.rotation.y = Math.PI / 2;
      car.scale.setScalar(2.2);
      car.position.set(0, -radius, 0);
      car.userData.loopRadius = radius;
      arm.add(car);
    }
    host.add(arm);
    parts.arm = arm;
    parts.car = car;
  }
  if (b.kind === 'bumper') {
    const lim = 2.4;
    for (const c of parts.cars) {
      c.userData.home = c.position.clone();
      c.userData.vx = (Math.random() * 2 - 1) * 1.6;
      c.userData.vz = (Math.random() * 2 - 1) * 1.6;
      c.userData.lim = lim;
    }
  }
  for (const s of parts.steam) {
    for (let i = 0; i < 3; i++) {
      const spr = isoSprite(loadSpr('glow_warm.png'), 0.45, { parent: s, additive: true, cy: 0.5, y: 0.1 + i * 0.15, order: 8 });
      spr.material.opacity = 0.0;
      spr.userData.keepLit = true;
      spr.userData.steamI = i;
    }
  }
  b.parts = parts;
  const spec = ART[b.kind];
  if (!opts.preview && spec && spec.nightColor && b.kind !== 'path') {
    const rec = addNightLight(0, spec.nightY || 2.4, 0, spec.nightColor, 3.2, 9, 2, false);
    rec.bulb.position.set(0, spec.nightY || 2.4, 0);
    b.group.add(rec.bulb);
    if (rec.light) { rec.light.position.set(0, spec.nightY || 2.4, 0); b.group.add(rec.light); }
    rec._building = b.id;
  }
}

function syncOccup(b, on) {
  for (const c of b.cells) {
    if (on) occup.set(keyOf(c.cx, c.cz), b);
    else if (occup.get(keyOf(c.cx, c.cz)) === b) occup.delete(keyOf(c.cx, c.cz));
  }
}

function canPlace(kind, cx, cz, rot, ignore) {
  const cat = CATALOG[kind];
  if (!cat || cat.special) return false;
  const cells = cellsFor(kind, cx, cz, rot);
  if (!cells.length) return false;
  for (const c of cells) {
    if (!owned(c.cx, c.cz)) return false;
    const hit = occup.get(keyOf(c.cx, c.cz));
    if (hit && hit !== ignore) return false;
  }
  return true;
}

function makeCoinSprite(b) {
  const spr = isoSprite(assets.ui['coin.png'] || loadUi('coin.png'), 0.7, { cy: 0.5, y: 0, order: 12 });
  spr.userData.keepLit = true;
  spr.userData.coinOf = b.id;
  spr.visible = false;
  b.group.add(spr);
  const cat = CATALOG[b.kind];
  spr.position.set(0, (cat.w >= 3 ? 4.6 : 2.8), 0);
  b.coin = spr;
  return spr;
}


function placeBuilding(kind, cx, cz, rot = 0, opts = {}) {
  const cat = CATALOG[kind];
  if (!cat || cat.special) return null;
  if (!opts.force && !canPlace(kind, cx, cz, rot, opts.ignore)) return null;
  const cells = cellsFor(kind, cx, cz, rot);
  const mid = footprintCenter(kind, cx, cz, rot);
  const group = new THREE.Group();
  group.position.set(mid.x, 0, mid.z);
  group.rotation.y = (rot % 4) * Math.PI / 2;
  const model = buildArt(kind);
  if (model) group.add(model);
  else mesh(new THREE.BoxGeometry(cat.w * TILE * 0.8, 1.2, cat.d * TILE * 0.8), M.wood, { y: 0.6, parent: group });
  addBlobShadow(group, cat.w * 0.7, cat.d * 0.7, 0.3);
  scene.add(group);
  const b = {
    id: opts.id || nextId++,
    kind, cx, cz, rot, cells, group, model,
    stored: opts.stored || 0,
    buildT: opts.buildT != null ? opts.buildT : cat.build,
    parts: {}
  };
  if (model) hookParts(b, model);
  makeCoinSprite(b);
  if (kind !== 'path') {
    const col = (kind === 'ferris' || kind === 'superloop') ? 'pool_ruby.png' : (cat.tab === 'food' ? 'pool_amber.png' : 'pool_warm.png');
    lightPool(loadSpr(col), cat.w * 1.8, cat.d * 1.8, group, 0, 0, 0.05);
  }
  buildings.push(b);
  syncOccup(b, true);
  if (b.buildT > 0) group.scale.setScalar(0.08);
  return b;
}
function removeBuilding(b) {
  syncOccup(b, false);
  for (let i = nightLights.length - 1; i >= 0; i--) {
    if (nightLights[i]._building === b.id) {
      if (nightLights[i].light && nightLights[i].light.parent) nightLights[i].light.parent.remove(nightLights[i].light);
      if (nightLights[i].bulb && nightLights[i].bulb.parent) nightLights[i].bulb.parent.remove(nightLights[i].bulb);
      nightLights.splice(i, 1);
    }
  }
  scene.remove(b.group);
  const i = buildings.indexOf(b);
  if (i >= 0) buildings.splice(i, 1);
  if (G.selected === b) selectBuilding(null);
}

function isPathCell(cx, cz) {
  const b = occup.get(keyOf(cx, cz));
  return b && b.kind === 'path';
}
function entranceCell() { return { cx: 0, cz: G.lotExtent }; }

function reachableSet() {
  const start = entranceCell();
  const seen = new Set();
  const q = [];
  if (isPathCell(start.cx, start.cz)) { q.push(start); seen.add(keyOf(start.cx, start.cz)); }
  for (let cx = -G.lotExtent; cx <= G.lotExtent; cx++) {
    const c = { cx, cz: G.lotExtent };
    if (isPathCell(c.cx, c.cz) && !seen.has(keyOf(c.cx, c.cz))) { q.push(c); seen.add(keyOf(c.cx, c.cz)); }
  }
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length) {
    const c = q.shift();
    for (const [dx, dz] of dirs) {
      const n = { cx: c.cx + dx, cz: c.cz + dz };
      const k = keyOf(n.cx, n.cz);
      if (seen.has(k) || !isPathCell(n.cx, n.cz)) continue;
      seen.add(k); q.push(n);
    }
  }
  return seen;
}

function isConnected(b) {
  if (b.kind === 'path') return true;
  const reach = reachableSet();
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const c of b.cells) {
    for (const [dx, dz] of dirs) {
      if (reach.has(keyOf(c.cx + dx, c.cz + dz))) return true;
    }
  }
  return false;
}

function adjacentPathCell(b) {
  const reach = reachableSet();
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const c of b.cells) {
    for (const [dx, dz] of dirs) {
      if (reach.has(keyOf(c.cx + dx, c.cz + dz))) return { cx: c.cx + dx, cz: c.cz + dz };
    }
  }
  return null;
}

function checkLevel() {
  let up = false;
  while (G.level < XP_LEVELS.length && G.xp >= XP_LEVELS[G.level]) {
    G.level += 1;
    up = true;
  }
  if (up) onLevelUp();
}

function onLevelUp() {
  const unlocked = CATALOG_ORDER.filter((k) => CATALOG[k].unlock === G.level).map((k) => CATALOG[k].name);
  const msg = unlocked.length ? `LEVEL ${G.level}\n${unlocked.join(', ')} unlocked` : `LEVEL ${G.level}`;
  const el = $('levelUp');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2400);
  audio.chime && audio.chime();
  setHint(`Level ${G.level}! New attractions unlocked.`);
  populateTray();
}

function grantXP(n) { G.xp += Math.floor(n); checkLevel(); updateHUD(); populateTray(); }

function collectBuilding(b, silent) {
  const amt = Math.floor(b.stored);
  if (amt <= 0) return 0;
  b.stored -= amt;
  G.cash += amt;
  grantXP(amt * 0.4);
  if (!silent) {
    audio.cash && audio.cash();
    spawnCashPop(b, amt);
  }
  updateCoin(b);
  updateHUD();
  save();
  return amt;
}

function spawnCashPop(b, amt) {
  const p = b.group.position.clone(); p.y = 2.2;
  p.project(camera);
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = '+$' + amt;
  el.style.left = ((p.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-p.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  $('pops').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function updateCoin(b) {
  if (!b.coin) return;
  const cat = CATALOG[b.kind];
  const readyAmt = cat && cat.income > 0 && b.buildT <= 0 && b.stored >= Math.max(6, cat.cap * 0.18);
  b.coin.visible = !!readyAmt;
  if (readyAmt) {
    const t = performance.now() * 0.003;
    b.coin.position.y = (cat.w >= 3 ? 4.4 : 2.6) + Math.sin(t + b.id) * 0.12;
    const s = 0.65 + Math.sin(t * 2 + b.id) * 0.06;
    b.coin.scale.set(s, s, 1);
  }
}

function stepIncome(dt) {
  for (const b of buildings) {
    const cat = CATALOG[b.kind];
    if (!cat || !cat.income) { if (b.buildT > 0) b.buildT = Math.max(0, b.buildT - dt); continue; }
    if (b.buildT > 0) {
      b.buildT -= dt;
      const t = 1 - clamp(b.buildT / Math.max(0.2, cat.build), 0, 1);
      b.group.scale.setScalar(0.08 + t * 0.92);
      if (b.buildT <= 0) { b.group.scale.setScalar(1); audio.chime && audio.chime(); }
      continue;
    }
    const connected = isConnected(b);
    const nGuests = crowds.filter((g) => g.targetId === b.id).length;
    const rate = cat.income * (connected ? 1 : 0.12) * (1 + nGuests * 0.12);
    b.stored = Math.min(cat.cap, b.stored + rate * dt);
    updateCoin(b);
  }
}

function expandCost() { return EXPAND_COSTS[Math.min(G.expandCount, EXPAND_COSTS.length - 1)]; }
function doExpand() {
  const c = expandCost();
  if (G.cash < c || G.lotExtent >= 11) return false;
  G.cash -= c;
  G.expandCount += 1;
  G.lotExtent += 2;
  rebuildLotShell();
  grantXP(40);
  setHint('The lot grows. Lay path to the new ground.');
  audio.chime && audio.chime();
  updateHUD(); populateTray(); save();
  return true;
}



function playGuest(g, name) {
  if (!g.actions) return;
  if (g.act === name) return;
  const next = g.actions[name] || g.actions.idle || Object.values(g.actions)[0];
  if (!next) return;
  if (g.act && g.actions[g.act]) g.actions[g.act].fadeOut(0.2);
  next.reset().fadeIn(0.2).play();
  g.act = name;
}

function applySitPose(root, on) {
  if (!root) return;
  root.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (!on) return;
    if (n === 'hips') { if (o.userData.baseY == null) o.userData.baseY = o.position.y; o.position.y = o.userData.baseY - 0.28; o.rotation.x = 0.22; }
    if (n.startsWith('thigh')) o.rotation.x = 1.25;
    if (n.startsWith('calf')) o.rotation.x = -1.15;
    if (n === 'spine' || n === 'spine1') o.rotation.x = 0.12;
  });
}

function findOpenSeat(b) {
  const p = b.parts || {};
  const list = [];
  if (p.gondolas && p.gondolas.length) list.push(...p.gondolas);
  else if (p.seats && p.seats.length) list.push(...p.seats);
  else if (p.cars && p.cars.length) list.push(...p.cars);
  else if (p.car) list.push(p.car);
  for (const s of list) if (!s.userData.taken) return s;
  return null;
}

function boardRide(guest, b) {
  const seat = findOpenSeat(b);
  if (!seat) return false;
  guest.ride = b;
  guest.seat = seat;
  guest.state = 'ride';
  guest.wait = 7 + Math.random() * 5;
  seat.userData.taken = guest;
  seat.attach(guest.group);
  let sitY = 0.02, sitScale = 0.42, sitYaw = Math.PI;
  if (b.kind === 'ferris') { sitY = -1.85; sitScale = 0.42; }
  if (b.kind === 'carousel') { sitY = 0.15; sitScale = 0.55; }
  if (b.kind === 'superloop') { sitY = 0.38; sitScale = 0.82 / 2.2; sitYaw = 0; }
  if (b.kind === 'tilt' || b.kind === 'bumper') { sitY = 0.22; sitScale = 0.55; }
  // prefer a child named seat
  let seatMesh = null;
  seat.traverse((o) => { if (/_seat$/.test(o.name) && !seatMesh) seatMesh = o; });
  if (seatMesh) {
    const lp = seat.worldToLocal(seatMesh.getWorldPosition(new THREE.Vector3()));
    guest.group.position.copy(lp);
    guest.group.position.y += 0.02;
  } else {
    guest.group.position.set(0, sitY, 0);
  }
  guest.group.rotation.set(0, sitYaw, 0);
  guest.group.scale.setScalar(sitScale);
  if (guest.mixer) guest.mixer.stopAllAction();
  guest.act = null;
  applySitPose(guest.model, true);
  return true;
}

function unboardRide(guest) {
  const seat = guest.seat;
  if (seat) seat.userData.taken = null;
  const pos = new THREE.Vector3();
  guest.group.getWorldPosition(pos);
  scene.attach(guest.group);
  guest.x = pos.x; guest.z = pos.z;
  guest.group.position.set(guest.x, 0, guest.z);
  guest.group.rotation.set(0, guest.heading, 0);
  guest.group.scale.setScalar(1);
  guest.ride = null; guest.seat = null;
  applySitPose(guest.model, false);
  playGuest(guest, 'walk');
}

function spawnGuest() {
  const names = ['tevy/casual-walker', 'tevy/dog-walker', 'tevy/road-worker'];
  const weighted = Math.random();
  const name = weighted < 0.55 ? names[0] : (weighted < 0.85 ? names[1] : names[2]);
  const g = new THREE.Group();
  const model = cloneModel(name, 1, { shareMaterials: name === 'tevy/casual-walker' ? false : true, shadows: false });
  let mixer = null, actions = {}, hand = null;
  if (model) {
    // casual variety: tint clothing
    const tint = new THREE.Color().setHSL(Math.random(), 0.35 + Math.random() * 0.25, 0.42);
    model.traverse((o) => {
      if (o.isMesh && o.material && o.material.color && name === 'tevy/casual-walker' && Math.random() < 0.7) {
        o.material.color.lerp(tint, 0.35);
      }
      if (o.isBone && /hand_R/i.test(o.name)) hand = o;
    });
    g.add(model);
    const clips = assets.clips[name] || [];
    if (clips.length) {
      mixer = new THREE.AnimationMixer(model);
      for (const c of clips) {
        const a = mixer.clipAction(c);
        a.enabled = true;
        actions[c.name] = a;
      }
    }
  } else {
    const spr = isoSprite(loadSpr('person_b_0.png'), 1.2, { parent: g, order: 7, alphaTest: 0.2 });
    g.userData.sprite = spr;
  }
  addBlobShadow(g, 0.28, 0.28, 0.25);
  scene.add(g);
  const ent = entranceCell();
  const w = cellWorld(ent.cx, ent.cz);
  const guest = {
    group: g, model, mixer, actions, hand, kind: name,
    x: w.x + (Math.random() - 0.5) * 0.4,
    z: w.z + 0.6 + Math.random() * 0.4,
    heading: Math.PI, speed: 1.15 + Math.random() * 0.5,
    state: 'walk', wait: 0, path: [], targetId: null, food: null,
    walkT: Math.random(), walkFrame: 0, act: null, ride: null, seat: null
  };
  g.position.set(guest.x, 0, guest.z);
  playGuest(guest, 'walk');
  crowds.push(guest);
  return guest;
}

function bfsPath(from, to) {
  if (!from || !to) return [];
  const startK = keyOf(from.cx, from.cz), goalK = keyOf(to.cx, to.cz);
  if (startK === goalK) return [from];
  const q = [from], prev = new Map(), seen = new Set([startK]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length) {
    const c = q.shift();
    for (const [dx, dz] of dirs) {
      const n = { cx: c.cx + dx, cz: c.cz + dz };
      const k = keyOf(n.cx, n.cz);
      if (seen.has(k) || !isPathCell(n.cx, n.cz)) continue;
      seen.add(k); prev.set(k, c); q.push(n);
      if (k === goalK) {
        const path = [n];
        let cur = n;
        while (keyOf(cur.cx, cur.cz) !== startK) {
          cur = prev.get(keyOf(cur.cx, cur.cz));
          if (!cur) break;
          path.push(cur);
        }
        path.reverse();
        return path;
      }
    }
  }
  return [];
}

function pickGuestTarget(guest) {
  const reach = reachableSet();
  const opts = buildings.filter((b) => b.kind !== 'path' && b.buildT <= 0 && isConnected(b));
  if (!opts.length) return null;
  const b = opts[Math.floor(Math.random() * opts.length)];
  const cell = adjacentPathCell(b);
  if (!cell || !reach.has(keyOf(cell.cx, cell.cz))) return null;
  const here = worldToCell(guest.x, guest.z);
  const start = isPathCell(here.cx, here.cz) ? here : entranceCell();
  const path = bfsPath(start, cell);
  if (!path.length) return null;
  guest.targetId = b.id;
  guest.path = path;
  guest.state = 'walk';
  return b;
}


function giveFood(guest, kind) {
  if (guest.food) { guest.group.remove(guest.food); guest.food = null; }
  const foodMap = {
    dog: 'tevy/hot-dog-cart', cake: 'tevy/donut-glazed', cotton: null,
    lemon: 'tevy/coffee-cup', pop: null, leg: null, pizza: 'tevy/pepperoni-pizza'
  };
  // coffee-cup may be missing from load list — use fallback mesh
  let meshF = null;
  if (kind === 'pizza' && assets.models['tevy/pepperoni-pizza']) {
    meshF = cloneModel('tevy/pepperoni-pizza', 0.55);
    if (meshF) meshF.position.set(0.18, 1.05, 0.14);
  } else if (kind === 'cake' && assets.models['tevy/donut-glazed']) {
    meshF = cloneModel('tevy/donut-glazed', 0.7);
    if (meshF) meshF.position.set(0.16, 1.08, 0.12);
  }
  if (!meshF) {
    const colors = { dog: 0xb8860b, cake: 0xf5e6c8, cotton: 0xff9ac8, lemon: 0xffe14a, pop: 0xfff2c4, leg: 0x8a3a18, pizza: 0xe8b03a };
    meshF = new THREE.Mesh(
      kind === 'cotton' ? new THREE.SphereGeometry(0.09, 10, 8) : new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: colors[kind] || 0xffe8a0, roughness: 0.55, emissive: kind === 'cotton' ? 0x331022 : 0x000000 })
    );
    meshF.position.set(0.16, 1.05, 0.10);
  }
  if (guest.hand) guest.hand.add(meshF);
  else guest.group.add(meshF);
  guest.food = meshF;
  guest.foodT = 8 + Math.random() * 5;
}


function setWalkerFrame(g) {
  if (g.model) {
    g.group.rotation.y = g.heading;
    if (g.state === 'walk' || g.state === 'leave') playGuest(g, 'walk');
    else if (g.state === 'queue' || g.state === 'use') playGuest(g, Math.random() < 0.02 ? 'look_around' : 'idle');
    return;
  }
  const spr = g.group.userData.sprite;
  if (!spr) return;
  const hx = Math.sin(g.heading), hz = Math.cos(g.heading);
  const toward = hx + hz, right = hx - hz;
  const flip = right > 0, back = toward < 0;
  let fi = (back ? 6 : 0) + g.walkFrame;
  const file = `person_b_${Math.min(fi, 7)}${flip ? 'f' : ''}.png`;
  const tex = assets.spr[file] || loadSpr(file);
  if (spr.material.map !== tex) {
    spr.material.map = tex; spr.material.needsUpdate = true;
  }
}


function stepCrowds(dt) {
  const attrs = buildings.filter((b) => b.kind !== 'path' && b.buildT <= 0).length;
  const want = attrs ? Math.min(32, 8 + attrs * 2) : 0;
  if (crowds.length < want && Math.random() < dt * 1.8) spawnGuest();

  for (let i = crowds.length - 1; i >= 0; i--) {
    const g = crowds[i];
    if (g.mixer) g.mixer.update(dt);
    if (g.foodT > 0) {
      g.foodT -= dt;
      if (g.foodT <= 0 && g.food) { g.food.parent && g.food.parent.remove(g.food); g.food = null; }
    }
    if (g.state === 'ride') {
      g.wait -= dt;
      if (g.wait <= 0) {
        unboardRide(g);
        const b = buildings.find((x) => x.id === g.targetId);
        if (b && CATALOG[b.kind] && CATALOG[b.kind].food) giveFood(g, CATALOG[b.kind].food);
        if (Math.random() < 0.3) { g.state = 'leave'; g.path = bfsPath(worldToCell(g.x, g.z), entranceCell()); g.targetId = null; }
        else { g.state = 'walk'; pickGuestTarget(g); }
      }
      continue;
    }
    if (g.state === 'use' || g.state === 'queue') {
      g.wait -= dt;
      g.group.position.set(g.x, 0, g.z);
      setWalkerFrame(g);
      if (g.wait <= 0) {
        const b = buildings.find((x) => x.id === g.targetId);
        if (b) {
          const cat = CATALOG[b.kind];
          if (cat.tab === 'rides' && boardRide(g, b)) continue;
          if (cat.food) giveFood(g, cat.food);
          b.stored = Math.min(cat.cap, b.stored + cat.income * 1.2);
        }
        if (Math.random() < 0.3) { g.state = 'leave'; g.path = bfsPath(worldToCell(g.x, g.z), entranceCell()); g.targetId = null; }
        else { g.state = 'walk'; pickGuestTarget(g); }
      }
      continue;
    }
    if (!g.path || !g.path.length) {
      if (g.state === 'leave') { scene.remove(g.group); crowds.splice(i, 1); continue; }
      if (!pickGuestTarget(g)) {
        g.state = 'leave';
        g.path = bfsPath(worldToCell(g.x, g.z), entranceCell()) || [];
      }
    }
    if (!g.path || !g.path.length) continue;
    const stepC = g.path[0];
    const w = cellWorld(stepC.cx, stepC.cz);
    const dx = w.x - g.x, dz = w.z - g.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.28) {
      g.path.shift();
      if (!g.path.length) {
        if (g.state === 'leave') { scene.remove(g.group); crowds.splice(i, 1); continue; }
        g.state = 'queue';
        g.wait = 1.6 + Math.random() * 2.2;
        playGuest(g, 'idle');
      }
      continue;
    }
    g.heading = Math.atan2(dx, dz);
    g.x += Math.sin(g.heading) * g.speed * dt;
    g.z += Math.cos(g.heading) * g.speed * dt;
    g.group.position.set(g.x, 0, g.z);
    g.walkT += dt * g.speed * 2.2;
    g.walkFrame = (g.walkT % 1 < 0.5) ? 0 : 1;
    setWalkerFrame(g);
  }
}


function animateRides(dt, t) {
  const lampF = G._lampF || 0;
  for (const b of buildings) {
    const p = b.parts || {};
    if (p.wheel) {
      const ax = p.wheelAxis || 'z';
      p.wheel.rotation[ax] += dt * 0.32;
      p.gondolas.forEach((g, i) => { g.rotation[ax] = -p.wheel.rotation[ax] + Math.sin(t * 1.6 + i) * 0.07; });
    }
    if (p.arm) p.arm.rotation[p.armAxis || 'x'] += dt * 1.15;
    if (p.platform && (b.kind === 'carousel' || b.kind === 'tilt')) {
      p.platform.rotation.y += dt * (b.kind === 'tilt' ? 0.95 : 0.55);
    }
    if (p.canopy && b.kind === 'carousel') p.canopy.rotation.y += dt * 0.55;
    p.seats.forEach((h, i) => { h.position.y = (h.userData.baseY || 0) + Math.sin(t * 3.1 + i * 0.8) * 0.14; });
    p.horses.forEach((h, i) => {
      if (p.seats.includes(h)) return;
      h.position.y = 0.15 + Math.sin(t * 3.1 + i * 0.8) * 0.14;
    });
    p.cars.forEach((c, i) => {
      if (b.kind === 'tilt') c.rotation.y += dt * 1.7;
      if (b.kind === 'bumper') {
        const home = c.userData.home;
        const lim = 2.15;
        c.position.x += (c.userData.vx || 0) * dt;
        c.position.z += (c.userData.vz || 0) * dt;
        const ox = c.position.x - (home ? home.x : 0);
        const oz = c.position.z - (home ? home.z : 0);
        if (Math.abs(ox) > lim) { c.userData.vx *= -1; c.position.x = (home ? home.x : 0) + clamp(ox, -lim, lim); }
        if (Math.abs(oz) > lim) { c.userData.vz *= -1; c.position.z = (home ? home.z : 0) + clamp(oz, -lim, lim); }
        c.rotation.y = Math.atan2(c.userData.vx || 0, c.userData.vz || 1);
        for (let j = i + 1; j < p.cars.length; j++) {
          const o = p.cars[j];
          const dx = o.position.x - c.position.x, dz = o.position.z - c.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.15 && d > 0.01) {
            const nx = dx / d, nz = dz / d;
            const rel = ((c.userData.vx || 0) - (o.userData.vx || 0)) * nx + ((c.userData.vz || 0) - (o.userData.vz || 0)) * nz;
            if (rel < 0) {
              c.userData.vx -= rel * nx; c.userData.vz -= rel * nz;
              o.userData.vx += rel * nx; o.userData.vz += rel * nz;
            }
          }
        }
      }
    });
    p.signs.forEach((s) => { s.rotation.y += dt * 0.85; });
    p.steam.forEach((s) => {
      s.children.forEach((spr) => {
        if (!spr.isSprite) return;
        const i = spr.userData.steamI || 0;
        const ph = ((t * 0.35 + i * 0.33) % 1);
        spr.position.y = 0.1 + ph * 0.7;
        spr.material.opacity = ((G._lampF || 0) > 0.3 ? 0.45 : 0.28) * (1 - ph);
        const sc = 0.3 + ph * 0.5;
        spr.scale.set(sc, sc, 1);
      });
    });
    const pulse = (i) => 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 7 + i * 0.55));
    p.bulbs.forEach((bulb, i) => {
      const pu = pulse(i);
      bulb.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissive) o.material.emissiveIntensity = 0.25 + lampF * pu * 3.2;
      });
    });
    p.emi.forEach((mat, i) => { mat.emissiveIntensity = 0.2 + lampF * pulse(i) * 2.8; });
  }
}

const ghost = { group: null, kind: null, ok: false, cx: 0, cz: 0, rot: 0 };
function clearGhost() {
  if (ghost.group) { scene.remove(ghost.group); ghost.group = null; }
  ghost.kind = null;
}

function ensureGhost(kind) {
  if (ghost.kind === kind && ghost.group) return;
  clearGhost();
  const cat = CATALOG[kind];
  if (!cat || cat.special) return;
  const g = new THREE.Group();
  const model = buildArt(kind);
  if (model) {
    model.traverse((o) => { if (o.isMesh) { o.material = M.ghostOk.clone(); o.castShadow = false; } });
    g.add(model);
  } else {
    mesh(new THREE.BoxGeometry(cat.w * TILE * 0.9, 0.4, cat.d * TILE * 0.9), M.ghostOk, { y: 0.2, parent: g, cast: false });
  }
  scene.add(g);
  ghost.group = g; ghost.kind = kind; ghost.rot = 0;
}
function tintGhost(ok) {
  if (!ghost.group) return;
  ghost.group.traverse((o) => {
    if (o.isMesh && o.material && o.material.color) o.material.color.copy(ok ? M.ghostOk.color : M.ghostNo.color);
  });
}
function updateGhostAt(cx, cz) {
  if (!ghost.group || !ghost.kind) return;
  ghost.cx = cx; ghost.cz = cz;
  ghost.ok = canPlace(ghost.kind, cx, cz, ghost.rot, G.moving);
  const mid = footprintCenter(ghost.kind, cx, cz, ghost.rot);
  ghost.group.position.set(mid.x, 0.04, mid.z);
  ghost.group.rotation.y = (ghost.rot % 4) * Math.PI / 2;
  tintGhost(ghost.ok);
}

function setHint(t, dur = 3.5) {
  G.hint = t; G.hintT = dur;
  const el = $('hint');
  el.textContent = t || '';
  el.style.opacity = t ? '1' : '0';
}
function populateTray() {
  const box = $('trayCards');
  if (!box) return;
  const tab = G.tab;
  box.innerHTML = '';
  for (const id of CATALOG_ORDER) {
    const cat = CATALOG[id];
    if (cat.tab !== tab) continue;
    const locked = G.level < cat.unlock;
    const cost = id === 'expand' ? expandCost() : cat.cost;
    const card = document.createElement('button');
    card.className = 'card' + (G.buildKind === id ? ' on' : '') + (locked ? ' locked' : '');
    if (!locked && G.cash < cost) card.classList.add('cant');
    if (id === 'expand' && G.lotExtent >= 11) card.classList.add('cant');
    card.dataset.kind = id;
    if (locked) card.dataset.lock = 'LVL ' + cat.unlock;
    const inc = cat.income ? `<span class="inc">+${cat.income.toFixed(1)}/s</span>` : '<span></span>';
    const price = id === 'expand' ? (G.lotExtent >= 11 ? 'MAX' : '$' + cost) : '$' + cost;
    const label = id === 'expand' ? 'Expand Lot' : cat.name;
    card.innerHTML = `<img alt="" src="assets/ui/icons/${cat.icon}.png"><div class="name">${label}</div><div class="meta"><span>${price}</span>${inc}</div>`;
    card.addEventListener('click', (e) => { e.stopPropagation(); onPickCard(id); });
    box.appendChild(card);
  }
}
function onPickCard(id) {
  const cat = CATALOG[id];
  if (!cat) return;
  if (G.level < cat.unlock) { setHint('Unlocks at level ' + cat.unlock + '.'); return; }
  if (id === 'expand') {
    if (!doExpand()) setHint(G.lotExtent >= 11 ? 'The lot is fully expanded.' : 'Need more coins to expand.');
    return;
  }
  if (G.cash < cat.cost && !G.moving) { setHint('Not enough coins.'); return; }
  G.buildKind = id;
  if (G.selected) selectBuilding(null);
  G.moving = null;
  ensureGhost(id);
  ghost.rot = 0;
  if (world.grid) world.grid.visible = true;
  populateTray();
  setHint('Left-click to place ' + cat.name + '. R rotates, right-click or Esc cancels.');
}
function cancelBuild() {
  if (G.moving) G.moving.group.visible = true;
  G.buildKind = null;
  G.moving = null;
  clearGhost();
  if (world.grid) world.grid.visible = false;
  populateTray();
}

function selectBuilding(b) {
  G.selected = b;
  const bar = $('selBar');
  placeRing(selectRing, b, 1.06);
  if (hoverB === b) placeRing(hoverRing, null);
  if (!b) { bar.classList.add('hidden'); updateCanvasCursor(); return; }
  const cat = CATALOG[b.kind];
  $('selName').textContent = cat.name;
  $('btnPlayBooth').classList.toggle('hidden', !cat.playable);
  bar.classList.remove('hidden');
  updateCanvasCursor();
}

function updateHUD() {
  $('hudCash').textContent = '$' + Math.floor(G.cash);
  $('hudLvlLbl').textContent = 'LEVEL ' + G.level;
  $('hudDayLbl').textContent = 'DAY ' + G.day;
  $('hudClock').textContent = fmtHour(G.hour);
  const lo = XP_LEVELS[G.level - 1] || 0;
  const hi = XP_LEVELS[G.level] || (lo + 200);
  const t = hi === lo ? 1 : clamp((G.xp - lo) / (hi - lo), 0, 1);
  $('xpFill').style.width = Math.round(t * 100) + '%';
}

function hideTitle() { $('title').classList.add('hidden'); }
function showTitleEl() { $('title').classList.remove('hidden'); }
function showTitle(force) {
  if (G.mode === 'play' && !force) return;
  if (G.mode === 'play') save();
  G.mode = 'title';
  hideHUD();
  showTitleEl();
  $('btnContinue').classList.toggle('hidden', !loadSave());
  G.zoom = 13; G.pan.set(0, 0, 2); applyCamera();
}
function hideHUD() { $('hud').classList.add('hidden'); }
function showHUD() { $('hud').classList.remove('hidden'); }

function serialize() {
  return {
    cash: G.cash, xp: G.xp, level: G.level, hour: G.hour, day: G.day, muted: G.muted,
    lotExtent: G.lotExtent, expandCount: G.expandCount, nextId,
    buildings: buildings.map((b) => ({ id: b.id, kind: b.kind, cx: b.cx, cz: b.cz, rot: b.rot, stored: b.stored, buildT: b.buildT }))
  };
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) {}
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearWorldBuildings() {
  while (buildings.length) removeBuilding(buildings[0]);
  occup.clear();
  while (crowds.length) { scene.remove(crowds.pop().group); }
}

function applySave(s) {
  clearWorldBuildings();
  G.cash = s.cash ?? START_CASH;
  G.xp = s.xp ?? 0;
  G.level = s.level ?? 1;
  G.hour = s.hour ?? 14;
  G.day = s.day ?? 1;
  G.muted = !!s.muted;
  G.lotExtent = s.lotExtent ?? START_EXTENT;
  G.expandCount = s.expandCount ?? 0;
  nextId = s.nextId || 1;
  rebuildLotShell();
  if (s.buildings) {
    for (const rec of s.buildings) {
      placeBuilding(rec.kind, rec.cx, rec.cz, rec.rot || 0, { id: rec.id, stored: rec.stored || 0, buildT: rec.buildT || 0, force: true });
      if (rec.id && rec.id >= nextId) nextId = rec.id + 1;
    }
  }
  checkLevel();
  setAtmosphere(G.hour);
  updateHUD(); populateTray();
}

function newGame() {
  G.mode = 'play';
  G.cash = START_CASH; G.xp = 0; G.level = 1; G.hour = 14; G.day = 1;
  G.lotExtent = START_EXTENT; G.expandCount = 0; nextId = 1;
  G.zoom = DEFAULT_ZOOM; G.pan.set(0, 0, 2);
  clearWorldBuildings();
  cancelBuild();
  rebuildLotShell();
  for (let i = 0; i < 4; i++) placeBuilding('path', 0, G.lotExtent - i, 0, { buildT: 0, force: true });
  hideTitle(); showHUD();
  setAtmosphere(G.hour);
  setHint('Lay a path, then place a ride. Tap coins to collect.');
  updateHUD(); populateTray(); applyCamera(); save();
  acEnsure(); audio.want = true;
}

function continueGame() {
  const s = loadSave();
  if (!s || !s.buildings) return newGame();
  G.mode = 'play';
  applySave(s);
  G.zoom = DEFAULT_ZOOM; G.pan.set(0, 0, 2);
  hideTitle(); showHUD();
  setHint('Welcome back to the midway.');
  applyCamera(); save();
  acEnsure(); audio.want = true;
}

function groundAt(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(groundPlane, _hit)) return _hit.clone();
  return null;
}
function buildingAt(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const objs = [];
  for (const b of buildings) b.group.traverse((o) => { if (o.isMesh || o.isSprite) objs.push(o); });
  const hits = raycaster.intersectObjects(objs, false);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && !buildings.find((b) => b.group === obj)) obj = obj.parent;
  return buildings.find((b) => b.group === obj) || null;
}

function tryPlaceAt(cx, cz) {
  if (G.moving) {
    const b = G.moving;
    if (!canPlace(b.kind, cx, cz, ghost.rot, b)) { setHint("Can't move there."); return; }
    syncOccup(b, false);
    b.cx = cx; b.cz = cz; b.rot = ghost.rot; b.cells = cellsFor(b.kind, cx, cz, b.rot);
    const mid = footprintCenter(b.kind, cx, cz, b.rot);
    b.group.position.set(mid.x, 0, mid.z);
    b.group.rotation.y = (b.rot % 4) * Math.PI / 2;
    b.group.visible = true;
    syncOccup(b, true);
    G.moving = null; G.buildKind = null; clearGhost();
    if (world.grid) world.grid.visible = false;
    selectBuilding(b); populateTray(); save();
    return;
  }
  const kind = G.buildKind;
  if (!kind) return;
  const cat = CATALOG[kind];
  if (G.cash < cat.cost) { setHint('Not enough coins.'); return; }
  if (!canPlace(kind, cx, cz, ghost.rot)) { setHint('Need a clear tile on your lot.'); return; }
  const b = placeBuilding(kind, cx, cz, ghost.rot);
  if (!b) return;
  G.cash -= cat.cost;
  grantXP(cat.cost * 0.15);
  audio.clank && audio.clank();
  if (kind !== 'path') { G.buildKind = null; clearGhost(); if (world.grid) world.grid.visible = false; }
  else updateGhostAt(cx, cz);
  if (!isConnected(b) && kind !== 'path') setHint('Connect a path so guests can reach it.');
  else if (kind === 'path') setHint('Path laid. Keep going, or pick a ride.');
  else setHint(cat.name + ' is going up.');
  updateHUD(); populateTray(); save();
}

function handleTap(x, y) {
  if (G.mode !== 'play') return;
  const bHit = buildingAt(x, y);
  if (G.buildKind || G.moving) {
    const gnd = groundAt(x, y);
    if (!gnd) return;
    const c = worldToCell(gnd.x, gnd.z);
    tryPlaceAt(c.cx, c.cz);
    return;
  }
  if (bHit) {
    const cat = CATALOG[bHit.kind];
    if (cat.income && bHit.stored >= Math.max(6, cat.cap * 0.18)) {
      collectBuilding(bHit);
      selectBuilding(bHit);
      return;
    }
    selectBuilding(bHit);
    return;
  }
  selectBuilding(null);
}

const pointers = new Map();
const keysDown = new Set();
let panning = false, pinched = false, lastPinch = 0, panStart = null;
let hoverB = null;
let hoverRing = null, selectRing = null;

function ensureHoverRing() {
  if (hoverRing) return;
  const geo = new THREE.RingGeometry(0.82, 1.05, 48);
  geo.rotateX(-Math.PI / 2);
  const hm = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.7, depthWrite: false });
  hoverRing = new THREE.Mesh(geo, hm);
  hoverRing.position.y = 0.05;
  hoverRing.visible = false;
  hoverRing.renderOrder = 6;
  scene.add(hoverRing);
  const sm = new THREE.MeshBasicMaterial({ color: 0xffe7b0, transparent: true, opacity: 0.9, depthWrite: false });
  selectRing = new THREE.Mesh(geo.clone(), sm);
  selectRing.position.y = 0.055;
  selectRing.visible = false;
  selectRing.renderOrder = 6;
  scene.add(selectRing);
}
function placeRing(ring, b, extra) {
  if (!ring) return;
  if (!b) { ring.visible = false; return; }
  const cat = CATALOG[b.kind];
  const mid = footprintCenter(b.kind, b.cx, b.cz, b.rot);
  ring.position.set(mid.x, 0.05, mid.z);
  const s = Math.max(cat.w || 1, cat.d || 1) * TILE * 0.58 * (extra || 1);
  ring.scale.set(s, 1, s);
  ring.visible = true;
}
function setHover(b) {
  if (hoverB === b) return;
  hoverB = b;
  placeRing(hoverRing, b && b !== G.selected ? b : null);
  updateCanvasCursor();
}
function updateCanvasCursor() {
  if (panning) { canvas.style.cursor = 'grabbing'; return; }
  if (G.buildKind || G.moving) { canvas.style.cursor = 'crosshair'; return; }
  if (hoverB) { canvas.style.cursor = 'pointer'; return; }
  canvas.style.cursor = 'default';
}
function wantsPan(e) {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') return true;
  return e.button === 1 || e.button === 2;
}
function onPointerDown(e) {
  if (G.mode === 'ringtoss') return onRtDown(e);
  if (e.target !== canvas) return;
  if (e.button === 1 || e.button === 2) e.preventDefault();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType });
  const panBtn = wantsPan(e);
  if (pointers.size === 1) {
    panning = false; pinched = false;
    panStart = { x: e.clientX, y: e.clientY, panx: G.pan.x, panz: G.pan.z, panBtn };
  }
  if (panBtn) canvas.style.cursor = 'grabbing';
  canvas.setPointerCapture?.(e.pointerId);
}
function onPointerMove(e) {
  if (G.mode === 'ringtoss') return onRtMove(e);
  if (!pointers.has(e.pointerId)) {
    if (G.mode === 'play') {
      if (G.buildKind || G.moving) {
        setHover(null);
        const gnd = groundAt(e.clientX, e.clientY);
        if (gnd) updateGhostAt(worldToCell(gnd.x, gnd.z).cx, worldToCell(gnd.x, gnd.z).cz);
      } else {
        setHover(buildingAt(e.clientX, e.clientY));
      }
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType });
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (!pinched) { pinched = true; lastPinch = d; }
    else if (lastPinch > 0) {
      G.zoom = clamp(G.zoom * (lastPinch / Math.max(8, d)), 6, 32);
      lastPinch = d; applyCamera();
    }
    return;
  }
  if (panStart && pointers.size === 1) {
    const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
    const allowPan = panStart.panBtn;
    if (allowPan) {
      if (!panning && Math.hypot(dx, dy) > 3) panning = true;
      if (panning) {
        const k = G.zoom * 2 / window.innerHeight;
        const sx = dx * k, sy = -dy * k;
        G.pan.x = panStart.panx - (sx * Math.cos(ISO_YAW) + sy * Math.sin(ISO_YAW));
        G.pan.z = panStart.panz - (-sx * Math.sin(ISO_YAW) + sy * Math.cos(ISO_YAW));
        applyCamera();
        canvas.style.cursor = 'grabbing';
      }
    }
  }
  if ((G.buildKind || G.moving) && !panning) {
    const gnd = groundAt(e.clientX, e.clientY);
    if (gnd) updateGhostAt(worldToCell(gnd.x, gnd.z).cx, worldToCell(gnd.x, gnd.z).cz);
  }
}
function onPointerUp(e) {
  if (G.mode === 'ringtoss') return onRtUp(e);
  const had = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinched = false;
  if (pointers.size === 0) {
    if (had && panStart && !panning && !pinched) {
      if (e.button === 2) { cancelBuild(); selectBuilding(null); setHint('Cancelled.'); }
      else if (e.button === 0 || (had.type && had.type !== 'mouse')) handleTap(e.clientX, e.clientY);
    }
    panning = false; panStart = null;
    updateCanvasCursor();
  }
}
function stepPanKeys(dt) {
  if (G.mode !== 'play' && G.mode !== 'title') return;
  let sx = 0, sy = 0;
  if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) sx -= 1;
  if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) sx += 1;
  if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) sy += 1;
  if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) sy -= 1;
  if (!sx && !sy) return;
  const k = G.zoom * 2 / Math.max(1, window.innerHeight) * 520 * dt;
  sx *= k; sy *= k;
  G.pan.x -= (sx * Math.cos(ISO_YAW) + sy * Math.sin(ISO_YAW));
  G.pan.z -= (-sx * Math.sin(ISO_YAW) + sy * Math.cos(ISO_YAW));
}
function trayKinds() {
  return CATALOG_ORDER.filter((id) => CATALOG[id].tab === G.tab);
}
function cycleTray(dir) {
  const ids = trayKinds();
  if (!ids.length) return;
  let i = G.buildKind ? ids.indexOf(G.buildKind) : -1;
  i = (i + dir + ids.length) % ids.length;
  onPickCard(ids[i]);
}
function rotateSelectedOrGhost() {
  $('btnRotate').click();
}
function sellSelected() {
  if (!G.selected) return;
  $('btnSell').click();
}

const RT = { ringsLeft: 3, hits: 0, bottles: [], flying: null, dragging: false, start: null, camSave: null, booth: null };
function makeBottle(x, z, color) {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.15, metalness: 0.05, transmission: 0.35, thickness: 0.4,
    transparent: true, opacity: 0.92, envMapIntensity: 1.1
  });
  mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.38, 14), glass, { y: 0.22, parent: g, recv: false });
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), glass, { y: 0.46, parent: g, recv: false });
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), M.metal, { y: 0.53, parent: g, recv: false });
  g.position.set(x, 0, z);
  return g;
}
function openRingToss(b) {
  if (!b || b.kind !== 'ringtoss' || G.mode !== 'play') return;
  G.mode = 'ringtoss';
  RT.booth = b;
  $('ringtoss').classList.remove('hidden');
  $('hud').classList.add('hidden');
  RT.ringsLeft = 3; RT.hits = 0; RT.flying = null;
  $('rtRings').textContent = '3'; $('rtHits').textContent = '0';
  RT.camSave = { zoom: G.zoom, pan: G.pan.clone() };
  const p = b.group.position;
  const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.group.rotation.y);
  G.pan.set(p.x + fwd.x * 0.4, 0, p.z + fwd.z * 0.4);
  G.zoom = 4.2; applyCamera();
  for (const old of RT.bottles) scene.remove(old);
  RT.bottles = [];
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.group.rotation.y);
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * 0.45;
    const bx = p.x + fwd.x * 0.85 + right.x * ox;
    const bz = p.z + fwd.z * 0.85 + right.z * ox;
    const bot = makeBottle(bx, bz, [0xc45a3a, 0x3a6a4a, 0x3a4a8a][i]);
    bot.position.y = 1.05;
    bot.userData.hit = false;
    scene.add(bot); RT.bottles.push(bot);
  }
  setHint('Drag back and release to throw.');
}
function closeRingToss() {
  if (RT.flying && RT.flying.mesh) scene.remove(RT.flying.mesh);
  RT.flying = null;
  for (const old of RT.bottles) scene.remove(old);
  RT.bottles = [];
  $('ringtoss').classList.add('hidden');
  if (RT.camSave) { G.zoom = RT.camSave.zoom; G.pan.copy(RT.camSave.pan); }
  G.mode = 'play'; showHUD(); applyCamera();
  if (RT.hits > 0) {
    const prize = 8 * RT.hits;
    G.cash += prize; grantXP(6 * RT.hits);
    setHint('Ring toss: ' + RT.hits + ' hit' + (RT.hits > 1 ? 's' : '') + '  +$' + prize);
    updateHUD(); save();
  }
}
function onRtDown(e) {
  if (e.target.closest && e.target.closest('#btnRtClose')) return;
  RT.dragging = true; RT.start = { x: e.clientX, y: e.clientY };
}
function onRtMove() {}
function onRtUp(e) {
  if (!RT.dragging || !RT.start) { RT.dragging = false; return; }
  RT.dragging = false;
  if (RT.ringsLeft <= 0 || RT.flying) return;
  const dx = e.clientX - RT.start.x, dy = e.clientY - RT.start.y;
  const power = clamp(Math.hypot(dx, dy) / 180, 0.2, 1);
  if (power < 0.22 && dy > -8) return;
  throwRing(-dx, -dy, power);
}
function throwRing(dirX, dirY, power) {
  RT.ringsLeft--; $('rtRings').textContent = String(RT.ringsLeft);
  audio.throw && audio.throw();
  const b = RT.booth;
  const p = b.group.position;
  const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.group.rotation.y);
  const origin = p.clone().add(fwd.clone().multiplyScalar(-0.4)); origin.y = 1.3;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 10, 20), new THREE.MeshStandardMaterial({ color: 0xd4a84a, metalness: 0.7, roughness: 0.3 }));
  ring.position.copy(origin); scene.add(ring);
  const aim = Math.atan2(dirX, 180);
  RT.flying = {
    mesh: ring, t: 0, x: origin.x, y: origin.y, z: origin.z,
    vx: fwd.x * (3.2 + power * 4) + Math.sin(b.group.rotation.y + Math.PI / 2) * aim * 2.2,
    vy: 1.6 + power * 2.4,
    vz: fwd.z * (3.2 + power * 4) + Math.cos(b.group.rotation.y + Math.PI / 2) * aim * 2.2
  };
}
function stepRingToss(dt) {
  const f = RT.flying; if (!f) return;
  f.t += dt; f.vy -= 7.2 * dt;
  f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
  f.mesh.position.set(f.x, f.y, f.z);
  f.mesh.rotation.x += dt * 8; f.mesh.rotation.z += dt * 3;
  for (const bot of RT.bottles) {
    if (bot.userData.hit) continue;
    const dx = f.x - bot.position.x, dz = f.z - bot.position.z, dy = f.y - (bot.position.y + 0.5);
    if (Math.hypot(dx, dz) < 0.18 && Math.abs(dy) < 0.25) {
      bot.userData.hit = true; RT.hits++; $('rtHits').textContent = String(RT.hits);
      audio.hit && audio.hit();
      f.mesh.position.set(bot.position.x, bot.position.y + 0.52, bot.position.z);
      f.mesh.rotation.set(Math.PI / 2, 0, 0);
      RT.flying = null;
      if (RT.ringsLeft <= 0) setTimeout(() => { if (G.mode === 'ringtoss') closeRingToss(); }, 1100);
      return;
    }
  }
  if (f.y < 0.6 || f.t > 3.2) {
    scene.remove(f.mesh); RT.flying = null;
    audio.miss && audio.miss();
    if (RT.ringsLeft <= 0) setTimeout(() => { if (G.mode === 'ringtoss') closeRingToss(); }, 800);
  }
}

const audio = { ctx: null, master: null, music: null, sfx: null, want: false, step: 0, next: 0 };
function acEnsure() {
  if (audio.ctx) return audio.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = G.muted ? 0 : 0.9; master.connect(ctx.destination);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
  const music = ctx.createGain(); music.gain.value = 0.22; music.connect(hp); hp.connect(master);
  const sfx = ctx.createGain(); sfx.gain.value = 0.6; sfx.connect(master);
  audio.ctx = ctx; audio.master = master; audio.music = music; audio.sfx = sfx;
  return ctx;
}
function setMuted(m) {
  G.muted = m;
  if (audio.master) audio.master.gain.setTargetAtTime(m ? 0 : 0.9, audio.ctx.currentTime, 0.05);
  $('btnMute').classList.toggle('muted', m);
  $('btnMute').textContent = m ? '\u00d7' : '\u266a';
  $('optSound').checked = !m;
}
function mf(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function tone(type, f, t, dur, vol, dest) {
  const ctx = audio.ctx; if (!ctx || G.muted) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
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
  const roots = [65, 65, 69, 62, 65, 70, 67, 62];
  while (audio.next < now + 0.35) {
    const beat = audio.step % 3, bar = Math.floor(audio.step / 3) % roots.length, r = roots[bar];
    if (!G.muted) {
      if (beat === 0) { calliope(audio.next, r, 0.09); calliope(audio.next, r + 4, 0.05); tone('sine', mf(r - 12), audio.next, 0.55, 0.06, audio.music); }
      else if (beat === 1) calliope(audio.next, r + 7, 0.05);
      else calliope(audio.next, r + (bar % 2 ? 12 : 9), 0.055);
    }
    audio.step++; audio.next += 0.28;
  }
}
audio.clank = () => { if (!acEnsure() || G.muted) return; const t = audio.ctx.currentTime; tone('square', 180, t, 0.08, 0.08, audio.sfx); tone('triangle', 90, t, 0.12, 0.1, audio.sfx); };
audio.cash = () => { if (!acEnsure() || G.muted) return; const t = audio.ctx.currentTime; tone('sine', 880, t, 0.08, 0.06, audio.sfx); tone('sine', 1320, t + 0.06, 0.1, 0.05, audio.sfx); };
audio.chime = () => { if (!acEnsure() || G.muted) return; const t = audio.ctx.currentTime; [72, 76, 79].forEach((m, i) => tone('sine', mf(m), t + i * 0.08, 0.25, 0.05, audio.sfx)); };
audio.throw = () => { if (!acEnsure() || G.muted) return; const t = audio.ctx.currentTime; tone('triangle', 420, t, 0.08, 0.05, audio.sfx); };
audio.hit = () => { if (!acEnsure() || G.muted) return; const t = audio.ctx.currentTime; tone('sine', 980, t, 0.12, 0.07, audio.sfx); tone('sine', 1470, t + 0.06, 0.12, 0.05, audio.sfx); };
audio.miss = () => { if (!acEnsure() || G.muted) return; const t = audio.ctx.currentTime; tone('sine', 180, t, 0.1, 0.05, audio.sfx); };

function bindUI() {
  $('btnPlay').addEventListener('click', () => newGame());
  $('btnContinue').addEventListener('click', () => continueGame());
  $('btnMute').addEventListener('click', () => setMuted(!G.muted));
  $('btnSettings').addEventListener('click', () => { save(); $('settings').classList.remove('hidden'); });
  $('btnSettingsDone').addEventListener('click', () => $('settings').classList.add('hidden'));
  $('btnToTitle').addEventListener('click', () => { $('settings').classList.add('hidden'); showTitle(true); });
  $('optSound').addEventListener('change', () => setMuted(!$('optSound').checked));
  $('btnRtClose').addEventListener('click', () => closeRingToss());
  $('btnRotate').addEventListener('click', () => {
    if (G.buildKind || G.moving) { ghost.rot = (ghost.rot + 1) % 4; updateGhostAt(ghost.cx, ghost.cz); return; }
    const b = G.selected; if (!b) return;
    const nr = (b.rot + 1) % 4;
    if (!canPlace(b.kind, b.cx, b.cz, nr, b)) { setHint("Can't rotate here."); return; }
    syncOccup(b, false);
    b.rot = nr; b.cells = cellsFor(b.kind, b.cx, b.cz, nr);
    b.group.rotation.y = nr * Math.PI / 2;
    syncOccup(b, true); save();
  });
  $('btnMove').addEventListener('click', () => {
    const b = G.selected; if (!b) return;
    G.moving = b; G.buildKind = b.kind;
    ensureGhost(b.kind); ghost.rot = b.rot;
    if (world.grid) world.grid.visible = true;
    b.group.visible = false;
    setHint('Left-click a new spot. Esc or right-click cancels.');
  });
  $('btnSell').addEventListener('click', () => {
    const b = G.selected; if (!b) return;
    const refund = Math.floor((CATALOG[b.kind].cost || 0) * 0.5);
    collectBuilding(b, true);
    G.cash += refund;
    removeBuilding(b);
    setHint(refund ? 'Sold for $' + refund + '.' : 'Path removed.');
    updateHUD(); populateTray(); save();
  });
  $('btnPlayBooth').addEventListener('click', () => { if (G.selected) openRingToss(G.selected); });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      G.tab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === tab));
      populateTray();
    });
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    G.zoom = clamp(G.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 6, 32);
    applyCamera();
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    keysDown.add(e.code);
    const settingsOpen = $('settings') && !$('settings').classList.contains('hidden');
    if (e.key === 'Escape') {
      if (settingsOpen) { $('settings').classList.add('hidden'); return; }
      if (G.mode === 'ringtoss') return closeRingToss();
      cancelBuild(); selectBuilding(null);
      return;
    }
    if (settingsOpen || G.mode === 'ringtoss') return;
    if (e.key === '1') switchTab('rides');
    if (e.key === '2') switchTab('food');
    if (e.key === '3') switchTab('games');
    if (e.key === '4') switchTab('paths');
    if (e.key === '[' || e.key === 'q' || e.key === 'Q') { e.preventDefault(); cycleTray(-1); }
    if (e.key === ']' || e.key === 'e' || e.key === 'E') { e.preventDefault(); cycleTray(1); }
    if (e.key === 'Enter') {
      const ids = trayKinds().filter((id) => G.level >= CATALOG[id].unlock);
      if (!G.buildKind && ids[0]) onPickCard(ids[0]);
    }
    if (e.key === 'r' || e.key === 'R') rotateSelectedOrGhost();
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); sellSelected(); }
  });
  window.addEventListener('keyup', (e) => { keysDown.delete(e.code); });
  window.addEventListener('blur', () => keysDown.clear());
  window.addEventListener('resize', () => {
    quality.dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(quality.dpr);
    const want = preferredShadow();
    if (quality.shadow < want && (G.fps || 60) > 50) applyShadowSize(want);
    applyCamera();
  });
  window.addEventListener('pointerdown', () => { acEnsure(); if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); }, { once: true });
}
function switchTab(id) {
  G.tab = id;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
  populateTray();
}


function frame() {
  requestAnimationFrame(frame);
  const dt = clamp(clock.getDelta(), 0, 0.05);
  const now = performance.now();
  G._fpsN = (G._fpsN || 0) + 1;
  if (!G._fpsT0) G._fpsT0 = now;
  if (now - G._fpsT0 >= 500) {
    G.fps = G._fpsN / ((now - G._fpsT0) / 1000);
    G._fpsN = 0;
    G._fpsT0 = now;
  }
  if (!ready) { renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera); return; }
  stepPanKeys(dt);
  if (G.fps) tuneQuality(G.fps);
  if (G.mode === 'play' || G.mode === 'title') {
    if (G.mode === 'play') {
      G.hour += dt * G.timeScale;
      if (G.hour >= 24) { G.hour -= 24; G.day += 1; }
      setAtmosphere(G.hour);
      stepIncome(dt);
      stepCrowds(dt);
      animateRides(dt, clock.elapsedTime);
      if (G.hintT > 0) { G.hintT -= dt; if (G.hintT <= 0) { G.hint = ''; $('hint').style.opacity = '0'; } }
      if ((G._saveT = (G._saveT || 0) + dt) > 8) { G._saveT = 0; save(); }
    } else {
      setAtmosphere(G.hour);
      animateRides(dt, clock.elapsedTime);
    }
    if (G.mode === 'play') updateHUD();
  }
  if (G.mode === 'ringtoss') { stepRingToss(dt); setAtmosphere(G.hour); animateRides(dt, clock.elapsedTime); }
  tickMusic();
  updateCamPos();
  renderBloom();
}

function hideUI(v) {
  $('hud').classList.toggle('hidden', !!v);
  if (v || G.mode !== 'title') hideTitle();
  else showTitleEl();
  $('loading').classList.add('hidden');
}
function hideTray(v) {
  $('buildTray').classList.toggle('hidden', !!v);
}

function placeManyForShot(night) {
  newGame();
  G.lotExtent = 7;
  G.expandCount = 1;
  rebuildLotShell();
  const paths = [];
  for (let z = -6; z <= 7; z++) paths.push(['path', 0, z]);
  for (const z of [-4, -1, 2, 5]) {
    for (let x = -5; x <= 5; x++) if (x !== 0) paths.push(['path', x, z]);
  }
  const layout = paths.concat([
    ['ferris', -4, -2],
    ['superloop', 4, -2],
    ['carousel', -4, 4],
    ['tilt', 4, 4],
    ['bumper', 0, -6],
    ['corndog', 2, 6],
    ['cotton', -2, 6],
    ['ringtoss', 2, 3],
    ['lemonade', 2, 0],
    ['funnelcake', -2, 0],
    ['popcorn', -2, 3],
    ['turkey', 5, 6],
    ['pizza', -5, 6]
  ]);
  clearWorldBuildings();
  G.cash = 8000; G.level = 4; G.xp = 500;
  for (const [k, cx, cz] of layout) placeBuilding(k, cx, cz, 0, { buildT: 0, force: true });
  G.hour = night ? 20.4 : 15.0;
  setAtmosphere(G.hour);
  const spots = [[0,5],[0,2],[0,0],[0,-1],[1,2],[-1,2],[2,2],[-2,2],[1,5],[-1,5],[2,-1],[-2,-1],[1,-4],[-1,-4],[2,5],[-2,5],[3,2],[-3,2],[0,4],[1,0]];
  for (let i = 0; i < 20; i++) {
    const g = spawnGuest();
    const s = spots[i % spots.length];
    const w = cellWorld(s[0], s[1]);
    g.x = w.x + (Math.random() - 0.5) * 0.45;
    g.z = w.z + (Math.random() - 0.5) * 0.45;
    g.group.position.set(g.x, 0, g.z);
  }
  const rides = buildings.filter((b) => CATALOG[b.kind] && CATALOG[b.kind].tab === 'rides');
  crowds.forEach((g, i) => {
    if (i < 10 && rides.length) boardRide(g, rides[i % rides.length]);
  });
  animateRides(3.2, 6.0);
  hideTray(true);
  setHint('', 0); if ($('hint')) $('hint').style.opacity = '0';
  G.pan.set(0, 0, 0);
  G.zoom = night ? 15.2 : 16.2;
  applyCamera();
}


const ICON_ZOOM = {
  path: 1.7, ferris: 15, superloop: 10.6, carousel: 7.6, tilt: 6.2, bumper: 8.2,
  corndog: 4.6, funnelcake: 4.6, cotton: 4.8, lemonade: 4.6, popcorn: 4.6,
  turkey: 5.0, pizza: 4.8, ringtoss: 4.8
};
const ICON_MIDY = {
  ferris: 5.2, superloop: 4.8, carousel: 2.2, tilt: 1.15, bumper: 1.7, path: 0.08
};
function renderAllIcons(size = 256) {
  const prevTone = renderer.toneMapping;
  const prevExp = renderer.toneMappingExposure;
  const prevSpace = renderer.outputColorSpace;
  const prevPr = renderer.getPixelRatio();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: true
  });
  const sc = new THREE.Scene();
  sc.environment = scene.environment;
  sc.add(new THREE.HemisphereLight(0xffe2c4, 0x3a2a1c, 1.15));
  const sun = new THREE.DirectionalLight(0xffd7a0, 2.5);
  sun.position.set(8, 14, 6);
  sc.add(sun);
  const fill = new THREE.DirectionalLight(0xb8c8e0, 0.85);
  fill.position.set(-6, 8, -4);
  sc.add(fill);
  const cam = new THREE.OrthographicCamera(-8, 8, 8, -8, -80, 80);
  const out = {};
  const buf = new Uint8Array(size * size * 4);
  const flip = document.createElement('canvas');
  flip.width = size; flip.height = size;
  const ctx2 = flip.getContext('2d');
  const img = ctx2.createImageData(size, size);
  for (const id of CATALOG_ORDER) {
    const cat = CATALOG[id];
    if (!cat || cat.special) continue;
    const art = buildArt(id);
    const dummy = { kind: id, group: art, parts: null, id: 0 };
    hookParts(dummy, art, { preview: true });
    if (dummy.parts && dummy.parts.arm) dummy.parts.arm.rotation.z = 0.55;
    if (dummy.parts && dummy.parts.wheel) dummy.parts.wheel.rotation[dummy.parts.wheelAxis || 'z'] = 0.35;
    sc.add(art);
    const z = ICON_ZOOM[id] || 8;
    const midY = ICON_MIDY[id] || 1.35;
    cam.left = -z; cam.right = z; cam.top = z; cam.bottom = -z;
    cam.updateProjectionMatrix();
    const d = 40, cy = Math.sin(ISO_PITCH), ch = Math.cos(ISO_PITCH);
    cam.position.set(Math.sin(ISO_YAW) * ch * d, midY + cy * d, Math.cos(ISO_YAW) * ch * d);
    cam.lookAt(0, midY, 0);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(sc, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    // flip Y into a 2D canvas
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      const dst = y * size * 4;
      img.data.set(buf.subarray(src, src + size * 4), dst);
    }
    ctx2.putImageData(img, 0, 0);
    out[cat.icon] = flip.toDataURL('image/png');
    sc.remove(art);
  }
  renderer.setRenderTarget(null);
  rt.dispose();
  renderer.toneMapping = prevTone;
  renderer.toneMappingExposure = prevExp;
  renderer.outputColorSpace = prevSpace;
  renderer.setPixelRatio(prevPr);
  renderer.setClearColor(prevClear, prevAlpha);
  applyCamera();
  return out;
}

function exposeDebug() {
  window.LOT = {
    get ready() { return ready; },
    get fps() { return G.fps || 0; },
    G, CATALOG, TILE, SAVE_KEY, buildings, crowds, ART,
    newGame, continueGame, save, loadSave, applyCamera, setMuted, hideUI, hideTray, showTitle,
    placeBuilding, removeBuilding, collectBuilding,
    collectAll() {
      let t = 0; for (const b of buildings) t += collectBuilding(b, true); updateHUD(); save(); return t;
    },
    grant(cash, xp) { if (cash) G.cash += cash; if (xp) grantXP(xp); updateHUD(); populateTray(); save(); },
    tickIncome: stepIncome, setHour(h) { G.hour = h; setAtmosphere(h); },
    doExpand, populateTray, canPlace, isConnected, cancelBuild, selectBuilding,
    openRingToss, closeRingToss, worldToCell, cellWorld,
    pick(kind) { onPickCard(kind); },
    placeAt(kind, cx, cz, rot = 0) {
      const cat = CATALOG[kind];
      if (cat.special) return doExpand();
      const paid = G.cash >= cat.cost;
      const b = placeBuilding(kind, cx, cz, rot, { buildT: 0 });
      if (b && paid) { G.cash -= cat.cost; grantXP(cat.cost * 0.15); }
      updateHUD(); populateTray(); save();
      return b ? { id: b.id, cx: b.cx, cz: b.cz, kind: b.kind } : null;
    },
    snapshot() {
      return {
        cash: G.cash, xp: G.xp, level: G.level, hour: G.hour, day: G.day,
        lotExtent: G.lotExtent, nBuildings: buildings.length,
        kinds: buildings.map((b) => b.kind),
        stored: buildings.map((b) => ({ kind: b.kind, stored: +b.stored.toFixed(2), connected: isConnected(b) })),
        guests: crowds.length, mode: G.mode, fps: G.fps || 0
      };
    },
    poseBuildMenu() {
      newGame();
      G.hour = 15; setAtmosphere(15);
      G.tab = 'rides'; switchTab('rides');
      onPickCard('ferris');
      G.pan.set(0, 0, 1); G.zoom = 13; applyCamera();
      hideUI(false); showHUD(); hideTray(false);
    },
    poseBusyDay() { placeManyForShot(false); hideUI(false); showHUD(); G.mode = 'play'; },
    poseNightShow() { placeManyForShot(true); hideUI(false); showHUD(); G.mode = 'play'; },
    poseCloseRides() {
      placeManyForShot(false);
      hideUI(true); hideTray(true);
      G.hour = 16.6; setAtmosphere(16.6);
      G.pan.set(0.4, 0, -1.6); G.zoom = 7.6; applyCamera();
      G.mode = 'play';
    },
    perf() {
      let tris = 0, meshes = 0, instanced = 0;
      scene.traverse((o) => {
        if (o.isMesh && o.geometry) {
          meshes++;
          const idx = o.geometry.index;
          const n = idx ? idx.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0);
          tris += o.isInstancedMesh ? n * (o.count || 0) : n;
          if (o.isInstancedMesh) instanced += o.count || 0;
        }
      });
      const info = renderer.info;
      return {
        fps: G.fps || 0, meshes, tris: Math.round(tris), instanced,
        calls: G.drawCalls || info.render.calls, renderTriangles: G.drawTris || info.render.triangles,
        guests: crowds.length, buildings: buildings.length,
        shadow: quality.shadow, bloomScale: quality.bloomScale, dpr: quality.dpr
      };
    },
    renderAllIcons
  };
}

function boot() {
  preloadArt();
  manager.onLoad = () => {
    if (ready) return;
    optimizeAllModels();
    buildMaterials();
    buildSkyAndLights();
    rebuildLotShell();
    plantDecor();
    ensureHoverRing();
    applyCamera();
    setAtmosphere(15.5);
    bindUI();
    populateTray();
    $('loading').classList.add('hidden');
    $('btnContinue').classList.toggle('hidden', !loadSave());
    showTitle(true);
    ready = true;
    exposeDebug();
  };
}
boot();
requestAnimationFrame(frame);
