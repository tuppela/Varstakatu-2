import * as THREE from 'three';
import * as PROC from './proc.js';

const texLoader = new THREE.TextureLoader();
const GLSL_NOISE = /* glsl */`
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p, int oct){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ if(i>=oct) break; s+=a*vnoise2(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s/(1.0-pow(0.5,float(oct))); }
`;
const GLSL_HSV = /* glsl */`
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
vec3 hsvAdj(vec3 c, float hue, float sat, float val){ vec3 h=rgb2hsv(max(c,vec3(0.))); h.x=fract(h.x+hue-0.5); h.y=clamp(h.y*sat,0.,1.); h.z*=val; return hsv2rgb(h); }
`;

export const quality = { aniso: 8 };

function loadTex(url, { srgb = true, repeat = true } = {}) {
  return new Promise((res, rej) => {
    texLoader.load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = quality.aniso;
      res(t);
    }, undefined, rej);
  });
}

export async function loadTextures(onProgress) {
  const files = {
    roof_d: ['roof_d.webp', true], roof_n: ['roof_n.webp', false], roof_r: ['roof_r.webp', false],
    asphalt_d: ['asphalt_d.webp', true], asphalt_n: ['asphalt_n.webp', false], asphalt_r: ['asphalt_r.webp', false],
    forest_d: ['forest_d.webp', true], forest_nr: ['forest_nr.webp', false],
    rock_d: ['rock_d.webp', true], rock_nr: ['rock_nr.webp', false],
    gravel_d: ['gravel_d.webp', true], gravel_nr: ['gravel_nr.webp', false],
    grass_da: ['grass_da.webp', true],
  };
  const T = {};
  let done = 0;
  await Promise.all(Object.entries(files).map(async ([k, [f, srgb]]) => {
    T[k] = await loadTex(`assets/tex/${f}`, { srgb, repeat: k !== 'grass_da' });
    onProgress?.(++done / Object.keys(files).length);
  }));
  T.brick = PROC.brickWall();
  T.paver = PROC.pavers();
  T.board = PROC.boards();
  T.lawn = PROC.lawn();
  T.bark = PROC.birchBark();
  return T;
}

// ---------------------------------------------------------------------------
// shader patches
// ---------------------------------------------------------------------------
function worldVarying(shader, fragHead = '') {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWN = normalize(mat3(modelMatrix) * objectNormal);');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\n' + fragHead);
}

/** Standard material + optional anti-tiling, target-colour/contrast remap, desaturation, packed normal/roughness. */
function patchStandard(mat, key, o = {}) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTarget = { value: o.target ? new THREE.Color(...o.target) : new THREE.Color(1, 1, 1) };
    shader.uniforms.uMean = { value: o.mean ? new THREE.Color(...o.mean) : new THREE.Color(1, 1, 1) };
    shader.uniforms.uContrast = { value: o.contrast ?? 1 };
    shader.uniforms.uSat = { value: o.sat ?? 1 };
    shader.uniforms.uVal = { value: o.val ?? 1 };
    shader.uniforms.uTileMix = { value: o.antiTile ? 1 : 0 };
    const head = `${GLSL_NOISE}\nuniform vec3 uTarget; uniform vec3 uMean; uniform float uContrast, uSat, uVal, uTileMix;\n`;
    worldVarying(shader, head);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`
#ifdef USE_MAP
  vec4 sA = texture2D(map, vMapUv);
  if (uTileMix > 0.5) {
    vec2 uvB = mat2(0.8,0.6,-0.6,0.8) * vMapUv * 0.77 + vec2(0.31,0.17);
    vec4 sB = texture2D(map, uvB);
    sA = mix(sA, sB, smoothstep(0.30, 0.70, vnoise2(vWPos.xz * 0.06)));
  }
  vec3 sc = sA.rgb;
  float lum = dot(sc, vec3(0.2126,0.7152,0.0722));
  sc = mix(vec3(lum), sc, uSat) * uVal;
  sc = uTarget * clamp(mix(vec3(1.0), sc / max(uMean, vec3(1e-3)), uContrast), 0.0, 3.0);
  diffuseColor *= vec4(sc, sA.a);
#endif`);
    if (o.packed) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * texture2D(normalMap, vNormalMapUv).b;')
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(/vec3 mapN = [^;]+;/,
          'vec3 nrs = texture2D(normalMap, vNormalMapUv).xyz; vec3 mapN; mapN.xy = nrs.xy * 2.0 - 1.0; mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));'));
    }
  };
  return mat;
}

function patchBrickWall(mat, T) {
  mat.customProgramCacheKey = () => 'brickwall';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tBrick = { value: T.brick.map };
    shader.uniforms.tBrickH = { value: T.brick.height };
    shader.uniforms.uSize = { value: new THREE.Vector2(...T.brick.size) };
    worldVarying(shader, /* glsl */`
uniform sampler2D tBrick; uniform sampler2D tBrickH; uniform vec2 uSize;
float gBrickH = 0.5;
vec2 brickUV(){ vec3 n = normalize(vWN); vec3 a = abs(n);
  if (a.y > 0.6) return vWPos.xz / uSize;
  return (a.x > a.z ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y)) / uSize; }
vec3 bumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', 'vec2 buv = brickUV(); diffuseColor.rgb *= texture2D(tBrick, buv).rgb; gBrickH = texture2D(tBrickH, buv).r;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.97, 0.86, gBrickH);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = bumpN(-vViewPosition, normal, vec2(dFdx(gBrickH), dFdy(gBrickH)) * 0.9, faceDirection);');
  };
  return mat;
}

function patchBoard(mat, T) {
  mat.customProgramCacheKey = () => 'board';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tBoardH = { value: T.board.height };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tBoardH; float gBoardH = 1.0;
vec3 bumpB(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad); }`)
      .replace('#include <map_fragment>', '#include <map_fragment>\n  gBoardH = texture2D(tBoardH, vMapUv).r;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = bumpB(-vViewPosition, normal, vec2(dFdx(gBoardH), dFdy(gBoardH)) * 0.6, faceDirection);');
  };
  return mat;
}

// ---------------------------------------------------------------------------
// terrain splat: grass / forest floor / rock / gravel, mixed like the Blender graph
// ---------------------------------------------------------------------------
export function makeTerrainMaterial(T) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  mat.customProgramCacheKey = () => 'terrain-splat';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tGrassD: { value: T.lawn.d }, tGrassNR: { value: T.lawn.nr },
      tForestD: { value: T.forest_d }, tForestNR: { value: T.forest_nr },
      tRockD: { value: T.rock_d }, tRockNR: { value: T.rock_nr },
      tGravelD: { value: T.gravel_d }, tGravelNR: { value: T.gravel_nr },
    });
    worldVarying(shader, /* glsl */`
${GLSL_NOISE}
${GLSL_HSV}
uniform sampler2D tGrassD, tGrassNR, tForestD, tForestNR, tRockD, tRockNR, tGravelD, tGravelNR;
float gRough = 1.0; vec2 gNxy = vec2(0.0);
vec4 aTile(sampler2D t, vec2 uv, vec2 dx, vec2 dy){
  vec4 a = textureGrad(t, uv, dx, dy);
  vec2 uv2 = mat2(0.8,0.6,-0.6,0.8) * uv * 0.73 + vec2(0.37,0.19);
  vec4 b = textureGrad(t, uv2, dx*0.73, dy*0.73);
  return mix(a, b, smoothstep(0.30,0.70, vnoise2(vWPos.xz*0.045)));
}
float mapRange(float v, float a, float b){ return clamp((v-a)/(b-a), 0.0, 1.0); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <map_fragment>', /* glsl */`
{
  vec3 p = vWPos; float xb = p.x, yb = -p.z;                       // Blender object coordinates
  float n0 = fbm2(p.xz*0.6, 3) - 0.5, n1 = fbm2(p.xz*2.5, 2) - 0.5, n2 = fbm2(p.xz*0.08, 2);
  float forestFac = mapRange(vColor.r + n0*0.6, 0.3, 0.6);
  float rockFac   = mapRange(vColor.g + n1*0.35, 0.45, 0.62);
  float v1 = max(15.5 - xb, xb - 21.5) + n1*0.8;
  float f1 = mapRange(v1, 1.3, 0.7) * step(-22.6, yb);
  float dA = max(-29.5 - yb, yb + 22.1), dB = max(-18.8 - yb, yb + 15.1);
  float f2 = mapRange(min(dA, dB) + n1*0.8, 1.0, 0.55);
  float gravelFac = max(f1, f2);

  vec2 uvG = vec2(p.x, -p.z) * 0.398, uvF = vec2(p.x, -p.z) * 0.5, uvR = uvF, uvV = uvF;
  vec2 dGx = dFdx(uvG), dGy = dFdy(uvG), dFx = dFdx(uvF), dFy = dFdy(uvF);

  vec4 g = aTile(tGrassD, uvG, dGx, dGy); vec4 gn = textureGrad(tGrassNR, uvG, dGx, dGy);
  vec3 col = g.rgb; float rough = gn.b; vec2 nxy = gn.rg*2.0-1.0;
  col = mix(col, vec3(0.85,0.9,0.7), mapRange(n2, 0.35, 0.7) * 0.28);
  if (forestFac > 0.002) {
    vec3 c = hsvAdj(aTile(tForestD, uvF, dFx, dFy).rgb, 0.53, 0.9, 0.62); vec4 n = textureGrad(tForestNR, uvF, dFx, dFy);
    col = mix(col, c, forestFac); rough = mix(rough, n.b, forestFac); nxy = mix(nxy, n.rg*2.0-1.0, forestFac);
  }
  if (rockFac > 0.002) {
    vec3 c = hsvAdj(aTile(tRockD, uvR, dFx, dFy).rgb, 0.5, 0.55, 1.35); vec4 n = textureGrad(tRockNR, uvR, dFx, dFy);
    col = mix(col, c, rockFac); rough = mix(rough, n.b, rockFac); nxy = mix(nxy, n.rg*2.0-1.0, rockFac);
  }
  if (gravelFac > 0.002) {
    vec3 c = hsvAdj(aTile(tGravelD, uvV, dFx, dFy).rgb, 0.5, 0.35, 1.1); vec4 n = textureGrad(tGravelNR, uvV, dFx, dFy);
    col = mix(col, c, gravelFac); rough = mix(rough, n.b, gravelFac); nxy = mix(nxy, n.rg*2.0-1.0, gravelFac);
  }
  diffuseColor.rgb = col; gRough = rough; gNxy = nxy;
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gRough, 0.05, 1.0);')
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
{
  vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 Tw = normalize(vec3(1.0,0.0,0.0) - Nw * Nw.x);
  vec3 Bw = cross(Nw, Tw);
  vec3 mn = vec3(gNxy, sqrt(max(0.0, 1.0 - dot(gNxy, gNxy))));
  vec3 Wn = normalize(Tw*mn.x + Bw*mn.y + Nw*mn.z);
  normal = normalize((viewMatrix * vec4(Wn, 0.0)).xyz);
}`);
  };
  return mat;
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
/** Top-down UVs from world x/z (used for terrain-like meshes that came out without UVs). */
function planarUV(geom, scale) {
  const p = geom.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * scale; uv[i * 2 + 1] = -p.getZ(i) * scale; }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
/** Per-triangle box projection (for rocks); makes the geometry non-indexed. */
function boxUV(mesh, scale) {
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      const [u, w] = ay >= ax && ay >= az ? [v.x, v.z] : ax >= az ? [v.z, v.y] : [v.x, v.y];
      uv[(i + k) * 2] = u * scale; uv[(i + k) * 2 + 1] = w * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  mesh.geometry = g;
}

const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
function setRepeat(tex, rx, ry) { tex.repeat.set(rx, ry); return tex; }

// ---------------------------------------------------------------------------
// material assignment
// ---------------------------------------------------------------------------
export function applyHouseMaterials(root, T, ctx = {}) {
  const lawnMean = T.lawn.mean;
  const cache = new Map();
  const make = (name, src) => {
    if (cache.has(name)) return cache.get(name);
    let m = null;
    switch (name) {
      case 'VK brick': m = patchBrickWall(std({ color: 0xffffff, roughness: 0.9 }), T); break;
      case 'VK tile':
        m = patchStandard(std({
          color: 0xffffff, roughness: 1, map: setRepeat(T.roof_d, 1 / 7, 1 / 6), normalMap: setRepeat(T.roof_n, 1 / 7, 1 / 6),
          roughnessMap: setRepeat(T.roof_r, 1 / 7, 1 / 6), normalScale: new THREE.Vector2(1.3, 1.3),
        }), 'roof', { target: [0.30, 0.045, 0.032], mean: [0.283, 0.08, 0.024], contrast: 0.5 });
        break;
      case 'VK board':
        m = patchBoard(std({ color: 0xffffff, roughness: 0.62, map: setRepeat(T.board.map, 1, 1) }), T);
        break;
      case 'VK paver': {
        const t = T.paver; t.map.repeat.set(1 / t.size[0], 1 / t.size[1]);
        m = std({ color: 0xffffff, roughness: 0.93, map: t.map, bumpMap: setRepeat(t.height, 1 / t.size[0], 1 / t.size[1]), bumpScale: 2.5 });
        break;
      }
      case 'VK asphalt': case 'VK bikeway':
        m = patchStandard(std({ color: 0xffffff, roughness: 1, map: T.asphalt_d, normalMap: T.asphalt_n, roughnessMap: T.asphalt_r, normalScale: new THREE.Vector2(0.8, 0.8) }),
          'asphalt', { antiTile: true, target: [1, 1, 1], mean: [1, 1, 1], contrast: 1, sat: 0.25, val: 1.05 });
        break;
      case 'VK field': {
        const mean = lawnMean, target = [0.16, 0.25, 0.05];
        m = patchStandard(std({ color: 0xffffff, roughness: 1, map: T.lawn.d, normalMap: T.lawn.nr }), 'field',
          { packed: true, antiTile: true, target, mean, contrast: 0.7 });
        break;
      }
      case 'VK rock':
        m = patchStandard(std({ color: 0xffffff, roughness: 1, map: T.rock_d, normalMap: T.rock_nr }), 'rock',
          { packed: true, sat: 0.55, val: 1.35 });
        break;
      case 'VK mulch':
        m = patchStandard(std({ color: 0xffffff, roughness: 1, map: T.forest_d, normalMap: T.forest_nr }), 'mulch',
          { packed: true, sat: 0.9, val: 0.5 });
        break;
      case 'VK punagraniittisora':
        m = patchStandard(std({ color: 0xffffff, roughness: 1, map: T.gravel_d, normalMap: T.gravel_nr }), 'sora',
          { packed: true, target: [0.95, 0.6, 0.55], mean: [0.55, 0.5, 0.45], contrast: 0.8 });
        break;
      case 'VK glass':
        m = std({ color: 0x050a0b, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.62, envMapIntensity: 1.6, depthWrite: false });
        m.emissive = new THREE.Color(0xffc477); m.emissiveIntensity = 0;
        ctx.glass = m;
        break;
      case 'VK hortensian kukat': case 'VK hortensian lehdet': case 'VK pensaan lehdet': case 'VK koivun lehdet':
        m = src.clone(); m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; m.alphaToCoverage = true; m.depthWrite = true;
        m.roughness = 0.7;
        break;
      case 'VK koivun tuohi':
        m = std({ color: 0xffffff, roughness: 0.7, map: T.bark });
        break;
      default: m = src;
    }
    m.name = name;
    cache.set(name, m);
    return m;
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((s) => make(s.name, s));
    o.material = Array.isArray(o.material) ? out : out[0];
    const nm = list[0].name;
    o.castShadow = nm !== 'VK glass' && !nm.startsWith('VK hortensian');
    o.receiveShadow = true;
    if (nm === 'VK rock') boxUV(o, 0.5);
    if (nm === 'VK punagraniittisora' || nm === 'VK mulch') { if (!o.geometry.attributes.uv) planarUV(o.geometry, 0.5); }
  });
  return ctx;
}

export function applyTerrainMaterials(root, T) {
  const splat = makeTerrainMaterial(T);
  const cache = {};
  const get = (key, build) => (cache[key] ??= build());
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    const matName = (Array.isArray(o.material) ? o.material[0] : o.material).name;
    o.receiveShadow = true; o.castShadow = false;
    if (matName === 'VK ground') { o.material = splat; return; }
    if (matName === 'VK field') {
      planarUV(o.geometry, 0.4);
      o.material = get('field', () => patchStandard(std({ color: 0xffffff, roughness: 1, map: T.lawn.d, normalMap: T.lawn.nr }), 'field',
        { packed: true, antiTile: true, target: [0.16, 0.25, 0.05], mean: T.lawn.mean, contrast: 0.7 }));
      return;
    }
    if (matName === 'VK asphalt' || matName === 'VK bikeway') {
      planarUV(o.geometry, 0.5);
      o.material = get('asphalt', () => patchStandard(std({ color: 0xffffff, roughness: 1, map: T.asphalt_d, normalMap: T.asphalt_n, roughnessMap: T.asphalt_r, normalScale: new THREE.Vector2(0.8, 0.8) }),
        'asphalt', { antiTile: true, sat: 0.25, val: 1.05 }));
    }
  });
}
