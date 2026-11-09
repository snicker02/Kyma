// Tiny vector / matrix helpers (plain arrays) — replaces the three.js dependency.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// 3x3 matrices are row-major arrays of 9 numbers: m[r*3+c].
export function mat3Mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

export const mat3MulVec = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// GLSL wants column-major.
export const mat3ToColumnMajor = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

// Internal fractal rotation. Reproduces v1 exactly: the original built
// Mx·My·Mz with these (transposed-sign) rows via THREE.Matrix3.set().
export function fractalRotation(alpha, beta, gamma) {
  const cx = Math.cos(alpha), sx = Math.sin(alpha);
  const cy = Math.cos(beta), sy = Math.sin(beta);
  const cz = Math.cos(gamma), sz = Math.sin(gamma);
  const mx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const my = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const mz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  return mat3Mul(mat3Mul(mx, my), mz);
}

export const hexToRgb = h => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
export const rgbToHex = c => '#' + c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');

export const wrapPi = a => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const fract = x => x - Math.floor(x);
