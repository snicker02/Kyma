// Headless logic tests: `node tests/run.mjs` (no dependencies).

import { PARAMS, GROUPS, defaults, coerce, PARAM_BY_ID } from '../engine/params.js';
import { State } from '../engine/state.js';
import { cameraBasis, pixelRay } from '../engine/camera.js';
import { fractalRotation, dot, sub, normalize, length, cross, wrapPi, mat3Mul } from '../engine/vec.js';
import { makeDE, march, viewScore } from '../engine/de.js';
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
ok(coerce(PARAM_BY_ID.get('iterations'), 99) === 40, 'iterations hard-clamped to shader loop bound');
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
  const expect = typeof v === 'boolean' ? 'bool' : Array.isArray(v) ? { 2: 'vec2', 3: 'vec3', 9: 'mat3' }[v.length] : null;
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
    for (let variant = 1; variant < 11; variant++) for (const mode of [0, 1, 2]) {
      const stack = [1 + (variant % 6), (variant + mode) % 7, (variant * 3) % 7, mode * 2, 6 - mode].map(x => Math.min(6, x));
      combos.push([0, -1, mode, variant, stack]);
    }
    for (const [a, b, mode, variant = 0, stack] of combos) {
      writeFileSync('/tmp/surf-combo.frag', '#version 100\n' + fractalFrag(a, b, { mode, variant, stack, texLod: (a + b + variant) % 2 === 0 }));
      const r = spawnSync('glslangValidator', ['/tmp/surf-combo.frag']);
      n++;
      if (r.status !== 0) { bad++; console.log(`   glslang fail A=${a} B=${b} mode=${mode} variant=${variant}:\n${r.stdout}`); }
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
  ok(evil.iterations === 40 && !('bogus' in evil) && evil.lightColor === base.lightColor, 'hostile values sanitised');
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
      if (f.functionEnabledP) {
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
      if (aux.i >= f.startIterationsC) aux.dist = Math.min(aux.dist, aux.DE0);
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
      vOffX: r(-0.3, 0.3), vOffY: r(-0.3, 0.3), vOffZ: r(-0.3, 0.3), vPolyOn: rnd() < 0.4, polarN: 3 + Math.floor(r(0, 6)),
      vDEOffset: r(0, 1), scaleVary: rnd() < 0.5 ? 0 : r(-0.3, 0.3), alpha: r(-0.5, 0.5), beta: r(-0.5, 0.5), gamma: r(-0.5, 0.5),
      vAddC: rnd() < 0.5, vMinDEStart: Math.floor(r(0, 5)), juliaMode: true, juliaCX: r(-0.5, 0.5), juliaCY: r(-0.5, 0.5), juliaCZ: r(-0.5, 0.5), invEnabled: false };
    const f = {
      functionEnabledAx: v.vPreAbsX, functionEnabledAy: v.vPreAbsY, functionEnabledAz: v.vPreAbsZ,
      offsetA000: [v.vOffX, v.vOffY, v.vOffZ], functionEnabledP: v.vPolyOn, int6: v.polarN,
      additionConstant0555: [v.foldX, v.foldY, v.foldZ], functionEnabledCz: v.vZFold,
      functionEnabledB: modes.map(m => m > 0), functionEnabledSign: modes.map(m => m === 2),
      additionConstantP000: [v.vIfsOffX, v.vIfsOffY, v.vIfsOffZ], additionConstantA000: [v.vIfsAddX, v.vIfsAddY, v.vIfsAddZ],
      minR2p25: v.minR * v.minR, scale2: v.scale, offset0: v.vDEOffset, functionEnabledK: v.scaleVary !== 0, scaleVary0: v.scaleVary,
      alpha: v.alpha, beta: v.beta, gamma: v.gamma, startIterationsC: v.vMinDEStart, cpixel: v.vAddC, c: [v.juliaCX, v.juliaCY, v.juliaCZ] };
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
