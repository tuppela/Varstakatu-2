import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Sky/fog colour keys by sun altitude in degrees (sRGB hex).
const FOG_KEYS = [
  [-18, 0x05070d], [-8, 0x0b111c], [-3, 0x2b3347], [0, 0xa9806e], [3, 0xe2b48c],
  [9, 0xc9c6bf], [20, 0xbdd0e4], [90, 0xb4cde8],
];
const SUN_KEYS = [  // sun light colour by altitude
  [-2, 0xff6a2a], [1, 0xff8a45], [4, 0xffb270], [9, 0xffd29f], [18, 0xffe6c4], [40, 0xfff3e0], [90, 0xfff7ea],
];

function keyColor(keys, alt, out) {
  if (alt <= keys[0][0]) return out.setHex(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (alt <= keys[i][0]) {
      const [a0, c0] = keys[i - 1], [a1, c1] = keys[i];
      const t = (alt - a0) / (a1 - a0);
      return out.setHex(c0).lerp(_tmp.setHex(c1), t);
    }
  }
  return out.setHex(keys[keys.length - 1][1]);
}
const _tmp = new THREE.Color();

export class Atmosphere {
  constructor(renderer, scene, { shadowSize = 2048, shadowExtent = 62, center = new THREE.Vector3(4, 2, -12) } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.center = center;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.altitudeDeg = 45;
    this.haze = 1;
    this.clouds = 0.2;

    // visible sky
    this.sky = new Sky();
    this.sky.scale.setScalar(2400);
    scene.add(this.sky);
    // separate copy rendered into the environment map
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(500);
    this.envSky.material.uniforms.showSunDisc.value = 0;   // the sun is a real light, keep it out of the IBL
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
    this._envDirty = true;
    this._envLast = 0;

    // stars
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.97 + 0.03;
      pos.set([Math.cos(a) * r * 2200, y * 2200, Math.sin(a) * r * 2200], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -shadowExtent; sc.right = shadowExtent; sc.top = shadowExtent; sc.bottom = -shadowExtent;
    sc.near = 10; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);
    this.sun.target.position.copy(center);

    this.moonDir = new THREE.Vector3(0.45, 0.62, 0.64).normalize();
    this.moon = new THREE.DirectionalLight(0x93aef5, 0);
    this.moon.position.copy(center).addScaledVector(this.moonDir, 200);
    this.moon.target.position.copy(center);
    scene.add(this.moon, this.moon.target);

    this.fill = new THREE.HemisphereLight(0xaec7ee, 0x5b6340, 0.0);
    scene.add(this.fill);

    this.fog = new THREE.FogExp2(0xbdd0e4, 0.0021);
    scene.fog = this.fog;
    this.fogColor = new THREE.Color();
    this.exposureTarget = 0.5;
  }

  /** Update everything from sun direction (unit vector, scene axes). */
  setSun(dir, altitudeDeg) {
    this.sunDir.copy(dir);
    this.altitudeDeg = altitudeDeg;
    const alt = altitudeDeg;
    const day = smooth(-6, 8, alt);          // 0 night .. 1 day
    const dusk = 1 - smooth(-2, 14, alt);    // golden/blue hour weight
    const night = 1 - smooth(-14, -4, alt);  // deep night

    // sky shader
    const su = this.sky.material.uniforms, eu = this.envSky.material.uniforms;
    const turb = lerp(1.7, 5.0, dusk * 0.7) + (this.haze - 1) * 3.2;
    const rayl = lerp(1.9, 2.8, dusk) * lerp(1, 0.75, clamp01(this.haze - 1));
    const mie = 0.0035 + 0.006 * (this.haze - 1 > 0 ? this.haze - 1 : 0) + 0.002 * dusk;
    su.cloudCoverage.value = this.clouds; su.cloudDensity.value = 0.32;
    eu.cloudCoverage.value = 0;
    for (const u of [su, eu]) {
      const isEnv = u === eu;   // the ambient light is whiter and less blue than the visible sky
      u.turbidity.value = Math.max(0.6, turb) + (isEnv ? 2.2 : 0);
      u.rayleigh.value = rayl * (isEnv ? 0.55 : 1);
      u.mieCoefficient.value = mie;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(dir);
    }

    // sun light
    keyColor(SUN_KEYS, alt, this.sun.color);
    const sunI = 4.2 * Math.pow(smooth(-1.5, 12, alt), 0.85);
    this.sun.intensity = sunI;
    this.sun.visible = sunI > 0.01;
    this.sun.castShadow = alt > 0.3;
    this.sun.position.copy(this.center).addScaledVector(dir, 300);
    this.sun.shadow.needsUpdate = true;

    // moon + fill
    this.moon.intensity = 0.55 * night;
    this.moon.visible = this.moon.intensity > 0.01;
    const tw = smooth(-11, -2, alt) * (1 - smooth(1, 10, alt));   // twilight: skylight with no sun
    this.fill.intensity = lerp(0.22 * night + 0.05, 0.12, day) + 0.75 * tw;
    this.fill.color.setHex(0xaec7ee).lerp(_tmp.setHex(0x1b2a55), night).lerp(_tmp.setHex(0x8f93c4), tw * 0.8);
    this.fill.groundColor.setHex(0x5b6340).lerp(_tmp.setHex(0x0c0f12), night).lerp(_tmp.setHex(0x4a3b36), tw * 0.7);

    // fog follows horizon colour
    keyColor(FOG_KEYS, alt, this.fogColor);
    this.fog.color.copy(this.fogColor);
    this.fog.density = 0.0021 * lerp(1, 1.15, dusk) * (0.35 + 0.65 * this.haze);
    this.scene.background = null;

    // stars
    this.starMat.opacity = clamp01((-alt - 2) / 8) * 0.9;
    this.stars.visible = this.starMat.opacity > 0.01;

    // exposure: bright days sit lower, night is lifted
    this.exposureTarget = lerp(1.25, lerp(0.72, 0.5, smooth(5, 35, alt)), smooth(-10, 2, alt));
    this.renderer.toneMappingExposure = this.exposureTarget;
    this.scene.environmentIntensity = lerp(0.35, 0.3, day) + 0.28 * day * (1 - smooth(0, 16, alt));
    this._envDirty = true;
  }

  /** Re-render the sky into the environment map (throttled). */
  updateEnvironment(now, force = false) {
    if (!this._envDirty) return;
    if (!force && now - this._envLast < 140) return;
    this._envLast = now;
    this._envDirty = false;
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.scene.environment = this.envTarget.texture;
    if (prev) prev.dispose();
  }

  tick(seconds) { this.sky.material.uniforms.time.value = seconds; }

  followCamera(camera) {
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
  }
}
