// Colour gradients. The shader samples one 256×1 lookup texture (unit 2):
//   colour = LUT(fract(idx · u_gradScale)),  idx = orbit trap · 0.4 + colorShift · 10
// so every gradient, modifier and the custom editor cost the same in the shader.
//
// The first eight entries are the original cosine palettes, rebuilt exactly:
// a + b·cos(idx·k + φ) has period 2π/k in idx, so sampling one period into the
// LUT and setting u_gradScale = k / 2π reproduces them to 8-bit precision.
// Multi-stop gradients are interpolated in OKLab, which keeps hue transitions
// even and avoids the muddy midpoints of straight RGB blending.

const TAU = Math.PI * 2;
export const LUT_SIZE = 256;

const cosine = (a, b, k, ph) => ({ kind: 'cos', a, b, k, ph, cyclic: true });
const stops = (k, cyclic, ...hex) => ({ kind: 'stops', k, cyclic, hex });
// Hard-edged bands (awning / candy stripes): colours alternate with a short
// blend of width `edge` (fraction of a band) so stripes stay crisp but don't alias.
const bands = (k, edge, ...hex) => ({ kind: 'bands', k, edge, cyclic: true, hex });

// Order matters: saved projects store the index. Append only.
export const GRADIENTS = [
  { name: 'Cosmic Neon', ...cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 1.0, [0, 2, 4]) },
  { name: 'Solar Flare', ...cosine([0.6, 0.6, 0.6], [0.4, 0.4, 0.4], 2.0, [0, 0.5, 1]) },
  { name: 'Deep Sea', ...cosine([0.4, 0.4, 0.4], [0.6, 0.6, 0.6], 3.0, [2.5, 3.5, 4]) },
  { name: 'Toxic Sludge', ...cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 3.5, [1.5, 1, 0.5]) },
  { name: 'Monochrome Pro', ...cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 1.0, [0, 0, 0]) },
  { name: 'Electric Orchid', ...cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 2.5, [2, 0, 4]) },
  { name: 'Golden Hour', ...cosine([0.6, 0.6, 0.6], [0.4, 0.4, 0.4], 1.8, [0, 3, 2]) },
  { name: 'Ice & Fire', ...cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 4.0, [4, 2, 0]) },
  // ── v2.8 gradients ─────────────────────────────────────────────────────────
  { name: 'Inferno', ...stops(4, false, '#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4') },
  { name: 'Magma', ...stops(4, false, '#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf') },
  { name: 'Viridis', ...stops(4, false, '#440154', '#3b528b', '#21918c', '#5ec962', '#fde725') },
  { name: 'Twilight', ...stops(4, true, '#e2d9e2', '#9e9cc2', '#5e43a5', '#2f1436', '#a1305e', '#d5a189') },
  { name: 'Spectrum', ...stops(4, true, '#ff2a2a', '#ffd42a', '#2aff55', '#2ad4ff', '#552aff', '#ff2ad4') },
  { name: 'Sunset Strip', ...stops(4, false, '#0b1d3a', '#3d2c6b', '#8e3b78', '#e05a5a', '#f9a65a', '#fde6a0') },
  { name: 'Lava', ...stops(4, false, '#000000', '#3b0000', '#a01000', '#ff5a00', '#ffd060', '#ffffff') },
  { name: 'Blood Moon', ...stops(4, true, '#050000', '#3d0000', '#8a0303', '#d1495b', '#edae49', '#5a1a00') },
  { name: 'Ocean Depths', ...stops(4, false, '#000814', '#001d3d', '#003566', '#0a7ea4', '#4cc9f0', '#e0fbfc') },
  { name: 'Aurora', ...stops(4, true, '#031b26', '#0b6e4f', '#2fd69a', '#a0ff9e', '#5a4fcf', '#12082a') },
  { name: 'Emerald', ...stops(4, false, '#020d07', '#064e3b', '#059669', '#34d399', '#a7f3d0', '#f0fdf4') },
  { name: 'Rust & Teal', ...stops(4, true, '#1b2a2f', '#0f5257', '#2a9d8f', '#e9c46a', '#e76f51', '#6b2a1a') },
  { name: 'Copper', ...stops(4, false, '#120805', '#4a2412', '#9c5a2b', '#d99a5e', '#f4d1a8', '#fff5e8') },
  { name: 'Chrome', ...stops(6, true, '#0a0a0a', '#5a5a5a', '#e8e8e8', '#7a7a7a', '#1c1c1c', '#bdbdbd') },
  { name: 'Bone', ...stops(4, false, '#000000', '#2b2b3a', '#5e6d7a', '#a7bcc0', '#ffffff') },
  { name: 'Ink Wash', ...stops(4, false, '#1d1b18', '#6b6457', '#c9c0ad', '#faf6ec') },
  { name: 'Vaporwave', ...stops(4, true, '#2b1055', '#7597de', '#ff71ce', '#01cdfe', '#05ffa1', '#b967ff') },
  { name: 'Candy', ...stops(4, true, '#ff6b9d', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff') },
  { name: 'Pastel Dream', ...stops(4, true, '#f8c8dc', '#c8b6ff', '#b8e0ff', '#c1f7d5', '#fff3b0') },
  { name: 'Custom (5 colors)', kind: 'custom', k: 4, cyclic: true },
  // ── v2.9 stripes & ornament (Mandelbulber-style banded colouring) ─────────
  { name: 'Circus Stripes', ...bands(8, 0.12, '#c4302b', '#f0d23a') },
  { name: 'Awning Teal', ...bands(8, 0.12, '#1d7f86', '#efe4c8') },
  { name: 'Lime Ribbon', ...bands(8, 0.15, '#5f7f17', '#e6d846') },
  { name: 'Candy Cane', ...bands(8, 0.1, '#a8102a', '#f4eee4') },
  { name: 'Orange Sash', ...bands(8, 0.12, '#d2491a', '#b9c7dc', '#e8a33a', '#9fb3d1') },
  { name: 'Gilded Filigree', ...stops(6, true, '#2a1d06', '#7a5a16', '#d8b24a', '#fff1b8', '#a8761e', '#4a3410') },
  { name: 'Moss & Gold', ...stops(5, true, '#1f2a0a', '#5a6a18', '#b9a432', '#efe08c', '#7a6a1c') },
  { name: 'Shell Pink', ...stops(5, true, '#efe8f0', '#c98fb3', '#7a3d63', '#f2c94c', '#3b4a5a') },
  // Arbitrary stop positions from a Mandelbulber material gradient (gradStops), RGB-linear like Mandelbulber.
  { name: 'Imported (Mandelbulber)', kind: 'imported', k: 4, cyclic: true },
];
export const GRADIENT_NAMES = GRADIENTS.map(g => g.name);
export const CUSTOM_GRADIENT = GRADIENTS.findIndex(g => g.kind === 'custom'); // 27, fixed by saved projects
export const WRAP_MODES = ['Auto', 'Repeat', 'Mirror'];
export const IMPORTED_GRADIENT = GRADIENTS.findIndex(g => g.kind === 'imported');

// "pos:#hex …" → sorted [{ t, rgb }]
export function parseStops(str) {
  const out = [];
  for (const tok of String(str || '').trim().split(/\s+/)) {
    const m = tok.match(/^([0-9.]+):(#[0-9a-f]{6})$/i);
    if (m) out.push({ t: Math.min(1, Math.max(0, +m[1])), rgb: hexToRgb(m[2]) });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ── colour maths ──────────────────────────────────────────────────────────────
function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function srgbToOklab([r, g, b]) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToSrgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, b].map(c => toSrgb(Math.min(1, Math.max(0, c))));
}

// Hue rotation (degrees) and saturation scale in a luma-preserving way, applied
// to display-space RGB.
function adjust([r, g, b], hueDeg, sat) {
  if (hueDeg) {
    const a = (hueDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    // Rotation about the grey axis (exact, unlike HSV hue shifting).
    const k = (1 - c) / 3, q = Math.sqrt(1 / 3) * s;
    [r, g, b] = [
      r * (c + k) + g * (k - q) + b * (k + q),
      r * (k + q) + g * (c + k) + b * (k - q),
      r * (k - q) + g * (k + q) + b * (c + k),
    ];
  }
  if (sat !== 1) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
  }
  return [r, g, b].map(x => Math.min(1, Math.max(0, x)));
}

// Sample a gradient's base curve at t ∈ [0,1) (one period).
function baseSampler(g, custom, stopsStr) {
  if (g.kind === 'cos') {
    return t => [0, 1, 2].map(i => g.a[i] + g.b[i] * Math.cos(TAU * t + g.ph[i]));
  }
  if (g.kind === 'imported') {
    // Mandelbulber cColorGradient: linear RGB between stops, wrapping last → first.
    const st = parseStops(stopsStr);
    if (st.length === 0) return () => [0.5, 0.5, 0.5];
    if (st.length === 1) return () => st[0].rgb;
    return t => {
      let i = st.length - 1;
      for (let k = 0; k < st.length; k++) if (st[k].t <= t) i = k;
      if (t < st[0].t) i = st.length - 1;
      const a = st[i], b = st[(i + 1) % st.length];
      let span = b.t - a.t; if (span <= 0) span += 1;
      let f = t - a.t; if (f < 0) f += 1;
      f = Math.min(1, f / span);
      return [0, 1, 2].map(j => a.rgb[j] + (b.rgb[j] - a.rgb[j]) * f);
    };
  }
  if (g.kind === 'bands') {
    const cols = g.hex.map(hexToRgb), n = cols.length, e = g.edge;
    return t => {
      const x = t * n, i = Math.floor(x) % n, f = x - Math.floor(x);
      const a = cols[i], b = cols[(i + 1) % n];
      let w = f < 1 - e ? 0 : (f - (1 - e)) / e;
      w = w * w * (3 - 2 * w); // smoothstep across the edge
      return [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * w);
    };
  }
  const hex = g.kind === 'custom' ? custom : g.hex;
  const labs = hex.map(h => srgbToOklab(hexToRgb(h)));
  // Cyclic gradients wrap last → first; others span first → last once.
  const n = labs.length, segs = g.cyclic ? n : n - 1;
  return t => {
    const x = t * segs, i = Math.min(Math.floor(x), segs - 1), f = x - i;
    const a = labs[i % n], b = labs[(i + 1) % n];
    return oklabToSrgb([0, 1, 2].map(j => a[j] + (b[j] - a[j]) * f));
  };
}

// Everything that affects the LUT, as plain data (also the cache key).
export function gradientSpec(v) {
  const idx = Math.min(Math.max(v.palette | 0, 0), GRADIENTS.length - 1);
  return {
    idx,
    wrap: v.gradWrap | 0,
    reverse: !!v.gradReverse,
    hue: +v.gradHue || 0,
    sat: v.gradSat ?? 1,
    repeat: v.gradRepeat ?? 1,
    custom: idx === CUSTOM_GRADIENT ? [v.gradC1, v.gradC2, v.gradC3, v.gradC4, v.gradC5] : null,
    stops: GRADIENTS[idx].kind === 'imported' ? (v.gradStops || '') : null,
  };
}
export const gradientKey = s => JSON.stringify(s);

const mirrored = (spec, g) => spec.wrap === 2 || (spec.wrap === 0 && !g.cyclic);

// Shader scale for idx → LUT coordinate: one LUT period per 2π/k of idx. With
// Mirror the period holds there-and-back, so each half sweeps the full gradient.
// Multi-stop gradients use k = 4 (the cosine set uses 1–4): orbit-trap indices
// span well under one unit on most scenes, and a lower k would show only the
// first stop or two.
export function gradientScale(spec) {
  return (GRADIENTS[spec.idx].k / TAU) * spec.repeat;
}

// RGBA8 LUT, LUT_SIZE × 1.
export function buildGradientLUT(spec, size = LUT_SIZE) {
  const g = GRADIENTS[spec.idx];
  const custom = (spec.custom || []).map(c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#808080'));
  const f = baseSampler(g, custom, spec.stops);
  const mirror = mirrored(spec, g);
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    let t = (i + 0.5) / size; // texel centres, as LINEAR filtering samples them
    if (mirror) t = 1 - Math.abs(1 - 2 * t); // 0→1→0 across the LUT
    if (spec.reverse) t = mirror ? 1 - t : (1 - t) % 1;
    if (!mirror && g.kind !== 'cos' && !g.cyclic) t = Math.min(t, 1 - 1e-9);
    const c = adjust(f(mirror ? Math.min(t, 1 - 1e-9) : t), spec.hue, spec.sat);
    out[i * 4] = Math.round(c[0] * 255);
    out[i * 4 + 1] = Math.round(c[1] * 255);
    out[i * 4 + 2] = Math.round(c[2] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// For the panel preview strip: CSS gradient isn't exact, so draw the LUT.
export function drawGradientPreview(canvas, spec) {
  const lut = buildGradientLUT(spec, canvas.width);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) img.data.set(lut, y * canvas.width * 4);
  ctx.putImageData(img, 0, 0);
}
