// Environment images: procedural presets (no external files) and user uploads.
//
// Everything is normalised to a power-of-two canvas so WebGL1 can mipmap it
// (blur + image-based lighting) and wrap it horizontally (360° panoramas).
// Equirectangular convention: top row = straight up, centre column = −Z.

export const ENV_W = 2048, ENV_H = 1024;
export const PRESET_W = 1024, PRESET_H = 512;

export const ENV_PRESETS = {
  studio: 'Studio',
  sunset: 'Sunset',
  nebula: 'Nebula',
  aurora: 'Aurora',
};

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Seeded value noise that tiles horizontally (period = `px` cells).
function makeNoise(seed, px) {
  const hash = (x, y) => {
    x = ((x % px) + px) % px;
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return mix(mix(hash(xi, yi), hash(xi + 1, yi), u), mix(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  };
}

function fbm(noise, x, y, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// Pixel → world direction for the equirect convention used by the shader.
function dirOf(px, py, W, H) {
  const u = (px + 0.5) / W, v = (py + 0.5) / H;
  const phi = (u - 0.5) * 2 * Math.PI, theta = v * Math.PI;
  return [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
}

function paint(W, H, fn) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y, dirOf(x, y, W, H));
    const i = (y * W + x) * 4;
    img.data[i] = clamp01(r) * 255; img.data[i + 1] = clamp01(g) * 255; img.data[i + 2] = clamp01(b) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const GENERATORS = {
  // Grey cyclorama with softbox panels — clean reflections.
  studio: () => paint(PRESET_W, PRESET_H, (x, y, d) => {
    const h = d[1];
    let k = mix(0.08, 0.32, smooth(-0.6, 0.6, h));
    const box = (az, el, w, hgt, s) => {
      const a = Math.atan2(d[0], -d[2]) - az, e = Math.asin(h) - el;
      const aw = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      return s * smooth(w, w * 0.8, aw) * smooth(hgt, hgt * 0.8, Math.abs(e));
    };
    k += box(-0.9, 0.45, 0.35, 0.22, 2.2) + box(1.2, 0.3, 0.25, 0.3, 1.4) + box(Math.PI, 0.9, 0.6, 0.12, 1.0);
    return [k, k * 1.01, k * 1.04];
  }),

  // Dusk sky with a low sun and dark ground.
  sunset: () => {
    const n = makeNoise(7, 16);
    return paint(PRESET_W, PRESET_H, (x, y, d) => {
      const h = d[1];
      const sun = [0.35, 0.08, -0.93];
      const sd = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
      const top = [0.08, 0.12, 0.35], hor = [1.0, 0.45, 0.18], gnd = [0.05, 0.03, 0.04];
      const t = smooth(0, 0.6, h);
      let c = h > 0 ? top.map((v, i) => mix(hor[i], v, t)) : gnd.map((v, i) => mix(hor[i] * 0.4, v, smooth(0, -0.25, h)));
      const cloud = h > 0.02 ? smooth(0.55, 0.75, fbm(n, x / PRESET_W * 16, y / PRESET_H * 24, 5)) * smooth(0.02, 0.15, h) * (1 - smooth(0.3, 0.7, h)) : 0;
      c = c.map((v, i) => mix(v, [0.95, 0.55, 0.45][i], cloud * 0.6));
      const glow = Math.pow(Math.max(sd, 0), 64) * 2 + Math.pow(Math.max(sd, 0), 6) * 0.35;
      return [c[0] + glow, c[1] + glow * 0.75, c[2] + glow * 0.45];
    });
  },

  // Deep-space clouds and stars.
  nebula: () => {
    const n1 = makeNoise(3, 8), n2 = makeNoise(11, 8), st = makeNoise(29, 1024);
    return paint(PRESET_W, PRESET_H, (x, y) => {
      const u = x / PRESET_W * 8, v = y / PRESET_H * 8;
      const a = fbm(n1, u, v, 6), b = fbm(n2, u * 1.3 + 5, v * 1.3, 6);
      const m = smooth(0.45, 0.8, a), q = smooth(0.5, 0.85, b);
      let r = 0.02 + m * 0.55 + q * 0.15, g = 0.01 + m * 0.12 + q * 0.3, bl = 0.05 + m * 0.4 + q * 0.55;
      const s = st(x, y * 1.0);
      if (s > 0.996) { const k = (s - 0.996) * 250; r += k; g += k; bl += k; }
      return [r, g, bl];
    });
  },

  // Night with aurora curtains over a dark horizon.
  aurora: () => {
    const n = makeNoise(17, 12), st = makeNoise(41, 1024);
    return paint(PRESET_W, PRESET_H, (x, y, d) => {
      const h = d[1];
      let c = [0.01, 0.02, 0.05 + 0.08 * smooth(0.6, 0, h)];
      if (h > 0) {
        const band = fbm(n, x / PRESET_W * 12, h * 3, 4);
        const curtain = smooth(0.5, 0.75, band) * smooth(0.05, 0.25, h) * (1 - smooth(0.35, 0.8, h));
        c = [c[0] + curtain * 0.1, c[1] + curtain * 0.9, c[2] + curtain * 0.45 + curtain * smooth(0.3, 0.6, h) * 0.5];
        const s = st(x, y);
        if (s > 0.997) { const k = (s - 0.997) * 300; c = c.map(v => v + k); }
      } else c = c.map(v => v * 0.3);
      return c;
    });
  },
};

export function proceduralEnv(name) {
  const g = GENERATORS[name];
  if (!g) throw new Error('Unknown environment preset ' + name);
  return { canvas: g(), aspect: 2, name: ENV_PRESETS[name], kind: 'preset', key: name };
}

// Load a user image (File/Blob or data URL) into a power-of-two canvas.
// `aspect` is the ORIGINAL aspect (backdrop mode cover-fits with it).
export async function imageEnv(source, maxTex = 4096, name = 'Image') {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Could not decode that image'));
      im.src = url;
    });
    const W = Math.min(ENV_W, maxTex), H = Math.min(ENV_H, maxTex / 2);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);
    const aspect = img.naturalWidth / img.naturalHeight;
    return { canvas: c, aspect, name: (source && source.name) || name, kind: 'image' };
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

// ~2:1 images are almost certainly equirectangular panoramas.
export const looksLikePanorama = aspect => Math.abs(aspect - 2) < 0.08;
