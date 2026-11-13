// Line-by-line ports of Mandelbulber 2 formulas and its distance evaluation, used
// only by the tests to check the .fract importer end to end. Written against
// Mandelbulber's own names (mandelbulber2/formula/definition/*.cpp,
// src/compute_fractal.cpp, src/algebra.cpp) and NOT against Kyma's code.

const DEG = Math.PI / 180;
const fabs = Math.abs, sign = Math.sign;
const mmul = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; };
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
// CRotationMatrix::RotateX/Y/Z (matrix = matrix * rot) and SetRotation2: Z, Y, X.
const RX = a => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const RY = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const RZ = a => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
export const SetRotation2 = deg => mmul(mmul(RZ(deg[2] * DEG), RY(deg[1] * DEG)), RX(deg[0] * DEG));

const P = (s, k, d) => (s[k] !== undefined ? s[k].trim().split(/\s+/).map(x => Number(x.replace(',', '.'))) : d);
const B = (s, k, d) => (s[k] !== undefined ? s[k].trim() === 'true' : d);

// fractal_amazing_ifs.cpp FormulaCode
function amazingIfs(z, f, aux) {
  const tc = f;
  if (B(tc, 'transf_sphere_inversion_enabled_false', false)
      && aux.i >= P(tc, 'transf_start_iterations_X', [0])[0] && aux.i < P(tc, 'transf_stop_iterations_1', [1])[0]) {
    const off = P(tc, 'transf_offset_000', [0, 0, 0]);
    z = z.map((x, k) => x + off[k]);
    const rr = z[0] * z[0] + z[1] * z[1] + z[2] * z[2];
    const g = P(tc, 'transf_scaleG_1', [1])[0];
    z = z.map(x => x * g / rr); aux.DE *= g / rr;
    const ac = P(tc, 'transf_addition_constant', [0, 0, 0]);
    z = z.map((x, k) => x + ac[k] - off[k]);
    const a = P(tc, 'transf_scaleA_1', [1])[0];
    z = z.map(x => x * a); aux.DE *= a;
  }
  if (B(tc, 'transf_function_enabledA_false', false)) {
    if (B(tc, 'transf_function_enabledAx_false', false)) z[0] = fabs(z[0]);
    if (B(tc, 'transf_function_enabledAy_false', false)) z[1] = fabs(z[1]);
    if (B(tc, 'transf_function_enabledAz_false', false)) z[2] = fabs(z[2]);
  }
  const oA = P(tc, 'transf_offsetA_000', [0, 0, 0]);
  z = z.map((x, k) => x + oA[k]);
  if (B(tc, 'transf_function_enabledP_false', false)
      && aux.i >= P(tc, 'transf_start_iterations_P', [0])[0] && aux.i < P(tc, 'transf_stop_iterations_P1', [1])[0]) {
    z[1] = fabs(z[1]);
    let psi = Math.PI / P(tc, 'transf_int_6', [6])[0];
    const fm = (a, b) => a - b * Math.trunc(a / b); // C fmod
    psi = fabs(fm(Math.atan2(z[1], z[0]) + psi, 2 * psi) - psi);
    const len = Math.sqrt(z[0] * z[0] + z[1] * z[1]);
    z[0] = Math.cos(psi) * len; z[1] = Math.sin(psi) * len;
  }
  const a5 = P(tc, 'transf_addition_constant_0555', [0.5, 0.5, 0.5]);
  if (B(tc, 'transf_function_enabledCx', true)) z[0] = fabs(z[0] + a5[0]) - fabs(z[0] - a5[0]) - z[0];
  if (B(tc, 'transf_function_enabledCy', true)) z[1] = fabs(z[1] + a5[1]) - fabs(z[1] - a5[1]) - z[1];
  if (B(tc, 'transf_function_enabledCz_false', false)) z[2] = fabs(z[2] + a5[2]) - fabs(z[2] - a5[2]) - z[2];
  if (B(tc, 'transf_function_enabledI_false', false)) {
    const pc = P(tc, 'transf_addition_constantP_000', [0, 0, 0]);
    ['x', 'y', 'z'].forEach((a, k) => {
      if (!B(tc, `transf_function_enabledB${a}_false`, false)) return;
      if (!B(tc, `transf_function_enabled${a}_false`, false)) z[k] = fabs(z[k]); else z[k] = sign(z[k]) * fabs(z[k]);
      z[k] -= pc[k];
    });
  }
  const aA = P(tc, 'transf_addition_constantA_000', [0, 0, 0]);
  z = z.map((x, k) => x + aA[k]);
  const rr = z[0] * z[0] + z[1] * z[1] + z[2] * z[2];
  const MinRR = P(tc, 'transf_minR2_p25', [0.25])[0];
  const dividend = rr < MinRR ? MinRR : Math.min(rr, 1.0);
  if (aux.i >= P(tc, 'transf_start_iterations_B', [0])[0] && aux.i < P(tc, 'transf_stop_iterations_B', [250])[0]) {
    const useScale = (aux.actualScaleA + P(tc, 'transf_scale_2', [2])[0]) / dividend;
    z = z.map(x => x * useScale);
    aux.DE = aux.DE * fabs(useScale) + P(tc, 'analyticDE_offset_0', [0])[0];
    if (B(tc, 'transf_function_enabledK_false', false)) {
      const vary = P(tc, 'transf_scale_vary_0', [0])[0] * (fabs(aux.actualScaleA) - P(tc, 'transf_scaleC_1', [1])[0]);
      aux.actualScaleA -= vary;
    }
  }
  return mv(SetRotation2(P(tc, 'transf_rotation2', [0, 0, 0])), z);
}

// fractal_amazing_surf_mod1.cpp FormulaCode (colour bookkeeping omitted)
function amazingSurfMod1(z, f, aux) {
  const scale = P(f, 'mandelbox_scale', [2])[0], vary = P(f, 'mandelbox_vary_scale_vary', [0])[0];
  aux.actualScale = scale + vary * (fabs(aux.actualScale) - 1.0);
  const c1 = P(f, 'transf_addition_constant_111', [1, 1, 1]);
  if (B(f, 'transf_function_enabledAx', true)) {
    z[0] = fabs(z[0] + c1[0]) - fabs(z[0] - c1[0]) - z[0];
    z[1] = fabs(z[1] + c1[1]) - fabs(z[1] - c1[1]) - z[1];
  }
  if (B(f, 'transf_function_enabledAy_false', false)) {
    z[0] = c1[0] - fabs(fabs(z[0]) - c1[0]); z[1] = c1[1] - fabs(fabs(z[1]) - c1[1]);
  }
  if (B(f, 'transf_function_enabledAz_false', false)) { z[0] = fabs(z[0] + c1[0]); z[1] = fabs(z[1] + c1[1]); }
  if (B(f, 'transf_function_enabledx_false', false)) {
    const fv = P(f, 'mandelbox_folding_value', [2])[0];
    if (fabs(z[0]) > c1[0]) z[0] = sign(z[0]) * fv - z[0];
    if (fabs(z[1]) > c1[1]) z[1] = sign(z[1]) * fv - z[1];
  }
  if (B(f, 'transf_function_enabledy_false', false)) {
    const o2 = P(f, 'transf_offset_2', [2])[0];
    z[0] = o2 - fabs(fabs(z[0] + c1[0]) - o2) - c1[0];
    z[1] = o2 - fabs(fabs(z[1] + c1[1]) - o2) - c1[1];
  }
  const ac = P(f, 'transf_addition_constant', [0, 0, 0]);
  z = z.map((x, k) => x + ac[k]);
  let r2 = z[0] * z[0] + z[1] * z[1] + z[2] * z[2];
  if (B(f, 'transf_function_enabled_false', false)) r2 -= z[2] * z[2];
  const sqtR = Math.sqrt(P(f, 'transf_minimum_radius_05', [0.5])[0]);
  if (r2 < sqtR) { z = z.map(x => x / sqtR); aux.DE *= 1 / sqtR; }
  else if (r2 < 1.0) { z = z.map(x => x / r2); aux.DE *= 1 / r2; }
  const s1 = P(f, 'transf_scale_1', [1])[0];
  z = z.map(x => x * (aux.actualScale * s1 + (1 - s1)));
  aux.DE = aux.DE * fabs(aux.actualScale) + 1.0;
  return mv(SetRotation2(P(f, 'transf_rotation', [0, 0, 0])), z);
}

// compute_fractal.cpp (single formula, linear analytic DE, bailout 100) with the
// fractal position / rotation step of CalculateDistance. Point in Mandelbulber
// world coordinates; returns r / DE.
export function mbDistance(main, frac, pointMB) {
  const fid = Number(main.formula_1);
  const fpos = P(main, 'fractal_position', [0, 0, 0]);
  const Rf = SetRotation2(P(main, 'fractal_rotation', [0, 0, 0]));
  let z = mv(Rf, pointMB.map((x, k) => x - fpos[k]));
  const c = z.slice();
  const N = P(main, 'N', [250])[0];
  // hybrid_fractal_sequences.cpp: addc = !dont_add_c_constant, inverted when the
  // formula is cpixelDisabledByDefault (Amazing IFS).
  const dont = B(main, 'dont_add_c_constant_1', false);
  const cpixel = fid === 239 ? dont : !dont;
  const julia = B(main, 'julia_mode', false), jc = P(main, 'julia_c', [0, 0, 0]);
  const aux = { DE: 1, actualScaleA: 0, actualScale: P(frac, 'mandelbox_scale', [2])[0], i: 0 };
  let r = Math.hypot(...z);
  for (aux.i = 0; aux.i < N; aux.i++) {
    z = fid === 239 ? amazingIfs(z, frac, aux) : amazingSurfMod1(z, frac, aux);
    if (cpixel) z = z.map((x, k) => x + (julia ? jc[k] : c[k]));
    r = Math.hypot(...z);
    if (r > 100) break;
  }
  return r / aux.DE;
}
