import * as THREE from 'three';

/** Regular-grid height + mask lookup built from the exported terrain mesh. */
export class TerrainSampler {
  constructor(geometry) {
    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    const n = pos.count;
    const q = (v) => Math.round(v * 20);            // 5 cm buckets
    const xs = new Set(), zs = new Set();
    for (let i = 0; i < n; i++) { xs.add(q(pos.getX(i))); zs.add(q(pos.getZ(i))); }
    this.xs = [...xs].sort((a, b) => a - b);
    this.zs = [...zs].sort((a, b) => a - b);
    const nx = this.xs.length, nz = this.zs.length;
    this.regular = nx * nz === n;
    this.nx = nx; this.nz = nz;
    this.h = new Float32Array(nx * nz).fill(NaN);
    this.mask = new Float32Array(nx * nz * 2);      // forest, rock
    const xi = new Map(this.xs.map((v, i) => [v, i])), zi = new Map(this.zs.map((v, i) => [v, i]));
    for (let i = 0; i < n; i++) {
      const ix = xi.get(q(pos.getX(i))), iz = zi.get(q(pos.getZ(i)));
      const k = iz * nx + ix;
      this.h[k] = pos.getY(i);
      if (col) { this.mask[k * 2] = col.getX(i); this.mask[k * 2 + 1] = col.getY(i); }
    }
    this.x0 = this.xs[0] / 20; this.z0 = this.zs[0] / 20;
    this.dx = (this.xs[nx - 1] - this.xs[0]) / 20 / (nx - 1);
    this.dz = (this.zs[nz - 1] - this.zs[0]) / 20 / (nz - 1);
  }

  _cell(x, z) {
    let fx = (x - this.x0) / this.dx, fz = (z - this.z0) / this.dz;
    fx = Math.min(this.nx - 1.001, Math.max(0, fx)); fz = Math.min(this.nz - 1.001, Math.max(0, fz));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    return [ix, iz, fx - ix, fz - iz];
  }

  height(x, z) {
    const [ix, iz, tx, tz] = this._cell(x, z), nx = this.nx, h = this.h;
    const a = h[iz * nx + ix], b = h[iz * nx + ix + 1], c = h[(iz + 1) * nx + ix], d = h[(iz + 1) * nx + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** returns [forest, rock] */
  maskAt(x, z, out = [0, 0]) {
    const [ix, iz, tx, tz] = this._cell(x, z), nx = this.nx, m = this.mask;
    for (let k = 0; k < 2; k++) {
      const a = m[(iz * nx + ix) * 2 + k], b = m[(iz * nx + ix + 1) * 2 + k];
      const c = m[((iz + 1) * nx + ix) * 2 + k], d = m[((iz + 1) * nx + ix + 1) * 2 + k];
      out[k] = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }
    return out;
  }
}

/** 2D occupancy raster used to keep grass off paving, roads and the house. */
export class Occupancy {
  constructor(cx, cz, half = 110, cell = 0.4) {
    this.cx = cx - half; this.cz = cz - half; this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.data = new Uint8Array(this.n * this.n);
  }
  addMesh(mesh, grow = 0) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry, p = g.attributes.position, idx = g.index;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tri = idx ? idx.count / 3 : p.count / 3;
    for (let t = 0; t < tri; t++) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, idx ? idx.getX(t * 3 + k) : t * 3 + k).applyMatrix4(mesh.matrixWorld);
      this._fill(v[0], v[1], v[2], grow);
    }
  }
  addBox(minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let z = minZ; z <= maxZ; z += c * 0.5) for (let x = minX; x <= maxX; x += c * 0.5) this._set(x, z);
  }
  _set(x, z) {
    const ix = Math.floor((x - this.cx) / this.cell), iz = Math.floor((z - this.cz) / this.cell);
    if (ix >= 0 && iz >= 0 && ix < this.n && iz < this.n) this.data[iz * this.n + ix] = 1;
  }
  _fill(a, b, c, grow) {
    const minX = Math.min(a.x, b.x, c.x) - grow, maxX = Math.max(a.x, b.x, c.x) + grow;
    const minZ = Math.min(a.z, b.z, c.z) - grow, maxZ = Math.max(a.z, b.z, c.z) + grow;
    const step = this.cell * 0.5;
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-9) return;
    for (let z = minZ; z <= maxZ; z += step) for (let x = minX; x <= maxX; x += step) {
      if (grow > 0) { this._set(x, z); continue; }
      const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
      const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) this._set(x, z);
    }
  }
  has(x, z) {
    const ix = Math.floor((x - this.cx) / this.cell), iz = Math.floor((z - this.cz) / this.cell);
    return ix < 0 || iz < 0 || ix >= this.n || iz >= this.n ? false : this.data[iz * this.n + ix] === 1;
  }
}
