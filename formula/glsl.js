// Kyma's GLSL: the surf-family formula uniforms and mapLocal(), plus the fold
// bodies. Organon (core/engine/glsl.js) wraps them with the shared renderer.
//
// The shader is SPECIALISED per fold combination: the spec selects fold A
// (and hybrid fold B, if any), the surf variant and the fold stack. A runtime
// if-chain over every fold inside the 40-iteration loop measured 2.1× slower
// even for the plain box fold, so each combination compiles to its own program
// (see Renderer.program()) and an unused fold costs nothing.

import { fractalFrag as coreFrag, fractalMapSource as coreMapSource } from '../core/engine/glsl.js';

// Fold bodies. Each transforms `z` in place. All are isometries (or, for the
// smooth box fold, 1-Lipschitz), so map() needs no derivative correction —
// tests/run.mjs verifies this numerically against the CPU port in de.js.
// Index order must match FOLD_NAMES in params.js.
export const FOLD_GLSL = [
  // 0 Type 1 (Box)
  `z = boxFold(z);
    if (u_tgladWeight > 0.0) z = tgladSmooth(z, u_fold, vec3(1.0));`,
  // 1 Type 2
  `z = u_fold - abs(abs(z) - u_fold);`,
  // 2 Type 3
  `z = 2.0 - abs(abs(z + u_fold) - 2.0) - u_fold;`,
  // 3 Surf XY (reference Amazing Surf: box-fold X and Y only)
  `z.xy = abs(z.xy + u_fold.xy) - abs(z.xy - u_fold.xy) - z.xy;
    if (u_tgladWeight > 0.0) z = tgladSmooth(z, u_fold, vec3(1.0, 1.0, 0.0));`,
  // 4 Tetrahedral (Sierpinski) symmetry + box
  `if (z.x + z.y < 0.0) z.xy = -z.yx;
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    if (z.y + z.z < 0.0) z.zy = -z.yz;
    z = boxFold(z);
    if (u_tgladWeight > 0.0) z = tgladSmooth(z, u_fold, vec3(1.0));`,
  // 5 Octahedral symmetry (abs + sort, Menger-style) + box
  `z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    z = boxFold(z);
    if (u_tgladWeight > 0.0) z = tgladSmooth(z, u_fold, vec3(1.0));`,
  // 6 Icosahedral symmetry + box. Mirrors x = 0, y = 0 and the golden mirror
  //   ICO_N bound one cell of the 120-element group Ih; six passes always
  //   land in it (tests/run.mjs checks the cell is 1/120 of space).
  `for (int k = 0; k < 6; k++) {
      z.xy = abs(z.xy);
      z -= 2.0 * min(0.0, dot(z, ICO_N)) * ICO_N;
    }
    z = boxFold(z);
    if (u_tgladWeight > 0.0) z = tgladSmooth(z, u_fold, vec3(1.0));`,
  // 7 Polar kaleidoscope: mirror into one of N sectors around Z, then XY box
  `float sector = 6.2831853 / u_polarN;
    float pa = abs(mod(atan(z.y, z.x) + 0.5 * sector, sector) - 0.5 * sector);
    z.xy = length(z.xy) * vec2(cos(pa), sin(pa));
    z.xy = abs(z.xy + u_fold.xy) - abs(z.xy - u_fold.xy) - z.xy;`,
  // 8 Smooth box: 2f·tanh(z/f) − z — the box fold with its creases rounded.
  //   Slope 2·sech² − 1 ∈ (−1, 1] keeps it 1-Lipschitz; unbounded like the box
  //   fold, so orbits can still escape. Axes with limit 0 reduce to z → −z.
  `z = 2.0 * u_fold * tanhSafe(z / max(u_fold, vec3(1e-4))) - z;`,
  // 9 Abs shift (Kali kaleidoscopic IFS step)
  `z = abs(z) - u_fold;`,
  // 10 Diagonal box: box fold in a frame rotated 45° about Z
  `vec2 dq = vec2(z.x - z.y, z.x + z.y) * 0.70710678;
    vec3 dw = boxFold(vec3(dq, z.z));
    z = vec3((dw.x + dw.y) * 0.70710678, (dw.y - dw.x) * 0.70710678, dw.z);`,
  // 11 Kali Type 2 (X/Y): FoldType 2 of Kali's original amazingsurface.frag
  `z.xy = u_fold.xy - abs(abs(z.xy) - u_fold.xy);`,
  // 12 Kali Type 3 (X/Y): FoldType 3 of Kali's original amazingsurface.frag
  `z.xy = abs(z.xy + u_fold.xy);`,
];

// Formula uniforms (inserted after Organon's render-mode uniforms).
export const UNIFORMS = `uniform float u_scale;
uniform float u_scaleVary;
uniform float u_minR;
uniform float u_influence;
uniform int   u_axisOrder;
uniform float u_tgladWeight;
uniform float u_cMult;
uniform bool  u_noC;
uniform vec3  u_preTrans;     // Classic: added after the fold, before the sphere fold (Kali's PreTranslation)
uniform bool  u_kaliDE;       // Classic: Kali's Mandelbox-style DE instead of |z|/2dr
// Wave Warp (Kyma): a per-iteration sine transform for every formula.
uniform int   u_waveType;      // 0 off, 1 ripple, 2 shear, 3 fold, 4 twist, 5 gyroid, 6 interference
uniform float u_waveAmp;
uniform float u_waveFreq;
uniform float u_wavePhase;
uniform float u_wavePhaseStep; // phase added per iteration
uniform int   u_waveStart;
uniform int   u_waveStop;
uniform vec3  u_waveAxis;      // per-axis weights (shear / fold / gyroid)
uniform bool  u_juliaMode;
uniform bool  u_cylinder;
uniform vec3  u_juliaC;
uniform vec3  u_fold;
uniform mat3  u_rotMatrix;    // post-fold rotation
uniform mat3  u_preRot;       // pre-fold rotation (tilts the fold planes)
uniform bool  u_preRotOn;
uniform mat3  u_spinMatrix;   // iteration k uses spin^k
uniform bool  u_spinOn;
uniform int   u_rotStart;     // rotations apply from this iteration on
uniform float u_invDELimit;   // clamp on the inversion's derivative factor
uniform int   u_iterations;
uniform int   u_hybridPeriod; // fold B on every Nth iteration
uniform float u_polarN;       // sectors for the polar kaleidoscope fold

// ── surf-family variant parameters (Mandelbulber surf formulas) ──
uniform float u_vFoldValue;
uniform float u_vFold2;
uniform bool  u_vZFold;
uniform bool  u_vSwapXY;
uniform bool  u_vSwapYZ;
uniform bool  u_vEvenFlipY;
uniform bool  u_vEvenFlipZ;
uniform int   u_vFlip;
uniform int   u_vCSwizzle;
uniform bool  u_vMboxFold;
uniform float u_vFixedR2;
uniform float u_vDEOffset;
uniform vec3  u_vOff;
uniform vec3  u_vSph;
uniform vec3  u_vPost;
uniform int   u_vKleinIters;
uniform vec3  u_vTail;
uniform float u_vTailScale;
uniform vec3  u_vTailOff;
uniform bool  u_vPolyOn;
uniform bool  u_vPolyAbsY;
// Amazing IFS (variant 10)
uniform vec3  u_vPreAbs;       // 1 = abs() that axis before the folds
uniform vec3  u_vIfsMode;      // per axis: 0 off, 1 mirror + shift (|z|−o), 2 shift only
uniform vec3  u_vIfsOff;
uniform vec3  u_vIfsAdd;       // offset added after the IFS fold, before the sphere fold
uniform bool  u_vAddC;         // add c (pixel or Julia) like Mandelbulber's "c pixel" option
uniform bool  u_vMinDE;        // DE = min over iterations of |z|/dr (Mandelbulber custom DE)
uniform int   u_vMinDEStart;   // Mandelbulber startIterationsC
uniform int   u_vMinDEStop;    // Mandelbulber stopIterationsC
uniform int   u_vPolyStop;     // polyfold runs for iterations [0, stop) (Mandelbulber stopIterationsP1, default 1)
// Mandelbulber-style sphere inversion, all formulas (transformCommon, iterations [start, stop))
uniform bool  u_vSInvOn;
uniform vec3  u_vSInvOff;      // offset000
uniform float u_vSInvG;        // scaleG1 (r² of the inversion sphere)
uniform vec3  u_vSInvAdd;      // additionConstant000
uniform float u_vSInvA;        // scaleA1
uniform int   u_vSInvStart;
uniform int   u_vSInvStop;

uniform bool  u_invEnabled;
uniform int   u_invMode;
uniform float u_invRadius;
uniform float u_invStrength;
uniform vec3  u_invCenter;

uniform float u_sphColW;       // weight per sphere-fold activation (inner 1×, middle ½×)
// colour source 3 = fold amounts (continuous), Mandelbulber's aux.color for the surf family
`;

// Helpers and the distance estimator. Organon provides g_boxCol, g_sphCol,
// g_colOn and (HAS_MAT) the texture probe g_texProbe / g_texDone / g_texZ / g_orbit.
const HELPERS = `

// Icosahedral (H3) golden mirror: with x = 0 and y = 0 it bounds one cell of
// Ih (angles π/2, π/3, π/5). Normal (−φ/2, −1/2, 1/(2φ)).
const vec3 ICO_N = vec3(-0.8090169944, -0.5, 0.3090169944);

vec3 permute(vec3 v, int order) {
  if (order == 1) return v.xzy;
  if (order == 2) return v.yxz;
  if (order == 3) return v.yzx;
  if (order == 4) return v.zxy;
  if (order == 5) return v.zyx;
  return v;
}

// Sphere inversion with derivative tracking; the derivative factor is clamped
// so the march can't stall near the inversion centre.
void sphereInvert(inout vec3 z, inout float dr) {
  vec3 dz = z - u_invCenter;
  float r2 = max(dot(dz, dz), 1e-6);
  float f = (u_invRadius * u_invRadius) / r2;
  z = mix(z, u_invCenter + dz * f, u_invStrength);
  dr *= mix(1.0, min(f, u_invDELimit), u_invStrength);
}

// Tglad smoothing of the box fold (per axis; axes with a zero limit are skipped).
vec3 tgladSmooth(vec3 z, vec3 limit, vec3 mask) {
  vec3 add = vec3(0.0);
  if (mask.x > 0.0 && abs(z.x) < limit.x) add.x = z.x * z.x / (2.0 * limit.x);
  if (mask.y > 0.0 && abs(z.y) < limit.y) add.y = z.y * z.y / (2.0 * limit.y);
  if (mask.z > 0.0 && abs(z.z) < limit.z) add.z = z.z * z.z / (2.0 * limit.z);
  return z - sign(z) * add * u_tgladWeight;
}

// tanh is not in GLSL ES 1.00; clamp keeps exp() finite.
vec3 tanhSafe(vec3 x) { x = clamp(x, -15.0, 15.0); vec3 e = exp(2.0 * x); return (e - 1.0) / (e + 1.0); }

// Box fold (Mandelbox / Amazing Surf core).
vec3 boxFold(vec3 z) { return abs(z + u_fold) - abs(z - u_fold) - z; }
// Fold-count colouring (Mandelbulber-style "aux colour"): every box-fold that
// actually reflects a component, and every sphere-fold that rescales, adds to a
// running count. The count is piecewise constant over the surface, so a banded
// gradient turns it into the crisp stripes Amazing Surf renders are known for.
float g_boxAmt; // Σ (|z| − 1) over components a box fold reflected (Mandelbulber difs.xyz)
float g_sphAmt; // Σ (r² − minR²)/100 where the sphere fold left z outside minR (difs.w)
vec2 boxXY(vec2 v, vec2 f) {
  vec2 hit = step(f, abs(v));
  vec2 r = abs(v + f) - abs(v - f) - v;
  g_boxCol += g_colOn * (hit.x + hit.y);
  g_boxAmt += g_colOn * dot(hit, abs(r) - 1.0);
  return r;
}
float boxF(float v, float f) {
  float hit = step(f, abs(v));
  float r = abs(v + f) - abs(v - f) - v;
  g_boxCol += g_colOn * hit;
  g_boxAmt += g_colOn * hit * (abs(r) - 1.0);
  return r;
}
// C-style fmod (result takes the sign of the dividend), as in Mandelbulber.
float fmodC(float a, float b) { float q = a / b; return a - b * sign(q) * floor(abs(q)); }
`;

const MAP = `

// ═══ Distance estimator ════════════════════════════════════════════════════
// Wave Warp. Each shape is a smooth, bounded deformation; dr is scaled by a
// local upper bound of the Jacobian's norm so the distance estimate stays
// conservative (rays never overshoot because of the warp).
void applyWave(inout vec3 z, inout float dr, int i) {
  float A = u_waveAmp, F = u_waveFreq;
  float ph = u_wavePhase + u_wavePhaseStep * float(i);
  float AF = abs(A * F);
  vec3 w = u_waveAxis;
  if (u_waveType == 1) {            // Ripple: radial sine shells
    float r = length(z);
    float g = 1.0 + A * sin(F * r + ph);
    z *= g;
    dr *= abs(g) + AF * r;
  } else if (u_waveType == 2) {     // Sine Shear: each axis pushed by the next
    z += A * w * sin(F * z.yzx + ph);
    dr *= 1.0 + AF * max(max(abs(w.x), abs(w.y)), abs(w.z));
  } else if (u_waveType == 3) {     // Wave Fold: soft periodic fold, blend = A
    vec3 s = sin(F * z + ph) / max(F, 1e-4);
    vec3 b = clamp(abs(A) * w, 0.0, 1.0);
    z = mix(z, s, b);
  } else if (u_waveType == 4) {     // Twist Wave: XY rotation waving along Z
    float th = A * sin(F * z.z + ph);
    float c = cos(th), sn = sin(th);
    float rxy = length(z.xy);
    z.xy = vec2(c * z.x - sn * z.y, sn * z.x + c * z.y);
    dr *= 1.0 + AF * rxy;
  } else if (u_waveType == 5) {     // Gyroid Wave: sin·cos lattice displacement
    vec3 q = F * z;
    z += A * w * sin(q + ph) * cos(q.yzx);
    dr *= 1.0 + AF * 1.4142136 * max(max(abs(w.x), abs(w.y)), abs(w.z));
  } else if (u_waveType == 6) {     // Interference: product of three standing waves
    vec3 q = F * z + ph;
    vec3 s = sin(q), c = cos(q);
    float P = s.x * s.y * s.z;
    z += A * w * P;
    dr *= 1.0 + AF * 1.7320508 * length(w);
  }
}

// SURF_VARIANT selects the per-iteration formula (compile-time):
//   0 Classic v2 engine       1 Amazing Surf (Mandelbulber reference)
//   2 Mod 1   3 Mod 2   4 Mod 3   5 Mod 4   6 Multi   7 M3D   8 Klein   9 Klein V2
// Variants 1–9 reimplement Mandelbulber's surf-family math (not its code) and
// use its bailout of 100. Everywhere Mandelbulber's analytic DE approximates the
// scale factor (e.g. |m| when Influence ≠ 1) the true applied factor is used.
// The app-level transforms — inversion, axis swap, pre-rotation, spin — wrap
// every variant.
#if SURF_VARIANT >= 11
// ═══ Kyma's own surf variants (11–15) ═══════════════════════════════════════
// All keep the Amazing Surf skeleton (scale vary → X/Y box fold → sphere fold
// → C-Mult → rotation → +c) and change the sphere fold or what follows it.
// Each step reports fac, a bound on how far it can stretch space, and the
// derivative is tracked as dr = dr·fac + 1 (the +1 is the added c).
uniform vec3  u_vLox;      // Loxodromic: spiral twist about X, Y, Z per unit of ln(1/r²)
uniform vec3  u_vTorusR;   // Torus: ring radius around X, Y, Z
uniform vec3  u_vTorusOn;  // Torus: which rings are on (1/0)
uniform vec3  u_vEll;      // Ellipsoid: semi-axis stretch
uniform vec3  u_vVortex;   // Vortex: twist per ln(radius) about X, Y, Z
uniform vec3  u_vVortexD;  // Vortex: twist per height about X, Y, Z
uniform vec2  u_vGyro;     // Gyroid: frequency, fold limit

// Coordinates with axis a last (w.xy = plane, w.z = along the axis).
vec3 toAxis(vec3 z, int a) { return a == 0 ? z.yzx : (a == 1 ? z.zxy : z); }
vec3 fromAxis(vec3 w, int a) { return a == 0 ? w.zxy : (a == 1 ? w.yzx : w); }
vec3 twistAxis(vec3 z, int a, float th) {
  vec3 w = toAxis(z, a);
  float c = cos(th), s = sin(th);
  w.xy = vec2(c * w.x - s * w.y, s * w.x + c * w.y);
  return fromAxis(w, a);
}
// Sphere-fold factor for radius² rr (Amazing Surf's combined fold and scale).
float surfM(float rr, float minR2, float sc) { return sc / (rr < minR2 ? minR2 : min(rr, 1.0)); }

// Largest singular value of k·I + u⊗g (g = ∇k): closed form for a rank-1 update.
float sigRank1(float k, vec3 u, vec3 g) {
  if (abs(k) < 1e-9) return abs(k) + length(u) * length(g);
  vec3 v = g / k;
  float a = dot(u, v), b2 = dot(u, u) * dot(v, v);
  float T = 2.0 + 2.0 * a + b2, D = (1.0 + a) * (1.0 + a);
  return abs(k) * sqrt(0.5 * (T + sqrt(max(T * T - 4.0 * D, 0.0))));
}

// Torus ring fold about axis a, ring radius R, fold scale sc (the Amazing Surf
// scale on the last ring, 1 on earlier ones). Cylindrical (ρ, h) about the
// axis: ρ' = R + k(ρ − R), h' = k·h with k from the distance² to the ring.
// fac is multiplied by its exact stretch: meridian and ring-tangent
// directions are independent.
vec3 ringFold(vec3 z, int a, float R, float sc, float minR2, bool colour, inout float fac) {
  vec3 w = toAxis(z, a);
  float rho = length(w.xy);
  vec3 qv = vec3(rho - R, w.z, 0.0);
  float rr = dot(qv, qv);
  if (colour) {
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
  }
  float m = surfM(rr, minR2, sc);
  float k = (m - 1.0) * u_influence + 1.0;
  vec3 gk = (rr > minR2 && rr < 1.0) ? -u_influence * m * 2.0 * qv / rr : vec3(0.0);
  float rho2 = R + k * (rho - R);
  w.xy = rho > 1e-9 ? w.xy * (rho2 / rho) : vec2(rho2, 0.0);
  w.z *= k;
  fac *= max(sigRank1(k, qv, gk), abs(rho2) / max(rho, 1e-9));
  return fromAxis(w, a);
}

// Vortex twist about axis a by β·ln ρ + δ·height; stretch ≤ 1 + |β| + |δ|ρ.
vec3 vortexTwist(vec3 z, int a, float b, float d, inout float fac) {
  vec3 w = toAxis(z, a);
  float rv = length(w.xy);
  fac *= 1.0 + abs(b) + abs(d) * rv;
  return twistAxis(z, a, b * log(rv + 1e-4) + d * w.z);
}

#if SURF_VARIANT == 15
// Gyroid fold: reflect space across the gyroid sheets d = ±L, where
// d = g/|∇g| (|∇g| floored at f/2) approximates the distance to g = 0 — the
// way a box fold reflects across x = ±f. Returns the folded z; gfac is the
// exact largest stretch (analytic Jacobian, largest eigenvalue of JᵀJ).
vec3 gyroFold(vec3 z, out float gfac) {
  float f = u_vGyro.x, L = u_vGyro.y;
  vec3 q = z * f;
  vec3 sn = sin(q), cs = cos(q);
  float g = sn.x * cs.y + sn.y * cs.z + sn.z * cs.x;
  vec3 gr = vec3(cs.x * cs.y - sn.z * sn.x, cs.y * cs.z - sn.x * sn.y, cs.z * cs.x - sn.y * sn.z) * f;
  float gn = length(gr);
  float gl = max(gn, 0.5 * f);
  float d = g / gl;
  gfac = 1.0;
  if (abs(d) <= L) return z;
  float sgn = d > 0.0 ? 1.0 : -1.0;
  float e = d - sgn * L;               // z' = z − 2e·n̂, n̂ = ∇g/gl
  // Hessian of g (columns), f²·∂²G.
  float hxx = -sn.x * cs.y - sn.z * cs.x, hyy = -sn.x * cs.y - sn.y * cs.z, hzz = -sn.y * cs.z - sn.z * cs.x;
  float hxy = -cs.x * sn.y, hyz = -cs.y * sn.z, hxz = -cs.z * sn.x;
  mat3 H = mat3(hxx, hxy, hxz, hxy, hyy, hyz, hxz, hyz, hzz) * (f * f);
  vec3 ggl = gn > 0.5 * f ? H * gr / gn : vec3(0.0);   // ∇gl
  vec3 gd = gr / gl - g * ggl / (gl * gl);             // ∇d
  vec3 nh = gr / gl;
  // J = I − 2 n̂⊗∇d − 2e·(H/gl − ∇g⊗∇gl/gl²); columns j = ∂/∂z_j.
  mat3 J = mat3(1.0) - 2.0 * mat3(nh * gd.x, nh * gd.y, nh * gd.z)
         - 2.0 * e * (H / gl - mat3(gr * ggl.x, gr * ggl.y, gr * ggl.z) / (gl * gl));
  // Largest eigenvalue of the symmetric JᵀJ (trigonometric closed form).
  vec3 c0 = J[0], c1 = J[1], c2 = J[2];
  float a00 = dot(c0, c0), a11 = dot(c1, c1), a22 = dot(c2, c2);
  float a01 = dot(c0, c1), a02 = dot(c0, c2), a12 = dot(c1, c2);
  float p1 = a01 * a01 + a02 * a02 + a12 * a12;
  float tq = (a00 + a11 + a22) / 3.0;
  float p2 = (a00 - tq) * (a00 - tq) + (a11 - tq) * (a11 - tq) + (a22 - tq) * (a22 - tq) + 2.0 * p1;
  float pp = sqrt(max(p2 / 6.0, 0.0));
  float lam = tq;
  if (pp > 1e-12) {
    float b00 = (a00 - tq) / pp, b11 = (a11 - tq) / pp, b22 = (a22 - tq) / pp;
    float b01 = a01 / pp, b02 = a02 / pp, b12 = a12 / pp;
    float det = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
    float phi = acos(clamp(det * 0.5, -1.0, 1.0)) / 3.0;
    lam = tq + 2.0 * pp * cos(phi);
  }
  gfac = sqrt(max(lam, 0.0)) * 1.001;
  return z - 2.0 * e * nh;
}
#endif
#endif

float mapLocal(vec3 p, out float trap) {
#ifdef HAS_MAT
  g_texDone = false;
#endif
  g_boxCol = 0.0;
  g_sphCol = 0.0;
  g_boxAmt = 0.0;
  g_sphAmt = 0.0;
  float minDE = 1000.0;
  vec3 z = p;
  float dr = 1.0;
  trap = 1e10;
  vec3 offset = u_juliaMode ? u_juliaC : p;
#if SURF_VARIANT == 8 || SURF_VARIANT == 9
  offset = vec3(0.0); // Klein formulas add no c
#endif
  if (u_noC) offset = vec3(0.0); // Mandelbulber "don't add c constant"
  float actualScale = u_scale;
  float scaleA = 0.0;
  float minR2 = u_minR * u_minR;
  mat3 spin = mat3(1.0);

  for (int i = 0; i < 250; i++) {
    if (i >= u_iterations) break;
    g_colOn = i < u_colorIters ? 1.0 : 0.0;

    if (u_invEnabled && u_invMode == 0) sphereInvert(z, dr);

    z = permute(z, u_axisOrder);
    bool rotOn = i >= u_rotStart;
    if (rotOn && u_preRotOn) z = u_preRot * z;
    if (rotOn && u_spinOn) { z = spin * z; spin = spin * u_spinMatrix; }

    // Mandelbulber-style sphere inversion (transformCommon, from Amazing IFS),
    // for every formula: invert about −O with radius² G, shift by A, scale by S,
    // for iterations [start, stop). Exact derivative, no clamp.
    if (u_vSInvOn && i >= u_vSInvStart && i < u_vSInvStop) {
      z += u_vSInvOff;
      float ri = max(dot(z, z), 1e-20);
      z *= u_vSInvG / ri;
      dr *= u_vSInvG / ri;
      z += u_vSInvAdd - u_vSInvOff;
      z *= u_vSInvA;
      dr *= u_vSInvA;
    }

    // Wave Warp (all formulas), after the Mandelbulber inversion.
    if (u_waveType > 0 && i >= u_waveStart && i < u_waveStop) applyWave(z, dr, i);

#if SURF_VARIANT == 0
    actualScale = u_scale + u_scaleVary * (abs(actualScale) - 1.0);
  #ifdef HAS_FOLD_B
    if (i - (i / u_hybridPeriod) * u_hybridPeriod == u_hybridPeriod - 1) z = foldB(z);
    else z = foldA(z);
  #else
    z = foldA(z);
  #endif
    z += u_preTrans;
    float rr = u_cylinder ? dot(z.xy, z.xy) : dot(z, z);
    expSmoothStep(rr); // 'Exp smoothing' colour (Organon; no-op unless selected)
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float dividend = (rr < minR2) ? minR2 : min(rr, 1.0);
    float m = actualScale / dividend;
    // Influence blends the sphere-fold scale toward 1; the derivative uses the
    // factor actually applied (v1 and Mandelbulber use |m|).
    float k = (m - 1.0) * u_influence + 1.0;
    z *= k;
    z += offset;
    if (abs(u_cMult) > 0.001) z += offset.yxz * u_cMult;
    if (rotOn) z = u_rotMatrix * z;
    dr = dr * abs(k) + 1.0;

#elif SURF_VARIANT == 1
    // Amazing Surf (Kali / DarkBeam, Mandelbulber reference ordering).
    actualScale = u_scale + u_scaleVary * (abs(actualScale) - 1.0);
    z.xy = boxXY(z.xy, u_fold.xy);
    float rr = dot(z, z);
    if (u_cylinder) rr -= z.z * z.z;
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float dividend = rr < minR2 ? minR2 : min(rr, 1.0);
    float m = actualScale / dividend;
    float k = (m - 1.0) * u_influence + 1.0;
    z *= k;
    dr = dr * abs(k) + 1.0;
    if (abs(u_cMult) > 0.001) z += offset.yxz * u_cMult;
    if (rotOn) z = u_rotMatrix * z;
    z += offset;

#elif SURF_VARIANT == 2
    // Mod 1: fold stack, offset, Abox sphere fold, then a separate scale.
    actualScale = u_scale + u_scaleVary * (abs(actualScale) - 1.0);
    z = foldStack(z);
    z += u_vOff;
    float rr = dot(z, z);
    if (u_cylinder) rr -= z.z * z.z;
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float f = rr < minR2 ? 1.0 / minR2 : (rr < 1.0 ? 1.0 / rr : 1.0);
    z *= f;
    dr *= f;
    float s2 = actualScale * u_influence + (1.0 - u_influence);
    z *= s2;
    dr = dr * abs(s2) + 1.0;
    if (rotOn) z = u_rotMatrix * z;
    z += offset;

#elif SURF_VARIANT == 3 || SURF_VARIANT == 4
    // Mod 2 / Mod 3: fold stack, optional Z fold / swap, Mandelbox sphere fold
    // with centre offset and adjustable outer radius², additive scale.
  #if SURF_VARIANT == 3
    if (abs(u_cMult) > 0.001) z += permute(offset, u_vCSwizzle) * u_cMult;
  #endif
    z = foldStack(z);
    if (u_vZFold) z.z = boxF(z.z, u_fold.z);
    if (u_vSwapXY) z.xy = z.yx;
  #if SURF_VARIANT == 4
    bool even = (i - (i / 2) * 2) == 0;
    if (u_vEvenFlipY && even) z.y = -z.y;
    if (u_vEvenFlipZ && even) z.z = -z.z;
  #endif
    z += u_vOff;
    float rr = dot(z, z);
    if (u_cylinder) rr -= z.z * z.z;
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    z += u_vSph;
    float f = rr < minR2 ? u_vFixedR2 / minR2 : (rr < u_vFixedR2 ? u_vFixedR2 / rr : 1.0);
    z *= f;
    dr *= f;
    z -= u_vSph;
    float useScale = scaleA + u_scale;
    z *= useScale;
    dr = dr * abs(useScale) + 1.0;
    if (u_scaleVary != 0.0) scaleA -= u_scaleVary * (abs(scaleA) - 1.0);
    if (rotOn) z = u_rotMatrix * z;
  #if SURF_VARIANT == 4
    if (abs(u_cMult) > 0.001) z += permute(offset, u_vCSwizzle) * u_cMult;
  #endif
    z += offset;

#elif SURF_VARIANT == 5
    // Mod 4: XY (+Z) box fold, offset, combined sphere fold + additive scale.
    z.xy = boxXY(z.xy, u_fold.xy);
    if (u_vZFold) z.z = boxF(z.z, u_fold.z);
    z += u_vOff;
    float rr = dot(z, z);
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float dividend = rr < minR2 ? minR2 : min(rr, 1.0);
    float useScale = (scaleA + u_scale) / dividend;
    z *= useScale;
    dr = dr * abs(useScale) + u_vDEOffset;
    if (u_scaleVary != 0.0) scaleA -= u_scaleVary * (abs(scaleA) - 1.0);
    if (abs(u_cMult) > 0.001) z += offset.yxz * u_cMult;
    z += u_vPost;
    if (rotOn) z = u_rotMatrix * z;
    z += offset;

#elif SURF_VARIANT == 6
    // Multi: fold stack, optional Z reflect, Abox (+ optional Mandelbox) sphere folds.
    z = foldStack(z);
    if (u_vZFold && abs(z.z) > u_fold.z) z.z = sign(z.z) * u_vFoldValue - z.z;
    z += u_vOff;
    float rr = dot(z, z);
    if (u_cylinder) rr -= z.z * z.z;
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    z += u_vSph;
    float f = rr < minR2 ? 1.0 / minR2 : (rr < 1.0 ? 1.0 / rr : 1.0);
    z *= f;
    dr *= f;
    if (u_vMboxFold) {
      float g = rr < minR2 ? u_vFixedR2 / minR2 : (rr < u_vFixedR2 ? u_vFixedR2 / rr : 1.0);
      z *= g;
      dr *= g;
    }
    z -= u_vSph;
    float s2 = u_scale * u_influence + (1.0 - u_influence);
    z *= s2;
    dr = dr * abs(s2) + 1.0;
    if (abs(u_cMult) > 0.001) z += permute(offset, u_vCSwizzle) * u_cMult;
    if (rotOn) z = u_rotMatrix * z;
    z += offset;

#elif SURF_VARIANT == 7
    // M3D (Mandelbulb3D original): sign flips, XY box fold, offset, sphere fold, c, post offset.
    if (u_vFlip == 1 || u_vFlip == 4 || u_vFlip == 5 || u_vFlip == 7) z.x = -z.x;
    if (u_vFlip == 2 || u_vFlip == 4 || u_vFlip == 6 || u_vFlip == 7) z.y = -z.y;
    if (u_vFlip == 3 || u_vFlip == 5 || u_vFlip == 6 || u_vFlip == 7) z.z = -z.z;
    actualScale = u_scale + u_scaleVary * (abs(actualScale) - 1.0);
    z.xy = boxXY(z.xy, u_fold.xy);
    z += u_vOff;
    float rr = dot(z, z);
    if (u_cylinder) rr -= z.z * z.z;
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float m = actualScale;
    if (rr < minR2) m /= minR2;
    else if (rr < 1.0) m /= rr;
    z *= m;
    dr = dr * abs(m) + u_vDEOffset;
    z += offset;
    z += u_vPost;
    if (rotOn) z = u_rotMatrix * z;

#elif SURF_VARIANT == 10
    // Amazing IFS (Mandelbulber fractal_amazing_ifs.cpp; Kali, DarkBeam): Amazing
    // Surf Mod 4 plus an IFS mirror-and-shift fold, with c off by default.
    // (Its built-in sphere inversion is the shared Mandelbulber inversion above.)
    if (u_vPreAbs.x > 0.5) z.x = abs(z.x);
    if (u_vPreAbs.y > 0.5) z.y = abs(z.y);
    if (u_vPreAbs.z > 0.5) z.z = abs(z.z);
    z += u_vOff;
    if (u_vPolyOn && i < u_vPolyStop) {
      z.y = abs(z.y);
      float psi = 3.14159265 / u_polarN;
      float pa = abs(fmodC(atan(z.y, z.x) + psi, 2.0 * psi) - psi);
      z.xy = length(z.xy) * vec2(cos(pa), sin(pa));
    }
    z.xy = boxXY(z.xy, u_fold.xy);
    if (u_vZFold) z.z = boxF(z.z, u_fold.z);
    // IFS fold: mirror (|z|) then shift, per axis; "shift only" keeps the sign.
    if (u_vIfsMode.x > 0.5) z.x = (u_vIfsMode.x < 1.5 ? abs(z.x) : z.x) - u_vIfsOff.x;
    if (u_vIfsMode.y > 0.5) z.y = (u_vIfsMode.y < 1.5 ? abs(z.y) : z.y) - u_vIfsOff.y;
    if (u_vIfsMode.z > 0.5) z.z = (u_vIfsMode.z < 1.5 ? abs(z.z) : z.z) - u_vIfsOff.z;
    z += u_vIfsAdd;
    float rr = dot(z, z);
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float dividend = rr < minR2 ? minR2 : min(rr, 1.0);
    float useScale = (scaleA + u_scale) / dividend;
    z *= useScale;
    dr = dr * abs(useScale) + u_vDEOffset;
    if (u_scaleVary != 0.0) scaleA -= u_scaleVary * (abs(scaleA) - 1.0);
    if (rotOn) z = u_rotMatrix * z;
    // Mandelbulber aux.dist: running min only inside [start, stop), else reset.
    float de0 = length(z) / abs(dr);
    minDE = (i >= u_vMinDEStart && i < u_vMinDEStop) ? min(minDE, de0) : de0;
    if (u_vAddC) z += offset;

#elif SURF_VARIANT >= 11
    actualScale = u_scale + u_scaleVary * (abs(actualScale) - 1.0);
    z.xy = boxXY(z.xy, u_fold.xy);
    float fac = 1.0;
  #if SURF_VARIANT == 15
    // Gyroid Surf: gyroid-sheet fold after the box fold, then the sphere fold.
    z = gyroFold(z, fac);
  #endif
  #if SURF_VARIANT == 12
    // Torus Surf: up to three ring folds, around X, Y and Z, in that order.
    // Only the last ring that is on carries the Amazing Surf scale, so one
    // ring alone is the single-ring fold; no ring is the plain sphere fold.
    int last = u_vTorusOn.z > 0.5 ? 2 : (u_vTorusOn.y > 0.5 ? 1 : (u_vTorusOn.x > 0.5 ? 0 : -1));
    if (last >= 0) {
      if (u_vTorusOn.x > 0.5) z = ringFold(z, 0, u_vTorusR.x, last == 0 ? actualScale : 1.0, minR2, last == 0, fac);
      if (u_vTorusOn.y > 0.5) z = ringFold(z, 1, u_vTorusR.y, last == 1 ? actualScale : 1.0, minR2, last == 1, fac);
      if (u_vTorusOn.z > 0.5) z = ringFold(z, 2, u_vTorusR.z, actualScale, minR2, true, fac);
    } else {
      float rr = dot(z, z);
      g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
      g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
      float m = surfM(rr, minR2, actualScale);
      float k = (m - 1.0) * u_influence + 1.0;
      vec3 gk = (rr > minR2 && rr < 1.0) ? -u_influence * m * 2.0 * z / rr : vec3(0.0);
      fac *= sigRank1(k, z, gk);
      z *= k;
    }
  #else
  #if SURF_VARIANT == 13
    // Ellipsoid Surf: fold boundaries are ellipsoids (radius measured in a stretched space).
    vec3 ue = z / u_vEll;
    float rr = dot(ue, ue);
    vec3 grr = 2.0 * z / (u_vEll * u_vEll);
  #else
    float rr = dot(z, z);
    vec3 grr = 2.0 * z;
  #endif
    g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
    float m = surfM(rr, minR2, actualScale);
    float k = (m - 1.0) * u_influence + 1.0;
    // ∇k (zero where the fold factor is constant); the fold's exact stretch is
    // the largest singular value of k·I + x⊗∇k.
    vec3 gk = (rr > minR2 && rr < 1.0) ? -u_influence * m * grr / rr : vec3(0.0);
  #if SURF_VARIANT == 11
    // Loxodromic Surf: inside the fold, turn about X, then Y, then Z by
    // Twist × ln(1/r²): the inversion becomes a loxodromic (spiral) Möbius map.
    // The twists keep |z|, so the stretch is ≤ 1 + 2(|tx| + |ty| + |tz|).
    float lnr = log(1.0 / clamp(rr, max(minR2, 1e-12), 1.0));
    z = twistAxis(z, 0, u_vLox.x * lnr);
    z = twistAxis(z, 1, u_vLox.y * lnr);
    z = twistAxis(z, 2, u_vLox.z * lnr);
    fac *= sigRank1(k, z, gk) * (rr > minR2 && rr < 1.0 ? 1.0 + 2.0 * (abs(u_vLox.x) + abs(u_vLox.y) + abs(u_vLox.z)) : 1.0);
    z *= k;
  #elif SURF_VARIANT == 14
    // Vortex Surf: after the fold, twist about X, then Y, then Z, each by its
    // Twist × ln ρ + Twist per Height × height, so every scale winds into
    // logarithmic spirals.
    fac *= sigRank1(k, z, gk);
    z *= k;
    z = vortexTwist(z, 0, u_vVortex.x, u_vVortexD.x, fac);
    z = vortexTwist(z, 1, u_vVortex.y, u_vVortexD.y, fac);
    z = vortexTwist(z, 2, u_vVortex.z, u_vVortexD.z, fac);
  #else
    fac *= sigRank1(k, z, gk);
    z *= k;
  #endif
  #endif
    dr = dr * fac + 1.0;
    if (abs(u_cMult) > 0.001) z += offset.yxz * u_cMult;
    if (rotOn) z = u_rotMatrix * z;
    z += offset;
#else
    // Klein / Klein V2: surf iterations, then a full box-fold × scale tail.
  #if SURF_VARIANT == 9
    if (u_vPolyOn) {
      z.x = abs(z.x);
      if (u_vPolyAbsY) z.y = abs(z.y);
      float psi = 3.14159265 / u_polarN;
      float pa = abs(fmodC(atan(z.y, z.x) + psi, 2.0 * psi) - psi);
      z.xy = length(z.xy) * vec2(cos(pa), sin(pa));
      z += u_vOff;
    }
  #endif
    if (i < u_vKleinIters) {
      z.xy = boxXY(z.xy, u_fold.xy);
      if (u_vSwapXY) z.xy = z.yx;
  #if SURF_VARIANT == 8
      if (u_vZFold) z.z = boxF(z.z, u_fold.z);
      if (u_vSwapYZ) z.yz = z.zy;
  #else
      if (u_vZFold) z.z = boxF(z.z, u_fold.z);
      else z.yz = z.zy;
  #endif
      float rr = dot(z, z);
      g_sphCol += g_colOn * (rr < minR2 ? 1.0 : (rr < 1.0 ? 0.5 : 0.0));
    g_sphAmt += g_colOn * max(rr - minR2, 0.0) * 0.01;
      float dividend = rr < minR2 ? minR2 : min(rr, 1.0);
      float useScale = (scaleA + u_scale) / dividend;
      z *= useScale;
      dr = dr * abs(useScale) + u_vDEOffset;
      if (u_scaleVary != 0.0) scaleA -= u_scaleVary * (abs(scaleA) - 1.0);
      if (rotOn) z = u_rotMatrix * z;
      z += u_vPost;
    } else {
      z = abs(z + u_vTail) - abs(z - u_vTail) - z;
      z *= u_vTailScale;
      dr *= abs(u_vTailScale);
      z += u_vTailOff;
    }
#endif

    if (u_invEnabled && u_invMode == 1) sphereInvert(z, dr);

    trap = min(trap, dot(z, z));
#if SURF_VARIANT != 0
    expSmoothStep(dot(z, z));
#endif
#ifdef HAS_MAT
    if (g_texProbe && !g_texDone && i >= u_texFracStart) {
      vec3 zz = abs(z - p);
      if (max(zz.x, max(zz.y, zz.z)) < u_texFracCube) { g_texZ = z; g_texDone = true; }
      else if (length(z) > u_texFracCube * 100.0) { g_texZ = z / length(z); g_texDone = true; }
    }
#endif
#if SURF_VARIANT != 0
    if (dot(z, z) > 10000.0) break; // Mandelbulber bailout 100
#endif
  }
#ifdef HAS_MAT
  g_orbit = trap;
  if (g_texProbe && !g_texDone) g_texZ = z;
#endif
  if (u_colorSource == 3) {
    // ×2.5 cancels the shader's trap·0.4, so one weighted unit = one index unit.
    trap = (g_boxAmt * u_foldColW + g_sphAmt * u_sphColW) * 2.5;
  } else if (u_colorSource == 1 || u_colorSource == 2) {
    float folds = g_boxCol * u_foldColW + g_sphCol * u_sphColW;
    trap = u_colorSource == 1 ? folds * 2.5 : trap + folds * 2.5;
  }
#if SURF_VARIANT == 10
  if (u_vMinDE) return 0.5 * minDE;
#endif
#if SURF_VARIANT == 0
  // Kali's estimate (amazingsurface.frag): (|z| − |S − 1|)/w − |S|^(1−N).
  // The last term assumes |S| > 1; it is dropped otherwise.
  if (u_kaliDE) {
    float as = abs(u_scale);
    return (length(z) - abs(u_scale - 1.0)) / abs(dr) - (as > 1.0 ? pow(as, 1.0 - float(u_iterations)) : 0.0);
  }
#endif
  return 0.5 * length(z) / abs(dr);
}

`;

// Fold-stack slot bodies (X/Y), index order = STACK_FOLDS in params.js.
export const STACK_GLSL = [
  '',
  'z.xy = boxXY(z.xy, u_fold.xy);',
  'z.xy = u_fold.xy - abs(abs(z.xy) - u_fold.xy);',
  'z.xy = abs(z.xy + u_fold.xy);',
  'if (abs(z.x) > u_fold.x) z.x = sign(z.x) * u_vFoldValue - z.x;\n    if (abs(z.y) > u_fold.y) z.y = sign(z.y) * u_vFoldValue - z.y;',
  'z.xy = u_vFold2 - abs(abs(z.xy + u_fold.xy) - u_vFold2) - u_fold.xy;',
  '{ vec2 sg = sign(z.xy); vec2 tg = boxXY(z.xy, u_fold.xy); z.xy -= sg * min(abs(sg * (z.xy - tg)), vec2(u_vFold2)); }',
];

export const DEFAULT_STACK = [1, 0, 0, 0, 0];

// Program defines for a canonical spec.
export const defines = f => `#define SURF_VARIANT ${f.variant | 0}\n` + (f.b >= 0 ? '#define HAS_FOLD_B\n' : '');

// Formula source for a canonical spec { variant, a, b, stack }.
export function source(f) {
  const a = FOLD_GLSL[f.a] ?? FOLD_GLSL[0];
  let src = HELPERS + `
vec3 foldA(vec3 z) {
    ${a}
    return z;
}
`;
  if (f.b >= 0) src += `
vec3 foldB(vec3 z) {
    ${FOLD_GLSL[f.b]}
    return z;
}
`;
  const stack = (f.stack || DEFAULT_STACK).map(t => STACK_GLSL[t] || '').filter(Boolean);
  src += `
vec3 foldStack(vec3 z) {
    ${stack.join('\n    ')}
    return z;
}
`;
  return src + MAP;
}

// ── Program spec ────────────────────────────────────────────────────────────
// Fold-stack variants (Mod 1/2/3, Multi) are the only ones that read the stack;
// classic is the only one that reads fold A/B.
const STACK_VARIANTS = new Set([2, 3, 4, 6]);

// Canonical spec from sceneUniforms().__f: fields a program doesn't use are
// normalised away so they don't multiply the number of compiled programs.
export function spec(raw) {
  raw = raw || {};
  const variant = raw.variant | 0;
  const classic = variant === 0;
  const a = classic ? raw.a | 0 : 0;
  let b = classic ? (raw.b ?? -1) | 0 : -1;
  if (b === a || b >= FOLD_GLSL.length) b = -1;
  const stack = STACK_VARIANTS.has(variant) ? (raw.stack || DEFAULT_STACK).map(x => x | 0) : [...DEFAULT_STACK];
  return { variant, a, b, stack };
}

export const specKey = f => `v${f.variant}|${f.a}|${f.b}|${f.stack.join('')}`;
export const DEFAULT_SPEC = spec({ variant: 0, a: 0, b: -1 });

// ── Back-compat helpers (tests) ─────────────────────────────────────────────
// fractalFrag(foldA, foldB, opts), opts { mode, texLod, variant, stack, mat, xl, rep, dz }.
export const fractalFrag = (foldA, foldB = -1, opts = {}) =>
  coreFrag({ f: spec({ variant: opts.variant, a: foldA, b: foldB, stack: opts.stack }) }, opts);
export const fractalMapSource = (foldA, foldB = -1, opts = {}) =>
  coreMapSource({ f: spec({ variant: opts.variant, a: foldA, b: foldB, stack: opts.stack }) }, opts);
