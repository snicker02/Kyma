// Material textures: tileable procedural presets (no external files) and user
// images. Everything becomes a power-of-two canvas so WebGL1 can mipmap it and
// REPEAT-wrap it (see Renderer.setMaterialTexture).
//
// Procedural textures tile seamlessly: every noise lattice is periodic in both
// axes with a period that divides the texture, so the edges meet exactly.

export const PROC_SIZE = 512;
export const MAX_IMAGE = 2048;

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// Integer hash → [0, 1).
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise periodic with period perX cells in x and perY cells in y.
export function periodicNoise(seed, perX, perY = perX) {
  const wx = v => ((v % perX) + perX) % perX, wy = v => ((v % perY) + perY) % perY;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(wx(xi), wy(yi), seed), b = hash2(wx(xi + 1), wy(yi), seed);
    const c = hash2(wx(xi), wy(yi + 1), seed), d = hash2(wx(xi + 1), wy(yi + 1), seed);
    return mix(mix(a, b, u), mix(c, d, u), v);
  };
}

// Fractal sum over octaves; octave k uses period base·2^k so it still tiles.
// x, y in [0, 1) texture space.
function fbmT(seed, base, oct, ridged = false) {
  const ns = Array.from({ length: oct }, (_, k) => periodicNoise(seed + k * 17, base << k));
  return (x, y) => {
    let s = 0, a = 0.5, n = 0;
    for (let k = 0; k < oct; k++) {
      const f = base << k;
      let v = ns[k](x * f, y * f);
      if (ridged) v = 1 - Math.abs(v * 2 - 1);
      s += a * v; n += a; a *= 0.5;
    }
    return s / n;
  };
}

// Tileable Worley (cellular) noise: returns [F1, F2] distances in cell units.
function worleyT(seed, cells) {
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([i + hash2(i, j, seed), j + hash2(i, j, seed + 7)]);
  return (x, y) => {
    const px = x * cells, py = y * cells, ci = Math.floor(px), cj = Math.floor(py);
    let f1 = 9, f2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      const wi = ((i % cells) + cells) % cells, wj = ((j % cells) + cells) % cells;
      const p = pts[wj * cells + wi];
      const qx = p[0] + (i - wi), qy = p[1] + (j - wj);
      const d = Math.hypot(px - qx, py - qy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return [f1, f2];
  };
}

// Each generator returns (x, y) → [r, g, b] in [0, 1] for x, y in [0, 1).
export const TEX_GEN = {
  marble() {
    const n = fbmT(3, 4, 5);
    const a = hex('#f2efe9'), b = hex('#8d8a86'), v = hex('#3d3a38');
    return (x, y) => {
      const t = Math.sin((x + y) * 2 * Math.PI * 2 + n(x, y) * 9);
      const vein = Math.pow(1 - Math.abs(t), 6);
      return mix3(mix3(a, b, n(y, x) * 0.6), v, vein * 0.85);
    };
  },
  cells() {
    const w = worleyT(5, 8), n = fbmT(9, 8, 3);
    const a = hex('#e9d9b0'), b = hex('#6b4a2b'), c = hex('#1b1410');
    return (x, y) => {
      const [f1, f2] = w(x, y);
      const edge = smooth(0.0, 0.12, f2 - f1);
      return mix3(c, mix3(a, b, clamp01(f1 * 0.9 + n(x, y) * 0.3)), edge);
    };
  },
  rust() {
    const n = fbmT(11, 4, 6), m = fbmT(23, 8, 4);
    const steel = hex('#6f7378'), r1 = hex('#7a3a14'), r2 = hex('#c46a2a'), r3 = hex('#3a1c0c');
    return (x, y) => {
      const k = smooth(0.42, 0.58, n(x, y));
      const rust = mix3(mix3(r3, r1, m(x, y)), r2, smooth(0.6, 0.9, m(y, x)));
      return mix3(steel, rust, k);
    };
  },
  brushed() {
    // Long streaks along x: 2 cells across, 16–128 cells down (periods match the scaling).
    const per = [16, 32, 64, 128];
    const ns = per.map((p, k) => periodicNoise(31 + k, 2, p));
    return (x, y) => {
      let s = 0;
      for (let k = 0; k < 4; k++) s += ns[k](x * 2, y * per[k]) / (k + 1);
      const v = 0.45 + 0.35 * (s / 2.08);
      return [v, v, v * 1.03];
    };
  },
  bark() {
    const n = fbmT(41, 4, 5), r = fbmT(43, 8, 4, true);
    const a = hex('#5a3d22'), b = hex('#2a1a0e'), c = hex('#8a6a45');
    return (x, y) => {
      const ridge = Math.pow(r(x * 1, y * 1), 3);
      const groove = smooth(0.35, 0.65, Math.abs(Math.sin((x * 12 + n(x, y) * 2.5) * Math.PI)));
      return mix3(mix3(b, a, groove), c, ridge * 0.6);
    };
  },
  lava() {
    const w = worleyT(51, 6), n = fbmT(53, 8, 5);
    const rock = hex('#1c1716'), rock2 = hex('#3b302c'), hot = hex('#ff6a10'), white = hex('#ffd36b');
    return (x, y) => {
      const [f1, f2] = w(x, y);
      const crack = 1 - smooth(0.0, 0.07 + n(x, y) * 0.06, f2 - f1);
      const base = mix3(rock, rock2, n(y, x));
      return mix3(base, mix3(hot, white, crack * crack), crack);
    };
  },
  stone() {
    const n = fbmT(61, 4, 6), d = fbmT(67, 16, 3);
    const a = hex('#a39c90'), b = hex('#5f5a52'), c = hex('#d2cbbd');
    return (x, y) => {
      const v = n(x, y);
      return mix3(mix3(b, a, v), c, Math.pow(d(x, y), 4) * 1.2);
    };
  },
};

// TEX_SOURCES (params.js) index → generator key. Index 0 = loaded image.
export const TEX_KEYS = [null, 'marble', 'cells', 'rust', 'brushed', 'bark', 'lava', 'stone'];

const cache = new Map();

// Returns { canvas, aspect, name } for a procedural key (cached).
export function proceduralTexture(key, size = PROC_SIZE) {
  const k = `${key}@${size}`;
  if (cache.has(k)) return cache.get(k);
  const fn = TEX_GEN[key]();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = fn(x / size, y / size);
    const i = (y * size + x) * 4;
    img.data[i] = clamp01(r) * 255; img.data[i + 1] = clamp01(g) * 255; img.data[i + 2] = clamp01(b) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const out = { canvas: c, aspect: 1, name: key };
  cache.set(k, out);
  return out;
}

const pot = n => 2 ** Math.round(Math.log2(Math.max(1, n)));

// User image → POT canvas (each side rounded to the nearest power of two,
// capped at MAX_IMAGE / the GPU limit). aspect keeps the image's true shape.
export async function imageTexture(file, maxTex = 4096) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Could not read that image'));
      im.src = url;
    });
    const cap = Math.min(MAX_IMAGE, maxTex);
    const W = Math.min(cap, pot(img.naturalWidth)), H = Math.min(cap, pot(img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, 0, 0, W, H);
    return { canvas: c, aspect: img.naturalWidth / img.naturalHeight, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}
