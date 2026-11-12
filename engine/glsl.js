// GLSL ES 1.00 sources (WebGL1).
//
// The fractal shader is SPECIALISED per fold combination: fractalFrag(a, b)
// emits only the code for fold A (and hybrid fold B, if any). A runtime
// if-chain over every fold inside the 40-iteration loop measured 2.1× slower
// even for the plain box fold, so each combination compiles to its own program
// (see Renderer.program()) and an unused fold costs nothing.

export const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Tone/display pass: accumulated linear colour → screen.
export const DISPLAY_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_tonemap; // 0 = legacy v1 curve, 1 = filmic (ACES fit) + sRGB gamma
void main() {
  vec3 col = max(texture2D(u_tex, v_uv).rgb, vec3(0.0));
  if (u_tonemap == 1) {
    col = clamp(col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
    col = pow(col, vec3(1.0 / 2.2));
  } else {
    col = pow(col, vec3(0.8));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

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
  // 6 Icosahedral symmetry (Knighty three-plane fold, two passes) + box
  `z = abs(z);
    for (int k = 0; k < 2; k++) {
      z -= 2.0 * min(0.0, dot(z, ICO_N1)) * ICO_N1;
      z -= 2.0 * min(0.0, dot(z, ICO_N2)) * ICO_N2;
      z -= 2.0 * min(0.0, dot(z, ICO_N3)) * ICO_N3;
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
];

const FRAG_HEAD = `
precision highp float;

// ── progressive / tiling plumbing ──
uniform vec2  u_resolution;   // full image size (uv space)
uniform vec2  u_pixelOffset;  // tile origin inside the full image
uniform vec2  u_bufferSize;   // size of the render target being written
uniform vec2  u_jitter;       // sub-pixel AA offset for this sample
uniform vec2  u_lensSample;   // low-discrepancy DOF lens sample for this pass
uniform sampler2D u_prev;     // previous running average
uniform float u_blend;        // 1/(n+1); 1.0 = first sample, ignore u_prev
uniform float u_sampleIndex;  // progressive sample number (path tracer / volume RNG)

// ── path tracer ──
uniform int   u_ptBounces;
uniform float u_ptRough;
uniform float u_ptMetal;
uniform float u_ptSky;
uniform vec3  u_ptSkyColor;
uniform float u_ptSun;
uniform float u_ptLightSize;
uniform float u_ptEmit;
uniform float u_ptClamp;

// ── volumetric ──
uniform float u_volDensity;
uniform float u_volThick;
uniform float u_volGlow;
uniform float u_volStepMin;
uniform int   u_volSteps;
uniform float u_volLight;

// ── formula ──
uniform float u_scale;
uniform float u_scaleVary;
uniform float u_minR;
uniform float u_influence;
uniform int   u_axisOrder;
uniform float u_tgladWeight;
uniform float u_cMult;
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
uniform int   u_vMinDEStart;   // first iteration that counts (Mandelbulber startIterationsC)

uniform bool  u_invEnabled;
uniform int   u_invMode;
uniform float u_invRadius;
uniform float u_invStrength;
uniform vec3  u_invCenter;

// ── camera ──
uniform vec3  u_camPos;
uniform vec3  u_camRight;
uniform vec3  u_camUp;
uniform vec3  u_camForward;
uniform float u_lens;
uniform float u_dof;
uniform float u_focalDist;

// ── shading ──
uniform int   u_maxSteps;
uniform float u_detail;
uniform float u_stepFactor;
uniform float u_maxDist;
uniform bool  u_missAsHit;
uniform int   u_debugView;

// ── environment ──
uniform sampler2D u_env;
uniform int   u_envMode;      // 0 solid, 1 backdrop, 2 panorama
uniform float u_envAspect;    // source image aspect (for backdrop cover-fit)
uniform float u_envIntensity;
uniform float u_envBlur;
uniform mat3  u_envRot;
uniform float u_envReflect;
uniform float u_envLight;
uniform bool  u_envFog;
uniform float u_fog;
uniform float u_volumetric;
uniform float u_brightness;
uniform float u_vignette;
uniform float u_colorShift;
uniform int   u_colorSource;   // 0 orbit trap, 1 fold count, 2 trap + folds
uniform float u_foldColW;      // weight per box-fold activation
uniform float u_sphColW;       // weight per sphere-fold activation (inner 1×, middle ½×)
uniform int   u_colorIters;    // folds count only in the first N iterations (broad bands)
// colour source 3 = fold amounts (continuous), Mandelbulber's aux.color for the surf family
uniform sampler2D u_grad;      // 256×1 colour gradient LUT (engine/gradients.js)
uniform float u_gradScale;
uniform vec3  u_lightPos;
uniform vec3  u_lightColor;
uniform vec3  u_bgColor;
uniform float u_ambient;
uniform float u_stepAO;
uniform float u_aoStrength;
uniform bool  u_shadows;
uniform float u_shadowSoft;

// Icosahedral fold planes (golden ratio).
const vec3 ICO_N1 = vec3(-0.4999999976, 0.3090169932, 0.8090169935);
const vec3 ICO_N2 = vec3(0.3090169932, 0.8090169935, -0.4999999976);
const vec3 ICO_N3 = vec3(0.8090169935, -0.4999999976, 0.3090169932);

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
float g_boxCol;
float g_sphCol;
float g_boxAmt; // Σ (|z| − 1) over components a box fold reflected (Mandelbulber difs.xyz)
float g_sphAmt; // Σ (r² − minR²)/100 where the sphere fold left z outside minR (difs.w)
float g_colOn; // 1 while the current iteration counts toward the colour
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

const FRAG_TAIL = `
// ═══ Distance estimator ════════════════════════════════════════════════════
// SURF_VARIANT selects the per-iteration formula (compile-time):
//   0 Classic v2 engine       1 Amazing Surf (Mandelbulber reference)
//   2 Mod 1   3 Mod 2   4 Mod 3   5 Mod 4   6 Multi   7 M3D   8 Klein   9 Klein V2
// Variants 1–9 reimplement Mandelbulber's surf-family math (not its code) and
// use its bailout of 100. Everywhere Mandelbulber's analytic DE approximates the
// scale factor (e.g. |m| when Influence ≠ 1) the true applied factor is used.
// The app-level transforms — inversion, axis swap, pre-rotation, spin — wrap
// every variant.
float map(vec3 p, out float trap) {
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
  float actualScale = u_scale;
  float scaleA = 0.0;
  float minR2 = u_minR * u_minR;
  mat3 spin = mat3(1.0);

  for (int i = 0; i < 40; i++) {
    if (i >= u_iterations) break;
    g_colOn = i < u_colorIters ? 1.0 : 0.0;

    if (u_invEnabled && u_invMode == 0) sphereInvert(z, dr);

    z = permute(z, u_axisOrder);
    bool rotOn = i >= u_rotStart;
    if (rotOn && u_preRotOn) z = u_preRot * z;
    if (rotOn && u_spinOn) { z = spin * z; spin = spin * u_spinMatrix; }

#if SURF_VARIANT == 0
    actualScale = u_scale + u_scaleVary * (abs(actualScale) - 1.0);
  #ifdef HAS_FOLD_B
    if (i - (i / u_hybridPeriod) * u_hybridPeriod == u_hybridPeriod - 1) z = foldB(z);
    else z = foldA(z);
  #else
    z = foldA(z);
  #endif
    float rr = u_cylinder ? dot(z.xy, z.xy) : dot(z, z);
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
    // Its built-in sphere inversion is Kyma's Sphere Inversion (start of iteration).
    if (u_vPreAbs.x > 0.5) z.x = abs(z.x);
    if (u_vPreAbs.y > 0.5) z.y = abs(z.y);
    if (u_vPreAbs.z > 0.5) z.z = abs(z.z);
    z += u_vOff;
    if (u_vPolyOn) {
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
    if (i >= u_vMinDEStart) minDE = min(minDE, length(z) / abs(dr));
    if (u_vAddC) z += offset;

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
    if (dot(z, z) > 10000.0) break; // Mandelbulber bailout 100
#endif
  }
  if (u_colorSource == 3) {
    // ×2.5 cancels the shader's trap·0.4, so one weighted unit = one index unit.
    trap = (g_boxAmt * u_foldColW + g_sphAmt * u_sphColW) * 2.5;
  } else if (u_colorSource != 0) {
    float folds = g_boxCol * u_foldColW + g_sphCol * u_sphColW;
    trap = u_colorSource == 1 ? folds * 2.5 : trap + folds * 2.5;
  }
#if SURF_VARIANT == 10
  if (u_vMinDE) return 0.5 * minDE;
#endif
  return 0.5 * length(z) / abs(dr);
}

// Tetrahedral normal: 4 DE evaluations instead of 6.
vec3 getNormal(vec3 p, float e) {
  float tr;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * e, tr) +
    k.yyx * map(p + k.yyx * e, tr) +
    k.yxy * map(p + k.yxy * e, tr) +
    k.xxx * map(p + k.xxx * e, tr));
}

float surfaceAO(vec3 p, vec3 n, float scale) {
  float occ = 0.0, w = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = scale * (0.02 + 0.12 * float(i) / 4.0);
    float tr;
    float d = map(p + n * h, tr);
    occ += (h - d) / h * w;
    w *= 0.6;
  }
  return clamp(1.0 - 0.45 * occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd, float maxT, float k, float eps) {
  float res = 1.0;
  float t = eps * 8.0;
  for (int i = 0; i < 80; i++) {
    if (t > maxT) break;
    float tr;
    float h = map(ro + rd * t, tr);
    if (h < eps) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, eps * 2.0, 0.3);
  }
  return clamp(res, 0.0, 1.0);
}


// ═══ Ground plane ══════════════════════════════════════════════════════════
// A horizontal plane at y = u_groundY, optionally displaced into hills, dunes or
// rock. It is a second surface in the ray march (not part of map()), so the
// fractal's DE, colouring, normals and the CPU mirror are untouched; the ground
// receives the fractal's shadows and contact AO through map().
// Types: 0 off, 1 matte, 2 grass, 3 sand, 4 rock, 5 water, 6 mirror, 7 checker.
uniform int   u_groundType;
uniform float u_groundY;
uniform vec3  u_groundCol;
uniform vec3  u_groundCol2;
uniform float u_groundScale;   // feature size of the texture and terrain
uniform float u_groundBump;    // terrain height (water: wave strength)
uniform float u_groundReflect; // water / mirror reflectivity
uniform float u_groundRough;   // mirror / water blur (path tracer)
uniform float u_groundFade;    // distance haze that melts the ground into the sky
uniform bool  u_groundShadows;

float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * gNoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s; // ≈ 0 … 0.94, mean ≈ 0.47
}

// Terrain height above u_groundY.
float groundHeight(vec2 xz) {
  if (u_groundBump <= 0.0) return 0.0;
  vec2 q = xz / u_groundScale;
  if (u_groundType == 2) return u_groundBump * (gFbm(q * 0.25) - 0.47) * 1.5;                 // rolling hills
  if (u_groundType == 3) return u_groundBump * ((gFbm(q * 0.2) - 0.47) * 1.2
                                 + 0.06 * sin(dot(q, vec2(0.8, 0.6)) * 6.0 + gFbm(q * 0.5) * 4.0)); // dunes + ripples
  if (u_groundType == 4) { float r = gFbm(q * 0.4); return u_groundBump * (r * r * 2.2 - 0.45); } // rock lumps
  return 0.0; // matte, water (waves are in the normal), mirror, checker: flat
}

// Distance to the ground. Displaced terrain is Lipschitz-scaled so the march
// never overshoots a slope.
float groundDist(vec3 p) {
  if (u_groundType == 0) return 1e9;
  float k = u_groundBump > 0.0 && u_groundType >= 2 && u_groundType <= 4 ? 1.0 / (1.0 + 1.6 * u_groundBump / u_groundScale) : 1.0;
  return (p.y - u_groundY - groundHeight(p.xz)) * k;
}

vec3 groundNormal(vec3 p, float t) {
  float e = 0.01 * u_groundScale;
  vec3 n = normalize(vec3(groundHeight(p.xz - vec2(e, 0.0)) - groundHeight(p.xz + vec2(e, 0.0)), 2.0 * e,
                          groundHeight(p.xz - vec2(0.0, e)) - groundHeight(p.xz + vec2(0.0, e))));
  vec2 q = p.xz / u_groundScale;
  float far = clamp(t * 0.03 / u_groundScale, 0.0, 1.0); // fade micro-detail out with distance (no shimmer)
  if (u_groundType == 5) {
    // Water: two octaves of wave slopes from noise gradients.
    vec2 w = vec2(gNoise(q * 1.7) - gNoise(q * 1.7 + vec2(0.37, 0.0)), gNoise(q * 1.7) - gNoise(q * 1.7 + vec2(0.0, 0.37)))
           + 0.5 * vec2(gNoise(q * 5.3) - gNoise(q * 5.3 + vec2(0.21, 0.0)), gNoise(q * 5.3) - gNoise(q * 5.3 + vec2(0.0, 0.21)));
    n = normalize(n + vec3(w.x, 0.0, w.y) * u_groundBump * 3.0 * (1.0 - 0.7 * far));
  } else if (u_groundType == 2) {
    // Grass: blade-scale tilt jitter.
    vec2 j = vec2(gNoise(q * 40.0), gNoise(q * 40.0 + 7.3)) - 0.5;
    n = normalize(n + vec3(j.x, 0.0, j.y) * 0.8 * (1.0 - far));
  }
  return n;
}

vec3 groundAlbedo(vec3 p, float t) {
  vec2 q = p.xz / u_groundScale;
  float far = clamp(t * 0.03 / u_groundScale, 0.0, 1.0);
  if (u_groundType == 2) {
    vec3 base = mix(u_groundCol, u_groundCol2, smoothstep(0.3, 0.75, gFbm(q * 0.6)));
    // Blade streaks: anisotropic noise in two directions, averaged away with distance.
    float blades = 0.5 * gNoise(q * vec2(80.0, 8.0)) + 0.5 * gNoise(q.yx * vec2(70.0, 9.0) + 3.1);
    blades = mix(blades, 0.5, far);
    return base * (0.45 + 1.1 * blades);
  }
  if (u_groundType == 3) {
    float rip = 0.5 + 0.5 * sin(dot(q, vec2(0.8, 0.6)) * 18.0 + gFbm(q * 0.8) * 6.0);
    float grain = mix(gNoise(q * 120.0), 0.5, far);
    return mix(u_groundCol, u_groundCol2, 0.35 * rip + 0.3 * gFbm(q * 0.3)) * (0.85 + 0.3 * grain);
  }
  if (u_groundType == 4) {
    float m = gFbm(q * 2.0);
    float crack = smoothstep(0.02, 0.0, abs(gNoise(q * 6.0) - 0.5)) * (1.0 - far);
    return mix(u_groundCol, u_groundCol2, smoothstep(0.35, 0.7, m)) * (1.0 - 0.6 * crack);
  }
  if (u_groundType == 7) {
    vec2 c = floor(q);
    float k = mod(c.x + c.y, 2.0);
    return mix(mix(u_groundCol, u_groundCol2, k), 0.5 * (u_groundCol + u_groundCol2), far);
  }
  return u_groundCol; // matte, water body colour, mirror tint
}

// Ground reflectivity at this view angle: water follows Fresnel, mirror is flat.
float groundReflectance(vec3 n, vec3 rd) {
  if (u_groundType == 5) return u_groundReflect * (0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0));
  if (u_groundType == 6) return u_groundReflect;
  return 0.0;
}

// Fractal-only march used by ground reflections.
bool marchFractal(vec3 ro, vec3 rd, out float t, out float trap) {
  float eps0 = 0.0003 / u_detail;
  t = 0.0; trap = 0.0;
  for (int i = 0; i < 1024; i++) {
    if (i >= u_maxSteps) return false;
    float d = map(ro + rd * t, trap);
    if (d < eps0 * (1.0 + t * 0.1)) return true;
    t += d * u_stepFactor;
    if (t > u_maxDist) return false;
  }
  return false;
}

// One gradient period spans the LUT; u_gradScale folds in the gradient's
// natural band width, Repeat and Mirror. Sampled at the texel centre row.
vec3 palette(float idx) {
  return texture2D(u_grad, vec2(fract(idx * u_gradScale), 0.5)).rgb;
}

// ── Environment lookups ──
vec4 envTex(vec2 uv, float lod) {
#ifdef HAS_TEX_LOD
  return texture2DLodEXT(u_env, uv, lod);
#else
  return texture2D(u_env, uv, lod);
#endif
}

// Equirectangular lookup for a world direction.
vec3 envDir(vec3 d, float lod) {
  d = u_envRot * d;
  vec2 uv = vec2(atan(d.x, -d.z) * 0.15915494 + 0.5, acos(clamp(d.y, -1.0, 1.0)) * 0.31830989);
  return envTex(uv, lod).rgb;
}

vec3 envBackground(vec3 rd, vec2 screenUv) {
  if (u_envMode == 1) {
    // Cover-fit the image to the full frame (not the tile).
    float sa = u_resolution.x / u_resolution.y;
    vec2 uv = screenUv - 0.5;
    if (sa > u_envAspect) uv.y *= u_envAspect / sa; else uv.x *= sa / u_envAspect;
    uv += 0.5;
    uv.y = 1.0 - uv.y;
    return envTex(uv, u_envBlur).rgb * u_envIntensity;
  }
  return envDir(rd, u_envBlur) * u_envIntensity;
}


// Sky seen in a direction (for reflections and the horizon haze).
vec3 skyColor(vec3 d) {
  return u_envMode == 2 ? envDir(d, u_envBlur) * u_envIntensity : u_bgColor;
}

// Surface-mode ground shading: textured albedo, light with the fractal's shadow
// and contact AO, environment light, reflections of the fractal and sky for
// water / mirror, then a distance haze into the sky so there is no hard horizon.
vec3 shadeGround(vec3 p, vec3 rd, float t, vec3 bg) {
  vec3 n = groundNormal(p, t);
  vec3 alb = groundAlbedo(p, t);
  float eN = 0.0004 * (1.0 + t * 0.1) / u_detail;
  vec3 toL = u_lightPos - p;
  float lightDist = length(toL);
  vec3 L = toL / lightDist;
  float diff = max(dot(n, L), 0.0);
  float sh = 1.0;
  if (u_groundShadows && diff > 0.0) sh = softShadow(p + n * eN * 4.0, L, min(lightDist, 30.0), u_shadowSoft, eN);
  float ao = u_aoStrength > 0.0 ? mix(1.0, surfaceAO(p, n, 1.0 + t * 0.05), u_aoStrength) : 1.0;
  vec3 col = alb * (diff * sh + u_ambient) * ao;
  if (u_envMode > 0) col += alb * envDir(n, 6.0) * u_envLight * ao;

  float refl = groundReflectance(n, rd);
  if (refl > 0.0) {
    vec3 R = reflect(rd, n);
    if (R.y < 0.02) R.y = 0.02; // waves can tilt the reflection under the plane
    R = normalize(R);
    vec3 rc = skyColor(R);
    float tr, trap;
    if (marchFractal(p + n * eN * 6.0, R, tr, trap)) {
      vec3 q = p + n * eN * 6.0 + R * tr;
      vec3 fn = getNormal(q, 0.0004 * (1.0 + tr * 0.1) / u_detail);
      vec3 fl = normalize(u_lightPos - q);
      rc = palette(trap * 0.4 + u_colorShift * 10.0) * (max(dot(fn, fl), 0.0) + u_ambient)
         + pow(max(dot(reflect(R, fn), fl), 0.0), 32.0) * 0.4 * u_lightColor;
    }
    col = mix(col, rc * mix(vec3(1.0), alb, u_groundType == 6 ? 0.5 : 0.0), refl);
    col += pow(max(dot(reflect(rd, n), L), 0.0), 120.0) * sh * u_lightColor * refl * 2.0; // sun glint
  }
  return mix(col, bg, 1.0 - exp(-u_groundFade * t * 0.05));
}

vec3 heat(float x) {
  x = clamp(x, 0.0, 1.0);
  return clamp(vec3(1.5 * x, 1.5 * x - 0.5, 0.5 - 1.5 * x + 3.0 * x * x * x), 0.0, 1.0) + vec3(0.0, 0.0, 0.25 * (1.0 - x));
}

// Hash without sine (stable across GPUs).
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Primary camera ray (AA jitter + thin-lens DOF), shared by every render mode.
void primaryRay(out vec3 ro, out vec3 rd, out vec2 pix, out vec2 screenUv) {
  pix = gl_FragCoord.xy + u_pixelOffset;
  vec2 fragCoord = pix + u_jitter;
  screenUv = fragCoord / u_resolution;
  vec2 uv = (fragCoord - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  ro = u_camPos;
  rd = normalize(u_camForward * u_lens + uv.x * u_camRight + uv.y * u_camUp);
  if (u_dof > 0.0) {
    vec3 focusPoint = ro + rd * u_focalDist;
    vec2 h = fract(u_lensSample + hash22(pix));
    float r = sqrt(h.x);
    float ang = h.y * 6.2831853;
    ro += (u_camRight * cos(ang) + u_camUp * sin(ang)) * r * u_dof * 0.2;
    rd = normalize(focusPoint - ro);
  }
}

vec3 accumulate(vec3 col) {
  vec3 prev = u_blend < 1.0 ? texture2D(u_prev, gl_FragCoord.xy / u_bufferSize).rgb : vec3(0.0);
  return mix(prev, col, u_blend);
}

float vignetteAt(vec2 screenUv) { return 1.0 - smoothstep(0.4, 0.8, length(screenUv - 0.5)) * u_vignette; }

#if RENDER_MODE == 0
void main() {
  vec2 pix = gl_FragCoord.xy + u_pixelOffset;
  vec2 fragCoord = pix + u_jitter;
  vec2 screenUv = fragCoord / u_resolution;
  vec2 uv = (fragCoord - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  vec3 ro = u_camPos;
  vec3 rd = normalize(u_camForward * u_lens + uv.x * u_camRight + uv.y * u_camUp);

  if (u_dof > 0.0) {
    vec3 focusPoint = ro + rd * u_focalDist;
    // Cranley-Patterson rotated low-discrepancy lens sample (v1 used one random
    // number for both radius and angle, which put every sample on a spiral).
    vec2 h = fract(u_lensSample + hash22(pix));
    float r = sqrt(h.x);
    float ang = h.y * 6.2831853;
    ro += (u_camRight * cos(ang) + u_camUp * sin(ang)) * r * u_dof * 0.2;
    rd = normalize(focusPoint - ro);
  }

  float eps0 = 0.0003 / u_detail;
  float t = 0.0, trap = 0.0, steps = 0.0, vol = 0.0;
  bool hit = false, exhausted = true, onGround = false;

  for (int i = 0; i < 1024; i++) {
    if (i >= u_maxSteps) break;
    vec3 p = ro + rd * t;
    float d = map(p, trap);
    float dg = groundDist(p);
    onGround = dg < d;
    d = min(d, dg);
    if (u_volumetric > 0.0) {
      vec3 dl = u_lightPos - p;
      float scatter = 1.0 / (1.0 + dot(dl, dl) * 2.0);
      vol += scatter * min(d, 0.08) * u_volumetric;
    }
    if (d < eps0 * (1.0 + t * 0.1)) { hit = true; exhausted = false; break; }
    t += d * u_stepFactor;
    steps = float(i);
    if (t > u_maxDist) { exhausted = false; break; }
  }
  // A ray that used every step without converging stalled in a region where
  // the DE plateaus above the hit threshold: optionally shade it as surface.
  bool stranded = !hit && exhausted;
  if (stranded && u_missAsHit) hit = true;
  if (!hit) onGround = false;

  if (u_debugView == 1) {
    vec3 hc = heat(steps / float(u_maxSteps));
    vec3 prevD = u_blend < 1.0 ? texture2D(u_prev, gl_FragCoord.xy / u_bufferSize).rgb : vec3(0.0);
    gl_FragColor = vec4(mix(prevD, pow(hc, vec3(1.25)), u_blend), 1.0);
    return;
  }

  vec3 bg = u_envMode > 0 ? envBackground(rd, screenUv) : u_bgColor;
  vec3 col = bg;
  if (hit && onGround) {
    col = shadeGround(ro + rd * t, rd, t, bg);
    vec3 fogColG = (u_envMode > 0 && u_envFog) ? bg : u_bgColor;
    col = mix(col, fogColG, 1.0 - exp(-u_fog * t * 0.1));
  } else if (hit) {
    vec3 p = ro + rd * t;
    float eN = 0.0004 * (1.0 + t * 0.1) / u_detail;
    vec3 n = getNormal(p, eN);
    vec3 toL = u_lightPos - p;
    float lightDist = length(toL);
    vec3 lightDir = toL / lightDist;
    float diff = max(dot(n, lightDir), 0.0);
    float spec = pow(max(dot(reflect(rd, n), lightDir), 0.0), 32.0);

    float ao = mix(1.0, 1.0 - steps / float(u_maxSteps), u_stepAO);
    if (u_aoStrength > 0.0) ao *= mix(1.0, surfaceAO(p, n, 1.0 + t * 0.05), u_aoStrength);
    ao = max(ao, 0.0);

    float sh = 1.0;
    if (u_shadows && diff > 0.0) sh = softShadow(p + n * eN * 2.0, lightDir, min(lightDist, 20.0), u_shadowSoft, eN);

    vec3 baseCol = palette(trap * 0.4 + u_colorShift * 10.0);
    col = baseCol * (diff * sh + u_ambient) * ao + spec * sh * 0.4 * u_lightColor;
    if (u_envMode > 0) {
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
      col += baseCol * envDir(n, 6.0) * u_envLight * ao;
      col += envDir(reflect(rd, n), 1.5) * u_envReflect * fres * ao;
    }
    vec3 fogCol = (u_envMode > 0 && u_envFog) ? bg : u_bgColor;
    col = mix(col, fogCol, 1.0 - exp(-u_fog * t * 0.1));
  }
  if (u_debugView == 2) {
    // Miss reason: green = hit, red = ran out of steps, blue = passed Max Distance.
    float shade = hit ? 0.35 + 0.65 * clamp(dot(col, vec3(0.333)), 0.0, 1.0) : 1.0;
    vec3 dc = stranded ? vec3(0.9, 0.1, 0.1) : hit ? vec3(0.2, 0.85, 0.3) * shade : vec3(0.1, 0.2, 0.7);
    vec3 prevD = u_blend < 1.0 ? texture2D(u_prev, gl_FragCoord.xy / u_bufferSize).rgb : vec3(0.0);
    gl_FragColor = vec4(mix(prevD, pow(dc, vec3(1.25)), u_blend), 1.0);
    return;
  }
  col += u_lightColor * vol;
  col *= u_brightness;
  col *= 1.0 - smoothstep(0.4, 0.8, length(screenUv - 0.5)) * u_vignette;
  col = max(col, vec3(0.0));

  vec3 prev = u_blend < 1.0 ? texture2D(u_prev, gl_FragCoord.xy / u_bufferSize).rgb : vec3(0.0);
  gl_FragColor = vec4(mix(prev, col, u_blend), 1.0);
}
#endif

#if RENDER_MODE == 1
// ═══ Path tracer ═══════════════════════════════════════════════════════════
// Unidirectional path tracing with next-event estimation toward the (sphere)
// light, cosine-weighted diffuse + rough-mirror specular lobes chosen by
// Fresnel, Russian roulette after the 2nd bounce, and the environment image
// (or a sky colour) as the light source for escaped rays. Radiance is linear;
// the display pass applies the filmic tone curve.

vec2 g_pix;
float g_cnt;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float rnd() {
  g_cnt += 1.0;
  return hash13(vec3(g_pix * 1.37 + g_cnt * 7.123, u_sampleIndex * 3.917 + g_cnt * 1.618));
}
vec3 randomSphere() {
  float z = 2.0 * rnd() - 1.0, a = 6.2831853 * rnd();
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a), r * sin(a), z) * pow(rnd(), 0.3333);
}
vec3 cosineDir(vec3 n) {
  float a = 6.2831853 * rnd(), u = 2.0 * rnd() - 1.0;
  return normalize(n + vec3(sqrt(max(0.0, 1.0 - u * u)) * vec2(cos(a), sin(a)), u));
}
vec3 toLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

bool g_onGround;
bool traceHit(vec3 ro, vec3 rd, out float t, out float trap) {
  float eps0 = 0.0003 / u_detail;
  t = 0.0; trap = 0.0; g_onGround = false;
  for (int i = 0; i < 1024; i++) {
    if (i >= u_maxSteps) return u_missAsHit;
    vec3 p = ro + rd * t;
    float d = map(p, trap);
    float dg = groundDist(p);
    g_onGround = dg < d;
    d = min(d, dg);
    if (d < eps0 * (1.0 + t * 0.1)) return true;
    t += d * u_stepFactor;
    if (t > u_maxDist) return false;
  }
  return u_missAsHit;
}

float shadowVis(vec3 ro, vec3 rd, float maxT, float eps) {
  float t = eps * 8.0;
  for (int i = 0; i < 1024; i++) {
    if (i >= u_maxSteps || t > maxT) break;
    float tr;
    float h = map(ro + rd * t, tr);
    if (h < eps) return 0.0;
    t += h * u_stepFactor;
  }
  return 1.0;
}

vec3 skyLight(vec3 d) {
  if (u_envMode > 0) return toLin(envDir(d, 2.0)) * u_ptSky;
  return toLin(u_ptSkyColor) * mix(0.12, 1.0, d.y * 0.5 + 0.5) * u_ptSky;
}

void main() {
  vec3 ro, rd; vec2 pix, screenUv;
  primaryRay(ro, rd, pix, screenUv);
  g_pix = pix; g_cnt = 0.0;

  vec3 bgPrimary = toLin(u_envMode > 0 ? envBackground(rd, screenUv) : u_bgColor);
  vec3 acc = vec3(0.0), thr = vec3(1.0);
  float tPrimary = -1.0;
  bool primaryGround = false;
  vec3 lightCol = toLin(u_lightColor) * u_ptSun;

  for (int b = 0; b < 7; b++) {
    if (b > u_ptBounces) break;
    float t, trap;
    if (!traceHit(ro, rd, t, trap)) {
      acc += thr * (b == 0 ? bgPrimary : skyLight(rd));
      break;
    }
    if (b == 0) { tPrimary = t; primaryGround = g_onGround; }
    vec3 p = ro + rd * t;
    float eN = 0.0004 * (1.0 + t * 0.1) / u_detail;
    // Material: the fractal uses the Path Tracing sliders; the ground its own.
    vec3 n, albedo;
    float metal = u_ptMetal, rough = u_ptRough;
    if (g_onGround) {
      n = groundNormal(p, t);
      albedo = toLin(groundAlbedo(p, t));
      if (u_groundType == 6) { metal = u_groundReflect; rough = u_groundRough; }
      else if (u_groundType == 5) { metal = 0.0; rough = u_groundRough; albedo *= 1.0 - u_groundReflect * 0.7; }
      else { metal = 0.0; rough = 1.0; }
    } else {
      n = getNormal(p, eN);
      albedo = toLin(palette(trap * 0.4 + u_colorShift * 10.0));
      acc += thr * albedo * u_ptEmit * exp(-trap * 4.0);
    }
    if (dot(n, rd) > 0.0) n = -n;

    vec3 F0 = mix(vec3(u_groundType == 5 && g_onGround ? 0.02 : 0.04), albedo, metal);
    vec3 fres = F0 + (1.0 - F0) * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);

    // Next-event estimation: one shadow ray to a random point on the light sphere.
    vec3 lp = u_lightPos + randomSphere() * u_ptLightSize;
    vec3 toL = lp - p;
    float ld = length(toL);
    vec3 l = toL / ld;
    float ndl = dot(n, l);
    if (ndl > 0.0) {
      float vis = shadowVis(p + n * eN * 2.0, l, ld, eN);
      if (vis > 0.0) {
        float shin = 2.0 / max(rough * rough, 0.002);
        vec3 diffW = albedo * (1.0 - metal) * (1.0 - fres);
        vec3 specW = fres * pow(max(dot(reflect(rd, n), l), 0.0), shin) * (shin + 2.0) * 0.125;
        acc += thr * (diffW + specW) * ndl * lightCol;
      }
    }

    // Choose the next bounce lobe.
    float pSpec = clamp(dot(fres, vec3(0.3333)) * (1.0 - 0.5 * rough) + 0.5 * metal, 0.05, 0.95);
    vec3 nd;
    if (rnd() < pSpec) {
      nd = normalize(reflect(rd, n) + randomSphere() * rough);
      if (dot(nd, n) <= 0.0) break;
      thr *= fres / pSpec;
    } else {
      nd = cosineDir(n);
      thr *= albedo * (1.0 - metal) * (1.0 - fres) / (1.0 - pSpec);
    }
    if (b >= 2) {
      float q = clamp(max(thr.x, max(thr.y, thr.z)), 0.05, 1.0);
      if (rnd() > q) break;
      thr /= q;
    }
    ro = p + n * eN * 3.0;
    rd = nd;
  }

  vec3 col = acc;
  if (tPrimary > 0.0) {
    if (primaryGround) col = mix(col, bgPrimary, 1.0 - exp(-u_groundFade * tPrimary * 0.05)); // horizon haze
    vec3 fogCol = (u_envMode > 0 && u_envFog) ? bgPrimary : toLin(u_bgColor);
    col = mix(col, fogCol, 1.0 - exp(-u_fog * tPrimary * 0.1));
  }
  col *= u_brightness * vignetteAt(screenUv);
  float m = max(col.r, max(col.g, col.b));
  if (m > u_ptClamp) col *= u_ptClamp / m; // firefly clamp
  gl_FragColor = vec4(accumulate(col), 1.0);
}
#endif

#if RENDER_MODE == 2
// ═══ Volumetric glow ═══════════════════════════════════════════════════════
// Treats the distance estimate as a density field, density = D·exp(−DE/thickness),
// and integrates emission–absorption along the ray. Empty space is skipped by
// stepping proportionally to the DE, so solid shapes become glowing shells and
// "dust" settings (DE plateaus above the hit threshold) become luminous fog.

void main() {
  vec3 ro, rd; vec2 pix, screenUv;
  primaryRay(ro, rd, pix, screenUv);
  vec3 bg = u_envMode > 0 ? envBackground(rd, screenUv) : u_bgColor;

  // Ground: find it first (its own cheap march), then integrate the glow only
  // up to it and show the lit ground behind the glow.
  float tG = 1e9;
  if (u_groundType > 0) {
    float tg = 0.0;
    for (int i = 0; i < 160; i++) {
      float dg = groundDist(ro + rd * tg);
      if (dg < 0.001 * (1.0 + tg * 0.1)) { tG = tg; break; }
      tg += dg;
      if (tg > u_maxDist) break;
    }
    if (tG < 1e8) {
      vec3 gp = ro + rd * tG;
      vec3 gn = groundNormal(gp, tG);
      float gd = max(dot(gn, normalize(u_lightPos - gp)), 0.0);
      bg = mix(groundAlbedo(gp, tG) * (gd + u_ambient), bg, 1.0 - exp(-u_groundFade * tG * 0.05));
    }
  }
  float T = 1.0, t = u_volStepMin * fract(hash22(pix + u_sampleIndex * 0.6180339).x + u_sampleIndex * 0.7548777);
  vec3 L = vec3(0.0);
  for (int i = 0; i < 1024; i++) {
    if (i >= u_volSteps || t > min(u_maxDist, tG) || T < 0.005) break;
    vec3 p = ro + rd * t;
    float trap;
    float d = map(p, trap);
    float dens = u_volDensity * exp(-max(d, 0.0) / u_volThick);
    float dt = clamp(d * 0.5, u_volStepMin, 1.0);
    if (dens > 1e-4) {
      vec3 c = palette(trap * 0.4 + u_colorShift * 10.0);
      float lit = 1.0;
      if (u_volLight > 0.0) {
        // Cheap self-shadowing: does the density fall off toward the light?
        vec3 l = normalize(u_lightPos - p);
        float tr2;
        float d2 = map(p + l * u_volThick * 4.0, tr2);
        lit = mix(1.0, clamp(0.25 + (d2 - d) / (u_volThick * 4.0), 0.05, 1.5), u_volLight);
      }
      float a = 1.0 - exp(-dens * dt);
      L += T * a * c * u_volGlow * lit * mix(vec3(1.0), u_lightColor, u_volLight);
      T *= 1.0 - a;
    }
    t += dt;
  }
  vec3 col = L + T * bg;
  col *= u_brightness * vignetteAt(screenUv);
  gl_FragColor = vec4(accumulate(col), 1.0);
}
#endif
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

// Specialised fragment shader for fold A and optional hybrid fold B (-1 = none).
// opts: { mode, texLod, variant, stack }
// Note: '#ifdef' must be at column 0-ish; GLSL ES allows leading whitespace before '#'.
export function fractalFrag(foldA, foldB = -1, opts = {}) {
  const a = FOLD_GLSL[foldA] ?? FOLD_GLSL[0];
  const hasB = foldB >= 0 && foldB < FOLD_GLSL.length && foldB !== foldA;
  let src = FRAG_HEAD + `
vec3 foldA(vec3 z) {
    ${a}
    return z;
}
`;
  if (hasB) src = '#define HAS_FOLD_B\n' + src + `
vec3 foldB(vec3 z) {
    ${FOLD_GLSL[foldB]}
    return z;
}
`;
  const stack = (opts.stack || DEFAULT_STACK).map(t => STACK_GLSL[t] || '').filter(Boolean);
  src += `
vec3 foldStack(vec3 z) {
    ${stack.join('\n    ')}
    return z;
}
`;
  // Preprocessor header: #extension first (strict drivers require it before
  // anything else), then the specialisation defines.
  const head = (opts.texLod ? '#extension GL_EXT_shader_texture_lod : enable\n#define HAS_TEX_LOD\n' : '')
    + `#define RENDER_MODE ${opts.mode | 0}\n#define SURF_VARIANT ${opts.variant | 0}\n`;
  src = head + src;
  return src + FRAG_TAIL;
}

// Back-compat / default program (box fold, no hybrid).
export const FRACTAL_FRAG = fractalFrag(0, -1);

// Head-of-shader slice used by the parity harness (everything up to the normal).
export function fractalMapSource(foldA, foldB = -1, opts = {}) {
  const s = fractalFrag(foldA, foldB, opts);
  return s.slice(0, s.indexOf('// Tetrahedral normal'));
}
