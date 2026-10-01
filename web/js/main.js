import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Atmosphere } from './atmosphere.js';
import { loadTextures, applyHouseMaterials, applyTerrainMaterials, quality } from './materials.js';
import { TerrainSampler, Occupancy } from './terrain.js';
import { buildForest, buildGrass, wind } from './vegetation.js';
import { sunPosition, sunDirection, localToUTC } from './sun.js';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const dpr = window.devicePixelRatio || 1;
const coarse = matchMedia('(pointer: coarse)').matches;
const stored = (() => { try { return localStorage.getItem('vk-quality'); } catch { return null; } })();
const pref = qs.get('q') || stored || 'auto';
const level = pref === 'auto' ? (coarse ? 'medium' : 'high') : pref;
const QUALITY = {
  low:    { pr: 1,                   shadow: 1024, grass: 2500, trees: 0.35, aa: false, aniso: 2 },
  medium: { pr: Math.min(dpr, 1.5),  shadow: 2048, grass: 5000, trees: 0.7,  aa: true,  aniso: 4 },
  high:   { pr: Math.min(dpr, 2),    shadow: 4096, grass: 8000, trees: 1.0,  aa: true,  aniso: 8 },
}[level];
quality.aniso = QUALITY.aniso;
$('quality-label').textContent = pref;

// ---------------------------------------------------------------- renderer / scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY.aa, powerPreference: 'high-performance', preserveDrawingBuffer: qs.has('shot') });
renderer.setPixelRatio(QUALITY.pr);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 3500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 1.2; controls.maxDistance = 280;
controls.maxPolarAngle = Math.PI * 0.497;
controls.screenSpacePanning = true;
controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.zoomToCursor = true;

const HOUSE = new THREE.Vector3(3.8, 2, -11.7);
const atmosphere = new Atmosphere(renderer, scene, { shadowSize: QUALITY.shadow, shadowExtent: 62, center: HOUSE.clone() });

function setFov() { camera.fov = camera.aspect < 0.9 ? 72 : camera.aspect < 1.3 ? 62 : 54; camera.updateProjectionMatrix(); }
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; setFov();
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- loading
const bar = $('loading-fill'), label = $('loading-text');
let steps = 0, stepsDone = 0;
const progress = (text) => { stepsDone++; bar.style.width = `${Math.min(100, (stepsDone / steps) * 100)}%`; if (text) label.textContent = text; };

const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
const gltf = new GLTFLoader().setDRACOLoader(draco);
const loadGLB = (url) => gltf.loadAsync(url);

let state = { time: parseFloat(qs.get('t') ?? '17'), date: qs.get('date') ?? '2026-07-15', playing: false };
let views = {};
let ctx = {};
let terrainSampler = null;

async function init() {
  steps = 4 + 1 + 3 + 1;
  label.textContent = 'Ladataan tekstuureja…';
  const T = await loadTextures(() => {});
  progress('Ladataan maastoa…');
  const [terrainG, houseG, birchG, grassG, data] = await Promise.all([
    loadGLB('models/terrain.glb').then((g) => (progress('Ladataan taloa…'), g)),
    loadGLB('models/house.glb').then((g) => (progress(), g)),
    loadGLB('models/birch.glb').then((g) => (progress(), g)),
    loadGLB('models/grass.glb').then((g) => (progress(), g)),
    fetch('data/scene.json').then((r) => r.json()).then((d) => (progress(), d)),
  ]);

  // terrain
  let ground = null;
  terrainG.scene.traverse((o) => { if (o.isMesh && o.material.name === 'VK ground') ground = o; });
  terrainSampler = new TerrainSampler(ground.geometry);
  applyTerrainMaterials(terrainG.scene, T);
  scene.add(terrainG.scene);

  // house
  ctx = applyHouseMaterials(houseG.scene, T, {});
  scene.add(houseG.scene);

  // keep grass off paving, roads, mulch and the house itself
  const occ = new Occupancy(HOUSE.x, HOUSE.z, 110, 0.35);
  const norm = (s) => s.replace(/_/g, ' ').replace(/\.\d+$/, '');
  const exclude = ['Ajotie', 'Kiveys talon edessä', 'Käytävä kadulle', 'Istutusalue', 'Salaojasora', 'Linnunrata - ajorata', 'Linnunrata - pyörätie', 'Varstakatu', 'Kalliopaljastumat'];
  for (const root of [houseG.scene, terrainG.scene]) root.traverse((o) => {
    if (o.isMesh && exclude.some((n) => norm(o.name).startsWith(n) || (o.parent && norm(o.parent.name) === n))) occ.addMesh(o);
  });
  let footprint = null;
  houseG.scene.traverse((o) => { if (!footprint && /^Talo - runko/.test(norm(o.name)) && !o.isMesh) footprint = o; });
  const fb = new THREE.Box3().setFromObject(footprint ?? houseG.scene);
  occ.addBox(fb.min.x - 0.7, fb.min.z - 0.7, fb.max.x + 0.7, fb.max.z + 0.7);

  progress('Istutetaan puut…');
  await new Promise((r) => setTimeout(r, 16));
  const forest = buildForest(scene, data, terrainSampler, birchG, { density: QUALITY.trees });
  const grass = buildGrass(scene, grassG, T, terrainSampler, occ, { count: QUALITY.grass, center: [HOUSE.x, HOUSE.z] });
  console.log(`trees: ${forest.count}, grass tufts: ${grass.placed}`);
  window.__vk.forest = forest; window.__vk.grass = grass;

  // camera presets from the Blender scene
  for (const c of data.cameras) views[c.name] = { p: new THREE.Vector3(...c.p), t: new THREE.Vector3(...c.t) };
  const start = views[qs.get('view') ? `Kamera - ${qs.get('view')}` : 'Kamera - Etupiha'] ?? views['Kamera - Etupiha'];
  camera.position.copy(start.p); controls.target.copy(start.t);
  controls.update();

  applyTime(true);
  atmosphere.updateEnvironment(performance.now(), true);
  label.textContent = 'Valmis';
  $('loading').classList.add('done');
  requestAnimationFrame(frame);
  setTimeout(() => (window.__vkReady = true), 600);
}

// ---------------------------------------------------------------- time / sun
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dir = new THREE.Vector3();
function applyTime(initial = false) {
  const [Y, M, D] = state.date.split('-').map(Number);
  const h = ((state.time % 24) + 24) % 24;
  const pos = sunPosition(localToUTC(Y, M - 1, D, h));
  sunDirection(pos, dir);
  const alt = (pos.altitude * 180) / Math.PI;
  atmosphere.setSun(dir, alt);
  renderer.shadowMap.needsUpdate = true;
  if (ctx.glass) {
    ctx.glass.emissiveIntensity = (1 - smooth(-3, 7, alt)) * 1.5;
  }
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  $('clock').textContent = `${String(hh).padStart(2, '0')}.${String(mm).padStart(2, '0')}`;
  $('time').value = h;
  window.__vkSun = { alt, az: (pos.azimuth * 180) / Math.PI };
}

// ---------------------------------------------------------------- UI
$('time').addEventListener('input', (e) => { state.time = parseFloat(e.target.value); state.playing = false; $('play').setAttribute('aria-pressed', 'false'); applyTime(); });
$('date').value = state.date;
$('date').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; applyTime(); } });
$('haze').addEventListener('input', (e) => { atmosphere.haze = parseFloat(e.target.value); applyTime(); });
$('play').addEventListener('click', () => { state.playing = !state.playing; $('play').setAttribute('aria-pressed', String(state.playing)); });
for (const b of document.querySelectorAll('[data-time]')) b.addEventListener('click', () => tweenTime(parseFloat(b.dataset.time)));
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => flyTo(views[b.dataset.view]));
$('settings').addEventListener('click', () => {
  const order = ['auto', 'low', 'medium', 'high'];
  const next = order[(order.indexOf(pref) + 1) % order.length];
  try { localStorage.setItem('vk-quality', next); } catch {}
  location.reload();
});

let timeTween = null;
function tweenTime(target) {
  state.playing = false; $('play').setAttribute('aria-pressed', 'false');
  let from = state.time % 24; let to = target;
  if (Math.abs(to - from) > 12) to += to < from ? 24 : -24;
  timeTween = { from, to, t0: performance.now(), dur: 900 };
}
let flight = null;
function flyTo(v) {
  if (!v) return;
  flight = { p0: camera.position.clone(), t0v: controls.target.clone(), p1: v.p.clone(), t1: v.t.clone(), t0: performance.now(), dur: 1500 };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, pr = QUALITY.pr;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  wind.uTime.value = now / 1000;
  atmosphere.tick(now / 1000);

  if (timeTween) {
    const k = Math.min(1, (now - timeTween.t0) / timeTween.dur);
    state.time = timeTween.from + (timeTween.to - timeTween.from) * ease(k); applyTime();
    if (k >= 1) timeTween = null;
  } else if (state.playing) { state.time += dt * 0.55; applyTime(); }

  if (flight) {
    const k = ease(Math.min(1, (now - flight.t0) / flight.dur));
    camera.position.lerpVectors(flight.p0, flight.p1, k); controls.target.lerpVectors(flight.t0v, flight.t1, k);
    if (k >= 1) flight = null;
  }
  controls.update();

  if (terrainSampler) { // stay above the ground
    const gy = terrainSampler.height(camera.position.x, camera.position.z) + 0.6;
    if (camera.position.y < gy) { const d = gy - camera.position.y; camera.position.y += d; controls.target.y += d; }
  }
  atmosphere.followCamera(camera);
  atmosphere.updateEnvironment(now);

  // adaptive resolution
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2.5 && pref === 'auto') {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    if (fps < 28 && pr > 0.7) { pr = Math.max(0.7, pr * 0.85); renderer.setPixelRatio(pr); }
    else if (fps > 58 && pr < QUALITY.pr) { pr = Math.min(QUALITY.pr, pr * 1.1); renderer.setPixelRatio(pr); }
  }
  renderer.render(scene, camera);
}

window.__vk = { THREE, scene, camera, controls, renderer, atmosphere, state, views: () => views, applyTime, flyTo, terrain: () => terrainSampler };
init().catch((e) => { console.error(e); label.textContent = 'Lataus epäonnistui: ' + e.message; });
