// Procedural textures drawn with canvas: brick wall, pavers, boards, lawn, bark, needle branches.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lin2srgb = (v) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const css = (r, g, b) => `rgb(${Math.round(255 * lin2srgb(r))},${Math.round(255 * lin2srgb(g))},${Math.round(255 * lin2srgb(b))})`;
const srgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}
function tex(c, { srgb: isSrgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
function speckle(ctx, w, h, rnd, n, a0, a1) {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${a0 + rnd() * (a1 - a0)})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
}

/** Running-bond brick: returns { map, height, size:[m,m] } with colours in linear RGB like the Blender node. */
function bondPattern({ w, h, bricksAcross, courses, joint, c1, c2, mortar, seed, jitter = 0.07 }) {
  const rnd = rng(seed);
  const [c, ctx] = canvas(w, h), [hc, hx] = canvas(w, h);
  ctx.fillStyle = css(...mortar); ctx.fillRect(0, 0, w, h);
  hx.fillStyle = '#000'; hx.fillRect(0, 0, w, h);
  const bw = w / bricksAcross, bh = h / courses;
  for (let r = 0; r < courses; r++) {
    const off = (r % 2) * 0.5 * bw;
    for (let b = -1; b <= bricksAcross; b++) {
      const t = rnd(), k = 1 + (rnd() - 0.5) * jitter * 2;
      const col = [0, 1, 2].map((i) => (c1[i] + (c2[i] - c1[i]) * t) * k);
      const x = b * bw + off + joint / 2, y = r * bh + joint / 2, ww = bw - joint, hh = bh - joint;
      for (const dx of [0, -w, w]) {
        ctx.fillStyle = css(...col); ctx.fillRect(x + dx, y, ww, hh);
        const g = ctx.createLinearGradient(0, y, 0, y + hh);
        g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.07)');
        ctx.fillStyle = g; ctx.fillRect(x + dx, y, ww, hh);
        hx.fillStyle = `rgb(${200 + rnd() * 40},${200 + rnd() * 40},${200 + rnd() * 40})`; hx.fillRect(x + dx, y, ww, hh);
      }
    }
  }
  speckle(ctx, w, h, rnd, w * h / 90, 0.04, 0.12);
  hx.filter = 'blur(1.2px)'; hx.drawImage(hc, 0, 0); hx.filter = 'none';
  return { map: tex(c), height: tex(hc, { srgb: false }) };
}

export function brickWall() {
  const t = bondPattern({ w: 1152, h: 768, bricksAcross: 8, courses: 16, joint: 6.4,
    c1: [0.72, 0.65, 0.48], c2: [0.62, 0.56, 0.42], mortar: [0.50, 0.47, 0.40], seed: 11 });
  t.size = [1.8, 1.2];
  return t;
}
export function pavers() {
  const t = bondPattern({ w: 1024, h: 1024, bricksAcross: 10, courses: 20, joint: 6,
    c1: [0.332, 0.319, 0.296], c2: [0.407, 0.392, 0.356], mortar: [0.184, 0.171, 0.15], seed: 5, jitter: 0.12 });
  t.size = [2, 2];
  return t;
}

/** Vertical boards, 0.25 m wide with a groove; u runs across the boards. */
export function boards() {
  const w = 1024, h = 256, rnd = rng(3);
  const [c, ctx] = canvas(w, h), [hc, hx] = canvas(w, h);
  ctx.fillStyle = srgb(238, 236, 229); ctx.fillRect(0, 0, w, h);
  hx.fillStyle = '#fff'; hx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const x = i * 256;
    ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.04})`; ctx.fillRect(x, 0, 256, h);
    for (let k = 0; k < 40; k++) { // faint grain
      ctx.fillStyle = `rgba(90,80,60,${0.015 + rnd() * 0.03})`; ctx.fillRect(x + rnd() * 256, 0, 1 + rnd() * 2, h);
    }
    ctx.fillStyle = 'rgba(70,64,52,0.55)'; ctx.fillRect(x, 0, 9, h);
    hx.fillStyle = '#000'; hx.fillRect(x, 0, 9, h);
  }
  hx.filter = 'blur(2px)'; hx.drawImage(hc, 0, 0); hx.filter = 'none';
  return { map: tex(c), height: tex(hc, { srgb: false }) };
}

/** Seamless lawn: colour + packed normal/roughness (same layout as the Poly Haven ground layers). */
export function lawn() {
  const S = 512, rnd = rng(21);
  const [c, ctx] = canvas(S, S), [hc, hx] = canvas(S, S);
  ctx.fillStyle = srgb(92, 124, 44); ctx.fillRect(0, 0, S, S);
  hx.fillStyle = '#777'; hx.fillRect(0, 0, S, S);
  const wrapDraw = (g, fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy); };
  for (let i = 0; i < 70; i++) { // broad blotches
    const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 70;
    const [R, G, B] = rnd() < 0.5 ? [120, 146, 52] : [66, 98, 36];
    wrapDraw(ctx, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, `rgba(${R},${G},${B},0.30)`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      ctx.fillStyle = g; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  const pal = [[66, 104, 32], [92, 132, 42], [122, 152, 52], [152, 162, 66], [56, 88, 30], [108, 142, 46], [170, 168, 80]];
  ctx.lineCap = 'round'; hx.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, len = 7 + rnd() * 16;
    const p = pal[(rnd() * pal.length) | 0], al = 0.45 + rnd() * 0.45;
    const lw = 0.9 + rnd() * 0.9, hv = 90 + rnd() * 150;
    wrapDraw(ctx, (dx, dy) => {
      ctx.strokeStyle = `rgba(${p[0]},${p[1]},${p[2]},${al})`; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
      ctx.quadraticCurveTo(x + dx + Math.cos(a + 0.5) * len * 0.5, y + dy + Math.sin(a + 0.5) * len * 0.5, x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      ctx.stroke();
      hx.strokeStyle = `rgba(${hv},${hv},${hv},0.6)`; hx.lineWidth = lw;
      hx.beginPath(); hx.moveTo(x + dx, y + dy); hx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len); hx.stroke();
    });
  }
  // normal from height (Sobel, wrapped) + roughness in blue
  const hd = hx.getImageData(0, 0, S, S).data, nr = new Uint8ClampedArray(S * S * 4);
  const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * 1.4, ny = dy * 1.4, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l;
    const k = (y * S + x) * 4;
    nr[k] = (nx * 0.5 + 0.5) * 255; nr[k + 1] = (ny * 0.5 + 0.5) * 255; nr[k + 2] = 0.9 * 255; nr[k + 3] = 255;
  }
  const [nc, nctx] = canvas(S, S); nctx.putImageData(new ImageData(nr, S, S), 0, 0);
  // average colour (linear) so other materials can tint to a target
  const cd = ctx.getImageData(0, 0, S, S).data; let r = 0, g = 0, b = 0;
  for (let i = 0; i < cd.length; i += 4) { r += cd[i]; g += cd[i + 1]; b += cd[i + 2]; }
  const n = cd.length / 4, toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return { d: tex(c), nr: tex(nc, { srgb: false }), mean: [toLin(r / n), toLin(g / n), toLin(b / n)] };
}

/** Birch bark: pale with dark horizontal lenticels. */
export function birchBark() {
  const w = 256, h = 512, rnd = rng(8);
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, srgb(214, 211, 202)); g.addColorStop(0.5, srgb(232, 230, 223)); g.addColorStop(1, srgb(212, 209, 200));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const x = rnd() * w, y = rnd() * h, len = 6 + rnd() * 34, a = rnd() * 0.75 + 0.15;
    ctx.fillStyle = `rgba(28,26,24,${a})`;
    for (const dx of [-w, 0, w]) ctx.fillRect(x + dx, y, len, 1 + rnd() * 1.6);
  }
  for (let i = 0; i < 40; i++) { // dark patches near the base look
    ctx.fillStyle = `rgba(40,36,32,${0.12 + rnd() * 0.2})`; ctx.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 20, 2 + rnd() * 10);
  }
  return tex(c);
}

/** Conifer twig cards. kind: 'pine' (sparse tufts) | 'fir' (flat, dense). Transparent background. */
export function needleBranch(kind, seed = 1) {
  const w = 256, h = 128, rnd = rng(seed);
  const [c, ctx] = canvas(w, h);
  ctx.lineCap = 'round';
  const cols = kind === 'pine'
    ? [[34, 66, 40], [44, 82, 46], [58, 98, 52], [27, 52, 34], [84, 112, 56]]
    : [[22, 48, 34], [30, 62, 40], [38, 74, 46], [18, 40, 30], [56, 88, 50]];
  const sx = 8, ex = w - 10, cy = h / 2;
  ctx.strokeStyle = srgb(60, 44, 30); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(sx, cy); ctx.lineTo(ex, cy); ctx.stroke();
  const steps = kind === 'pine' ? 34 : 64;
  for (let i = 0; i < steps; i++) {
    const t = i / steps, x = sx + (ex - sx) * t;
    const len = (kind === 'pine' ? 46 : 40) * (1 - t * 0.78) * (0.7 + rnd() * 0.5);
    const per = kind === 'pine' ? 10 : 5;
    for (let k = 0; k < per; k++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const ang = (kind === 'pine' ? (rnd() - 0.5) * 2.4 : side * (0.55 + rnd() * 0.5));
      const L = len * (0.75 + rnd() * 0.5);
      const col = cols[(rnd() * cols.length) | 0];
      ctx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.lineWidth = kind === 'pine' ? 2.3 : 2.6;
      ctx.beginPath(); ctx.moveTo(x, cy);
      ctx.lineTo(x + Math.cos(ang) * L * 0.5 + 4, cy + Math.sin(ang) * L);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  t.premultiplyAlpha = false;
  return t;
}

/** Conifer bark: vertical furrows and plates, greyscale-ish (tinted by vertex colours). */
export function pineBark() {
  const w = 256, h = 512, rnd = rng(31);
  const [c, ctx] = canvas(w, h), [hc, hx] = canvas(w, h);
  ctx.fillStyle = srgb(150, 138, 126); ctx.fillRect(0, 0, w, h);
  hx.fillStyle = '#9a9a9a'; hx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) { // dark furrows
    const x = rnd() * w, y = rnd() * h, len = 30 + rnd() * 150, wd = 2 + rnd() * 5, a = 0.35 + rnd() * 0.5;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      ctx.fillStyle = `rgba(48,38,32,${a})`; ctx.fillRect(x + dx + Math.sin(y * 0.05) * 2, y + dy, wd, len);
      hx.fillStyle = `rgba(20,20,20,${a})`; hx.fillRect(x + dx + Math.sin(y * 0.05) * 2, y + dy, wd, len);
    }
  }
  for (let i = 0; i < 160; i++) { // lighter flaky plates
    const x = rnd() * w, y = rnd() * h, len = 14 + rnd() * 60, wd = 6 + rnd() * 12;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      ctx.fillStyle = `rgba(214,196,176,${0.15 + rnd() * 0.3})`; ctx.fillRect(x + dx, y + dy, wd, len);
      hx.fillStyle = 'rgba(255,255,255,0.35)'; hx.fillRect(x + dx, y + dy, wd, len);
    }
  }
  speckle(ctx, w, h, rnd, 2500, 0.05, 0.2);
  return { map: tex(c), height: tex(hc, { srgb: false }) };
}
