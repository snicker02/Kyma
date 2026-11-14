// Mandelbulber settings (.fract) importer.
//
// Exact where Kyma has the same maths: the formula (Amazing IFS, Amazing Surf
// Mod 1), its parameters, iteration count, fractal position / rotation and the
// camera (position, target, roll, field of view). Approximate where Kyma has no
// equivalent: materials (image textures → the material's colour gradient),
// HDR backgrounds (→ a sky colour), primitives (water / plane → the ground
// plane; spheres are dropped), lights (main light direction only), DOF and fog.
// Every approximation is listed in the returned notes.
//
// Coordinate systems: Mandelbulber is Z-up, Kyma is Y-up. C maps Mandelbulber
// (x, y, z) to Kyma (x, z, −y), a proper rotation, so handedness and image
// orientation are preserved.

import { mat3Mul, mat3MulVec, transpose3, normalize, cross, dot, sub, add, mul, length } from './vec.js';
import { PARAMS } from './params.js';
import { VARIANT_DEFAULTS } from './presets.js';
import { cameraBasis } from './camera.js';
import { IMPORTED_GRADIENT } from './gradients.js';

// Default Kyma-from-Mandelbulber rotation (Z-up -> Y-up). When the file has a
// water / plane primitive, the rotation instead takes that plane's normal (on
// the camera's side) to +Y, so the ground is level and the camera is above it,
// even in upside-down scenes.
const C_DEFAULT = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const DEG = Math.PI / 180;
// Proper rotation taking unit vector a to unit vector b (Rodrigues).
function rotFromTo(a, b) {
  const v = cross(a, b), c = dot(a, b);
  if (c < -0.999999) { // opposite: 180 degrees about an axis perpendicular to a
    const ax = normalize(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    const r = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(2 * ax[i] * ax[j] - (i === j ? 1 : 0));
    return r;
  }
  const k = 1 / (1 + c);
  const vx = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const vx2 = mat3Mul(vx, vx);
  return vx.map((x, i) => (i % 4 === 0 ? 1 : 0) + x + vx2[i] * k);
}

// Mandelbulber formula ids (formula/definition/all_fractal_list_enums.hpp).
export const MB_FORMULAS = { 239: 'Amazing IFS', 77: 'Amazing Surf Mod 1' };

// ── parsing ──────────────────────────────────────────────────────────────────
// "key value value;" lines grouped by [section]; decimal commas become points.
export function parseFract(text) {
  const sections = { main_parameters: {} };
  let cur = sections.main_parameters;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { cur = sections[sec[1]] = sections[sec[1]] || {}; continue; }
    const m = line.match(/^(\S+)\s+(.*?);?$/);
    if (m) cur[m[1]] = m[2].replace(/;$/, '');
  }
  return sections;
}
const nums = s => String(s).trim().split(/\s+/).map(x => Number(x.replace(',', '.')));
const num = (o, k, d) => (o[k] !== undefined ? nums(o[k])[0] : d);
const vec = (o, k, d) => (o[k] !== undefined ? nums(o[k]).slice(0, 3) : d);
const bool = (o, k, d) => (o[k] !== undefined ? o[k].trim() === 'true' : d);
// Mandelbulber colours are 16-bit hex per channel: "e700 ea00 ed00".
function col16(o, k) {
  if (o[k] === undefined) return null;
  const p = o[k].trim().split(/\s+/).map(h => parseInt(h, 16) / 65535);
  if (p.length < 3 || p.some(x => !Number.isFinite(x))) return null;
  return p;
}
const hex = rgb => '#' + rgb.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');

// ── rotations ────────────────────────────────────────────────────────────────
const Rx = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
// CRotationMatrix::SetRotation2(r): Null(); RotateZ(r.z); RotateY(r.y); RotateX(r.x)
// with matrix = matrix · rot each time → Rz·Ry·Rx (angles in degrees here).
export const mbRotation2 = d => mat3Mul(mat3Mul(Rz(d[2] * DEG), Ry(d[1] * DEG)), Rx(d[0] * DEG));

// Kyma's fractalRotation(α, β, γ) = Rx(−α)·Ry(−β)·Rz(−γ). Solve for the angles
// that give matrix M (XYZ decomposition).
export function fractalAnglesFor(M) {
  const q = Math.asin(Math.max(-1, Math.min(1, M[2])));
  const p = Math.atan2(-M[5], M[8]);
  const r = Math.atan2(-M[1], M[0]);
  return { alpha: -p, beta: -q, gamma: -r };
}
// Kyma eulerDeg(x, y, z) = Ry(y)·Rx(x)·Rz(z). Solve for the angles (degrees).
export function eulerDegFor(M) {
  const x = Math.asin(Math.max(-1, Math.min(1, -M[5])));
  let y, z;
  if (Math.abs(Math.cos(x)) > 1e-7) {
    y = Math.atan2(M[2], M[8]);
    z = Math.atan2(M[3], M[4]);
  } else {
    // Gimbal lock (pitch ±90°, which every Z-up import is close to): only
    // yaw ± roll is defined, so put it all in yaw.
    z = 0;
    y = Math.atan2(-M[6], M[0]);
  }
  return { x: x / DEG, y: y / DEG, z: z / DEG };
}

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

// ── scene ────────────────────────────────────────────────────────────────────
export function importMandelbulber(text) {
  const S = parseFract(text);
  const m = S.main_parameters, notes = [];
  if (!/Mandelbulber settings/.test(String(text).slice(0, 200)) && !m.formula_1)
    return { ok: false, error: 'Not a Mandelbulber settings file' };
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
  o.iterations = Math.min(250, Math.max(1, Math.round(num(m, 'N', 250))));
  const bail = num(m, 'bailout', 100);
  if (bail !== 100) notes.push(`Bailout ${bail} ignored (Kyma uses Mandelbulber's default 100).`);
  o.juliaMode = bool(m, 'julia_mode', false);
  [o.juliaCX, o.juliaCY, o.juliaCZ] = vec(m, 'julia_c', [0, 0, 0]);
  o.stepFactor = Math.min(2, Math.max(0.05, 2 * num(m, 'DE_factor', 1)));
  o.detail = Math.min(4, Math.max(0.1, num(m, 'detail_level', 1)));
  o.maxSteps = 1024;
  o.maxStep = 3; // Mandelbulber caps each march step at 3 (non-advanced quality)
  o.maxDist = Math.max(30, num(m, 'view_distance_max', 50));
  o.invEnabled = false;
  o.rotStart = 0;
  o.preAlpha = 0; o.preBeta = 0; o.preGamma = 0;

  // Ground primitive first: it decides the world rotation C.
  let prim = null;
  const eyeMB0 = vec(m, 'camera', [0, -3, 0]);
  for (const kind of ['water', 'plane']) {
    for (let n = 1; n <= 4 && !prim; n++) {
      const pre = `primitive_${kind}_${n}_`;
      if (!bool(m, pre + 'enabled', false)) continue;
      const pos = vec(m, pre + 'position', [0, 0, 0]);
      let nrm = normalize(mat3MulVec(mbRotation2(vec(m, pre + 'rotation', [0, 0, 0])), [0, 0, 1]));
      if (dot(sub(eyeMB0, pos), nrm) < 0) nrm = mul(nrm, -1); // the camera's side is "up"
      prim = { kind, n, pre, pos, nrm };
    }
  }
  const C = prim ? rotFromTo(prim.nrm, [0, 1, 0]) : C_DEFAULT;
  const toK = v => mat3MulVec(C, v);

  // Fractal position / rotation → object transform. Mandelbulber evaluates
  // Rf·(p − pos); Kyma evaluates Rᵀ·(p − pos)/s, so R = C·Rfᵀ, pos = C·pos.
  const Rf = mbRotation2(vec(m, 'fractal_rotation', [0, 0, 0]));
  const Ro = mat3Mul(C, transpose3(Rf));
  const e = eulerDegFor(Ro);
  o.objRotX = e.x; o.objRotY = e.y; o.objRotZ = e.z;
  [o.objX, o.objY, o.objZ] = toK(vec(m, 'fractal_position', [0, 0, 0]));
  o.objScale = 1;
  if (m.repeat !== undefined && nums(m.repeat).some(x => x)) notes.push('Repeat (tiling) is not supported.');

  // Camera: exact eye, target, roll and vertical field of view.
  const eyeMB = vec(m, 'camera', [0, -3, 0]);
  const tgtMB = vec(m, 'target', [0, 0, 0]);
  const topMB = vec(m, 'camera_top', [0, 0, 1]);
  const eye = toK(eyeMB), tgt = toK(tgtMB);
  const orbit = sub(eye, tgt), d = length(orbit);
  o.targetX = tgt[0]; o.targetY = tgt[1]; o.targetZ = tgt[2];
  o.dist = d;
  o.rotY = Math.asin(Math.max(-1, Math.min(1, -orbit[1] / d)));
  o.rotX = Math.atan2(orbit[0], orbit[2]);
  o.rollX = 0; o.rollY = 0; o.rollZ = 0;
  const b0 = cameraBasis({ ...o });
  let U = toK(topMB);
  U = normalize(sub(U, mul(b0.forward, dot(U, b0.forward))));
  o.rollZ = Math.atan2(-dot(U, b0.right), dot(U, b0.up));
  if (num(m, 'perspective_type', 0) !== 0) notes.push('Non-perspective projection (fisheye / equirectangular) → perspective.');
  o.lens = 0.5 / Math.tan(num(m, 'fov', 53.13) * DEG / 2);

  // Main light (light 1: directional, camera-relative by default).
  const lr = vec(m, 'light1_rotation', [-45, 45, 0]).map(x => x / 180.8 * Math.PI); // sic: Mandelbulber divides by 180.8
  const rot = [lr[0], -lr[1], lr[2]];
  const fwd = normalize(sub(tgtMB, eyeMB));
  const top = normalize(sub(topMB, mul(fwd, dot(topMB, fwd))));
  const right = normalize(cross(fwd, top));
  const rotAbout = (v, ax, a) => add(add(mul(v, Math.cos(a)), mul(cross(ax, v), Math.sin(a))), mul(ax, dot(ax, v) * (1 - Math.cos(a))));
  let L = mul(fwd, -1);
  L = rotAbout(L, fwd, rot[2]); L = rotAbout(L, right, rot[1]); L = rotAbout(L, top, rot[0]);
  const Lk = normalize(toK(L));
  o.lightRelative = false;
  [o.lightX, o.lightY, o.lightZ] = add(tgt, mul(Lk, Math.max(10, 4 * d)));
  const lc = col16(m, 'light1_color');
  if (lc) o.lightColor = hex(lc);

  // Background / fog / DOF.
  const bg = col16(m, 'background_color_1') || col16(m, 'fog_color_2');
  if (bool(m, 'textured_background', false)) {
    o.bgColor = '#8fb2d6';
    notes.push('HDR / image background not available: replaced with a sky colour (load a panorama in Environment to get it back).');
  } else if (bg) o.bgColor = hex(bg);
  o.fog = bool(m, 'volumetric_fog_enabled', false) || bool(m, 'basic_fog_enabled', false) ? 0.15 : 0.04;
  const dofOn = bool(m, 'DOF_enabled', false) || bool(m, 'DOF_monte_carlo', false);
  o.dofStrength = dofOn ? Math.min(1, 0.15 + num(m, 'DOF_radius', 10) / 40) : 0;
  o.focalDist = num(m, 'DOF_focus', d);
  o.aoStrength = bool(m, 'ambient_occlusion_enabled', false) ? 0.6 : 0.3;
  o.shadows = true;
  o.brightness = Math.min(2, Math.max(0.5, num(m, 'brightness', 1) * 1.2));

  // Colour: Mandelbulber's material gradient as an imported gradient.
  const gr = m.mat1_surface_color_gradient;
  if (gr) {
    const t = gr.trim().split(/\s+/);
    const stops = [];
    for (let i = 0; i + 1 < t.length; i += 2) stops.push(`${(Number(t[i]) / 10000).toFixed(4)}:#${t[i + 1].toLowerCase()}`);
    o.gradStops = stops.join(' ');
    o.palette = IMPORTED_GRADIENT;
    o.colorShift = num(m, 'mat1_coloring_palette_offset', 0);
    o.gradRepeat = Math.max(0.1, num(m, 'mat1_coloring_speed', 1));
    o.colorSource = 0;
  }
  if (bool(m, 'mat1_use_color_texture', false) || m.mat1_file_color_texture)
    notes.push('Surface colour came from an image texture in Mandelbulber; using the material gradient instead.');

  // Ground: the primitive chosen above, level by construction.
  o.groundType = 0;
  if (prim) {
    const { kind, n, pre, pos } = prim;
    o.groundType = kind === 'water' ? 5 : 1;
    o.groundTiltX = 0; o.groundTiltZ = 0; o.groundYaw = 0; o.groundOffX = 0; o.groundOffZ = 0;
    o.groundY = toK(pos)[1];
    if (kind === 'water') {
      Object.assign(o, { groundColor: '#0b2a3a', groundScale: Math.max(0.2, num(m, pre + 'length', 1)), groundBump: 0.25 * num(m, pre + 'relative_amplitude', 1), groundReflect: 0.85, groundRough: 0.05 });
      if (bool(m, pre + 'empty', false)) notes.push("Water is a thin two-sided sheet in Mandelbulber ('empty'); Kyma's ground is solid below it.");
    }
    o.groundFade = 0.3;
    const others = Object.keys(m).filter(k => /^primitive_(water|plane)_\d+_enabled$/.test(k) && bool(m, k, false)).length - 1;
    notes.push(`${kind} primitive ${n} → ground plane${others > 0 ? ` (${others} more water/plane primitive(s) dropped: Kyma has one plane)` : ''}.`);
  }
  const dropped = Object.keys(m).filter(k => /^primitive_(sphere|box|cylinder|cone|torus|circle|rectangle)_\d+_enabled$/.test(k) && bool(m, k, false));
  if (dropped.length) notes.push(`Dropped ${dropped.length} primitive(s) Kyma can't draw (spheres, boxes …).`);

  // Keep only real params, coerced.
  const known = new Set(PARAMS.map(p => p.id));
  const params = Object.fromEntries(Object.entries(o).filter(([k]) => known.has(k)));
  return { ok: true, formula: MB_FORMULAS[fid], params, notes, world: C };
}
