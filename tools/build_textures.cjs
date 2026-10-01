// Converts the Poly Haven source textures to small WebP files for the viewer.
//   npm i sharp && node tools/build_textures.cjs [size]
// Ground layers: <name>_d.webp (sRGB colour) and <name>_nr.webp (R,G = OpenGL normal xy, B = roughness).
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "web", "assets", "tex");
const SIZE = parseInt(process.argv[2] || "1024", 10);
fs.mkdirSync(OUT, { recursive: true });

const src = (dir, file) => path.join(ROOT, dir, file);
const resize = (p) => sharp(p).resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" });

async function colour(dir, file, outName, q = 82) {
  await resize(src(dir, file)).removeAlpha().webp({ quality: q }).toFile(path.join(OUT, outName));
}
async function gray(dir, file, outName, q = 80) {
  await resize(src(dir, file)).greyscale().removeAlpha().webp({ quality: q }).toFile(path.join(OUT, outName));
}
async function normal(dir, file, outName, q = 88) {
  await resize(src(dir, file)).removeAlpha().webp({ quality: q }).toFile(path.join(OUT, outName));
}
// R,G from the normal map, B from the roughness map
async function packNR(dir, nor, rough, outName, q = 88) {
  const n = await resize(src(dir, nor)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = await resize(src(dir, rough)).greyscale().raw().toBuffer();
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i * 3] = n.data[i * 3];
    out[i * 3 + 1] = n.data[i * 3 + 1];
    out[i * 3 + 2] = r[i];
  }
  await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: q }).toFile(path.join(OUT, outName));
}

(async () => {
  // roof tiles and asphalt use ordinary three.js maps
  await colour("clay_roof_tiles_02", "clay_roof_tiles_02_diff_2k.jpg", "roof_d.webp");
  await normal("clay_roof_tiles_02", "clay_roof_tiles_02_nor_gl_2k.jpg", "roof_n.webp");
  await gray("clay_roof_tiles_02", "clay_roof_tiles_02_rough_2k.jpg", "roof_r.webp");
  await colour("worn_asphalt", "worn_asphalt_diff_2k.jpg", "asphalt_d.webp");
  await normal("worn_asphalt", "worn_asphalt_nor_gl_2k.jpg", "asphalt_n.webp");
  await gray("worn_asphalt", "worn_asphalt_rough_2k.jpg", "asphalt_r.webp");
  // ground layers, packed
  for (const [dir, base, name] of [
    ["forrest_ground_01", "forrest_ground_01", "forest"],
    ["gravel_road", "gravel_road", "gravel"],
    ["lichen_rock", "lichen_rock", "rock"],
  ]) {
    await colour(dir, `${base}_diff_2k.jpg`, `${name}_d.webp`);
    await packNR(dir, `${base}_nor_gl_2k.jpg`, `${base}_rough_2k.jpg`, `${name}_nr.webp`);
  }
  // grass tuft: colour + alpha
  const gdir = path.join(ROOT, "grass_medium_01", "textures");
  const alpha = await sharp(path.join(gdir, "grass_medium_01_alpha_1k.png")).greyscale().raw().toBuffer();
  const diff = await sharp(path.join(gdir, "grass_medium_01_diff_1k.jpg")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = diff.info.width, h = diff.info.height;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = diff.data[i * 3]; rgba[i * 4 + 1] = diff.data[i * 3 + 1]; rgba[i * 4 + 2] = diff.data[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 85, alphaQuality: 90 }).toFile(path.join(OUT, "grass_da.webp"));
  let total = 0;
  for (const f of fs.readdirSync(OUT)) { const s = fs.statSync(path.join(OUT, f)).size; total += s; console.log(f.padEnd(18), (s / 1024).toFixed(0) + " KB"); }
  console.log("total", (total / 1e6).toFixed(2), "MB at", SIZE);
})();
