// CPU port of the shader's distance estimator — used for double-click autofocus,
// Rebirth's visibility check, Auto-fix Cut-offs and Auto Shell. Kept in
// lock-step with map() in glsl.js, case for case (tests/browser.mjs compares
// the GPU and CPU values for every variant, fold and fold-stack type).

import { fractalRotation, mat3Mul, objectTransform, mat3MulVec } from './vec.js';
import { cameraBasis, pixelRay } from './camera.js';

const abs = Math.abs, sgn = Math.sign;
const PHI = 1.6180339887;
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const N1 = nrm([-1, PHI - 1, 1 / (PHI - 1)]);
const N2 = nrm([PHI - 1, 1 / (PHI - 1), -1]);
const N3 = nrm([1 / (PHI - 1), -1, PHI - 1]);

const dot3 = z => z[0] * z[0] + z[1] * z[1] + z[2] * z[2];
const boxF = (x, f) => abs(x + f) - abs(x - f) - x;
// C-style fmod (sign of the dividend), as in Mandelbulber.
const fmodC = (a, b) => { const q = a / b; return a - b * sgn(q) * Math.floor(abs(q)); };

const permuteBy = (z, order) => {
  const [x, y, w] = z;
  switch (order) {
    case 1: return [x, w, y];
    case 2: return [y, x, w];
    case 3: return [y, w, x];
    case 4: return [w, x, y];
    case 5: return [w, y, x];
    default: return [x, y, w];
  }
};

const waveParams = v => ({
    type: v.waveType | 0, A: v.waveAmp ?? 0, F: v.waveFreq ?? 1, ph: v.wavePhase || 0,
    step: v.wavePhaseStep || 0, start: v.waveStart | 0, stop: v.waveStop ?? 250,
    w: [v.waveAxX ?? 1, v.waveAxY ?? 1, v.waveAxZ ?? 1],
  });

// Wave Warp step (mirrors applyWave in glsl.js). Returns [z, dr].
export function makeWave(v) {
  const wave = waveParams(v), abs = Math.abs;
  return (z, dr, i) => {
    const { A, F, w } = wave, ph = wave.ph + wave.step * i, AF = abs(A * F);
    const [x, y, zz] = z;
    const wmax = Math.max(abs(w[0]), abs(w[1]), abs(w[2]));
    switch (wave.type) {
      case 1: {
        const r = Math.hypot(x, y, zz), g = 1 + A * Math.sin(F * r + ph);
        return [[x * g, y * g, zz * g], dr * (abs(g) + AF * r)];
      }
      case 2:
        return [[x + A * w[0] * Math.sin(F * y + ph), y + A * w[1] * Math.sin(F * zz + ph), zz + A * w[2] * Math.sin(F * x + ph)], dr * (1 + AF * wmax)];
      case 3: {
        const Fs = Math.max(F, 1e-4), cl = t => Math.min(Math.max(t, 0), 1);
        const f = (c, k) => { const b = cl(abs(A) * w[k]); return c + (Math.sin(F * c + ph) / Fs - c) * b; };
        return [[f(x, 0), f(y, 1), f(zz, 2)], dr];
      }
      case 4: {
        const th = A * Math.sin(F * zz + ph), c = Math.cos(th), s = Math.sin(th);
        return [[c * x - s * y, s * x + c * y, zz], dr * (1 + AF * Math.hypot(x, y))];
      }
      case 5: {
        const qx = F * x, qy = F * y, qz = F * zz;
        return [[x + A * w[0] * Math.sin(qx + ph) * Math.cos(qy), y + A * w[1] * Math.sin(qy + ph) * Math.cos(qz), zz + A * w[2] * Math.sin(qz + ph) * Math.cos(qx)], dr * (1 + AF * Math.SQRT2 * wmax)];
      }
      case 6: {
        const P = Math.sin(F * x + ph) * Math.sin(F * y + ph) * Math.sin(F * zz + ph);
        return [[x + A * w[0] * P, y + A * w[1] * P, zz + A * w[2] * P], dr * (1 + AF * Math.sqrt(3) * Math.hypot(w[0], w[1], w[2]))];
      }
      default: return [z, dr];
    }
  };
}

// ── Kyma's own surf variants 11–15 (mirrors the SURF_VARIANT >= 11 block in
// glsl.js). One step = X/Y box fold, the variant's fold and scale; returns the
// new z and fac, the stretch bound used as dr = dr·fac + 1. C-Mult, rotation
// and +c are applied by the caller, as in the shader.
const toAxisV = (z, a) => a === 0 ? [z[1], z[2], z[0]] : a === 1 ? [z[2], z[0], z[1]] : [z[0], z[1], z[2]];
const fromAxisV = (w, a) => a === 0 ? [w[2], w[0], w[1]] : a === 1 ? [w[1], w[2], w[0]] : [w[0], w[1], w[2]];
const twistAxisV = (z, a, th) => {
  const w = toAxisV(z, a), c = Math.cos(th), s = Math.sin(th);
  return fromAxisV([c * w[0] - s * w[1], s * w[0] + c * w[1], w[2]], a);
};
// Largest singular value of k·I + u⊗g (closed form for a rank-1 update).
export function sigRank1(k, u, g) {
  if (abs(k) < 1e-9) return abs(k) + Math.hypot(u[0], u[1], u[2]) * Math.hypot(g[0], g[1], g[2]);
  const v = [g[0] / k, g[1] / k, g[2] / k];
  const a = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], b2 = dot3(u) * dot3(v);
  const T = 2 + 2 * a + b2, D = (1 + a) ** 2;
  return abs(k) * Math.sqrt(0.5 * (T + Math.sqrt(Math.max(T * T - 4 * D, 0))));
}

// Largest eigenvalue of a symmetric 3×3 (trigonometric closed form).
function symMaxEig(a00, a11, a22, a01, a02, a12) {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12, q = (a00 + a11 + a22) / 3;
  const p2 = (a00 - q) ** 2 + (a11 - q) ** 2 + (a22 - q) ** 2 + 2 * p1;
  const p = Math.sqrt(Math.max(p2 / 6, 0));
  if (p <= 1e-12) return q;
  const b00 = (a00 - q) / p, b11 = (a11 - q) / p, b22 = (a22 - q) / p, b01 = a01 / p, b02 = a02 / p, b12 = a12 / p;
  const det = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  return q + 2 * p * Math.cos(Math.acos(Math.min(Math.max(det / 2, -1), 1)) / 3);
}

// Gyroid fold (mirrors gyroFold in glsl.js): { z, d, gfac }.
export function gyroFoldMap(z, f, L) {
  const q = [z[0] * f, z[1] * f, z[2] * f];
  const sn = q.map(Math.sin), cs = q.map(Math.cos);
  const g = sn[0] * cs[1] + sn[1] * cs[2] + sn[2] * cs[0];
  const gr = [(cs[0] * cs[1] - sn[2] * sn[0]) * f, (cs[1] * cs[2] - sn[0] * sn[1]) * f, (cs[2] * cs[0] - sn[1] * sn[2]) * f];
  const gn = Math.hypot(gr[0], gr[1], gr[2]), gl = Math.max(gn, 0.5 * f);
  const d = g / gl;
  if (Math.abs(d) <= L) return { z: [...z], d, gfac: 1 };
  const e = d - Math.sign(d) * L;
  const f2 = f * f;
  const H = [ // H[r][c]
    [(-sn[0] * cs[1] - sn[2] * cs[0]) * f2, -cs[0] * sn[1] * f2, -cs[2] * sn[0] * f2],
    [-cs[0] * sn[1] * f2, (-sn[0] * cs[1] - sn[1] * cs[2]) * f2, -cs[1] * sn[2] * f2],
    [-cs[2] * sn[0] * f2, -cs[1] * sn[2] * f2, (-sn[1] * cs[2] - sn[2] * cs[0]) * f2],
  ];
  const Hv = x => H.map(r => r[0] * x[0] + r[1] * x[1] + r[2] * x[2]);
  const ggl = gn > 0.5 * f ? Hv(gr).map(t => t / gn) : [0, 0, 0];
  const gd = [0, 1, 2].map(i => gr[i] / gl - g * ggl[i] / (gl * gl));
  const nh = gr.map(t => t / gl);
  const J = [0, 1, 2].map(r => [0, 1, 2].map(c => (r === c ? 1 : 0) - 2 * nh[r] * gd[c] - 2 * e * (H[r][c] / gl - gr[r] * ggl[c] / (gl * gl))));
  const col = c => [J[0][c], J[1][c], J[2][c]];
  const c0 = col(0), c1 = col(1), c2 = col(2), dd = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lam = symMaxEig(dd(c0, c0), dd(c1, c1), dd(c2, c2), dd(c0, c1), dd(c0, c2), dd(c1, c2));
  return { z: [z[0] - 2 * e * nh[0], z[1] - 2 * e * nh[1], z[2] - 2 * e * nh[2]], d, gfac: Math.sqrt(Math.max(lam, 0)) * 1.001 };
}

export function makeSurfStep(v) {
  const variant = v.surfVariant | 0;
  const minR2 = v.minR * v.minR, infl = v.influence ?? 1;
  const fx = v.foldX, fy = v.foldY;
  const lox = [v.vLoxX || 0, v.vLoxY || 0, v.vLoxZ ?? 0.6];
  const ringR = [v.vTorusRX ?? 0.6, v.vTorusRY ?? 0.6, v.vTorusRZ ?? 0.6];
  const ringOn = [!!v.vTorusOnX, !!v.vTorusOnY, v.vTorusOnZ ?? true];
  const lastRing = ringOn[2] ? 2 : ringOn[1] ? 1 : ringOn[0] ? 0 : -1;
  const ell = [v.vEllX ?? 1, v.vEllY ?? 1, v.vEllZ ?? 1];
  const vb = [v.vVortexX || 0, v.vVortexY || 0, v.vVortexZ ?? 0.4];
  const vd = [v.vVortexDX || 0, v.vVortexDY || 0, v.vVortexDZ || 0];
  const gf = v.vGyroFreq ?? 2, gL = v.vGyroL ?? 0.4;
  const surfM = (rr, sc) => sc / (rr < minR2 ? minR2 : Math.min(rr, 1));
  const scl = (z, k) => [z[0] * k, z[1] * k, z[2] * k];
  // Ring fold about axis a (mirrors ringFold in glsl.js): { z, fac }.
  const ringFold = (z, a, R, sc) => {
    let w = toAxisV(z, a);
    const rho = Math.hypot(w[0], w[1]);
    const qv = [rho - R, w[2], 0], rr = dot3(qv);
    const m = surfM(rr, sc), k = (m - 1) * infl + 1;
    const gk = rr > minR2 && rr < 1 ? scl(qv, -infl * m * 2 / rr) : [0, 0, 0];
    const rho2 = R + k * (rho - R);
    w = rho > 1e-9 ? [w[0] * rho2 / rho, w[1] * rho2 / rho, w[2] * k] : [rho2, 0, w[2] * k];
    return { z: fromAxisV(w, a), fac: Math.max(sigRank1(k, qv, gk), abs(rho2) / Math.max(rho, 1e-9)) };
  };
  return (z0, actualScale) => {
    let z = [boxF(z0[0], fx), boxF(z0[1], fy), z0[2]];
    let fac = 1, rr = dot3(z);
    if (variant === 15) { const r = gyroFoldMap(z, gf, gL); z = r.z; fac = r.gfac; rr = dot3(z); }
    if (variant === 12 && lastRing >= 0) {
      for (let a = 0; a < 3; a++) {
        if (!ringOn[a]) continue;
        const r = ringFold(z, a, ringR[a], a === lastRing ? actualScale : 1);
        z = r.z; fac *= r.fac;
      }
      return { z, fac, rr };
    }
    let grr;
    if (variant === 13) {
      rr = (z[0] / ell[0]) ** 2 + (z[1] / ell[1]) ** 2 + (z[2] / ell[2]) ** 2;
      grr = [2 * z[0] / ell[0] ** 2, 2 * z[1] / ell[1] ** 2, 2 * z[2] / ell[2] ** 2];
    } else { rr = dot3(z); grr = scl(z, 2); }
    const m = surfM(rr, actualScale), k = (m - 1) * infl + 1;
    const gk = rr > minR2 && rr < 1 ? scl(grr, -infl * m / rr) : [0, 0, 0];
    if (variant === 11) {
      const lnr = Math.log(1 / Math.min(Math.max(rr, Math.max(minR2, 1e-12)), 1));
      for (let a = 0; a < 3; a++) z = twistAxisV(z, a, lox[a] * lnr);
      fac *= sigRank1(k, z, gk) * (rr > minR2 && rr < 1 ? 1 + 2 * (abs(lox[0]) + abs(lox[1]) + abs(lox[2])) : 1);
      z = scl(z, k);
    } else if (variant === 14) {
      fac *= sigRank1(k, z, gk);
      z = scl(z, k);
      for (let a = 0; a < 3; a++) {
        const w = toAxisV(z, a), rv = Math.hypot(w[0], w[1]);
        fac *= 1 + abs(vb[a]) + abs(vd[a]) * rv;
        z = twistAxisV(z, a, vb[a] * Math.log(rv + 1e-4) + vd[a] * w[2]);
      }
    } else {
      fac *= sigRank1(k, z, gk);
      z = scl(z, k);
    }
    return { z, fac, rr };
  };
}

export function makeDE(v, scaleOverride) {
  const R = fractalRotation(v.alpha, v.beta, v.gamma);
  const P = fractalRotation(v.preAlpha, v.preBeta, v.preGamma);
  const preOn = v.preAlpha !== 0 || v.preBeta !== 0 || v.preGamma !== 0;
  const SP = fractalRotation(v.spinX, v.spinY, v.spinZ);
  const spinOn = v.spinX !== 0 || v.spinY !== 0 || v.spinZ !== 0;
  const mv = (M, z) => [M[0] * z[0] + M[1] * z[1] + M[2] * z[2], M[3] * z[0] + M[4] * z[1] + M[5] * z[2], M[6] * z[0] + M[7] * z[1] + M[8] * z[2]];
  const scale = scaleOverride ?? v.scale;
  const fx = v.foldX, fy = v.foldY, fz = v.foldZ;
  const jc = [v.juliaCX, v.juliaCY, v.juliaCZ];
  const minR2 = v.minR * v.minR;
  const iters = v.iterations | 0;
  const ic = [v.invCX, v.invCY, v.invCZ];
  const ir2 = v.invRadius * v.invRadius;
  const is = v.invStrength;
  const variant = v.surfVariant | 0;
  const stack = [v.vStack1, v.vStack2, v.vStack3, v.vStack4, v.vStack5].map(x => x | 0);
  const vOff = [v.vOffX, v.vOffY, v.vOffZ], vSph = [v.vSphX, v.vSphY, v.vSphZ], vPost = [v.vPostX, v.vPostY, v.vPostZ];
  const vTail = [v.vTailX, v.vTailY, v.vTailZ], vTailOff = [v.vTailOffX, v.vTailOffY, v.vTailOffZ];
  // Amazing IFS
  const preAbs = [!!v.vPreAbsX, !!v.vPreAbsY, !!v.vPreAbsZ], ifsMode = [v.vIfsX | 0, v.vIfsY | 0, v.vIfsZ | 0];
  const ifsOff = [v.vIfsOffX ?? 0, v.vIfsOffY ?? 0, v.vIfsOffZ ?? 0], ifsAdd = [v.vIfsAddX ?? 0, v.vIfsAddY ?? 0, v.vIfsAddZ ?? 0];
  const fixedR2 = v.vFixedR2, f2 = v.vFold2, fv = v.vFoldValue;

  const invert = (z, dr) => {
    const dx = z[0] - ic[0], dy = z[1] - ic[1], dz = z[2] - ic[2];
    const r2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-6);
    const f = ir2 / r2;
    z[0] += (ic[0] + dx * f - z[0]) * is;
    z[1] += (ic[1] + dy * f - z[1]) * is;
    z[2] += (ic[2] + dz * f - z[2]) * is;
    return dr * (1 + (Math.min(f, v.invDELimit) - 1) * is);
  };

  const tglad = (z, mz) => {
    const w = v.tgladWeight;
    if (abs(z[0]) < fx) z[0] -= sgn(z[0]) * (z[0] * z[0] / (2 * fx)) * w;
    if (abs(z[1]) < fy) z[1] -= sgn(z[1]) * (z[1] * z[1] / (2 * fy)) * w;
    if (mz && abs(z[2]) < fz) z[2] -= sgn(z[2]) * (z[2] * z[2] / (2 * fz)) * w;
  };

  const box = z => [boxF(z[0], fx), boxF(z[1], fy), boxF(z[2], fz)];
  const reflect = (z, n) => { const d = Math.min(0, z[0] * n[0] + z[1] * n[1] + z[2] * n[2]); return [z[0] - 2 * d * n[0], z[1] - 2 * d * n[1], z[2] - 2 * d * n[2]]; };
  const boxT = z => { z = box(z); if (v.tgladWeight > 0) tglad(z, true); return z; };

  // Classic engine folds — mirrors FOLD_GLSL in glsl.js.
  const applyFold = (z, type) => {
    switch (type) {
      case 0: return boxT(z);
      case 1: return [fx - abs(abs(z[0]) - fx), fy - abs(abs(z[1]) - fy), fz - abs(abs(z[2]) - fz)];
      case 2: return [2 - abs(abs(z[0] + fx) - 2) - fx, 2 - abs(abs(z[1] + fy) - 2) - fy, 2 - abs(abs(z[2] + fz) - 2) - fz];
      case 3: {
        z = [boxF(z[0], fx), boxF(z[1], fy), z[2]];
        if (v.tgladWeight > 0) tglad(z, false);
        return z;
      }
      case 4: {
        let [x, y, w] = z;
        if (x + y < 0) { const t = x; x = -y; y = -t; }
        if (x + w < 0) { const t = x; x = -w; w = -t; }
        if (y + w < 0) { const t = w; w = -y; y = -t; }
        return boxT([x, y, w]);
      }
      case 5: {
        let [x, y, w] = [abs(z[0]), abs(z[1]), abs(z[2])];
        if (x < y) [x, y] = [y, x];
        if (x < w) [x, w] = [w, x];
        if (y < w) [y, w] = [w, y];
        return boxT([x, y, w]);
      }
      case 6: {
        z = [abs(z[0]), abs(z[1]), abs(z[2])];
        for (let k = 0; k < 2; k++) { z = reflect(z, N1); z = reflect(z, N2); z = reflect(z, N3); }
        return boxT(z);
      }
      case 7: {
        const sector = 2 * Math.PI / v.polarN;
        let a = Math.atan2(z[1], z[0]) + 0.5 * sector;
        a = abs(a - sector * Math.floor(a / sector) - 0.5 * sector);
        const r = Math.hypot(z[0], z[1]);
        const x = r * Math.cos(a), y = r * Math.sin(a);
        return [boxF(x, fx), boxF(y, fy), z[2]];
      }
      case 8: {
        const sb = (x, f) => { const g = Math.max(f, 1e-4); const u = Math.max(-15, Math.min(15, x / g)); const e = Math.exp(2 * u); return 2 * f * ((e - 1) / (e + 1)) - x; };
        return [sb(z[0], fx), sb(z[1], fy), sb(z[2], fz)];
      }
      case 9: return [abs(z[0]) - fx, abs(z[1]) - fy, abs(z[2]) - fz];
      default: {
        const c = Math.SQRT1_2;
        const w = box([(z[0] - z[1]) * c, (z[0] + z[1]) * c, z[2]]);
        return [(w[0] + w[1]) * c, (w[1] - w[0]) * c, w[2]];
      }
    }
  };

  // Fold-stack slot (X/Y only) — mirrors STACK_GLSL in glsl.js.
  const stackFold = (z, type) => {
    let [x, y, w] = z;
    switch (type) {
      case 1: x = boxF(x, fx); y = boxF(y, fy); break;
      case 2: x = fx - abs(abs(x) - fx); y = fy - abs(abs(y) - fy); break;
      case 3: x = abs(x + fx); y = abs(y + fy); break;
      case 4:
        if (abs(x) > fx) x = sgn(x) * fv - x;
        if (abs(y) > fy) y = sgn(y) * fv - y;
        break;
      case 5: x = f2 - abs(abs(x + fx) - f2) - fx; y = f2 - abs(abs(y + fy) - f2) - fy; break;
      case 6: {
        const sx = sgn(x), sy = sgn(y);
        const tx = boxF(x, fx), ty = boxF(y, fy);
        x -= sx * Math.min(abs(sx * (x - tx)), f2);
        y -= sy * Math.min(abs(sy * (y - ty)), f2);
        break;
      }
      default: break;
    }
    return [x, y, w];
  };
  const foldStack = z => { for (const t of stack) if (t) z = stackFold(z, t); return z; };

  const wave = waveParams(v), applyWave = makeWave(v);
  const surfStep = variant >= 11 ? makeSurfStep(v) : null;

  const map = function map(p) {
    let z = [p[0], p[1], p[2]];
    let dr = 1, trap = 1e10;
    const off = variant === 8 || variant === 9 || v.noC ? [0, 0, 0] : (v.juliaMode ? jc : p);
    let minDE = 1000;
    let actualScale = scale, scaleA = 0;
    let S = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

    for (let i = 0; i < iters; i++) {
      if (v.invEnabled && v.invMode === 0) dr = invert(z, dr);
      z = permuteBy(z, v.axisOrder);
      const rotOn = i >= v.rotStart;
      if (rotOn && preOn) z = mv(P, z);
      if (rotOn && spinOn) { z = mv(S, z); S = mat3Mul(S, SP); }
      // Mandelbulber-style sphere inversion, all formulas (mirrors glsl.js).
      if (v.vSInvOn && i >= (v.vSInvStart | 0) && i < (v.vSInvStop ?? 1)) {
        const so = [v.vSInvOffX || 0, v.vSInvOffY || 0, v.vSInvOffZ || 0];
        z = add(z, so);
        const ri = Math.max(dot3(z), 1e-20), g = v.vSInvG ?? 1;
        z = mul(z, g / ri); dr *= g / ri;
        z = add(z, [(v.vSInvAddX || 0) - so[0], (v.vSInvAddY || 0) - so[1], (v.vSInvAddZ || 0) - so[2]]);
        const a = v.vSInvA ?? 1;
        z = mul(z, a); dr *= a;
      }
      // Wave Warp, all formulas (mirrors applyWave in glsl.js).
      if (wave.type > 0 && i >= wave.start && i < wave.stop) {
        const r = applyWave(z, dr, i); z = r[0]; dr = r[1];
      }

      if (variant === 0) {
        actualScale = scale + v.scaleVary * (abs(actualScale) - 1);
        const useB = v.foldType2 > 0 && v.hybridPeriod > 0 && (v.foldType2 - 1) !== v.foldType && i % v.hybridPeriod === v.hybridPeriod - 1;
        z = applyFold(z, useB ? v.foldType2 - 1 : v.foldType);
        const rr = v.cylinder ? z[0] * z[0] + z[1] * z[1] : dot3(z);
        const dividend = rr < minR2 ? minR2 : Math.min(rr, 1);
        const m = actualScale / dividend;
        const k = (m - 1) * v.influence + 1;
        z = add(mul(z, k), off);
        if (abs(v.cMult) > 0.001) z = add(z, [off[1], off[0], off[2]], v.cMult);
        if (rotOn) z = mv(R, z);
        dr = dr * abs(k) + 1;
      } else if (variant === 1) {
        actualScale = scale + v.scaleVary * (abs(actualScale) - 1);
        z = [boxF(z[0], fx), boxF(z[1], fy), z[2]];
        let rr = dot3(z);
        if (v.cylinder) rr -= z[2] * z[2];
        const dividend = rr < minR2 ? minR2 : Math.min(rr, 1);
        const m = actualScale / dividend;
        const k = (m - 1) * v.influence + 1;
        z = mul(z, k);
        dr = dr * abs(k) + 1;
        if (abs(v.cMult) > 0.001) z = add(z, [off[1], off[0], off[2]], v.cMult);
        if (rotOn) z = mv(R, z);
        z = add(z, off);
      } else if (variant === 2) {
        actualScale = scale + v.scaleVary * (abs(actualScale) - 1);
        z = foldStack(z);
        z = add(z, vOff);
        let rr = dot3(z);
        if (v.cylinder) rr -= z[2] * z[2];
        const f = rr < minR2 ? 1 / minR2 : (rr < 1 ? 1 / rr : 1);
        z = mul(z, f); dr *= f;
        const s2 = actualScale * v.influence + (1 - v.influence);
        z = mul(z, s2); dr = dr * abs(s2) + 1;
        if (rotOn) z = mv(R, z);
        z = add(z, off);
      } else if (variant === 3 || variant === 4) {
        if (variant === 3 && abs(v.cMult) > 0.001) z = add(z, permuteBy(off, v.vCSwizzle), v.cMult);
        z = foldStack(z);
        if (v.vZFold) z[2] = boxF(z[2], fz);
        if (v.vSwapXY) z = [z[1], z[0], z[2]];
        if (variant === 4 && i % 2 === 0) {
          if (v.vEvenFlipY) z[1] = -z[1];
          if (v.vEvenFlipZ) z[2] = -z[2];
        }
        z = add(z, vOff);
        let rr = dot3(z);
        if (v.cylinder) rr -= z[2] * z[2];
        z = add(z, vSph);
        const f = rr < minR2 ? fixedR2 / minR2 : (rr < fixedR2 ? fixedR2 / rr : 1);
        z = mul(z, f); dr *= f;
        z = add(z, vSph, -1);
        const useScale = scaleA + scale;
        z = mul(z, useScale); dr = dr * abs(useScale) + 1;
        if (v.scaleVary !== 0) scaleA -= v.scaleVary * (abs(scaleA) - 1);
        if (rotOn) z = mv(R, z);
        if (variant === 4 && abs(v.cMult) > 0.001) z = add(z, permuteBy(off, v.vCSwizzle), v.cMult);
        z = add(z, off);
      } else if (variant === 5) {
        z = [boxF(z[0], fx), boxF(z[1], fy), z[2]];
        if (v.vZFold) z[2] = boxF(z[2], fz);
        z = add(z, vOff);
        const rr = dot3(z);
        const dividend = rr < minR2 ? minR2 : Math.min(rr, 1);
        const useScale = (scaleA + scale) / dividend;
        z = mul(z, useScale); dr = dr * abs(useScale) + v.vDEOffset;
        if (v.scaleVary !== 0) scaleA -= v.scaleVary * (abs(scaleA) - 1);
        if (abs(v.cMult) > 0.001) z = add(z, [off[1], off[0], off[2]], v.cMult);
        z = add(z, vPost);
        if (rotOn) z = mv(R, z);
        z = add(z, off);
      } else if (variant === 6) {
        z = foldStack(z);
        if (v.vZFold && abs(z[2]) > fz) z[2] = sgn(z[2]) * fv - z[2];
        z = add(z, vOff);
        let rr = dot3(z);
        if (v.cylinder) rr -= z[2] * z[2];
        z = add(z, vSph);
        const f = rr < minR2 ? 1 / minR2 : (rr < 1 ? 1 / rr : 1);
        z = mul(z, f); dr *= f;
        if (v.vMboxFold) {
          const g = rr < minR2 ? fixedR2 / minR2 : (rr < fixedR2 ? fixedR2 / rr : 1);
          z = mul(z, g); dr *= g;
        }
        z = add(z, vSph, -1);
        const s2 = scale * v.influence + (1 - v.influence);
        z = mul(z, s2); dr = dr * abs(s2) + 1;
        if (abs(v.cMult) > 0.001) z = add(z, permuteBy(off, v.vCSwizzle), v.cMult);
        if (rotOn) z = mv(R, z);
        z = add(z, off);
      } else if (variant === 7) {
        const fl = v.vFlip;
        if (fl === 1 || fl === 4 || fl === 5 || fl === 7) z[0] = -z[0];
        if (fl === 2 || fl === 4 || fl === 6 || fl === 7) z[1] = -z[1];
        if (fl === 3 || fl === 5 || fl === 6 || fl === 7) z[2] = -z[2];
        actualScale = scale + v.scaleVary * (abs(actualScale) - 1);
        z = [boxF(z[0], fx), boxF(z[1], fy), z[2]];
        z = add(z, vOff);
        let rr = dot3(z);
        if (v.cylinder) rr -= z[2] * z[2];
        let m = actualScale;
        if (rr < minR2) m /= minR2;
        else if (rr < 1) m /= rr;
        z = mul(z, m); dr = dr * abs(m) + v.vDEOffset;
        z = add(z, off);
        z = add(z, vPost);
        if (rotOn) z = mv(R, z);
      } else if (variant === 10) {
        // Amazing IFS — mirrors the SURF_VARIANT 10 block in glsl.js.
        for (let k = 0; k < 3; k++) if (preAbs[k]) z[k] = abs(z[k]);
        z = add(z, vOff);
        if (v.vPolyOn && i < (v.vPolyStop ?? 1)) {
          z[1] = abs(z[1]);
          const psi = Math.PI / v.polarN;
          const pa = abs(fmodC(Math.atan2(z[1], z[0]) + psi, 2 * psi) - psi);
          const len = Math.hypot(z[0], z[1]);
          z = [len * Math.cos(pa), len * Math.sin(pa), z[2]];
        }
        z = [boxF(z[0], fx), boxF(z[1], fy), z[2]];
        if (v.vZFold) z[2] = boxF(z[2], fz);
        for (let k = 0; k < 3; k++) if (ifsMode[k]) z[k] = (ifsMode[k] === 1 ? abs(z[k]) : z[k]) - ifsOff[k];
        z = add(z, ifsAdd);
        const rr = dot3(z);
        const dividend = rr < minR2 ? minR2 : Math.min(rr, 1);
        const useScale = (scaleA + scale) / dividend;
        z = mul(z, useScale); dr = dr * abs(useScale) + v.vDEOffset;
        if (v.scaleVary !== 0) scaleA -= v.scaleVary * (abs(scaleA) - 1);
        if (rotOn) z = mv(R, z);
        const de0 = Math.hypot(z[0], z[1], z[2]) / abs(dr);
        minDE = i >= (v.vMinDEStart | 0) && i < (v.vMinDEStop ?? 250) ? Math.min(minDE, de0) : de0;
        if (v.vAddC) z = add(z, off);
      } else if (variant >= 11) {
        actualScale = scale + v.scaleVary * (abs(actualScale) - 1);
        const st = surfStep(z, actualScale);
        z = st.z;
        dr = dr * st.fac + 1;
        if (abs(v.cMult) > 0.001) z = add(z, [off[1], off[0], off[2]], v.cMult);
        if (rotOn) z = mv(R, z);
        z = add(z, off);
      } else {
        if (variant === 9 && v.vPolyOn) {
          z[0] = abs(z[0]);
          if (v.vPolyAbsY) z[1] = abs(z[1]);
          const psi = Math.PI / v.polarN;
          const pa = abs(fmodC(Math.atan2(z[1], z[0]) + psi, 2 * psi) - psi);
          const len = Math.hypot(z[0], z[1]);
          z = [len * Math.cos(pa), len * Math.sin(pa), z[2]];
          z = add(z, vOff);
        }
        if (i < v.vKleinIters) {
          z = [boxF(z[0], fx), boxF(z[1], fy), z[2]];
          if (v.vSwapXY) z = [z[1], z[0], z[2]];
          if (variant === 8) {
            if (v.vZFold) z[2] = boxF(z[2], fz);
            if (v.vSwapYZ) z = [z[0], z[2], z[1]];
          } else if (v.vZFold) z[2] = boxF(z[2], fz);
          else z = [z[0], z[2], z[1]];
          const rr = dot3(z);
          const dividend = rr < minR2 ? minR2 : Math.min(rr, 1);
          const useScale = (scaleA + scale) / dividend;
          z = mul(z, useScale); dr = dr * abs(useScale) + v.vDEOffset;
          if (v.scaleVary !== 0) scaleA -= v.scaleVary * (abs(scaleA) - 1);
          if (rotOn) z = mv(R, z);
          z = add(z, vPost);
        } else {
          z = [boxF(z[0], vTail[0]), boxF(z[1], vTail[1]), boxF(z[2], vTail[2])];
          z = mul(z, v.vTailScale); dr *= abs(v.vTailScale);
          z = add(z, vTailOff);
        }
      }

      if (v.invEnabled && v.invMode === 1) dr = invert(z, dr);
      trap = Math.min(trap, dot3(z));
      if (variant !== 0 && dot3(z) > 10000) break; // Mandelbulber bailout 100
    }
    if (variant === 10 && v.vMinDE) return { d: 0.5 * minDE, trap };
    return { d: 0.5 * Math.hypot(z[0], z[1], z[2]) / abs(dr), trap };
  };
  map.applyFold = applyFold; // exposed for tests
  map.stackFold = stackFold;
  // Object transform (matches map() in glsl.js): evaluate in the object's frame.
  const T = objectTransform(v);
  if (T.identity) return map;
  return p => {
    const q = mat3MulVec(T.inv, [p[0] - T.pos[0], p[1] - T.pos[1], p[2] - T.pos[2]]);
    const r = map([q[0] / T.s, q[1] / T.s, q[2] / T.s]);
    return { ...r, d: r.d * T.s };
  };
}

// Sphere-trace one ray; returns hit distance or -1. Mirrors the shader loop,
// including Step Factor, Max Distance and "stranded rays as surface".
export function marchInfo(map, ro, rd, v) {
  const eps0 = 0.0003 / v.detail;
  const fac = v.stepFactor ?? 1, maxD = v.maxDist ?? 100;
  let t = 0, i = 0;
  for (; i < v.maxSteps; i++) {
    const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = map(p).d;
    if (!Number.isFinite(d)) return { t: -1, reason: 'nan', steps: i };
    if (d < eps0 * (1 + t * 0.1)) return { t, reason: 'hit', steps: i };
    t += v.maxStep > 0 ? Math.min(d * fac, v.maxStep) : d * fac;
    if (t > maxD) return { t: -1, reason: 'far', steps: i };
  }
  return { t: v.missAsHit ? t : -1, reason: 'stranded', steps: i };
}

export function march(map, ro, rd, v) { return marchInfo(map, ro, rd, v).t; }

// Distance to the surface under a screen pixel (CSS px, top-left origin).
export function probePixel(v, px, py, w, h) {
  const cam = cameraBasis(v);
  const rd = pixelRay(cam, v.lens, px, h - py, w, h);
  return march(makeDE(v), cam.eye, rd, v);
}

// Coarse visibility score for a view: fraction of a grid of rays that hit, plus
// the camera's own clearance. Used to reject blank or camera-inside rebirths.
export function viewScore(v, grid = 5) {
  const cam = cameraBasis(v);
  const map = makeDE(v);
  const clearance = map(cam.eye).d;
  const cheap = { ...v, maxSteps: Math.min(v.maxSteps, 160), detail: Math.min(v.detail, 0.5) };
  let hits = 0, near = 0;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const rd = pixelRay(cam, v.lens, (i + 0.5) / grid * 16, (j + 0.5) / grid * 9, 16, 9);
      const t = march(map, cam.eye, rd, cheap);
      if (t >= 0) { hits++; if (t < 0.02) near++; }
    }
  }
  return { hitFrac: hits / (grid * grid), nearFrac: near / (grid * grid), clearance };
}

// Volumetric "Auto Shell": choose shell thickness / density / min step from the
// scene's distance scale. Each probe ray records the smallest DE it meets. On
// real surfaces that goes to ~0 (median ≲ 2e-4); on "dust" settings the DE
// plateaus (~1e-3), and the shell must be thinner than the plateau or the whole
// volume turns into uniform fog.
export function suggestVolumeShell(v, gx = 16, gy = 10) {
  const cam = cameraBasis(v), map = makeDE(v);
  const mins = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const rd = pixelRay(cam, v.lens, (i + 0.5) / gx * 16, (j + 0.5) / gy * 9, 16, 9);
    let t = 0, m = Infinity;
    for (let k = 0; k < 300 && t < Math.min(v.maxDist ?? 100, 50); k++) {
      const d = map([cam.eye[0] + rd[0] * t, cam.eye[1] + rd[1] * t, cam.eye[2] + rd[2] * t]).d;
      if (!Number.isFinite(d)) break;
      m = Math.min(m, d);
      if (d < 1e-5) break;
      t += Math.max(d * 0.5, 0.002);
    }
    mins.push(m);
  }
  mins.sort((a, b) => a - b);
  const median = mins[mins.length >> 1];
  if (median > 5e-4) {
    const thick = median * 0.35;
    return { kind: 'dust', median, volThick: thick, volDensity: Math.min(200, 0.03 / thick), volStepMin: Math.max(0.0005, thick * 4) };
  }
  return { kind: 'surface', median, volThick: 0.004, volDensity: 20, volStepMin: 0.008 };
}
