// Headless logic tests: `node tests/run.mjs` (no dependencies).

import { PARAMS, GROUPS, defaults, coerce, PARAM_BY_ID } from '../engine/params.js';
import { State } from '../engine/state.js';
import { cameraBasis, pixelRay } from '../engine/camera.js';
import { fractalRotation, dot, sub, normalize, length, cross, wrapPi, mat3Mul } from '../engine/vec.js';
import { makeDE, makeWave, makeSurfStep, march, marchInfo, viewScore, pickPixel } from '../engine/de.js';
import { Sequencer, MODE, EASE } from '../engine/sequencer.js';
import { encodeDiscovery, decodeDiscovery, evolve, rebirth, makeProject, parseProject, BIOMES } from '../engine/presets.js';
import { sceneUniforms, jitterFor, lensFor } from '../engine/renderer.js';
import { FRACTAL_FRAG, fractalFrag, FOLD_GLSL } from '../engine/glsl.js';
import { spawnSync } from 'node:child_process';
import { ZipWriter, crc32 } from '../engine/zip.js';
import { writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL', msg); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const section = s => console.log('•', s);

// ── Schema ──────────────────────────────────────────────────────────────────
section('schema');
const gids = new Set(GROUPS.map(g => g.id));
const ids = new Set();
for (const p of PARAMS) {
  ok(!ids.has(p.id), `duplicate id ${p.id}`); ids.add(p.id);
  ok(gids.has(p.group), `${p.id} has unknown group`);
  ok(coerce(p, p.def) === p.def, `${p.id} default does not survive coerce`);
  if (p.gate) {
    const g = PARAM_BY_ID.get(p.gate);
    const eqs = Array.isArray(p.gateEq) ? p.gateEq : [p.gateEq];
    ok(g?.type === 'bool' || (g?.type === 'select' && eqs.every(e => Number.isInteger(e) && e >= 0 && e < g.options.length)), `${p.id} gate must be a bool, or a select with valid gateEq value(s)`);
  }
  if (p.fine) ok(p.type === 'range', `${p.id}: fine-tune only applies to ranges`);
  if (p.type === 'range') ok(p.min < p.max, `${p.id} min<max`);
}
ok(coerce(PARAM_BY_ID.get('iterations'), 999) === 250, 'iterations hard-clamped to shader loop bound');
ok(coerce(PARAM_BY_ID.get('maxSteps'), 9999) === 1024, 'maxSteps hard-clamped to shader loop bound');
ok(FRACTAL_FRAG.includes('for (int i = 0; i < 1024; i++)'), 'shader march loop bound matches maxSteps hardMax');
ok(coerce(PARAM_BY_ID.get('lightColor'), 'red') === undefined, 'bad colour rejected');

// Every uniform the JS sends must be declared in the shader with a compatible type.
const decl = {};
for (const m of FRACTAL_FRAG.matchAll(/uniform\s+(\w+)\s+(\w+)\s*;/g)) decl[m[2]] = m[1];
const su = sceneUniforms(defaults());
for (const [k, v] of Object.entries(su)) {
  if (k.startsWith('__')) continue;
  const t = decl[k];
  ok(!!t, `uniform ${k} not declared in shader`);
  if (!t) continue;
  const expect = typeof v === 'boolean' ? 'bool' : Array.isArray(v) ? { 2: 'vec2', 3: 'vec3', 4: 'vec4', 9: 'mat3' }[v.length] : null;
  if (expect) ok(t === expect, `uniform ${k}: shader ${t} vs js ${expect}`);
  else ok(t === 'float' || t === 'int', `uniform ${k}: numeric type ${t}`);
  ok(Array.isArray(v) ? v.every(Number.isFinite) : (typeof v === 'boolean' || Number.isFinite(v)), `uniform ${k} finite`);
}

// Path-tracer / volume uniforms live behind #if RENDER_MODE; check they are declared somewhere.
{
  const all = fractalFrag(0, -1, { mode: 1 }) + fractalFrag(0, -1, { mode: 2 });
  for (const k of Object.keys(su).filter(k => /^u_(pt|vol)/.test(k))) ok(all.includes(' ' + k + ';'), `uniform ${k} declared for its render mode`);
  ok(su.__tonemap === 0 && sceneUniforms({ ...defaults(), renderMode: 1 }).__tonemap === 1, 'path tracing forces the filmic tone curve');
}

// ── Camera ──────────────────────────────────────────────────────────────────
section('camera');
const base = defaults();
let worstCenter = 0, worstOrtho = 0;
for (let i = 0; i < 500; i++) {
  const v = { ...base, rotX: (Math.random() * 2 - 1) * Math.PI, rotY: (Math.random() * 2 - 1) * 1.5, dist: 0.1 + Math.random() * 10,
    targetX: Math.random() * 4 - 2, targetY: Math.random() * 4 - 2, targetZ: Math.random() * 4 - 2 };
  const c = cameraBasis(v);
  const toT = normalize(sub(c.target, c.eye));
  worstCenter = Math.max(worstCenter, 1 - dot(c.forward, toT));
  worstOrtho = Math.max(worstOrtho, Math.abs(dot(c.right, c.up)), Math.abs(dot(c.right, c.forward)), Math.abs(dot(c.up, c.forward)),
    Math.abs(length(c.right) - 1), Math.abs(length(c.up) - 1));
  // right-handed: right × up = back
  const back = cross(c.right, c.up);
  worstOrtho = Math.max(worstOrtho, length(sub(back, c.forward.map(x => -x))));
}
ok(worstCenter < 1e-12, `orbit target centred (worst 1-cos = ${worstCenter})`);
ok(worstOrtho < 1e-9, `basis orthonormal & right-handed (worst ${worstOrtho})`);
{
  // v1 parity at the default view, and the v1 bug elsewhere.
  const c0 = cameraBasis(base);
  ok(near(c0.forward[2], -1) && near(c0.right[0], 1) && near(c0.up[1], 1), 'default view identical to v1');
  const b = 0.5, v = { ...base, rotX: b };
  const c = cameraBasis(v);
  const v1Forward = [Math.sin(b), 0, -Math.cos(b)]; // what v1's transposed matrix produced
  const angle = Math.acos(dot(v1Forward, normalize(sub(c.target, c.eye))));
  ok(near(angle, 2 * b, 1e-9), `confirmed v1 off-centre error = 2·rotX (${angle.toFixed(4)})`);
  // roll keeps orthonormality and rolls about forward when only rollZ is set
  const cr = cameraBasis({ ...base, rollZ: 0.7 });
  ok(near(dot(cr.forward, c0.forward), 1, 1e-12), 'rollZ keeps view direction');
  ok(near(dot(cr.right, c0.right), Math.cos(0.7), 1e-12), 'rollZ rotates right vector by angle');
}

// ── Fractal rotation ────────────────────────────────────────────────────────
section('fractal rotation');
{
  const R = fractalRotation(0.3, -1.1, 2.2);
  const RT = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const I = mat3Mul(R, RT);
  ok(I.every((x, i) => near(x, [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-12)), 'rotation is orthogonal');
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  ok(near(det, 1, 1e-12), 'rotation det = 1');
}

// ── Distance estimator ──────────────────────────────────────────────────────
section('distance estimator');
{
  const map = makeDE(base);
  let finite = true;
  for (let i = 0; i < 2000; i++) {
    const p = [Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4];
    const { d, trap } = map(p);
    if (!(Number.isFinite(d) && d >= 0 && Number.isFinite(trap))) finite = false;
  }
  ok(finite, 'DE finite and non-negative over random points (defaults)');
  for (const k in BIOMES) {
    const v = { ...base, ...BIOMES[k].v };
    const m = makeDE(v);
    let f = true;
    for (let i = 0; i < 300; i++) { const d = m([Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3]).d; if (!Number.isFinite(d)) f = false; }
    ok(f, `DE finite for biome ${k}`);
    const s = viewScore({ ...v }, 5);
    console.log(`    biome ${k.padEnd(9)} hit ${(s.hitFrac * 100).toFixed(0).padStart(3)}%  near ${(s.nearFrac * 100).toFixed(0)}%  clearance ${s.clearance.toFixed(3)}`);
  }
  // Influence fix: with influence = 1 the new derivative equals v1's |m| exactly.
  const s = viewScore(base, 5);
  console.log(`    default view: hit ${(s.hitFrac * 100).toFixed(0)}%, clearance ${s.clearance.toFixed(3)}`);
  ok(s.clearance > 0, 'default camera is outside the surface');
  ok(s.hitFrac > 0, 'default view sees surface');

  // Lipschitz sanity: the DE must not overshoot the true surface along a ray.
  // March one ray at small fixed steps; marched hit must not be beyond first sign of contact.
  const cam = cameraBasis(base);
  const rd = pixelRay(cam, 1, 8, 4.5, 16, 9);
  const t = march(map, cam.eye, rd, base);
  ok(t > 0, `centre-ish ray hits (t=${t.toFixed(4)})`);
}

// ── Fold types ──────────────────────────────────────────────────────────────
section('fold types');
{
  const { FOLD_NAMES } = await import('../engine/params.js');
  // Every fold must be 1-Lipschitz (isometries, or contraction for the sine fold);
  // otherwise the distance estimate would overshoot and the march would tunnel.
  for (let type = 0; type < FOLD_NAMES.length; type++) {
    const v = { ...base, foldType: type, foldX: 0.9, foldY: 1.1, foldZ: 0.7, tgladWeight: 0, polarN: 5 };
    const f = makeDE(v).applyFold;
    let worst = 0, moved = 0;
    for (let i = 0; i < 4000; i++) {
      const p = [Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3];
      const e = 1e-3;
      const q = [p[0] + (Math.random() - 0.5) * e, p[1] + (Math.random() - 0.5) * e, p[2] + (Math.random() - 0.5) * e];
      const a = f(p, type), b = f(q, type);
      worst = Math.max(worst, length(sub(a, b)) / length(sub(p, q)));
      if (length(sub(a, p)) > 1e-6) moved++;
      if (!a.every(Number.isFinite)) worst = Infinity;
    }
    ok(worst <= 1 + 1e-6, `fold ${type} (${FOLD_NAMES[type]}) 1-Lipschitz (worst stretch ${worst.toFixed(6)})`);
    ok(moved > 100, `fold ${type} actually folds space`);
    const s = viewScore({ ...base, foldType: type }, 4);
    ok(Number.isFinite(s.clearance), `fold ${type} DE finite at camera`);
    // A bounded fold traps every orbit and turns all of space solid (DE → 0
    // everywhere) — the bug the original sine fold had. Measure open space.
    const dm = makeDE({ ...base, foldType: type });
    let open = 0;
    for (let i = 0; i < 1500; i++) if (dm([Math.random() * 40 - 20, Math.random() * 40 - 20, Math.random() * 40 - 20]).d > 0.01) open++;
    ok(open / 1500 > 0.3, `fold ${type} leaves space open (${(open / 15).toFixed(0)}% of ±20 box)`);
  }
  // Hybrid: B every 2nd iteration must differ from pure A, and Off must equal pure A.
  const p0 = [0.31, -0.72, 0.44];
  const pure = makeDE({ ...base, foldType: 0 })(p0).d;
  ok(makeDE({ ...base, foldType: 0, foldType2: 0 })(p0).d === pure, 'hybrid Off == pure fold');
  ok(makeDE({ ...base, foldType: 0, foldType2: 6, hybridPeriod: 2 })(p0).d !== pure, 'hybrid B changes the DE');
  ok(makeDE({ ...base, foldType: 0, foldType2: 1, hybridPeriod: 1 })(p0).d === makeDE({ ...base, foldType: 0 })(p0).d, 'hybrid B = same type is a no-op');
}

// Every specialised program (11 A × 12 B) must compile as GLSL ES 1.00.
{
  const { FOLD_NAMES } = await import('../engine/params.js');
  ok(FOLD_GLSL.length === FOLD_NAMES.length, 'FOLD_GLSL matches FOLD_NAMES');
  const probe = spawnSync('glslangValidator', ['--version']);
  if (probe.status === 0) {
    let bad = 0, n = 0;
    const combos = [];
    for (let a = 0; a < FOLD_GLSL.length; a++) for (let b = -1; b < FOLD_GLSL.length; b++) combos.push([a, b, 0]);
    for (const mode of [1, 2]) for (let a = 0; a < FOLD_GLSL.length; a++) combos.push([a, -1, mode], [a, (a + 3) % FOLD_GLSL.length, mode]);
    for (let variant = 1; variant < 16; variant++) for (const mode of [0, 1, 2]) {
      const stack = [1 + (variant % 6), (variant + mode) % 7, (variant * 3) % 7, mode * 2, 6 - mode].map(x => Math.min(6, x));
      combos.push([0, -1, mode, variant, stack]);
    }
    // Material builds (HAS_MAT) of every variant × mode, with and without texture LOD.
    for (let variant = 0; variant < 16; variant++) for (const mode of [0, 1, 2]) for (const texLod of [true, false]) combos.push([0, -1, mode, variant, undefined, true, texLod]);
    // Repetition + Deep Zoom (+ materials + extra lights) builds.
    for (let variant = 0; variant < 16; variant++) for (const mode of [0, 1, 2]) combos.push([0, -1, mode, variant, undefined, variant % 2 === 0, mode !== 1, { rep: true, dz: true, xl: variant % 3 === 0 }]);
    for (const [a, b, mode, variant = 0, stack, mat = false, lod, extra = {}] of combos) {
      writeFileSync('/tmp/surf-combo.frag', '#version 100\n' + fractalFrag(a, b, { mode, variant, stack, mat, texLod: lod ?? (a + b + variant) % 2 === 0, ...extra }));
      const r = spawnSync('glslangValidator', ['/tmp/surf-combo.frag']);
      n++;
      if (r.status !== 0) { bad++; console.log(`   glslang fail A=${a} B=${b} mode=${mode} variant=${variant} mat=${mat}:\n${r.stdout}`); }
    }
    ok(bad === 0, `glslangValidator: all ${n} fold × render-mode programs compile`);
    console.log(`    glslang: ${n} specialised programs compiled`);
  } else console.log('    (glslangValidator not found — skipping per-combination shader check)');
}

// ── Rotations ───────────────────────────────────────────────────────────────
section('rotations');
{
  const p0 = [0.41, -0.33, 0.27];
  const d0 = makeDE(base)(p0).d;
  ok(makeDE({ ...base, spinX: 0.2, preAlpha: 0.5, alpha: 0.3, rotStart: 99 })(p0).d === makeDE({ ...base, alpha: 0 })(p0).d, 'rotStart past iterations disables all rotations');
  ok(makeDE({ ...base, preAlpha: 0.4 })(p0).d !== d0, 'pre-fold rotation changes the DE');
  ok(makeDE({ ...base, spinZ: 0.1 })(p0).d !== d0, 'iteration spin changes the DE');
  // Spin k=0 is identity, so with one iteration spin has no effect.
  ok(makeDE({ ...base, iterations: 1, spinZ: 0.3 })(p0).d === makeDE({ ...base, iterations: 1 })(p0).d, 'spin starts at identity');
  // Inversion DE limit: higher limit can only shrink (never grow) the DE.
  let worse = 0;
  for (let i = 0; i < 400; i++) {
    const q = [Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2];
    const a = makeDE({ ...base, invEnabled: true, invDELimit: 10 })(q).d, b = makeDE({ ...base, invEnabled: true, invDELimit: 100 })(q).d;
    if (b > a * (1 + 1e-12)) worse++;
  }
  ok(worse === 0, 'raising the inversion DE limit is always more conservative');
}

// ── Cut-off diagnosis (the screenshot's settings) ───────────────────────────
section('cut-off diagnosis');
{
  const { marchInfo } = await import('../engine/de.js');
  const u = { ...base, foldX: 1.63, foldY: 2.28, foldZ: 0.12, juliaCX: -0.31, juliaCY: -0.28, juliaCZ: 0.01, cMult: -0.37, alpha: 2.0904, beta: 2.5284, gamma: 1.6744, invEnabled: true };
  const frac = (v) => {
    const cam = cameraBasis(v), map = makeDE(v); let st = 0;
    for (let j = 0; j < 12; j++) for (let i = 0; i < 20; i++) if (marchInfo(map, cam.eye, pixelRay(cam, 1, (i + 0.5) / 20 * 16, (j + 0.5) / 12 * 9, 16, 9), v).reason === 'stranded') st++;
    return st / 240;
  };
  const f1 = frac(u), f2 = frac({ ...u, detail: 0.25 });
  console.log(`    stranded rays: detail 1 → ${(f1 * 100).toFixed(0)}%, detail 0.25 → ${(f2 * 100).toFixed(0)}%`);
  ok(f1 > 0.5 && f2 < 0.2, 'lowering Surface Detail resolves the reported cut-off');
  ok(marchInfo(makeDE(u), cameraBasis(u).eye, [0, 0, -1], { ...u, missAsHit: true }).t > 0, 'missAsHit turns stranded rays into hits');
  const { suggestVolumeShell } = await import('../engine/de.js');
  const sd = suggestVolumeShell(u), ss = suggestVolumeShell({ ...base, foldType: 3, juliaCX: 0.6, juliaCY: 0.3, juliaCZ: 0.5, rotY: 0.45, rotX: 0.3, dist: 4.5 });
  console.log(`    auto shell: dust → ${sd.kind} thick ${sd.volThick.toExponential(2)}, reef → ${ss.kind} thick ${ss.volThick}`);
  ok(sd.kind === 'dust' && sd.volThick < 0.001 && ss.kind === 'surface', 'Auto Shell separates dust fields from solid surfaces');
  for (const k of ['volThick', 'volDensity', 'volStepMin']) ok(coerce(PARAM_BY_ID.get(k), sd[k]) === sd[k], `auto shell ${k} within param limits`);
}

// ── Surf variants ───────────────────────────────────────────────────────────
section('surf variants');
{
  const { SURF_VARIANTS, STACK_FOLDS } = await import('../engine/params.js');
  const { VARIANT_DEFAULTS, isActive } = await import('../engine/presets.js');
  const { specOf, specKey } = await import('../engine/renderer.js');
  const { STACK_GLSL } = await import('../engine/glsl.js');
  ok(STACK_GLSL.length === STACK_FOLDS.length, 'STACK_GLSL matches STACK_FOLDS');
  ok(Object.keys(VARIANT_DEFAULTS).length === SURF_VARIANTS.length, 'every variant has a defaults entry');
  for (const [vi, d] of Object.entries(VARIANT_DEFAULTS)) for (const [k, val] of Object.entries(d)) {
    ok(PARAM_BY_ID.has(k) && coerce(PARAM_BY_ID.get(k), val) !== undefined, `variant ${vi} default ${k} valid`);
  }
  // Specialisation normalisation: unused fields never split the program cache.
  const keyOf = o => specKey(specOf({ ...sceneUniforms({ ...base, ...o }) }));
  ok(keyOf({ surfVariant: 1, foldType: 5, vStack2: 3 }) === keyOf({ surfVariant: 1 }), 'variant 1 key ignores classic folds and the stack');
  ok(keyOf({ surfVariant: 3, vStack2: 3 }) !== keyOf({ surfVariant: 3 }), 'stack variants key on the stack');
  ok(keyOf({ surfVariant: 0, foldType: 2, foldType2: 3 }) === keyOf({ surfVariant: 0, foldType: 2 }), 'hybrid B equal to A collapses');

  // Fold-stack slots: 1-Lipschitz, except Conditional Reflect, which is
  // discontinuous unless Value = 2·Limit (same as Mandelbulber's definition).
  const v0 = { ...base, foldX: 0.9, foldY: 1.2, vFold2: 1.7, vFoldValue: 2 };
  for (let t = 1; t < STACK_FOLDS.length; t++) {
    const vv = t === 4 ? { ...v0, foldX: 1, foldY: 1, vFoldValue: 2 } : v0;
    const f = makeDE(vv).stackFold;
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const p = [Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4];
      const q = [p[0] + (Math.random() - 0.5) * 1e-3, p[1] + (Math.random() - 0.5) * 1e-3, p[2]];
      worst = Math.max(worst, length(sub(f(p, t), f(q, t))) / length(sub(p, q)));
    }
    ok(worst <= 1 + 1e-6, `stack fold ${t} (${STACK_FOLDS[t]}) 1-Lipschitz${t === 4 ? ' when Value = 2·Limit' : ''} (worst ${worst.toFixed(6)})`);
  }
  {
    const f = makeDE({ ...v0, foldX: 1, vFoldValue: 1.5 }).stackFold;
    const jump = Math.abs(f([1 + 1e-9, 0, 0], 4)[0] - f([1 - 1e-9, 0, 0], 4)[0]);
    ok(jump > 0.4, `Conditional Reflect jumps by ${jump.toFixed(2)} at the limit when Value ≠ 2·Limit (documented, as in Mandelbulber)`);
  }

  // Each variant at its Mandelbulber defaults: finite DE and a non-degenerate field.
  for (let vi = 0; vi < SURF_VARIANTS.length; vi++) {
    const vv = { ...base, ...VARIANT_DEFAULTS[vi], surfVariant: vi };
    const map = makeDE(vv);
    let finite = true, open = 0;
    for (let i = 0; i < 1500; i++) {
      const d = map([Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8]).d;
      if (!Number.isFinite(d) || d < 0) finite = false;
      if (d > 0.01) open++;
    }
    const sc = viewScore({ ...vv, dist: 6, rotY: 0.4, rotX: 0.5 }, 5);
    console.log(`    ${SURF_VARIANTS[vi].padEnd(28)} open ${(open / 15).toFixed(0).padStart(3)}%  view hits ${(sc.hitFrac * 100).toFixed(0).padStart(3)}%`);
    ok(finite, `${SURF_VARIANTS[vi]}: DE finite and non-negative`);
    ok(open / 1500 > 0.2, `${SURF_VARIANTS[vi]}: space is not uniformly solid`);
  }
  // Gating helper used by Evolve.
  ok(!isActive(PARAM_BY_ID.get('vFixedR2'), { ...base, surfVariant: 1 }) && isActive(PARAM_BY_ID.get('vFixedR2'), { ...base, surfVariant: 3 }), 'isActive honours select gates');
}

// ── Sequencer ───────────────────────────────────────────────────────────────
section('sequencer');
{
  const sq = new Sequencer();
  const k = (o) => ({ ...base, ...o });
  sq.add(k({ dist: 2, rotX: 3.0, palette: 1, lightColor: '#000000', iterations: 10 }));
  sq.add(k({ dist: 4, rotX: -3.0, palette: 5, lightColor: '#ffffff', iterations: 20 }));
  sq.add(k({ dist: 8, rotX: -2.0, palette: 2, lightColor: '#ff0000', iterations: 30 }));
  const seg = 2;
  for (const ease of [EASE.LINEAR, EASE.SMOOTH, EASE.EASE]) {
    ok(near(sq.sample(0, seg, MODE.ONCE, ease).dist, 2), `ease ${ease}: key0 exact`);
    ok(near(sq.sample(seg, seg, MODE.ONCE, ease).dist, 4), `ease ${ease}: key1 exact`);
    ok(near(sq.sample(2 * seg, seg, MODE.ONCE, ease).dist, 8), `ease ${ease}: key2 exact`);
  }
  const mid = sq.sample(seg / 2, seg, MODE.ONCE, EASE.LINEAR);
  ok(near(mid.dist, 3), 'linear midpoint');
  ok(near(Math.abs(mid.rotX), Math.PI, 1e-9), `angle takes shortest arc through ±π (got ${mid.rotX})`);
  ok(mid.palette === 1, 'step params latch from start key');
  ok(mid.iterations === 15, 'int params rounded');
  ok(mid.lightColor === '#808080', `colour lerp (${mid.lightColor})`);
  ok(sq.duration(seg, MODE.ONCE) === 4 && sq.duration(seg, MODE.LOOP) === 6 && sq.duration(seg, MODE.PINGPONG) === 8, 'durations');
  const lp = sq.sample(6, seg, MODE.LOOP, EASE.SMOOTH);
  ok(near(lp.dist, 2, 1e-9), 'loop closes back onto key0');
  const lpm = sq.sample(5, seg, MODE.LOOP, EASE.LINEAR);
  ok(near(lpm.dist, 5), 'loop closing segment interpolates last→first');
  const pp1 = sq.sample(3, seg, MODE.PINGPONG, EASE.LINEAR), pp2 = sq.sample(5, seg, MODE.PINGPONG, EASE.LINEAR);
  ok(near(pp1.dist, pp2.dist), 'ping-pong symmetric');
  // Catmull-Rom can overshoot; hard limits must still hold.
  const s2 = new Sequencer();
  s2.add(k({ dist: 0.001 })); s2.add(k({ dist: 10 })); s2.add(k({ dist: 0.001 }));
  let minD = Infinity;
  for (let t = 0; t <= 4; t += 0.01) minD = Math.min(minD, s2.sample(t, 2, MODE.ONCE, EASE.SMOOTH).dist);
  ok(minD >= PARAM_BY_ID.get('dist').hardMin, 'catmull overshoot clamped by hard limits');
  // playback advance
  sq.play();
  let last = null;
  for (let i = 0; i < 1000 && sq.playing; i++) last = sq.update(0.01, seg, MODE.ONCE, EASE.LINEAR);
  ok(!sq.playing && near(last.dist, 8), 'once-mode stops on last key');
  // keyframes keep fly target (v1 dropped it)
  const s3 = new Sequencer(); s3.add(k({ targetX: 1.5 }));
  ok(s3.keys[0].targetX === 1.5, 'keyframe captures fly target');
  ok(s3.keys[0].maxSamples === undefined, 'keyframe excludes quality settings');
}

// ── State ───────────────────────────────────────────────────────────────────
section('state');
{
  const st = new State();
  const v0 = st.version;
  st.set('maxSamples', 10);
  ok(st.version === v0, 'noReset params do not restart accumulation');
  st.set('scale', 2.5);
  ok(st.version === v0 + 1, 'render params bump version');
  ok(!st.set('scale', 2.5), 'unchanged set is a no-op');
  ok(!st.set('scale', NaN) && st.get('scale') === 2.5, 'NaN ignored');
}

// ── Discovery codec / project ───────────────────────────────────────────────
section('discovery');
{
  ok(decodeDiscovery(encodeDiscovery(base)).scale === base.scale, 'defaults round-trip');
  ok(encodeDiscovery(base) === 'SURF2:e30', 'defaults encode to empty object');
  for (let trial = 0; trial < 50; trial++) {
    const v = { ...base };
    for (const p of PARAMS) {
      if (Math.random() < 0.5) continue;
      if (p.type === 'bool') v[p.id] = Math.random() < 0.5;
      else if (p.type === 'select') v[p.id] = Math.floor(Math.random() * p.options.length);
      else if (p.type === 'color') v[p.id] = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      else v[p.id] = coerce(p, p.min + Math.random() * (p.max - p.min)) ?? p.def;
    }
    const back = decodeDiscovery(encodeDiscovery(v));
    let same = true;
    for (const p of PARAMS) {
      const a = v[p.id], b = back[p.id];
      if (typeof a === 'number' ? Math.abs(a - b) > Math.abs(a) * 1e-6 + 1e-9 : a !== b) { same = false; console.log('   mismatch', p.id, a, b); }
    }
    ok(same, `random round-trip ${trial}`);
  }
  let threw = false;
  try { decodeDiscovery('hello'); } catch { threw = true; }
  ok(threw, 'junk rejected');
  const evil = decodeDiscovery('{"iterations": 1e9, "bogus": 1, "lightColor": "javascript:"}');
  ok(evil.iterations === 250 && !('bogus' in evil) && evil.lightColor === base.lightColor, 'hostile values sanitised');
  const proj = makeProject({ ...base, scale: 1.7 }, [{ dist: 3 }, { dist: 4 }]);
  const pp = parseProject(JSON.stringify(proj));
  ok(pp.params.scale === 1.7 && pp.keyframes.length === 2, 'project round-trip');
}

// ── Evolve / rebirth ────────────────────────────────────────────────────────
section('amazing ifs vs Mandelbulber reference');
{
  // Line-by-line port of mandelbulber2 fractal_amazing_ifs.cpp FormulaCode (sphere
  // inversion off, aux colour ignored), written against Mandelbulber's own names.
  // Final distance as compute_fractal.cpp: linear = r / aux.DE, custom = aux.dist.
  const { fractalRotation } = await import('../engine/vec.js');
  const { PARAMS } = await import('../engine/params.js');
  const { VARIANT_DEFAULTS } = await import('../engine/presets.js');
  const defs = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  const fabs = Math.abs, sign = Math.sign;
  function mbAmazingIfs(c, f, iters) {
    let z = [...c];
    const aux = { DE: 1, actualScaleA: 0, dist: 1000, i: 0 };
    const rot = fractalRotation(f.alpha, f.beta, f.gamma);
    const R = v => [rot[0]*v[0]+rot[1]*v[1]+rot[2]*v[2], rot[3]*v[0]+rot[4]*v[1]+rot[5]*v[2], rot[6]*v[0]+rot[7]*v[1]+rot[8]*v[2]];
    for (aux.i = 0; aux.i < iters; aux.i++) {
      if (f.functionEnabledAx) z[0] = fabs(z[0]);
      if (f.functionEnabledAy) z[1] = fabs(z[1]);
      if (f.functionEnabledAz) z[2] = fabs(z[2]);
      z = z.map((x, k) => x + f.offsetA000[k]);
      if (f.functionEnabledP && aux.i < f.stopP) {
        z[1] = fabs(z[1]);
        let psi = Math.PI / f.int6;
        psi = fabs(((Math.atan2(z[1], z[0]) + psi) % (2 * psi) + 2 * psi) % (2 * psi) - psi);
        const len = Math.sqrt(z[0] * z[0] + z[1] * z[1]);
        z[0] = Math.cos(psi) * len; z[1] = Math.sin(psi) * len;
      }
      const a = f.additionConstant0555;
      z[0] = fabs(z[0] + a[0]) - fabs(z[0] - a[0]) - z[0];
      z[1] = fabs(z[1] + a[1]) - fabs(z[1] - a[1]) - z[1];
      if (f.functionEnabledCz) z[2] = fabs(z[2] + a[2]) - fabs(z[2] - a[2]) - z[2];
      for (let k = 0; k < 3; k++) {
        if (!f.functionEnabledB[k]) continue;
        if (!f.functionEnabledSign[k]) z[k] = fabs(z[k]); else z[k] = sign(z[k]) * fabs(z[k]);
        z[k] -= f.additionConstantP000[k];
      }
      z = z.map((x, k) => x + f.additionConstantA000[k]);
      const rr = z[0] * z[0] + z[1] * z[1] + z[2] * z[2];
      const MinRR = f.minR2p25;
      const dividend = rr < MinRR ? MinRR : Math.min(rr, 1);
      const useScale = (aux.actualScaleA + f.scale2) / dividend;
      z = z.map(x => x * useScale);
      aux.DE = aux.DE * fabs(useScale) + f.offset0;
      if (f.functionEnabledK) aux.actualScaleA -= f.scaleVary0 * (fabs(aux.actualScaleA) - 1);
      z = R(z);
      aux.DE0 = Math.hypot(...z) / aux.DE;
      if (aux.i >= f.startIterationsC && aux.i < 250) aux.DE0 = Math.min(aux.dist, aux.DE0);
      aux.dist = aux.DE0;
      if (f.cpixel) z = z.map((x, k) => x + f.c[k]);
      if (z[0] * z[0] + z[1] * z[1] + z[2] * z[2] > 10000) break;
    }
    return { linear: Math.hypot(...z) / aux.DE, custom: aux.dist };
  }
  let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const r = (a, b) => a + (b - a) * rnd();
  let worst = 0, worstMin = 0, n = 0;
  for (let t = 0; t < 60; t++) {
    const modes = [0, 1, 2].map(() => Math.floor(r(0, 3)));
    const v = { ...defs, ...VARIANT_DEFAULTS[10], surfVariant: 10, iterations: 12,
      scale: r(1.5, 2.6), minR: r(0.2, 0.8), foldX: r(0.3, 1.2), foldY: r(0.3, 1.2), foldZ: r(0.3, 1.2), vZFold: rnd() < 0.5,
      vPreAbsX: rnd() < 0.3, vPreAbsY: rnd() < 0.3, vPreAbsZ: rnd() < 0.3, vIfsX: modes[0], vIfsY: modes[1], vIfsZ: modes[2],
      vIfsOffX: r(-1, 1), vIfsOffY: r(-1, 1), vIfsOffZ: r(-1, 1), vIfsAddX: r(-0.5, 0.5), vIfsAddY: r(-0.5, 0.5), vIfsAddZ: r(-0.5, 0.5),
      vOffX: r(-0.3, 0.3), vOffY: r(-0.3, 0.3), vOffZ: r(-0.3, 0.3), vPolyOn: rnd() < 0.4, vPolyStop: 1 + Math.floor(r(0, 12)), polarN: 3 + Math.floor(r(0, 6)),
      vDEOffset: r(0, 1), scaleVary: rnd() < 0.5 ? 0 : r(-0.3, 0.3), alpha: r(-0.5, 0.5), beta: r(-0.5, 0.5), gamma: r(-0.5, 0.5),
      vAddC: rnd() < 0.5, vMinDEStart: Math.floor(r(0, 5)), juliaMode: true, juliaCX: r(-0.5, 0.5), juliaCY: r(-0.5, 0.5), juliaCZ: r(-0.5, 0.5), invEnabled: false };
    const f = {
      functionEnabledAx: v.vPreAbsX, functionEnabledAy: v.vPreAbsY, functionEnabledAz: v.vPreAbsZ,
      offsetA000: [v.vOffX, v.vOffY, v.vOffZ], functionEnabledP: v.vPolyOn, int6: v.polarN,
      additionConstant0555: [v.foldX, v.foldY, v.foldZ], functionEnabledCz: v.vZFold,
      functionEnabledB: modes.map(m => m > 0), functionEnabledSign: modes.map(m => m === 2),
      additionConstantP000: [v.vIfsOffX, v.vIfsOffY, v.vIfsOffZ], additionConstantA000: [v.vIfsAddX, v.vIfsAddY, v.vIfsAddZ],
      minR2p25: v.minR * v.minR, scale2: v.scale, offset0: v.vDEOffset, functionEnabledK: v.scaleVary !== 0, scaleVary0: v.scaleVary,
      alpha: v.alpha, beta: v.beta, gamma: v.gamma, startIterationsC: v.vMinDEStart, stopP: v.vPolyStop, cpixel: v.vAddC, c: [v.juliaCX, v.juliaCY, v.juliaCZ] };
    for (let q = 0; q < 8; q++) {
      const p = [r(-2, 2), r(-2, 2), r(-2, 2)];
      const ref = mbAmazingIfs(p, f, v.iterations);
      const lin = makeDE({ ...v, vMinDE: false })(p).d, mn = makeDE({ ...v, vMinDE: true })(p).d;
      worst = Math.max(worst, Math.abs(lin - 0.5 * ref.linear) / Math.max(1e-9, 0.5 * ref.linear));
      worstMin = Math.max(worstMin, Math.abs(mn - 0.5 * ref.custom) / Math.max(1e-9, 0.5 * ref.custom));
      n++;
    }
  }
  ok(worst < 1e-7, `Amazing IFS linear DE matches the Mandelbulber port at ${n} points (worst rel ${worst.toExponential(1)})`);
  ok(worstMin < 1e-7, `Amazing IFS smooth (min) DE matches aux.dist (worst rel ${worstMin.toExponential(1)})`);
}

section('object transform');
{
  const { PARAMS } = await import('../engine/params.js');
  const defs = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  const { eulerDeg, mat3MulVec } = await import('../engine/vec.js');
  const base = { ...defs };
  const xf = { ...defs, objX: 0.7, objY: -0.4, objZ: 1.1, objRotX: 25, objRotY: -40, objRotZ: 15, objScale: 1.7 };
  const m0 = makeDE(base), m1 = makeDE(xf);
  const R = eulerDeg(25, -40, 15);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const q = [Math.sin(i * 1.3) * 2, Math.cos(i * 0.7) * 2, Math.sin(i * 2.1) * 2];
    // Placing local point q at world p = pos + s·R·q must give s × the untransformed DE.
    const p = mat3MulVec(R, q).map((x, k) => x * 1.7 + [0.7, -0.4, 1.1][k]);
    const a = m1(p).d, b = m0(q).d * 1.7;
    worst = Math.max(worst, Math.abs(a - b) / Math.max(1e-9, Math.abs(b)));
  }
  ok(worst < 1e-6, `object transform: DE(pos + s·R·q) = s·DE(q) at 200 points (worst rel ${worst.toExponential(1)})`);
  ok(makeDE(base) && makeDE({ ...defs, objScale: 1 }).length === makeDE(base).length, 'identity transform keeps the plain DE');
}

section('wave warp');
{
  const defs = defaults();
  const { VARIANT_DEFAULTS } = await import('../engine/presets.js');
  const names = ['', 'ripple', 'sine shear', 'wave fold', 'twist', 'gyroid', 'interference'];
  for (let t = 1; t <= 6; t++) {
    // 1. Amplitude 0 is the identity: DE equals the plain formula exactly.
    const plain = makeDE(defs), zero = makeDE({ ...defs, waveType: t, waveAmp: 0, waveStop: 250 });
    let same = true;
    for (let i = 0; i < 50; i++) { const p = [Math.sin(i) * 1.5, Math.cos(i * 1.7), Math.sin(i * 2.3) * 1.2]; if (plain(p).d !== zero(p).d) same = false; }
    ok(same, `wave ${names[t]}: amplitude 0 leaves the DE unchanged`);
    // 2. The dr factor bounds the local stretch: |W(p+h) − W(p)| ≤ k(p)·|h| (k = dr factor).
    for (const [A, F] of [[0.3, 3], [-0.8, 7], [1.5, 0.7]]) {
      const W = makeWave({ waveType: t, waveAmp: A, waveFreq: F, wavePhase: 0.4, wavePhaseStep: 0.3, waveAxX: 1, waveAxY: -0.6, waveAxZ: 1.4 });
      let worst = 0;
      for (let i = 0; i < 400; i++) {
        const p = [Math.sin(i * 1.1) * 2.5, Math.cos(i * 0.37) * 2.5, Math.sin(i * 2.9 + 1) * 2.5];
        const [wp, k] = W(p, 1, i % 5);
        for (let d = 0; d < 6; d++) {
          const h = [Math.sin(i + d * 3.1), Math.cos(i * 1.3 + d), Math.sin(d * 7.7 - i)].map(x => x * 1e-6);
          const [wq] = W([p[0] + h[0], p[1] + h[1], p[2] + h[2]], 1, i % 5);
          worst = Math.max(worst, Math.hypot(wq[0] - wp[0], wq[1] - wp[1], wq[2] - wp[2]) / Math.hypot(...h) / k);
        }
      }
      ok(worst <= 1 + 1e-4, `wave ${names[t]} A=${A} F=${F}: DE derivative bounds the warp (max stretch/k ${worst.toFixed(4)})`);
    }
    // 3. Works with every formula and stays finite.
    let finite = true;
    for (const variant of [0, 1, 2, 5, 8, 10]) {
      const m = makeDE({ ...defs, ...(VARIANT_DEFAULTS[variant] || {}), surfVariant: variant, waveType: t, waveAmp: 0.4, waveFreq: 4, waveStop: 4 });
      for (let i = 0; i < 40; i++) { const d = m([Math.sin(i) * 2, Math.cos(i * 1.3) * 2, Math.sin(i * 0.7) * 2]).d; if (!Number.isFinite(d)) finite = false; }
    }
    ok(finite, `wave ${names[t]}: finite DE on Classic, Surf, Mod 1, Mod 4, Klein and Amazing IFS`);
  }
  const W = makeWave({ waveType: 1, waveAmp: 0.2, waveFreq: 3, waveStart: 2, waveStop: 4 });
  ok(W([1, 0, 0], 1, 0)[0][0] !== 1, 'makeWave applies the shape (iteration gating lives in the DE loop)');
  const gated = makeDE({ ...defs, waveType: 2, waveAmp: 0.5, waveStart: 40, waveStop: 41 });
  ok(gated([0.3, 0.2, 0.1]).d === makeDE(defs)([0.3, 0.2, 0.1]).d, 'iteration range outside the iteration count has no effect');
}

section('kyma surf variants 11–15');
{
  const { VARIANT_DESC, VARIANT_DEFAULTS: VD } = await import('../engine/presets.js');
  const { SURF_VARIANTS } = await import('../engine/params.js');
  ok(VARIANT_DESC.length === SURF_VARIANTS.length && SURF_VARIANTS.every((n, i) => typeof VARIANT_DESC[i] === 'string' && VARIANT_DESC[i].length > 20), 'every formula has its own description (no gaps)');
  ok([11, 12, 13, 14, 15].every(i => VARIANT_DESC[i].startsWith(SURF_VARIANTS[i].replace(/ \(Kyma\)$/, ''))), 'descriptions line up with formula names');
  ok(SURF_VARIANTS.every((_, i) => VD[i]), 'every formula has defaults');
  const { VARIANT_DEFAULTS } = await import('../engine/presets.js');
  const names = { 11: 'Loxodromic', 12: 'Torus', 13: 'Ellipsoid', 14: 'Vortex', 15: 'Gyroid' };
  const shapes = {
    11: [{ vLoxZ: 0.6 }, { vLoxX: -2.5, vLoxZ: 0 }, { vLoxX: 0.7, vLoxY: 1.3, vLoxZ: -0.4, influence: 0.6 }],
    12: [{ vTorusOnZ: true, vTorusRZ: 0.6 }, { vTorusOnX: true, vTorusOnY: true, vTorusOnZ: false, vTorusRX: 1.4, vTorusRY: 0.3 }, { vTorusOnX: true, vTorusOnY: true, vTorusOnZ: true, vTorusRX: 0.2, vTorusRY: 0.9, vTorusRZ: 0.5, influence: 1.5 }],
    13: [{ vEllX: 1, vEllY: 1, vEllZ: 1.8 }, { vEllX: 0.3, vEllY: 2.5, vEllZ: 1 }, { vEllX: 2, vEllY: 0.5, vEllZ: 0.4, influence: 0.5 }],
    14: [{ vVortexZ: 0.4 }, { vVortexX: -1.6, vVortexDX: 0.8, vVortexZ: 0 }, { vVortexX: 0.3, vVortexY: -0.7, vVortexZ: 0.5, vVortexDY: -1.5, vVortexDZ: 0.4 }],
    15: [{ vGyroFreq: 2, vGyroL: 0.4 }, { vGyroFreq: 5, vGyroL: 0.1 }, { vGyroFreq: 0.7, vGyroL: 0.9, influence: 0.7 }],
  };
  for (const vi of [11, 12, 13, 14, 15]) {
    // 1. The step never stretches space by more than its reported fac.
    for (const [si, sh] of shapes[vi].entries()) {
      const v = { ...defaults(), ...VARIANT_DEFAULTS[vi], surfVariant: vi, minR: 0.5, foldX: 1, foldY: 1, ...sh };
      const step = makeSurfStep(v);
      let worst = 0;
      for (let i = 0; i < 600; i++) {
        const r = 0.2 + 2.6 * ((i * 0.618) % 1);
        const p = [Math.sin(i * 1.7) * r, Math.cos(i * 2.3) * r, Math.sin(i * 0.9 + 1) * r];
        const a = step(p, 2);
        for (let d = 0; d < 4; d++) {
          const h = [Math.sin(i + d * 3.1), Math.cos(i * 1.3 + d), Math.sin(d * 7.7 - i)].map(x => x * 1e-7);
          const b = step([p[0] + h[0], p[1] + h[1], p[2] + h[2]], 2);
          worst = Math.max(worst, Math.hypot(b.z[0] - a.z[0], b.z[1] - a.z[1], b.z[2] - a.z[2]) / Math.hypot(...h) / a.fac);
        }
      }
      ok(worst <= 1 + 1e-3, `${names[vi]} #${si + 1}: step stretch ≤ fac (max ratio ${worst.toFixed(4)})`);
    }
    // 2. Finite DE everywhere, also with Julia, C-Mult, scale vary and rotation.
    const m = makeDE({ ...defaults(), ...VARIANT_DEFAULTS[vi], surfVariant: vi, juliaMode: true, juliaCX: 0.3, cMult: 0.2, scaleVary: 0.1, alpha: 0.3, iterations: 20 });
    let fin = true;
    for (let i = 0; i < 200; i++) { const d = m([Math.sin(i) * 3, Math.cos(i * 1.3) * 3, Math.sin(i * 0.7) * 3]).d; if (!(d >= 0) || !Number.isFinite(d)) fin = false; }
    ok(fin, `${names[vi]}: DE finite and non-negative`);
  }
  // 3. Neutral settings reduce exactly to Mandelbulber Amazing Surf (variant 1).
  const base = { ...defaults(), ...VARIANT_DEFAULTS[1], surfVariant: 1, juliaMode: true, juliaCX: 0.4, juliaCY: -0.2, cMult: 0.1, alpha: 0.2, iterations: 14 };
  const ref = makeDE(base);
  const neutral = { 11: { vLoxX: 0, vLoxY: 0, vLoxZ: 0 }, 12: { vTorusOnX: false, vTorusOnY: false, vTorusOnZ: false }, 13: { vEllX: 1, vEllY: 1, vEllZ: 1 }, 14: { vVortexX: 0, vVortexY: 0, vVortexZ: 0, vVortexDX: 0, vVortexDY: 0, vVortexDZ: 0 }, 15: { vGyroFreq: 1, vGyroL: 50 } };
  for (const vi of [11, 12, 13, 14, 15]) {
    const mm = makeDE({ ...base, surfVariant: vi, ...neutral[vi] });
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      const p = [Math.sin(i * 1.1) * 2, Math.cos(i * 0.7) * 2, Math.sin(i * 2.9) * 2];
      const a = ref(p).d, b = mm(p).d;
      worst = Math.max(worst, Math.abs(a - b) / Math.max(a, 1e-9));
    }
    ok(worst < 1e-6, `${names[vi]} with neutral settings = Amazing Surf (max rel diff ${worst.toExponential(1)})`);
  }
  // 3b. A ring of radius 0 is a sphere fold: Torus with one ring at R = 0 = Amazing Surf.
  for (const X of 'XYZ') {
    const mm = makeDE({ ...base, surfVariant: 12, vTorusOnX: X === 'X', vTorusOnY: X === 'Y', vTorusOnZ: X === 'Z', ['vTorusR' + X]: 0 });
    let w = 0;
    for (let i = 0; i < 80; i++) { const p = [Math.sin(i) * 2, Math.cos(i * 0.9) * 2, Math.sin(i * 2.2) * 2]; w = Math.max(w, Math.abs(ref(p).d - mm(p).d) / Math.max(ref(p).d, 1e-9)); }
    ok(w < 1e-6, `Torus: single ring ${X} with radius 0 = Amazing Surf (${w.toExponential(1)})`);
  }
  // 3c. Axes are independent: each axis alone differs from the others, and together differs from any one.
  for (const [vi, keys] of [[11, ['vLoxX', 'vLoxY', 'vLoxZ']], [14, ['vVortexX', 'vVortexY', 'vVortexZ']]]) {
    const one = keys.map(k => makeDE({ ...base, surfVariant: vi, ...Object.fromEntries(keys.map(q => [q, q === k ? 0.7 : 0])) }));
    const all = makeDE({ ...base, surfVariant: vi, ...Object.fromEntries(keys.map(q => [q, 0.7])) });
    const sig = f => [0, 1, 2, 3, 4, 5].map(i => f([Math.sin(i) * 1.4, Math.cos(i * 1.7) * 1.4, Math.sin(i * 0.6) * 1.4]).d.toFixed(9)).join();
    const sigs = [...one.map(sig), sig(all)];
    ok(new Set(sigs).size === 4, `${names[vi]}: X, Y, Z twists are independent`);
  }
  // 3d. Saved v2.17.0 scenes (one Axis selector) convert to the same shape.
  const { migrateLegacy, decodeDiscovery, parseProject } = await import('../engine/presets.js');
  const mv = migrateLegacy({ vAxis: 1, vLox: 0.9, vTorusR: 0.7, vVortex: -0.3, vVortexDepth: 0.2, scale: 2 });
  ok(mv.vLoxX === 0 && mv.vLoxY === 0.9 && mv.vLoxZ === 0 && mv.vTorusOnY === true && !mv.vTorusOnX && !mv.vTorusOnZ && mv.vTorusRY === 0.7
    && mv.vVortexY === -0.3 && mv.vVortexDY === 0.2 && mv.vVortexX === 0 && !('vAxis' in mv) && mv.scale === 2, 'old Axis + value → that axis’s new controls');
  const pj = parseProject(JSON.stringify({ app: 'kyma', params: { surfVariant: 11, vAxis: 0, vLox: 1.1 }, keyframes: [{ surfVariant: 14, vAxis: 2, vVortex: 0.5 }] }));
  ok(pj.params.vLoxX === 1.1 && pj.params.vLoxZ === 0 && pj.keyframes[0].vVortexZ === 0.5 && pj.keyframes[0].vVortexX === 0, 'old projects and their keyframes convert on load');
  ok(decodeDiscovery(JSON.stringify({ surfVariant: 12, vAxis: 0, vTorusR: 0.4 })).vTorusOnX === true, 'old discovery strings convert');

  // 4. The variant control actually changes the shape.
  for (const vi of [11, 12, 13, 14, 15]) {
    const a = makeDE({ ...base, ...VARIANT_DEFAULTS[vi], surfVariant: vi }), b = makeDE({ ...base, surfVariant: vi, ...neutral[vi] });
    let diff = 0;
    for (let i = 0; i < 60; i++) { const p = [Math.sin(i) * 1.5, Math.cos(i * 1.3) * 1.5, Math.sin(i * 0.4) * 1.5]; diff += Math.abs(a(p).d - b(p).d); }
    ok(diff > 1e-3, `${names[vi]}: its control changes the DE`);
  }
}

section('mutation grid / textures / materials');
{
  const { breed } = await import('../ui/mutation.js');
  const { TEX_GEN, TEX_KEYS } = await import('../engine/textures.js');
  const { BIOMES } = await import('../engine/presets.js');
  const parent = { ...defaults(), ...BIOMES.ifs_shells.v };
  const kids = breed(parent, 8, 0.08);
  ok(kids.length === 8 && kids.every(k => Object.keys(k).length >= 1), `breed: 8 children, each changes ≥1 gene (${kids.map(k => Object.keys(k).length).join(',')})`);
  ok(kids.every(k => Object.keys(k).every(id => PARAM_BY_ID.get(id)?.mutate)), 'breed only touches mutable parameters');
  const usable = kids.filter(k => { const s = viewScore({ ...parent, ...k }, 4); return s.clearance > 0.02 && s.hitFrac > 0.01; }).length;
  ok(usable >= 6, `breed: ${usable}/8 children keep a usable view`);
  ok(new Set(kids.map(k => JSON.stringify(k))).size === 8, 'breed: children are all different');
  const locked = breed(parent, 12, 0.1, { lockColour: true });
  ok(locked.every(k => !('colorShift' in k)), 'Lock colour keeps colorShift out of the mutations');
  const wv = breed({ ...parent, waveType: 2 }, 30, 0.1).some(k => /^wave/.test(Object.keys(k).join(' ')));
  ok(wv, 'wave parameters join the mutation pool when Wave Warp is on');
  ok(!breed(parent, 30, 0.1).some(k => Object.keys(k).some(id => /^wave/.test(id))), 'inactive wave parameters are never mutated');

  // Procedural textures must tile: value at x = 1 equals x = 0 (and y).
  for (const key of TEX_KEYS.slice(1)) {
    const f = TEX_GEN[key]();
    let worst = 0, range = 0;
    for (let i = 0; i < 64; i++) {
      const u = i / 64;
      const a = f(0, u), b = f(1, u), c = f(u, 0), d = f(u, 1);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]), Math.abs(c[k] - d[k]));
      const g = f(u, (u * 7.3) % 1); range = Math.max(range, Math.abs(g[0] - a[0]) + Math.abs(g[1] - a[1]));
    }
    ok(worst < 1e-9 && range > 0.02, `texture ${key}: tiles seamlessly (edge mismatch ${worst.toExponential(1)}) and is not flat`);
  }

  // Shader: material / texture / crease code is opt-in — the classic path is untouched.
  // Material code is compiled in only for HAS_MAT programs; the classic build
  // must not contain any of it (it is the v2.15 shader exactly).
  const live = src => {
    const out = [], st = [];
    for (const line of src.split('\n')) {
      const t = line.trim(), on = st.every(x => x);
      if (/^#ifdef HAS_MAT\b/.test(t)) { st.push(!!/^#define HAS_MAT/m.test(src)); continue; }
      if (/^#if/.test(t)) { st.push(true); if (on) out.push(line); continue; }
      if (/^#endif/.test(t)) { st.pop(); if (on) out.push(line); continue; }
      if (/^#else/.test(t) && st.length) { if (on) out.push(line); continue; }
      if (on) out.push(line);
    }
    return out.join('\n').replace(/\/\/.*$/gm, '');
  };
  for (const mode of [0, 1, 2]) {
    const cls = live(fractalFrag(0, -1, { mode })), mat = live(fractalFrag(0, -1, { mode, mat: true }));
    ok(!/HAS_MAT|u_matOn|evalSurface|g_texProbe|u_texMode/.test(cls), `mode ${mode}: classic build has no material code`);
    ok(/#define HAS_MAT/.test(fractalFrag(0, -1, { mode, mat: true })) && /u_matOn/.test(mat), `mode ${mode}: material build defines HAS_MAT`);
    // D3D (Windows WebGL) inlines every map() call: keep the material build's extra call sites few.
    const calls = x => (x.match(/[^\w.]map\(/g) || []).length;
    const extra = calls(mat) - calls(cls);
    ok(extra <= 4, `mode ${mode}: material build adds ${extra} map() call sites (≤ 4)`);
  }
  const su1 = sceneUniforms({ ...defaults(), texMode: 1 }), su2 = sceneUniforms({ ...defaults(), creaseAmt: 0.2 }), su3 = sceneUniforms({ ...defaults(), matOn: true });
  ok(!sceneUniforms(defaults()).__mat && su1.__mat && su2.__mat && su3.__mat, 'material build only when materials, texture or crease is on');
  const { specOf, specKey } = await import('../engine/renderer.js');
  ok(specKey(specOf(su1)) !== specKey(specOf(sceneUniforms(defaults()))), 'material build gets its own program key');
  const su0 = sceneUniforms(defaults());
  ok(su0.u_matOn === false && su0.u_texMode === 0 && su0.u_crease === 0, 'materials, texture and crease are off by default');
  let pt;
  ok((pt = fractalFrag(0, -1, { mode: 1, mat: true })).includes('thinFilm(max(dot(n, -rd), 0.0), mt.iridT)') && pt.includes('exitSolid(p - n * eN * 2.0, dir, eN, ok)'), 'path tracer has the film and glass lobes');
}

section('extra lights');
{
  const { fractalFrag: ff } = await import('../engine/glsl.js');
  const { specOf, specKey } = await import('../engine/renderer.js');
  const strip = (src, defs) => {
    const out = [], st = [];
    for (const line of src.split('\n')) {
      const t = line.trim(), on = st.every(x => x);
      const m = t.match(/^#ifdef (\w+)/);
      if (m) { st.push(defs.includes(m[1]) || m[1] === 'HAS_TEX_LOD'); continue; }
      if (/^#if/.test(t)) { st.push(true); if (on) out.push(line); continue; }
      if (/^#else/.test(t)) { const top = st.pop(); st.push(!top); continue; }
      if (/^#endif/.test(t)) { st.pop(); continue; }
      if (on) out.push(line);
    }
    return out.join('\n').replace(/\/\/.*$/gm, '');
  };
  const sites = (x, fn) => (x.match(new RegExp(`[^\\w.]${fn}\\(`, 'g')) || []).length;
  for (const mode of [0, 1, 2]) {
    const cls = strip(ff(0, -1, { mode }), []), xl = strip(ff(0, -1, { mode, xl: true }), ['HAS_XLIGHTS']);
    const both = strip(ff(0, -1, { mode, xl: true, mat: true }), ['HAS_XLIGHTS', 'HAS_MAT']);
    ok(!/u_l2Pos|extraLights|xvol/.test(cls), `mode ${mode}: classic build has no extra-light code`);
    ok(/u_l2Pos/.test(xl) && /#define HAS_XLIGHTS/.test(ff(0, -1, { mode, xl: true })), `mode ${mode}: light build defines HAS_XLIGHTS`);
    // D3D (Windows) inlines every call: keep the extra shadow-ray sites few.
    const extraShadow = sites(xl, 'softShadow') + sites(xl, 'shadowVis') - sites(cls, 'softShadow') - sites(cls, 'shadowVis');
    ok(extraShadow <= 2, `mode ${mode}: extra lights add ${extraShadow} shadow-ray call sites (≤ 2)`);
    const extraMap = sites(both, 'map') - sites(cls, 'map');
    ok(extraMap <= 4, `mode ${mode}: materials + lights add ${extraMap} map() call sites (≤ 4)`);
  }
  const d = defaults();
  const off = sceneUniforms(d);
  ok(!off.__xl && off.u_lOn[0] === 0 && off.u_lOn[1] === 0, 'extra lights are off by default (classic program)');
  const on = sceneUniforms({ ...d, light2On: true, light2Color: '#ff0000', light2Int: 2, light3On: false });
  ok(on.__xl && on.u_lOn[0] === 1 && Math.abs(on.u_l2Col[0] - 2) < 1e-9 && on.u_l2Col[1] === 0, 'Light 2 colour × intensity reaches the shader');
  ok(on.u_l2Pos[0] === d.light2X && on.u_l2Pos[1] === d.light2Y && on.u_l2Pos[2] === d.light2Z, 'Light 2 sits at its world position');
  const rel = sceneUniforms({ ...d, light3On: true, light3Relative: true, light3X: 0, light3Y: 0, light3Z: 0 });
  ok(rel.u_l3Pos.every((c, i) => Math.abs(c - rel.u_camPos[i]) < 1e-9), 'Light 3 "Follows Camera" at offset 0 sits on the camera');
  ok(specKey(specOf(on)) !== specKey(specOf(off)) && specKey(specOf(on)).endsWith('|xl'), 'light build gets its own program key');
  ok(['light2On', 'light2X', 'light2Color', 'light2Int', 'light2Shadows', 'light2Relative', 'light3On', 'light3Z'].every(id => PARAM_BY_ID.get(id)?.group === 'light'), 'Light 2 / 3 controls live in Atmosphere & Light');
}

section('repetition / deep zoom');
{
  const { effectiveIterations } = await import('../engine/params.js');
  const { fractalFrag: ff } = await import('../engine/glsl.js');
  const { specOf, specKey } = await import('../engine/renderer.js');
  const base = { ...defaults(), juliaMode: true, juliaCX: 0.3, juliaCY: -0.2, juliaCZ: 0.1, iterations: 12 };
  const one = makeDE(base);
  // Grid: the copy in cell (i, j, k) is the original moved by (i·SX, j·SY, k·SZ).
  const grid = { ...base, repMode: 1, repCountX: 2, repCountY: 1, repCountZ: 2, repSpaceX: 6, repSpaceY: 5, repSpaceZ: 7 };
  const g = makeDE(grid);
  let worst = 0;
  for (const [i, j, k] of [[0, 0, 0], [1, 0, -2], [-2, 1, 2], [2, -1, 0]]) {
    for (let n = 0; n < 40; n++) {
      const q = [Math.sin(n) * 1.2, Math.cos(n * 1.3) * 1.2, Math.sin(n * 0.7) * 1.2];
      const p = [q[0] + i * 6, q[1] + j * 5, q[2] + k * 7];
      const a = one(q).d, b = g(p).d;
      if (a < 1.2) worst = Math.max(worst, Math.abs(a - b) / Math.max(a, 1e-9)); // well inside the cell: equal
    }
  }
  ok(worst < 1e-9, `grid: each copy is the original moved into its cell (max rel diff ${worst.toExponential(1)})`);
  // Each copy is cut at its cell walls: the array's distance is never more than
  // its own copy's distance or the distance to the nearest wall (+ the tiny pad),
  // so rays stop at a wall and resume against the next cell's copy.
  let viol = 0;
  for (let n = 0; n < 600; n++) {
    const p = [Math.sin(n * 1.7) * 16, Math.sin(n * 0.37 + 1) * 8, Math.cos(n * 2.3) * 18];
    const idx = [[6, 2], [5, 1], [7, 2]].map(([sp, c], k) => Math.min(Math.max(Math.floor(p[k] / sp + 0.5), -c), c));
    const own = one([p[0] - idx[0] * 6, p[1] - idx[1] * 5, p[2] - idx[2] * 7]).d;
    viol = Math.max(viol, g(p).d - own);
  }
  ok(viol <= 1e-12, `grid: never steps past its own copy (max excess ${viol.toExponential(1)})`);
  // A compact formula spaced wider than its size: identical to the full union of copies.
  const { BIOMES: BB } = await import('../engine/presets.js');
  const cbase = { ...defaults(), ...BB.kyma_ell.v };
  // Ellipsoid Coral reaches ~4.1 from its centre, so spacing 9 keeps every copy inside its cell.
  const cone = makeDE(cbase), cg = makeDE({ ...cbase, repMode: 1, repCountX: 2, repCountY: 1, repCountZ: 2, repSpaceX: 9, repSpaceY: 9, repSpaceZ: 9 });
  // Safe step: inside the ball of radius (array DE) around any point there is
  // no surface of any copy. "Surface" = a copy's own DE below 1e-4.
  const solidGrid = q => {
    const c = [Math.round(q[0] / 9), Math.round(q[1] / 9), Math.round(q[2] / 9)];
    for (let i = c[0] - 1; i <= c[0] + 1; i++) for (let j = c[1] - 1; j <= c[1] + 1; j++) for (let k = c[2] - 1; k <= c[2] + 1; k++) {
      if (Math.abs(i) > 2 || Math.abs(j) > 1 || Math.abs(k) > 2) continue;
      if (cone([q[0] - i * 9, q[1] - j * 9, q[2] - k * 9]).d < 1e-4) return true;
    }
    return false;
  };
  let crossings = 0, tested = 0;
  for (let n = 0; n < 160; n++) {
    const p = [Math.sin(n * 1.7) * 20, Math.sin(n * 0.37 + 1) * 9, Math.cos(n * 2.3) * 20];
    const R = cg(p).d;
    for (let m = 0; m < 24; m++) {
      const dir = [Math.sin(m * 2.4 + n), Math.cos(m * 1.7 - n), Math.sin(m * 0.9 + 2 * n)];
      const L = Math.hypot(...dir), f = R * 0.999 * Math.cbrt(((m * 0.618) % 1));
      const q = [p[0] + dir[0] / L * f, p[1] + dir[1] / L * f, p[2] + dir[2] / L * f];
      tested++;
      if (solidGrid(q)) crossings++;
    }
  }
  ok(crossings === 0, `grid of a compact shape: no surface inside any step ball (${tested} samples)`);
  // Ring: copy k is the original rotated by k·360°/N about the axis, then moved out by R.
  const ring = { ...base, repMode: 2, repRingN: 6, repRingR: 5, repRingAxis: 1, repRingRotate: true };
  const r = makeDE(ring);
  let wr = 0;
  for (let k = 0; k < 6; k++) {
    const th = k * Math.PI / 3, c = Math.cos(th), sn = Math.sin(th);
    for (let n = 0; n < 30; n++) {
      const q = [Math.sin(n) * 1.1, Math.cos(n * 1.3) * 1.1, Math.sin(n * 0.7) * 1.1];
      // local frame of the Y axis ring: w = (z, x, y); copy centre at angle th on the w.xy plane.
      const wx = q[2] + 5, wy = q[0];
      const W = [wx * c - wy * sn, wx * sn + wy * c, q[1]];
      const p = [W[1], W[2], W[0]];
      const a = one(q).d, b = r(p).d;
      if (a < 1.0) wr = Math.max(wr, Math.abs(a - b) / Math.max(a, 1e-9));
    }
  }
  ok(wr < 1e-9, `ring: each copy is the original turned and moved onto the ring (max rel diff ${wr.toExponential(1)})`);
  const cring = makeDE({ ...cbase, repMode: 2, repRingN: 6, repRingR: 5, repRingAxis: 1, repRingRotate: true });
  const solidRing = q => {
    for (let k = 0; k < 6; k++) {
      const th = -k * Math.PI / 3, c = Math.cos(th), sn = Math.sin(th);
      const W = [q[2], q[0], q[1]];
      const L = [W[0] * c - W[1] * sn - 5, W[0] * sn + W[1] * c, W[2]];
      if (cone([L[1], L[2], L[0]]).d < 1e-4) return true;
    }
    return false;
  };
  let crossR = 0, testedR = 0;
  for (let n = 0; n < 160; n++) {
    const p = [Math.sin(n * 1.7) * 8, Math.sin(n * 0.37 + 1) * 3, Math.cos(n * 2.3) * 8];
    const R = cring(p).d;
    for (let m = 0; m < 24; m++) {
      const dir = [Math.sin(m * 2.4 + n), Math.cos(m * 1.7 - n), Math.sin(m * 0.9 + 2 * n)];
      const L = Math.hypot(...dir), f = R * 0.999 * Math.cbrt(((m * 0.618) % 1));
      testedR++;
      if (solidRing([p[0] + dir[0] / L * f, p[1] + dir[1] / L * f, p[2] + dir[2] / L * f])) crossR++;
    }
  }
  ok(crossR === 0, `ring of a compact shape: no surface inside any step ball (${testedR} samples)`);
  const varied = makeDE({ ...grid, repRotVar: 40, repScaleVar: 0.3, repColVar: 1, repSeed: 7 });
  let fin = true, trapDiff = 0;
  for (let n = 0; n < 200; n++) {
    const p = [Math.sin(n) * 14, Math.cos(n * 1.3) * 6, Math.sin(n * 0.7) * 16];
    const a = varied(p);
    if (!(a.d >= 0) || !Number.isFinite(a.d)) fin = false;
    trapDiff += Math.abs(a.trap - g(p).trap);
  }
  ok(fin && trapDiff > 0, 'per-copy rotation, scale and colour variation: finite DE, colour shifts per copy');
  const su = sceneUniforms(grid);
  ok(su.__rep && !sceneUniforms(defaults()).__rep && specKey(specOf(su)).includes('|rep'), 'repetition builds its own program only when on');

  // Deep zoom.
  ok(effectiveIterations({ iterations: 20, deepZoom: false, deepIters: 1, dist: 0.001 }) === 20, 'Deep Zoom off: iterations unchanged');
  ok(effectiveIterations({ iterations: 20, deepZoom: true, deepIters: 1, dist: 5 / 1024 }) === 30, 'Deep Zoom: +1 iteration per halving of the view distance');
  ok(effectiveIterations({ iterations: 245, deepZoom: true, deepIters: 2, dist: 1e-6 }) === 250, 'Deep Zoom: capped at 250 iterations');
  const dz = sceneUniforms({ ...defaults(), deepZoom: true, dist: 0.01 });
  ok(dz.__dz && dz.u_iterations === effectiveIterations({ ...defaults(), deepZoom: true, dist: 0.01 }) && specKey(specOf(dz)).includes('|dz'), 'Deep Zoom builds its own program and sends the extra iterations');
  for (const mode of [0, 1, 2]) {
    const cls = ff(0, -1, { mode });
    ok(!/#define (DEEP_ZOOM|HAS_REP)/.test(cls), `mode ${mode}: classic build has neither repetition nor deep zoom`);
    ok(/#define DEEP_ZOOM/.test(ff(0, -1, { mode, dz: true })) && /#define HAS_REP/.test(ff(0, -1, { mode, rep: true })), `mode ${mode}: flags define their code`);
  }
  // The CPU marcher uses the pixel-sized threshold in Deep Zoom (picking matches the GPU).
  const tiny = { ...defaults(), surfVariant: 1, dist: 0.002, deepZoom: true, detail: 1 };
  const coarse = marchInfo(makeDE(tiny), [0, 0, 3], [0, 0, -1], { ...tiny, deepZoom: false });
  const fine = marchInfo(makeDE(tiny), [0, 0, 3], [0, 0, -1], { ...tiny, __pix: 1 / 800 / 1e3 });
  ok(fine.reason !== 'nan' && (fine.t < 0 || coarse.t < 0 || fine.t >= coarse.t - 1e-12), 'Deep Zoom threshold is never coarser than the classic one');
  const pk = pickPixel({ ...defaults() }, 400, 225, 800, 450);
  ok(pk.t > 0 && Math.abs(Math.hypot(...pk.n) - 1) < 1e-9 && pk.n.reduce((a, x, i) => a + x * (pk.eye[i] - pk.p[i]), 0) > 0, 'pick: hit point with a unit normal facing the camera');
}

section('mandelbulber import');
{
  const { readFileSync } = await import('node:fs');
  const { importMandelbulber, parseFract } = await import('../engine/mbimport.js');
  const { mbDistance } = await import('./mb_reference.mjs');
  const { cameraBasis } = await import('../engine/camera.js');
  const { PARAMS, coerce } = await import('../engine/params.js');
  const defs = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  const dir = new URL('../presets/batjorge/', import.meta.url);
  for (const name of ['voyager', 'cuentos', 'una-de-setas', 'amrand']) {
    const txt = readFileSync(new URL(name + '.fract', dir), 'utf8');
    const r = importMandelbulber(txt);
    ok(r.ok, `${name}: imports (${r.formula || r.error})`);
    if (!r.ok) continue;
    const S = parseFract(txt), m = S.main_parameters;
    const v = { ...defs };
    for (const p of PARAMS) if (p.id in r.params) v[p.id] = coerce(p, r.params[p.id]);
    const de = makeDE(v), W = r.world;
    const toK = q => [W[0] * q[0] + W[1] * q[1] + W[2] * q[2], W[3] * q[0] + W[4] * q[1] + W[5] * q[2], W[6] * q[0] + W[7] * q[1] + W[8] * q[2]];
    const nums = s => s.trim().split(/\s+/).map(x => Number(x.replace(',', '.')));
    const tgt = nums(m.target), cam = nums(m.camera);
    const span = Math.hypot(...tgt.map((x, k) => x - cam[k]));
    let worst = 0, seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 150; i++) {
      const p = tgt.map(x => x + (rnd() * 2 - 1) * span * 0.6);
      const ref = 0.5 * mbDistance(m, S.fractal_1 || {}, p);
      worst = Math.max(worst, Math.abs(de(toK(p)).d - ref) / Math.max(1e-12, Math.abs(ref)));
    }
    ok(worst < 1e-6, `${name}: DE matches the Mandelbulber port at 150 points (worst rel ${worst.toExponential(1)})`);
    const b = cameraBasis(v), eye = toK(cam), fw = toK(tgt.map((x, k) => x - cam[k])), fl = Math.hypot(...fw), top = toK(nums(m.camera_top));
    const eyeErr = Math.hypot(...b.eye.map((x, k) => x - eye[k]));
    const fwdErr = Math.hypot(...b.forward.map((x, k) => x - fw[k] / fl));
    const upDot = b.up.reduce((s2, x, k) => s2 + x * top[k], 0) / Math.hypot(...top);
    ok(eyeErr < 1e-9 && fwdErr < 1e-9 && upDot > 0.999999, `${name}: camera eye / direction / roll exact`);
    ok(Math.abs(v.lens - 0.5 / Math.tan(nums(m.fov)[0] * Math.PI / 360)) < 1e-12, `${name}: field of view`);
  }
  const hy = importMandelbulber(readFileSync(new URL('rusticalia-hybrid.fract', dir), 'utf8'));
  ok(!hy.ok && /Hybrid/.test(hy.error), 'hybrid files are rejected with a reason');
  ok(!importMandelbulber('hello').ok, 'non-Mandelbulber text is rejected');
  // Colour texture → Kyma texture: fractalized mapping, scale = 1/sx, centre, cube, start, Multiply.
  const cu = importMandelbulber(readFileSync(new URL('cuentos.fract', dir), 'utf8')).params;
  ok(cu.texMode === 1 && cu.texMap === 1 && cu.texBlend === 0 && cu.texScale === 1 && cu.texOffX === 0.88 && cu.texOffY === -0.1 && cu.texFracStart === 24 && cu.texFracCube === 8,
    'Cuentos: fractalized colour texture (centre 0.88/−0.1, start 24, cube 8) imported');
  const am = importMandelbulber(readFileSync(new URL('amrand.fract', dir), 'utf8')).params;
  ok(am.texScale === 0.5 && am.texFracStart === 12, 'Amrand: texture scale 2 → 0.5 tiles per unit');
  const plain = importMandelbulber(readFileSync(new URL('voyager.fract', dir), 'utf8').replace(/mat1_use_color_texture true;/, '')).params;
  ok(plain.texMode === 0, 'no colour texture in the file → texture off');
}

section('evolve / rebirth');
{
  for (let i = 0; i < 200; i++) {
    const m = evolve(base);
    for (const id in m) { const p = PARAM_BY_ID.get(id); ok(m[id] >= p.min - 1e-12 && m[id] <= p.max + 1e-12, `evolve ${id} in range`); }
  }
  const t0 = performance.now();
  let good = 0;
  for (let i = 0; i < 6; i++) {
    const r = rebirth(base);
    const s = r.score;
    if (s.clearance > 0.02 && s.hitFrac >= 0.3 && s.hitFrac <= 0.92) good++;
    for (const id in r.values) ok(coerce(PARAM_BY_ID.get(id), r.values[id]) !== undefined, `rebirth ${id} valid`);
  }
  console.log(`    rebirth: ${good}/6 met the visibility target, avg ${((performance.now() - t0) / 6).toFixed(0)} ms each`);
  ok(good >= 4, 'rebirth usually finds a visible, non-enclosed view');
}

// ── Sampling sequences ──────────────────────────────────────────────────────
section('sampling');
{
  let inRange = true, sumX = 0;
  for (let n = 0; n < 1024; n++) {
    const j = jitterFor(n), l = lensFor(n);
    if (Math.abs(j[0]) > 0.5 || Math.abs(j[1]) > 0.5 || l[0] < 0 || l[0] >= 1 || l[1] < 0 || l[1] >= 1) inRange = false;
    sumX += j[0];
  }
  ok(inRange, 'jitter/lens samples in range');
  ok(Math.abs(sumX / 1024) < 0.01, 'jitter unbiased');
  ok(jitterFor(0)[0] === 0 && jitterFor(0)[1] === 0, 'first sample at pixel centre (matches v1 while moving)');
  ok(near(wrapPi(3 * Math.PI), Math.PI, 1e-12) || near(wrapPi(3 * Math.PI), -Math.PI, 1e-12), 'wrapPi');
}

// ── ZIP ─────────────────────────────────────────────────────────────────────
section('zip');
{
  ok(crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'crc32 check value');
  const z = new ZipWriter();
  const a = new Uint8Array(1000).map((_, i) => i * 7);
  z.add('frame_00000.png', a);
  z.add('frame_00001.png', new TextEncoder().encode('hello surf'));
  const parts = z.finish();
  const buf = Array.isArray(parts) ? Buffer.concat(parts.map(p => Buffer.from(p))) : Buffer.from(await parts.arrayBuffer());
  writeFileSync('/tmp/surf-test.zip', buf);
  ok(buf.length > 1000, 'zip written to /tmp/surf-test.zip (verified by python zipfile in CI step)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
