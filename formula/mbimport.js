// Kyma's half of the Mandelbulber .fract importer: Amazing IFS (239) and
// Amazing Surf Mod 1 (77), single formula. Organon (core/engine/mbimport.js)
// parses the file and does the scene: iterations, camera, fractal transform,
// light, background, materials and ground.

import { num, vec, bool, nums, fractalAnglesFor, mbRotation2 } from '../core/engine/mbimport.js';
import { VARIANT_DEFAULTS } from './presets.js';

// Mandelbulber formula ids (formula/definition/all_fractal_list_enums.hpp).
export const MB_FORMULAS = { 239: 'Amazing IFS', 77: 'Amazing Surf Mod 1' };

// ── formula mapping ──────────────────────────────────────────────────────────
function mapAmazingIfs(f, notes) {
  const o = { ...VARIANT_DEFAULTS[10], surfVariant: 10 };
  o.scale = num(f, 'transf_scale_2', 2);
  o.minR = Math.sqrt(Math.max(0, num(f, 'transf_minR2_p25', 0.25)));
  const fold = vec(f, 'transf_addition_constant_0555', [0.5, 0.5, 0.5]);
  [o.foldX, o.foldY, o.foldZ] = fold;
  o.vZFold = bool(f, 'transf_function_enabledCz_false', false);
  if (!bool(f, 'transf_function_enabledCx', true) || !bool(f, 'transf_function_enabledCy', true))
    notes.push('Box fold X/Y switched off in the file: Kyma always folds X and Y.');
  const preOn = bool(f, 'transf_function_enabledA_false', false);
  o.vPreAbsX = preOn && bool(f, 'transf_function_enabledAx_false', false);
  o.vPreAbsY = preOn && bool(f, 'transf_function_enabledAy_false', false);
  o.vPreAbsZ = preOn && bool(f, 'transf_function_enabledAz_false', false);
  [o.vOffX, o.vOffY, o.vOffZ] = vec(f, 'transf_offsetA_000', [0, 0, 0]);
  o.vPolyOn = bool(f, 'transf_function_enabledP_false', false);
  o.polarN = num(f, 'transf_int_6', 6);
  o.vPolyStop = num(f, 'transf_stop_iterations_P1', 1);
  if (num(f, 'transf_start_iterations_P', 0) !== 0) notes.push('Polyfold start iteration > 0 is not supported (starts at 0).');
  const ifsOn = bool(f, 'transf_function_enabledI_false', false);
  const ax = ['x', 'y', 'z'];
  const modes = ax.map(a => (ifsOn && bool(f, `transf_function_enabledB${a}_false`, false)
    ? (bool(f, `transf_function_enabled${a}_false`, false) ? 2 : 1) : 0));
  [o.vIfsX, o.vIfsY, o.vIfsZ] = modes;
  [o.vIfsOffX, o.vIfsOffY, o.vIfsOffZ] = vec(f, 'transf_addition_constantP_000', [0, 0, 0]);
  [o.vIfsAddX, o.vIfsAddY, o.vIfsAddZ] = vec(f, 'transf_addition_constantA_000', [0, 0, 0]);
  o.vDEOffset = num(f, 'analyticDE_offset_0', 0);
  o.scaleVary = bool(f, 'transf_function_enabledK_false', false) ? num(f, 'transf_scale_vary_0', 0) : 0;
  if (num(f, 'transf_scaleC_1', 1) !== 1) notes.push('Scale-vary base other than 1 is not supported.');
  if (num(f, 'transf_start_iterations_B', 0) !== 0 || num(f, 'transf_stop_iterations_B', 250) < 250)
    notes.push('Scale iteration range is not supported (scale applies every iteration).');
  // Built-in sphere inversion.
  o.vSInvOn = bool(f, 'transf_sphere_inversion_enabled_false', false);
  [o.vSInvOffX, o.vSInvOffY, o.vSInvOffZ] = vec(f, 'transf_offset_000', [0, 0, 0]);
  [o.vSInvAddX, o.vSInvAddY, o.vSInvAddZ] = vec(f, 'transf_addition_constant', [0, 0, 0]);
  o.vSInvG = num(f, 'transf_scaleG_1', 1);
  o.vSInvA = num(f, 'transf_scaleA_1', 1);
  o.vSInvStart = num(f, 'transf_start_iterations_X', 0);
  o.vSInvStop = num(f, 'transf_stop_iterations_1', 1);
  // aux.dist only feeds the distance in hybrid / custom-DE mode; a single
  // Amazing IFS uses the linear DE r / DE.
  o.vMinDE = false;
  if (bool(f, 'transf_function_enabledG_false', false))
    notes.push('Min-distance DE is set in the file but Mandelbulber ignores it for a single formula; left off.');
  Object.assign(o, fractalAnglesFor(mbRotation2(vec(f, 'transf_rotation2', [0, 0, 0]))));
  o.vAddC = false; // cpixelDisabledByDefault
  return o;
}

function mapAmazingSurfMod1(f, notes) {
  const o = { ...VARIANT_DEFAULTS[2], surfVariant: 2 };
  o.scale = num(f, 'mandelbox_scale', 2);
  o.scaleVary = num(f, 'mandelbox_vary_scale_vary', 0);
  o.influence = num(f, 'transf_scale_1', 1);
  const k = vec(f, 'transf_addition_constant_111', [1, 1, 1]);
  o.foldX = k[0]; o.foldY = k[1];
  o.vFoldValue = num(f, 'mandelbox_folding_value', 2);
  o.vFold2 = num(f, 'transf_offset_2', 2);
  // Mandelbulber's fold order: box, inverse, abs-offset, conditional reflect, double.
  const stack = [];
  if (bool(f, 'transf_function_enabledAx', true)) stack.push(1);
  if (bool(f, 'transf_function_enabledAy_false', false)) stack.push(2);
  if (bool(f, 'transf_function_enabledAz_false', false)) stack.push(3);
  if (bool(f, 'transf_function_enabledx_false', false)) stack.push(4);
  if (bool(f, 'transf_function_enabledy_false', false)) stack.push(5);
  for (let i = 0; i < 5; i++) o[`vStack${i + 1}`] = stack[i] ?? 0;
  [o.vOffX, o.vOffY, o.vOffZ] = vec(f, 'transf_addition_constant', [0, 0, 0]);
  o.cylinder = bool(f, 'transf_function_enabled_false', false);
  // sqtR = sqrt(minR05) is the r² threshold; Kyma thresholds at minR².
  o.minR = Math.pow(Math.max(1e-12, num(f, 'transf_minimum_radius_05', 0.5)), 0.25);
  Object.assign(o, fractalAnglesFor(mbRotation2(vec(f, 'transf_rotation', [0, 0, 0]))));
  return o;
}


// formula.importFract: the formula's parameters → { ok, formula, params } or { ok: false, error }.
export function importFract({ S, m, notes }) {
  const ids = Object.keys(m).filter(k => /^formula_\d+$/.test(k)).map(k => +nums(m[k])[0]).filter(n => n > 0);
  if (bool(m, 'hybrid_fractal_enable', false) && ids.length > 1)
    return { ok: false, error: `Hybrid of ${ids.length} formulas (${ids.join(', ')}); Kyma imports single Amazing IFS / Amazing Surf Mod 1 files only` };
  const fid = ids[0] ?? 0;
  if (!MB_FORMULAS[fid]) return { ok: false, error: `Formula ${fid} is not one Kyma can import (supported: ${Object.entries(MB_FORMULAS).map(([k, v]) => `${v} (${k})`).join(', ')})` };
  const f = S.fractal_1 || {};
  const o = fid === 239 ? mapAmazingIfs(f, notes) : mapAmazingSurfMod1(f, notes);
  // c addition (hybrid_fractal_sequences.cpp): addc = !dont_add_c_constant,
  // inverted for formulas that are cpixelDisabledByDefault (Amazing IFS).
  const dont = bool(m, 'dont_add_c_constant_1', false);
  if (fid === 239) o.vAddC = dont; else o.noC = dont;
  const cf = vec(m, 'fractal_constant_factor', [1, 1, 1]);
  if (cf.some(x => x !== 1)) notes.push('c multiplier (fractal_constant_factor) other than 1 is not supported.');

  // Iteration / DE controls.
  const bail = num(m, 'bailout', 100);
  if (bail !== 100) notes.push(`Bailout ${bail} ignored (Kyma uses Mandelbulber's default 100).`);
  o.juliaMode = bool(m, 'julia_mode', false);
  [o.juliaCX, o.juliaCY, o.juliaCZ] = vec(m, 'julia_c', [0, 0, 0]);
  o.stepFactor = Math.min(2, Math.max(0.05, 2 * num(m, 'DE_factor', 1)));
  o.invEnabled = false;
  o.rotStart = 0;
  o.preAlpha = 0; o.preBeta = 0; o.preGamma = 0;
  return { ok: true, formula: MB_FORMULAS[fid], params: o };
}
