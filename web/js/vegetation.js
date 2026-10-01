import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as PROC from './proc.js';

export const wind = { uTime: { value: 0 }, uWind: { value: 1 } };

function windPatch(mat, key, amp = 0.008, alphaBoost = 0) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime; shader.uniforms.uWind = wind.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
#else
  float ph = 0.0;
#endif
  float sw = transformed.y * transformed.y * ${amp.toFixed(4)} * uWind;
  transformed.x += sin(uTime * 1.25 + ph) * sw + sin(uTime * 3.1 + ph * 2.0 + transformed.y * 6.0) * sw * 0.18;
  transformed.z += cos(uTime * 1.05 + ph * 1.3) * sw * 0.7;`);
    if (alphaBoost > 0) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.a = clamp(diffuseColor.a * ${alphaBoost.toFixed(2)}, 0.0, 1.0);`);
    }
  };
  return mat;
}

// ---------------------------------------------------------------------------
// procedural conifers (unit height = 1, scaled per instance)
// ---------------------------------------------------------------------------
class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  vert(p, n, uv, c) { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); return this.pos.length / 3 - 1; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

function trunk(b, rnd, { h0 = 0, h1 = 1, r0, r1, sides, segs, lean = 0.012, colA, colB, colSplit = 0.5 }) {
  const ph = rnd() * 6.28, rows = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, y = h0 + (h1 - h0) * t, r = r0 + (r1 - r0) * Math.pow(t, 0.7);
    const cx = Math.sin(y * 3 + ph) * lean * y, cz = Math.cos(y * 2.3 + ph) * lean * y;
    const k = Math.min(1, Math.max(0, (y - colSplit) / 0.25));
    const col = [colA[0] + (colB[0] - colA[0]) * k, colA[1] + (colB[1] - colA[1]) * k, colA[2] + (colB[2] - colA[2]) * k];
    const row = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
      row.push(b.vert(new THREE.Vector3(cx + nx * r, y, cz + nz * r), new THREE.Vector3(nx, 0.1, nz).normalize(), [i / sides * 2, y * 14], col));
    }
    rows.push(row);
  }
  for (let s = 0; s < segs; s++) for (let i = 0; i < sides; i++) b.quad(rows[s][i], rows[s][i + 1], rows[s + 1][i + 1], rows[s + 1][i]);
}

/** Flat card from `origin` along dir, `side` is the in-plane perpendicular; normals follow `nfn`. */
function card(b, origin, dir, side, len, wid, nfn, col) {
  const w = side.clone().multiplyScalar(wid / 2), e = origin.clone().addScaledVector(dir, len);
  const p = [origin.clone().sub(w), origin.clone().add(w), e.clone().add(w), e.clone().sub(w)];
  const uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const ids = p.map((v, i) => b.vert(v, nfn(v), uv[i], col(i)));
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

const LOD = { near: { pineClumps: 9, cards: 12, firTiers: 15, firCards: 8, sides: 7, segs: 7 },
              mid: { pineClumps: 7, cards: 8, firTiers: 10, firCards: 6, sides: 5, segs: 4 },
              far: { pineClumps: 5, cards: 5, firTiers: 7, firCards: 5, sides: 4, segs: 3 } };

function buildPine(seed, lod) {
  const L = LOD[lod], rnd = PROC.rng(seed * 101 + 7);
  const tb = new Builder(), fb = new Builder();
  trunk(tb, rnd, { r0: 0.0165, r1: 0.0042, sides: L.sides, segs: L.segs, lean: 0.01 + rnd() * 0.01, colA: [0.16, 0.12, 0.095], colB: [0.62, 0.22, 0.075], colSplit: 0.42 });
  const up = new THREE.Vector3(0, 1, 0);
  const clumps = [];
  for (let c = 0; c < L.pineClumps; c++) {
    const top = c === 0, t = top ? 0.965 : 0.52 + 0.42 * Math.pow(rnd(), 0.8), a = rnd() * 6.283;
    const off = top ? 0 : 0.03 + 0.06 * rnd();
    clumps.push({ c: new THREE.Vector3(Math.cos(a) * off, t, Math.sin(a) * off), R: top ? 0.07 : 0.09 + rnd() * 0.05 });
  }
  for (const { c, R } of clumps) {
    for (let k = 0; k < L.cards; k++) {
      const a = rnd() * 6.283, tilt = (rnd() - 0.4) * 0.5;
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt)).normalize();
      const nrm = up.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9)).normalize();
      const side = new THREE.Vector3().crossVectors(nrm, dir).normalize();
      const o = c.clone().add(new THREE.Vector3((rnd() - 0.5) * R, (rnd() - 0.5) * R * 0.45, (rnd() - 0.5) * R));
      const len = R * (1.3 + rnd() * 0.7), shade = 0.78 + rnd() * 0.4 + (o.y - c.y) * 3;
      card(fb, o.clone().addScaledVector(dir, -len * 0.15), dir, side, len, len * 0.62,
        (v) => v.clone().sub(c).add(new THREE.Vector3(0, R * 0.55, 0)).normalize(), () => [shade, shade, shade]);
    }
  }
  return { trunk: tb.geometry(), foliage: fb.geometry() };
}

function buildFir(seed, lod) {
  const L = LOD[lod], rnd = PROC.rng(seed * 131 + 3);
  const tb = new Builder(), fb = new Builder();
  trunk(tb, rnd, { r0: 0.0125, r1: 0.003, sides: Math.max(4, L.sides - 1), segs: Math.max(2, L.segs - 2), lean: 0.006, colA: [0.2, 0.15, 0.115], colB: [0.34, 0.2, 0.12], colSplit: 0.2 });
  const n = L.firTiers;
  for (let i = 0; i < n; i++) {
    const t = 0.1 + 0.89 * (i / (n - 1)), cone = Math.max(0.02, Math.pow(1 - (t - 0.08) / 0.93, 0.92));
    const rad = 0.135 * cone + 0.006, ph = rnd() * 6.283;
    for (let k = 0; k < L.firCards; k++) {
      const a = ph + (k / L.firCards) * 6.283 + (rnd() - 0.5) * 0.5, th = 0.38 + rnd() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(th), -Math.sin(th), Math.sin(a) * Math.cos(th)).normalize();
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const len = rad * (1.05 + rnd() * 0.3), o = new THREE.Vector3(Math.cos(a) * rad * 0.1, t + rnd() * 0.012, Math.sin(a) * rad * 0.1);
      const out = new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize();
      const dark = 0.6 + 0.45 * (1 - cone) * 0.5 + rnd() * 0.15;
      card(fb, o, dir, side, len, Math.min(len * 0.85, 0.08), () => out.clone(),
        (i2) => { const f = i2 === 2 || i2 === 3 ? 1.0 : 0.55; return [dark * f, dark * f, dark * f]; });
    }
  }
  return { trunk: tb.geometry(), foliage: fb.geometry() };
}

// ---------------------------------------------------------------------------
export function buildForest(scene, data, terrain, birchGltf, opts = {}) {
  const density = opts.density ?? 1;
  const needlePine = PROC.needleBranch('pine', 4), needleFir = PROC.needleBranch('fir', 9);
  const heights = { pine: { a: 20.2, b: 14.9, c: 17.4 }, fir: { b: 19, c: 16 } };
  const tint = (kind) => (kind === 'pine' ? [0.66, 0.74, 0.44] : [0.5, 0.64, 0.42]);
  const bark = PROC.pineBark();
  const barkMat = windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: bark.map, bumpMap: bark.height, bumpScale: 3 }), 'bark', 0.004);
  const mats = {
    pine: windPatch(new THREE.MeshStandardMaterial({ map: needlePine, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8, alphaToCoverage: true }), 'pine-f', 0.008, 1.8),
    fir: windPatch(new THREE.MeshStandardMaterial({ map: needleFir, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8, alphaToCoverage: true }), 'fir-f', 0.008, 1.8),
  };
  const geoCache = {};
  const geo = (kind, variant, lod) => {
    const key = `${kind}-${variant}-${lod}`;
    return (geoCache[key] ??= (kind === 'pine' ? buildPine : buildFir)(variant.charCodeAt(0), lod));
  };

  // group trees by class
  const groups = new Map();
  const birches = [];
  let count = 0;
  const rnd = PROC.rng(99);
  for (const t of data.trees) {
    if (t.k !== 'birch' && t.l !== 'near' && rnd() > density) continue;     // thin out on weak devices
    if (t.k === 'birch') { birches.push(t); continue; }
    const key = `${t.k}|${t.v}|${t.l}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
    count++;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const placed = [];
  for (const [key, list] of groups) {
    const [kind, variant, lod] = key.split('|');
    const g = geo(kind, variant, lod);
    const H = (heights[kind][variant] ?? 18);
    const trunkMesh = new THREE.InstancedMesh(g.trunk, barkMat, list.length);
    const foliage = new THREE.InstancedMesh(g.foliage, mats[kind], list.length);
    list.forEach((t, i) => {
      const gy = terrain ? terrain.height(t.p[0], t.p[2]) : t.p[1];
      q.setFromAxisAngle(yAxis, t.r);
      const s = H * t.s;
      ps.set(t.p[0], gy - 0.25, t.p[2]); sc.set(s, s, s);
      m4.compose(ps, q, sc);
      trunkMesh.setMatrixAt(i, m4); foliage.setMatrixAt(i, m4);
      const k = 0.85 + (Math.sin(t.p[0] * 12.9 + t.p[2] * 78.2) * 0.5 + 0.5) * 0.35, base = tint(kind);
      c.setRGB(base[0] * k, base[1] * k * (0.95 + (i % 5) * 0.025), base[2] * k);
      foliage.setColorAt(i, c);
    });
    for (const mesh of [trunkMesh, foliage]) {
      mesh.castShadow = lod !== 'far'; mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; scene.add(mesh);
    }
    placed.push(trunkMesh, foliage);
  }

  // birches use the hand-made meshes
  if (birchGltf && birches.length) {
    const variants = {};
    birchGltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let n = o; let vname = null;
      while (n) { const m = /koivu\s+([abc])/i.exec(n.name || ''); if (m) { vname = m[1].toLowerCase(); break; } n = n.parent; }
      if (!vname) return;
      const geom = o.geometry.clone();
      const mm = new THREE.Matrix4().compose(new THREE.Vector3(), o.quaternion, o.scale);
      geom.applyMatrix4(mm);
      (variants[vname] ??= []).push({ geom, mat: o.material });
    });
    for (const [v, parts] of Object.entries(variants)) {
      const list = birches.filter((b) => b.v === v);
      if (!list.length) continue;
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geom, part.mat, list.length);
        list.forEach((t, i) => {
          const gy = terrain ? terrain.height(t.p[0], t.p[2]) : t.p[1];
          q.setFromAxisAngle(yAxis, t.r); ps.set(t.p[0], gy - 0.05, t.p[2]); sc.setScalar(t.s);
          im.setMatrixAt(i, m4.compose(ps, q, sc));
        });
        im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
        if (part.mat.alphaTest > 0) windPatch(part.mat, 'birch-leaf-' + v, 0.006);
        scene.add(im); placed.push(im);
      }
    }
  }
  return { count, placed };
}

// ---------------------------------------------------------------------------
export function buildGrass(scene, grassGltf, T, terrain, occupancy, opts = {}) {
  const meshes = {};
  grassGltf.scene.traverse((o) => { if (o.isMesh) meshes[o.name.replace(/_\d+$/, '')] = o; });
  const names = ['tall_a', 'tall_b', 'tall_c', 'mid_b', 'mid_c', 'small_b', 'tiny_a', 'tiny_e'].filter((n) => meshes[n]);
  const weights = { tall_a: 3, tall_b: 3, tall_c: 3, mid_b: 2, mid_c: 2, small_b: 2, tiny_a: 3, tiny_e: 3 };
  const mat = windPatch(new THREE.MeshStandardMaterial({
    map: T.grass_da, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, alphaToCoverage: true, vertexColors: false,
  }), 'grass', 0.5);
  mat.map.colorSpace = THREE.SRGBColorSpace;
  mat.map.anisotropy = 4;

  const center = opts.center ?? [3.8, -11.7], R = opts.radius ?? 40, target = opts.count ?? 7000;
  const rnd = PROC.rng(2026), buckets = Object.fromEntries(names.map((n) => [n, []]));
  const total = names.reduce((s, n) => s + weights[n], 0), mk = [0, 0];
  let tries = 0, placed = 0;
  while (placed < target && tries < target * 12) {
    tries++;
    const a = rnd() * 6.283, d = R * Math.sqrt(rnd()), x = center[0] + Math.cos(a) * d, z = center[1] + Math.sin(a) * d;
    if (occupancy.has(x, z)) continue;
    terrain.maskAt(x, z, mk);
    if (mk[0] > 0.33 || mk[1] > 0.12) continue;                     // forest floor / rock
    const yb = -z, d1 = Math.max(15.5 - x, x - 21.5);
    if (d1 < 1.4 && yb > -22.6) continue;                           // gravel strip
    if (Math.min(Math.max(-29.5 - yb, yb + 22.1), Math.max(-18.8 - yb, yb + 15.1)) < 1.1) continue; // gravel bays
    if (rnd() > 1 - 0.75 * Math.min(1, Math.max(0, (d - 8) / (R - 8)))) continue;
    let r = rnd() * total, pick = names[0];
    for (const n of names) { r -= weights[n]; if (r <= 0) { pick = n; break; } }
    buckets[pick].push([x, terrain.height(x, z), z, rnd() * 6.283, 1.6 + rnd() * 1.6, rnd()]);
    placed++;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const made = [];
  for (const n of names) {
    const list = buckets[n]; if (!list.length) continue;
    const g = meshes[n].geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(), meshes[n].quaternion, meshes[n].scale));
    const im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(yAxis, t[3]); p.set(t[0], t[1] - 0.01, t[2]); s.setScalar(t[4]);
      im.setMatrixAt(i, m4.compose(p, q, s));
      const k = 0.78 + t[5] * 0.5; c.setRGB(k * (0.95 + t[5] * 0.25), k, k * 0.72);
      im.setColorAt(i, c);
    });
    im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
    scene.add(im); made.push(im);
  }
  return { placed, made };
}
