// Kyma (formerly Amazing Surf) — application bootstrap and wiring.

import { State } from './engine/state.js';
import { Renderer, sceneUniforms } from './engine/renderer.js';
import { Sequencer, MODE } from './engine/sequencer.js';
import { cameraBasis } from './engine/camera.js';
import { probePixel, makeDE, marchInfo, suggestVolumeShell } from './engine/de.js';
import { ENV_PRESETS, proceduralEnv, imageEnv, looksLikePanorama } from './engine/environment.js';
import { pixelRay } from './engine/camera.js';
import { renderImage, canvasToPngBlob, downloadBlob, stamp, Cancelled } from './engine/export.js';
import { ZipWriter } from './engine/zip.js';
import { gradientSpec, drawGradientPreview, GRADIENTS } from './engine/gradients.js';
const GRADIENT_COUNT = GRADIENTS.length;
import { VideoWriter, pickEncoder, canEncodeVideo, videoBitrate } from './engine/video.js';
import { FOLD_NAMES, SURF_VARIANTS as SURF_VARIANT_NAMES, defaults as paramDefaults, PARAMS } from './engine/params.js';
const PARAM_DEF = paramDefaults();
import { VARIANT_DEFAULTS, VARIANT_DESC } from './engine/presets.js';
import { BIOMES, evolve, rebirth, encodeDiscovery, decodeDiscovery, makeProject, parseProject } from './engine/presets.js';
import { wrapPi, clamp } from './engine/vec.js';
import { Panel } from './ui/panel.js';

export const VERSION = '2.12.0';

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const canvas = $('view');
const state = new State();
const seq = new Sequencer();
let renderer;

function fatal(msg) {
  const d = el('div', 'fatal', msg);
  document.body.append(d);
}

// The canvas fills the centre cell between the docks; size from layout, not window.
const stageSize = () => [Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight)];

try {
  [canvas.width, canvas.height] = stageSize();
  renderer = new Renderer(canvas);
} catch (e) {
  console.error(e);
  fatal('Kyma could not start WebGL.\n\n' + e.message);
  throw e;
}

$('ver').textContent = 'v' + VERSION;
const panel = new Panel({ left: $('groupsLeft'), right: $('groupsRight') }, state);

// ── Toast / progress ─────────────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.opacity = '0'), ms);
}

let busy = false, cancelRequested = false;
function showProgress(label) {
  cancelRequested = false;
  $('progressLabel').textContent = label;
  $('progressFill').style.width = '0%';
  $('progress').classList.remove('hidden');
}
const setProgress = f => ($('progressFill').style.width = (f * 100).toFixed(1) + '%');
const hideProgress = () => $('progress').classList.add('hidden');
$('progressCancel').addEventListener('click', () => { cancelRequested = true; });

// ── Undo / redo ──────────────────────────────────────────────────────────────
const undoStack = [], redoStack = [];
let undoBtn, redoBtn;
function pushHistory() {
  undoStack.push(state.snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  syncUndoButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(state.snapshot());
  state.setMany(undoStack.pop(), 'history');
  syncUndoButtons();
  toast('Undo');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(state.snapshot());
  state.setMany(redoStack.pop(), 'history');
  syncUndoButtons();
  toast('Redo');
}
function syncUndoButtons() {
  if (undoBtn) undoBtn.disabled = !undoStack.length;
  if (redoBtn) redoBtn.disabled = !redoStack.length;
}

// ── Sequencer UI ─────────────────────────────────────────────────────────────
const seqGroup = panel.group('seq');
const seqTop = el('div', 'grid');
seqTop.style.gap = '10px';
const addKeyBtn = el('button', 'action-btn sm', 'Add Keyframe');
const clearKeyBtn = el('button', 'action-btn sm danger', 'Clear All');
const keyRow = el('div', 'grid grid-2');
keyRow.append(addKeyBtn, clearKeyBtn);
const playBtn = el('button', 'action-btn primary', 'Play Sequence');
const timeline = el('div', 'seq-bar');
const seqProg = el('div', 'seq-progress', '<div></div>');
const seqHint = el('div', 'seq-hint', 'click = load · shift-click = delete · alt-click = overwrite with current');
const seqInfo = el('div', 'seq-info');
seqTop.append(keyRow, playBtn, timeline, seqProg, seqHint, seqInfo);
seqGroup.prepend(seqTop);

// Video & frames export: settings are params (panel builds them); this adds the
// buttons and a live summary of what Record will produce.
const videoGroup = panel.group('video');
const recBlock = el('div', 'grid');
recBlock.style.gap = '8px';
const recInfo = el('div', 'seq-info');
const recBtn2 = el('button', 'action-btn primary', '● Record Video');
const framesBtn = el('button', 'action-btn sm', 'Render PNG Frames (.zip)');
const recNote = el('div', 'seq-hint', '');
recNote.style.marginTop = '0';
recBlock.append(recBtn2, recInfo, framesBtn, recNote);
videoGroup.prepend(recBlock);

let currentDot = -1;
function rebuildTimeline() {
  timeline.innerHTML = '';
  if (!seq.length) timeline.append(el('span', 'seq-empty', 'No keyframes yet'));
  seq.keys.forEach((_, i) => {
    const d = el('div', 'seq-dot', String(i + 1));
    d.title = `Key ${i + 1}`;
    d.addEventListener('click', e => {
      if (e.shiftKey) { seq.remove(i); rebuildTimeline(); toast(`Key ${i + 1} deleted`); return; }
      if (e.altKey) { seq.replace(i, state.sceneSnapshot()); toast(`Key ${i + 1} overwritten`); return; }
      seq.stop();
      pushHistory();
      state.setMany(seq.keys[i], 'key');
      currentDot = i;
      syncSeqUI();
    });
    timeline.append(d);
  });
  syncSeqUI();
}
function syncSeqUI() {
  const v = state.values;
  const dur = seq.duration(v.seqDuration, v.seqMode);
  seqInfo.textContent = `${seq.length} key${seq.length === 1 ? '' : 's'} · ${dur.toFixed(1)} s total`;
  playBtn.textContent = seq.playing ? '■ Stop' : '▶ Play Sequence';
  seqProg.firstChild.style.width = (seq.playing ? seq.progress(v.seqDuration, v.seqMode) * 100 : 0) + '%';
  if (seq.playing) currentDot = Math.round(seq.position(seq.time, v.seqDuration, v.seqMode)) % Math.max(1, seq.length);
  [...timeline.children].forEach((d, i) => d.classList.toggle('current', i === currentDot));
  if (!seq.playing) syncRecInfo();
}
function addKeyframe() {
  seq.add(state.sceneSnapshot());
  currentDot = seq.length - 1;
  rebuildTimeline();
  toast(`Keyframe ${seq.length} added`);
}
function togglePlay() {
  if (recorder && recSeq) { stopRecording(); return; } // stopping playback ends a sequence recording
  if (seq.playing) { seq.stop(); syncSeqUI(); return; }
  if (!seq.play()) toast('Add 2+ keyframes');
  syncSeqUI();
}
addKeyBtn.addEventListener('click', addKeyframe);
clearKeyBtn.addEventListener('click', () => { seq.clear(); currentDot = -1; rebuildTimeline(); toast('Cleared'); });
playBtn.addEventListener('click', togglePlay);
state.onChange(id => {
  if (id === 'seqDuration' || id === 'seqMode') syncSeqUI();
  if (id == null || /^(rec|seq)/.test(id)) syncRecInfo();
});
rebuildTimeline();

// ── View / style extras ──────────────────────────────────────────────────────
const resetViewBtn = el('button', 'action-btn', 'Reset View');
resetViewBtn.addEventListener('click', () => {
  pushHistory();
  state.setMany({ rotX: 0, rotY: 0, rollX: 0, rollY: 0, rollZ: 0, dist: 5, lens: 1, targetX: 0, targetY: 0, targetZ: 0 });
});
panel.group('view').append(resetViewBtn);

const PRESET_RESET = Object.fromEntries(PARAMS
  .filter(p => /^(colorSource|foldColW|sphColW|colorIters|gradRepeat|gradWrap|gradReverse|gradHue|gradSat)$/.test(p.id))
  .map(p => [p.id, p.def]));
// Presets dropdown, grouped by engine. Picking one applies it (undoable); the
// list then shows its name until you pick another.
const presetSel = el('select', 'preset-select');
presetSel.id = 'presetSelect';
presetSel.append(Object.assign(el('option', '', `Choose a preset (${Object.keys(BIOMES).length})…`), { value: '', disabled: true, selected: true }));
const presetGroups = [
  ['Classic engine', k => !BIOMES[k].group && !BIOMES[k].v.surfVariant],
  ['Mandelbulber Amazing Surf', k => !BIOMES[k].group && !!BIOMES[k].v.surfVariant],
  ['Amazing IFS', k => BIOMES[k].group === 'ifs'],
];
for (const [label, test] of presetGroups) {
  const og = el('optgroup');
  og.label = label;
  for (const key in BIOMES) if (test(key)) og.append(Object.assign(el('option', '', BIOMES[key].label), { value: key }));
  if (og.children.length) presetSel.append(og);
}
presetSel.addEventListener('change', () => {
  const b = BIOMES[presetSel.value];
  if (!b) return;
  pushHistory();
  // Colouring controls added after a preset was written would otherwise keep
  // whatever the previous scene had (e.g. fold-count stripes leaking into
  // Crimson Chalice), so reset them to defaults unless the preset sets them.
  // The ground is staging and is left as you set it.
  state.setMany({ ...PRESET_RESET, ...b.v });
  toast(`Preset: ${b.label}`);
});
panel.group('presets').append(presetSel);

// Gradient preview strip: the actual LUT (after Wrap / Reverse / Hue / Saturation),
// one period. Click it to step to the next gradient.
const gradPreview = el('canvas', 'grad-preview');
gradPreview.width = 256; gradPreview.height = 12;
gradPreview.title = 'Gradient preview (one period) — click for the next gradient';
panel.controls.get('palette').wrap.after(gradPreview);
const syncGradPreview = () => drawGradientPreview(gradPreview, gradientSpec(state.values));
gradPreview.addEventListener('click', () => {
  pushHistory();
  const n = GRADIENT_COUNT;
  state.set('palette', ((state.values.palette | 0) + 1) % n);
});
state.onChange(id => { if (id == null || id === 'palette' || /^grad/.test(id)) syncGradPreview(); });
syncGradPreview();

// ── Surf variant ────────────────────────────────────────────────────────────
const variantDesc = el('div', 'fold-desc');
panel.controls.get('surfVariant').wrap.after(variantDesc);
const variantDefaultsBtn = el('button', 'action-btn sm', 'Load Variant Defaults');
variantDefaultsBtn.title = "Reset this formula's parameters to Mandelbulber's defaults (converted to this app's units)";
variantDesc.after(variantDefaultsBtn);
panel.gateNode(variantDefaultsBtn, { gate: 'surfVariant', gateEq: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
const syncVariantDesc = () => { variantDesc.textContent = VARIANT_DESC[state.get('surfVariant')]; };
function loadVariantDefaults(announce) {
  const vi = state.get('surfVariant');
  state.setMany(VARIANT_DEFAULTS[vi] || {});
  if (announce) toast(`${SURF_VARIANT_NAMES[vi]} defaults loaded (Ctrl+Z undoes)`, 3000);
}
variantDefaultsBtn.addEventListener('click', () => { pushHistory(); loadVariantDefaults(true); });
// Picking a variant from the dropdown loads its defaults: they are different
// formulas, and Mandelbulber's defaults are where each one looks right.
let variantPrev = state.get('surfVariant');
state.onChange((id, v, src) => {
  if (id !== 'surfVariant') return;
  syncVariantDesc();
  if (src === 'ui' && v !== 0) {
    const snap = { ...state.values, surfVariant: variantPrev };
    undoStack.push(snap); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; syncUndoButtons();
    loadVariantDefaults(true);
  }
  variantPrev = v;
});
syncVariantDesc();

const FOLD_DESC = [
  'Classic Mandelbox box fold on all three axes. Fold Weight adds Tglad smoothing.',
  'Inverted box: reflects the space about the fold limit, giving pillowed cells.',
  'Double-reflection fold around ±2. Ridged and terraced.',
  'The reference Mandelbulber Amazing Surf: folds X and Y only, leaving Z alone. Sheet-like and surfing.',
  'Sierpinski tetrahedral mirror symmetry, then a box fold. Triangular, pyramidal motifs.',
  'Octahedral symmetry (abs + axis sort, as in the Menger sponge), then a box fold. Cubic and stepped.',
  'Icosahedral (Knighty three-plane) symmetry, then a box fold. Five-fold, quasi-crystal structure.',
  'Polar kaleidoscope: mirrors space into N angular sectors around Z (Polar Sectors), then an XY box fold. Mandala and rosette forms.',
  'Smooth box fold, 2f·tanh(z/f) − z: the box fold with its creases rounded off. Soft and organic, with no hard seams.',
  'Abs Shift: the Kali kaleidoscopic IFS step, abs(z) − limit. Crystalline and lacy, and very sensitive to the fold limits.',
  'Box fold in a frame rotated 45° about Z. Diamond and lozenge lattices.',
];
const foldDesc = el('div', 'fold-desc');
panel.controls.get('foldType').wrap.after(foldDesc);
panel.gateNode(foldDesc, { gate: 'surfVariant', gateEq: 0 });
const syncFoldDesc = () => {
  const a = state.get('foldType'), b = state.get('foldType2') - 1;
  foldDesc.textContent = FOLD_DESC[a] + (b >= 0 && b !== a ? ` Hybrid: every ${state.get('hybridPeriod')}${['', 'st', 'nd', 'rd'][state.get('hybridPeriod')] ?? 'th'} iteration uses ${FOLD_NAMES[b]}.` : '');
};
state.onChange(id => { if (id === 'foldType' || id === 'foldType2' || id === 'hybridPeriod') syncFoldDesc(); });
syncFoldDesc();

// ── Environment source ──────────────────────────────────────────────────────
let envInfo = null; // { name, kind: 'preset'|'image', key?, dataUrl?, aspect }
// ── Ground plane ─────────────────────────────────────────────────────────────
// Picking a ground type loads that type's starting colours / terrain (undoable),
// and "Place Under Fractal" drops the plane to the bottom of the object with
// the base slightly sunk in, the way objects sit in a meadow or a bay.
const GROUND_DEFAULTS = {
  1: { groundColor: '#8a8578', groundFade: 0.2 },
  2: { groundColor: '#3d5a22', groundColor2: '#7f9a3a', groundScale: 1, groundBump: 0.4, groundFade: 0.35 },
  3: { groundColor: '#c9a66b', groundColor2: '#e8d3a0', groundScale: 1, groundBump: 0.6, groundFade: 0.35 },
  4: { groundColor: '#5a5650', groundColor2: '#8a857a', groundScale: 1, groundBump: 0.8, groundFade: 0.3 },
  5: { groundColor: '#0b2a3a', groundScale: 1, groundBump: 0.25, groundReflect: 0.9, groundRough: 0.03, groundFade: 0.3 },
  6: { groundColor: '#ffffff', groundReflect: 0.85, groundRough: 0, groundFade: 0.2 },
  7: { groundColor: '#2a2a2e', groundColor2: '#d8d8dc', groundScale: 1, groundFade: 0.25 },
};
let lastGroundType = state.values.groundType | 0;
state.onChange((id, _v, src) => {
  if (id !== 'groundType') return;
  const g = state.values.groundType | 0;
  // Only when you pick it in the panel (not presets, projects, undo or keys).
  if (src === 'ui' && g !== lastGroundType && GROUND_DEFAULTS[g]) {
    pushHistory();
    state.setMany(GROUND_DEFAULTS[g]);
  }
  lastGroundType = g;
});
// Vertical extent of the fractal around the view target (CPU DE, including the
// object transform): vertical rays up from below and down from above.
function objectSpan() {
  const v = state.values;
  const map = makeDE(v);
  const cx = v.targetX, cy = v.targetY, cz = v.targetZ;
  const R = Math.max(0.5, v.dist * 0.45);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 11; i++) for (let k = 0; k < 11; k++) {
    const x = cx + (i / 10 - 0.5) * 2 * R, z = cz + (k / 10 - 0.5) * 2 * R;
    const up = marchInfo(map, [x, cy - 2.5 * R, z], [0, 1, 0], { ...v, maxDist: 5 * R, missAsHit: false });
    if (up.reason === 'hit') lo = Math.min(lo, cy - 2.5 * R + up.t);
    const dn = marchInfo(map, [x, cy + 2.5 * R, z], [0, -1, 0], { ...v, maxDist: 5 * R, missAsHit: false });
    if (dn.reason === 'hit') hi = Math.max(hi, cy + 2.5 * R - dn.t);
  }
  return isFinite(lo) ? { lo, hi } : null;
}
function groundUnderFractal() {
  const span = objectSpan();
  if (!span) { toast('No surface found under the view — frame the object first', 3000); return; }
  const { lo, hi } = span, v = state.values;
  pushHistory();
  const y = lo + 0.08 * Math.max(0, hi - lo);
  state.setMany({ groundY: +y.toFixed(3), groundType: (v.groundType | 0) || 2 });
  toast(`Ground at y = ${y.toFixed(2)} (object spans ${lo.toFixed(2)} … ${hi.toFixed(2)})`, 3000);
}
{
  const g = panel.group('ground');
  const btn = el('button', 'action-btn sm', 'Place Under Fractal');
  btn.title = 'Find the bottom of the object in view and put the ground there';
  btn.addEventListener('click', groundUnderFractal);
  const reset = el('button', 'action-btn sm', 'Level Plane');
  reset.title = 'Zero the tilt, spin and slide';
  reset.addEventListener('click', () => { pushHistory(); state.setMany({ groundTiltX: 0, groundTiltZ: 0, groundYaw: 0, groundOffX: 0, groundOffZ: 0 }); });
  const row = el('div', 'grid grid-2');
  row.append(btn, reset);
  const note = el('div', 'seq-hint', 'Grass, sand and rock are procedural textures with optional hills; water and mirror reflect the fractal. Path Traced mode gives the ground real bounce light.');
  note.style.marginTop = '0';
  g.append(row, note);
}

// Object transform buttons: drop the object onto the ground (keeps the plane
// where it is) and reset.
{
  const g = panel.group('object');
  const drop = el('button', 'action-btn sm', 'Drop onto Ground');
  drop.title = 'Move the object up or down so its base sits just into the ground plane';
  drop.addEventListener('click', () => {
    const v = state.values;
    if (!(v.groundType | 0)) { toast('Turn on a ground first (Ground Plane panel)', 2500); return; }
    const span = objectSpan();
    if (!span) { toast('No surface found near the view target', 2500); return; }
    pushHistory();
    const sink = 0.08 * Math.max(0, span.hi - span.lo);
    state.set('objY', +(v.objY + (v.groundY - sink) - span.lo).toFixed(3));
    toast('Object dropped onto the ground', 1800);
  });
  const reset = el('button', 'action-btn sm', 'Reset Object');
  reset.addEventListener('click', () => { pushHistory(); state.setMany({ objX: 0, objY: 0, objZ: 0, objRotX: 0, objRotY: 0, objRotZ: 0, objScale: 1 }); });
  const row = el('div', 'grid grid-2');
  row.append(drop, reset);
  const note = el('div', 'seq-hint', 'Moves, turns and scales the fractal itself. The camera, light and ground stay put; the formula and colours are unchanged.');
  note.style.marginTop = '0';
  g.append(row, note);
}

const envGroup = panel.group('env');
const envSrcHead = el('div', 'sub-head', '<span>Image Source</span>');
const envSrcLabel = el('span', 'gate-badge off', 'NONE');
envSrcHead.append(envSrcLabel);
const envPresetGrid = el('div', 'grid grid-2');
for (const key in ENV_PRESETS) {
  const b = el('button', 'biome-btn', ENV_PRESETS[key]);
  b.addEventListener('click', () => applyEnv(proceduralEnv(key), 2));
  envPresetGrid.append(b);
}
const envLoadBtn = el('button', 'action-btn sm', 'Load Image…');
const envClearBtn = el('button', 'action-btn sm danger', 'Clear');
const envFile = el('input'); envFile.type = 'file'; envFile.accept = 'image/*'; envFile.hidden = true;
const envNote = el('div', 'seq-hint', 'Tip: drop an image on the viewer. 2:1 images load as a 360° panorama; any other shape loads as a backdrop.');
envNote.style.marginTop = '-6px';
envGroup.prepend(envSrcHead, envPresetGrid, row2(envLoadBtn, envClearBtn), envNote, envFile);
function row2(a, b) { const r = el('div', 'grid grid-2'); r.append(a, b); return r; }

function applyEnv(env, modeIfOff) {
  renderer.setEnvironment(env.canvas, env.aspect);
  envInfo = { name: env.name, kind: env.kind, key: env.key, aspect: env.aspect, canvas: env.canvas };
  envSrcLabel.textContent = env.name.length > 18 ? env.name.slice(0, 16) + '…' : env.name;
  envSrcLabel.className = 'gate-badge on';
  state.set('envMode', modeIfOff); // presets & 2:1 images → panorama, other images → backdrop
  state.bump();
  toast(`Environment: ${env.name}`);
}
function clearEnv() {
  renderer.setEnvironment(null);
  envInfo = null;
  envSrcLabel.textContent = 'NONE';
  envSrcLabel.className = 'gate-badge off';
  state.set('envMode', 0);
  state.bump();
}
async function loadEnvImage(file) {
  try {
    const env = await imageEnv(file, renderer.maxTex);
    applyEnv(env, looksLikePanorama(env.aspect) ? 2 : 1);
  } catch (e) { toast(e.message, 3000); }
}
envLoadBtn.addEventListener('click', () => envFile.click());
envFile.addEventListener('change', () => { const f = envFile.files[0]; envFile.value = ''; if (f) loadEnvImage(f); });
envClearBtn.addEventListener('click', () => { clearEnv(); toast('Environment cleared'); });
$('stage').addEventListener('dragover', e => { e.preventDefault(); });
$('stage').addEventListener('drop', e => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
  if (f) loadEnvImage(f);
});
state.onChange((id, v) => { if (id === 'envMode' && v > 0 && !envInfo) applyEnv(proceduralEnv('studio'), v); });

// ── Auto-fix cut-offs ───────────────────────────────────────────────────────
// Rays that exhaust Max Ray Steps are drawn as background ("cut-off"). This
// usually means the DE plateaus just above the hit threshold, so we probe the
// current view on the CPU and lower Surface Detail until rays converge.
const fixBtn = el('button', 'action-btn sm primary', 'Auto-fix Cut-offs');
const fixNote = el('div', 'seq-hint', 'Probes the current view and lowers Surface Detail until rays stop running out of steps. Debug View → Miss Reason shows stranded rays in red.');
fixNote.style.marginTop = '-6px';
panel.controls.get('maxSteps').wrap.before(fixBtn, fixNote);
function strandedFraction(v) {
  const cam = cameraBasis(v), map = makeDE(v);
  const GX = 24, GY = 14;
  let stranded = 0;
  const cv = { ...v, missAsHit: false };
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const rd = pixelRay(cam, v.lens, (i + 0.5) / GX * canvas.width, (j + 0.5) / GY * canvas.height, canvas.width, canvas.height);
    if (marchInfo(map, cam.eye, rd, cv).reason === 'stranded') stranded++;
  }
  return stranded / (GX * GY);
}
fixBtn.addEventListener('click', () => {
  const v = { ...state.values };
  const before = strandedFraction(v);
  if (before < 0.03) { toast(`Only ${(before * 100).toFixed(0)}% of rays stranded — nothing to fix`, 3000); return; }
  pushHistory();
  let det = v.detail, frac = before;
  for (const cand of [0.5, 0.35, 0.25, 0.15, 0.1, 0.05]) {
    if (cand >= det) continue;
    det = cand;
    frac = strandedFraction({ ...v, detail: det });
    if (frac < 0.03) break;
  }
  state.set('detail', det);
  toast(`Stranded rays ${(before * 100).toFixed(0)}% → ${(frac * 100).toFixed(0)}% (Surface Detail ${det})`, 4000);
});

const modeNote = el('div', 'seq-hint');
modeNote.style.marginTop = '-6px';
const MODE_NOTES = [
  'Direct lighting, fastest. Debug views and Auto-fix apply here.',
  'Global illumination: bounced light, soft shadows, the environment image as the light source. Previews as Surface while you move, then converges when you stop. Raise Live Max Samples / Export Samples for clean results. Uses the filmic tone curve.',
  'Renders the distance field as glowing fog: solid shapes become luminous shells and "dust" settings become clouds. Shell Thickness sets how far the glow reaches from the surface.',
];
panel.controls.get('renderMode').wrap.after(modeNote);
const syncModeNote = () => { modeNote.textContent = MODE_NOTES[state.get('renderMode')]; };
state.onChange(id => { if (id === 'renderMode') syncModeNote(); });
syncModeNote();

// Volumetric: fit the glow shell to this scene's distance scale.
const shellBtn = el('button', 'action-btn sm primary', 'Auto Shell from View');
shellBtn.title = 'Measures the distance field along view rays and sets Shell Thickness, Density and Min Step to suit it';
panel.controls.get('volDensity').wrap.before(shellBtn);
panel.gateNode(shellBtn, { gate: 'renderMode', gateEq: 2 });
function autoShell(announce = true) {
  const r = suggestVolumeShell(state.values);
  state.setMany({ volThick: Number(r.volThick.toPrecision(3)), volDensity: Number(r.volDensity.toPrecision(3)), volStepMin: Number(r.volStepMin.toPrecision(3)) });
  if (announce) toast(r.kind === 'dust'
    ? `Dust field (DE plateau ≈ ${r.median.toExponential(1)}): shell ${r.volThick.toPrecision(2)}`
    : 'Solid surface: standard glow shell', 3500);
}
shellBtn.addEventListener('click', () => { pushHistory(); autoShell(); });
// First switch into Volumetric with an untouched shell: fit it automatically.
state.onChange((id, v, src) => {
  if (id === 'renderMode' && v === 2 && src === 'ui' && state.get('volThick') === PARAM_DEF.volThick) autoShell();
});

const fmtNote = el('div', 'seq-hint');
fmtNote.style.marginTop = '0';
fmtNote.textContent = `Accumulation buffer: ${renderer.fmt.name}` + (renderer.fmt.maxSamples < 64 ? ` (8-bit fallback — samples capped at ${renderer.fmt.maxSamples})` : '');
panel.group('quality').append(fmtNote);

// ── Footer: evolve / rebirth / history / discovery / project ────────────────
const evolveBtn = el('button', 'action-btn', '✨ Evolve');
const rebirthBtn = el('button', 'action-btn', '🌀 Rebirth');
undoBtn = el('button', 'action-btn sm', '↶ Undo');
redoBtn = el('button', 'action-btn sm', '↷ Redo');
const copyBtn = el('button', 'action-btn solid', 'Copy Discovery String');
const loadBtn = el('button', 'action-btn sm', 'Load String');
const resetAllBtn = el('button', 'action-btn sm danger', 'Reset All');
const saveProjBtn = el('button', 'action-btn sm', 'Save Project');
const openProjBtn = el('button', 'action-btn sm', 'Open Project');
const row = (...b) => { const r = el('div', 'grid grid-2'); r.append(...b); return r; };
$('footLeft').append(row(evolveBtn, rebirthBtn), row(undoBtn, redoBtn));
$('footRight').append(copyBtn, row(loadBtn, resetAllBtn), row(saveProjBtn, openProjBtn));
syncUndoButtons();

evolveBtn.addEventListener('click', () => {
  pushHistory();
  const m = evolve(state.values);
  state.setMany(m);
  toast(`Evolved ${Object.keys(m).length} genes`);
});
rebirthBtn.addEventListener('click', () => {
  pushHistory();
  const r = rebirth(state.values);
  state.setMany(r.values);
  toast(`Rebirth · ${Math.round(r.score.hitFrac * 100)}% surface in view`);
});
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
resetAllBtn.addEventListener('click', () => { pushHistory(); state.resetAll(); toast('Reset to defaults'); });

const dlg = $('discDialog');
function openDiscDialog(title, text, readOnly) {
  $('discTitle').textContent = title;
  $('discText').value = text;
  $('discText').readOnly = !!readOnly;
  $('discLoad').style.display = readOnly ? 'none' : '';
  dlg.showModal();
  if (readOnly) $('discText').select(); else $('discText').focus();
}
copyBtn.addEventListener('click', async () => {
  const s = encodeDiscovery(state.values);
  try {
    await navigator.clipboard.writeText(s);
    toast('Discovery string copied');
  } catch {
    openDiscDialog('Discovery String (copy it)', s, true);
  }
});
loadBtn.addEventListener('click', () => openDiscDialog('Load Discovery String', '', false));
$('discClose').addEventListener('click', () => dlg.close());
$('discLoad').addEventListener('click', () => {
  try {
    const text = $('discText').value;
    const j = text.trim().startsWith('{') ? JSON.parse(text) : null;
    pushHistory();
    if (j && Array.isArray(j.keyframes)) {
      const p = parseProject(text);
      state.setMany(p.params);
      seq.fromJSON(p.keyframes);
      rebuildTimeline();
    } else {
      state.setMany(decodeDiscovery(text));
    }
    dlg.close();
    toast('Loaded');
  } catch (e) {
    console.error(e);
    toast('Could not read that string');
  }
});

saveProjBtn.addEventListener('click', () => {
  const proj = makeProject(state.values, seq.toJSON());
  if (envInfo) {
    proj.environment = envInfo.kind === 'preset'
      ? { kind: 'preset', key: envInfo.key }
      : { kind: 'image', name: envInfo.name, aspect: envInfo.aspect, dataUrl: envInfo.canvas.toDataURL('image/jpeg', 0.9) };
  }
  const json = JSON.stringify(proj, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), `kyma-project-${stamp()}.json`);
  toast('Project saved');
});
openProjBtn.addEventListener('click', () => $('projectFile').click());
$('projectFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    const p = parseProject(text);
    pushHistory();
    state.setMany(p.params);
    seq.fromJSON(p.keyframes);
    rebuildTimeline();
    const envJ = JSON.parse(text).environment;
    if (envJ?.kind === 'preset' && ENV_PRESETS[envJ.key]) applyEnv(proceduralEnv(envJ.key), p.params.envMode || 2);
    else if (envJ?.kind === 'image' && typeof envJ.dataUrl === 'string' && envJ.dataUrl.startsWith('data:image/')) {
      const env = await imageEnv(envJ.dataUrl, renderer.maxTex, envJ.name || 'Image');
      env.aspect = Number(envJ.aspect) || env.aspect;
      applyEnv(env, p.params.envMode || 2);
    } else if (envInfo && !envJ) clearEnv();
    state.set('envMode', p.params.envMode);
    toast(`Project loaded · ${seq.length} keys`);
  } catch (err) {
    console.error(err);
    toast('Not a valid project file');
  }
});

// Shared link: index.html#SURF2:...
if (location.hash.startsWith('#SURF2:')) {
  try { state.setMany(decodeDiscovery(decodeURIComponent(location.hash.slice(1)))); toast('Loaded from link'); }
  catch { toast('Bad discovery link'); }
}

// ── Panel chrome ─────────────────────────────────────────────────────────────
const app = $('app');
const DOCK_KEY = 'kyma.docks';
const OLD_DOCK_KEY = 'amazing-surf.docks'; // pre-rename layouts still load
function saveDocks() {
  try { localStorage.setItem(DOCK_KEY, JSON.stringify({ left: !app.classList.contains('no-left'), right: !app.classList.contains('no-right') })); } catch { /* storage unavailable */ }
}
function setDock(side, open) {
  app.classList.toggle(side === 'left' ? 'no-left' : 'no-right', !open);
  if (window.innerWidth <= 900 && open) app.classList.add(side === 'left' ? 'no-right' : 'no-left'); // one drawer at a time
  if (open) document.body.classList.remove('ui-hidden');
  saveDocks();
}
const dockOpen = side => !app.classList.contains(side === 'left' ? 'no-left' : 'no-right');
document.querySelectorAll('[data-dock]').forEach(b => b.addEventListener('click', () => setDock(b.dataset.dock, !dockOpen(b.dataset.dock))));
function toggleUIHidden() {
  const hide = !document.body.classList.contains('ui-hidden');
  document.body.classList.toggle('ui-hidden', hide);
  app.classList.toggle('no-left', hide);
  app.classList.toggle('no-right', hide);
  if (!hide) saveDocks();
}
// Initial dock state: remembered on desktop, closed drawers on narrow screens.
if (window.innerWidth <= 900) { app.classList.add('no-left', 'no-right'); }
else {
  try {
    const d = JSON.parse(localStorage.getItem(DOCK_KEY) || localStorage.getItem(OLD_DOCK_KEY) || 'null');
    if (d) { app.classList.toggle('no-left', !d.left); app.classList.toggle('no-right', !d.right); }
  } catch { /* ignore */ }
}

// ── Pulse / effective scale ──────────────────────────────────────────────────
const effectiveScale = (v, ms) => (v.pulse ? v.scale + Math.sin(ms * 0.002) * 0.3 : v.scale);

// ── Exports ──────────────────────────────────────────────────────────────────
const RES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160], '8k': [7680, 4320] };
function exportSize() {
  const r = $('saveRes').value;
  return RES[r] ?? stageSize(); // viewport = the centre viewer
}
// Video / PNG-frame size from the Video & Frames settings. Encoders need even
// dimensions (4:2:0 chroma), so round down to even.
const REC_RES = [null, 'viewport', '720p', '1080p', '1440p', '4k'];
const REC_FPS = [24, 30, 60];
const REALTIME_MAX = 2560 * 1440; // live capture above this risks the GPU watchdog
function recordSize(realtime = false) {
  const v = state.values;
  const key = REC_RES[v.recRes | 0];
  let [W, H] = key === null ? exportSize() : RES[key] ?? stageSize();
  let capped = false;
  if (realtime && W * H > REALTIME_MAX) {
    const k = Math.sqrt(REALTIME_MAX / (W * H));
    W = Math.floor(W * k); H = Math.floor(H * k); capped = true;
  }
  return { W: Math.max(2, W & ~1), H: Math.max(2, H & ~1), capped };
}
const recFps = () => REC_FPS[state.values.recFps | 0] ?? 30;
function seqFrameCount(fps) {
  const v = state.values;
  const dur = seq.duration(v.seqDuration, v.seqMode);
  return Math.max(1, Math.round(dur * fps) + (v.seqMode === MODE.LOOP ? 0 : 1));
}
function syncRecInfo() {
  if (!recInfoReady) return; // called during start-up before the export section has run
  const v = state.values, fps = recFps();
  const offline = v.recMode === 1 && seq.length >= 2;
  const { W, H, capped } = recordSize(!offline);
  const mbps = (videoBitrate(W, H, fps, v.recQuality | 0) / 1e6).toFixed(1);
  const fmt = v.recFormat === 1 ? 'WebM' : 'MP4';
  if (offline) {
    const n = seqFrameCount(fps);
    recInfo.textContent = `Offline · ${W}×${H} · ${fps} fps · ${n} frames · ${v.recSamples} spp · ${fmt} ~${mbps} Mb/s`;
    recNote.textContent = 'Frame-exact: every frame fully rendered, plays at the right speed. Same size, rate and samples apply to PNG Frames.';
  } else {
    recInfo.textContent = `Real-time · ${W}×${H}${capped ? ' (capped)' : ''} · ${fps} fps · ${fmt} ~${mbps} Mb/s`;
    recNote.textContent = v.recMode === 1
      ? 'Offline needs 2+ keyframes — without them Record captures the live view in real time.'
      : 'Captures the viewer as it plays (1 sample per moving frame). Real-time is capped at 1440p; use Offline for 4K and clean path-traced frames.';
  }
}
var recInfoReady = true;
$('saveRes').addEventListener('change', syncRecInfo);
new ResizeObserver(() => syncRecInfo()).observe(canvas);

async function saveImage() {
  if (busy) return;
  const [W, H] = exportSize();
  const v = { ...state.values };
  busy = true;
  showProgress(`Rendering ${W}×${H} · ${Math.min(v.exportSamples, renderer.sampleCap)} spp`);
  try {
    const scene = sceneUniforms(v, effectiveScale(v, performance.now()));
    const out = await renderImage(renderer, scene, W, H, v.exportSamples, { onProgress: setProgress, isCancelled: () => cancelRequested });
    downloadBlob(await canvasToPngBlob(out), `kyma-${W}x${H}-${stamp()}.png`);
    toast('Saved');
  } catch (e) {
    if (e instanceof Cancelled) toast('Cancelled');
    else { console.error(e); toast('Save failed: ' + e.message, 4000); }
  } finally {
    busy = false;
    hideProgress();
    renderer.resetLive();
  }
}
$('saveImg').addEventListener('click', saveImage);

async function renderFrames() {
  if (busy) return;
  if (seq.length < 2) { toast('Add 2+ keyframes'); return; }
  seq.stop();
  const v = { ...state.values };
  const { W, H } = recordSize();
  const fps = recFps();
  const frames = seqFrameCount(fps);
  const spp = Math.min(v.recSamples, renderer.sampleCap);
  if (!confirm(`Render ${frames} frames at ${W}×${H}, ${spp} spp each?\nThe .zip downloads when finished.`)) return;
  busy = true;
  showProgress(`Frames 0 / ${frames}`);
  const zip = new ZipWriter();
  try {
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const fv = { ...v, ...seq.sample(t, v.seqDuration, v.seqMode, v.seqEasing) };
      const scene = sceneUniforms(fv, effectiveScale(fv, t * 1000));
      $('progressLabel').textContent = `Frame ${f + 1} / ${frames} · ${W}×${H} · ${spp} spp`;
      const out = await renderImage(renderer, scene, W, H, spp, {
        onProgress: p => setProgress((f + p) / frames),
        isCancelled: () => cancelRequested,
      });
      const bytes = new Uint8Array(await (await canvasToPngBlob(out)).arrayBuffer());
      zip.add(`frame_${String(f).padStart(5, '0')}.png`, bytes);
    }
    downloadBlob(zip.finish(), `kyma-frames-${W}x${H}-${fps}fps-${stamp()}.zip`);
    toast(`${frames} frames saved`);
  } catch (e) {
    if (e instanceof Cancelled) {
      if (zip.count && confirm(`Cancelled. Download the ${zip.count} frames rendered so far?`)) {
        downloadBlob(zip.finish(), `kyma-frames-partial-${stamp()}.zip`);
      } else toast('Cancelled');
    } else { console.error(e); toast('Frame render failed: ' + e.message, 4000); }
  } finally {
    busy = false;
    hideProgress();
    renderer.resetLive();
  }
}
framesBtn.addEventListener('click', renderFrames);

// ── Video recording ─────────────────────────────────────────────────────────
// Two modes (Video & Frames Export panel):
//  • Offline (frame-exact, needs 2+ keyframes): each frame is rendered tiled at
//    the chosen size with Samples / Frame, then encoded with WebCodecs and muxed
//    to MP4 or WebM here. Timestamps are exact, so slow frames don't slow the video.
//  • Real-time: MediaRecorder on the canvas. With 2+ keyframes it rewinds and
//    records one pass of the sequence, then stops; otherwise it records the live
//    view until Stop. The canvas is resized to the chosen resolution (shown
//    letterboxed) and redrawn every frame, because the recorder only sees frames
//    that are drawn. Capped at 1440p: a sustained 4K live capture of this shader
//    is what reset the GPU driver in v1.
let recorder = null, chunks = [], recSeq = null, recExt = 'webm', recSize = null;

function startRecording() {
  if (busy) return;
  const v = state.values;
  if (v.recMode === 1 && seq.length >= 2) {
    if (canEncodeVideo()) { recordOffline(); return; }
    toast('This browser has no WebCodecs encoder — recording in real time instead', 4000);
  } else if (v.recMode === 1) {
    toast('Offline needs 2+ keyframes — recording the live view in real time', 3500);
  }
  startRealtime();
}

function pickRecordingFormat(preferWebM) {
  const mp4 = [['video/mp4;codecs=avc1.640028', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4']];
  const webm = [['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm']];
  return (preferWebM ? [...webm, ...mp4] : [...mp4, ...webm]).find(([m]) => MediaRecorder.isTypeSupported(m)) || [undefined, 'webm'];
}

function startRealtime() {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) { toast('Video recording is not supported in this browser', 3500); return; }
  const v = state.values, fps = recFps();
  const { W, H, capped } = recordSize(true);
  chunks = [];
  const [mime, ext] = pickRecordingFormat(v.recFormat === 1);
  recExt = ext;
  // Resize the drawing buffer to the recording size; CSS keeps the viewer box and
  // object-fit letterboxes it so the framing you see is the framing you get.
  recSize = [W, H];
  canvas.width = W; canvas.height = H;
  canvas.style.objectFit = 'contain';
  const stream = canvas.captureStream(fps);
  const bits = videoBitrate(W, H, fps, v.recQuality | 0);
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bits } : { videoBitsPerSecond: bits });
  } catch (e) {
    console.error(e); toast('Could not start the recorder: ' + e.message, 4000);
    recorder = null; recSize = null; canvas.style.objectFit = ''; return;
  }
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime || 'video/webm' });
    if (blob.size === 0) { toast('Recording was empty — nothing was drawn', 4000); return; }
    downloadBlob(blob, `kyma-${W}x${H}-${fps}fps-${stamp()}.${recExt}`);
    toast(`Saved ${(blob.size / 1048576).toFixed(1)} MB ${recExt.toUpperCase()} · ${W}×${H}`, 3000);
  };
  const size = `${W}×${H}${capped ? ' (capped to 1440p)' : ''}`;
  if (seq.length >= 2) {
    recSeq = { dur: seq.duration(v.seqDuration, v.seqMode) };
    seq.stop();
    state.setMany(seq.sample(0, v.seqDuration, v.seqMode, v.seqEasing), 'seq');
    seq.play();
    toast(`Recording sequence · ${recSeq.dur.toFixed(1)} s · ${size}`, 2500);
  } else {
    recSeq = null;
    toast(`Recording live view · ${size} · add 2+ keyframes to record the sequence`, 3500);
  }
  recorder.start(250);
  $('recVideo').textContent = 'Stop Rec';
  recBtn2.textContent = '■ Stop Recording';
  $('ui').classList.add('is-recording');
  syncSeqUI();
}

function stopRecording() {
  if (!recorder) return;
  const r = recorder;
  recorder = null;
  if (recSeq) { seq.stop(); recSeq = null; }
  // Let the last frame land in the stream before stopping, then hand the canvas
  // back to the layout.
  // (setTimeout, not rAF: rAF never fires in a background tab.)
  setTimeout(() => { if (r.state !== 'inactive') r.stop(); recSize = null; canvas.style.objectFit = ''; }, 60);
  $('recVideo').textContent = 'Record Video';
  recBtn2.textContent = '● Record Video';
  $('ui').classList.remove('is-recording');
  syncSeqUI();
}

async function recordOffline() {
  const v = { ...state.values };
  const fps = recFps();
  const { W, H } = recordSize();
  const frames = seqFrameCount(fps);
  const spp = Math.min(v.recSamples, renderer.sampleCap);
  const bits = videoBitrate(W, H, fps, v.recQuality | 0);
  const enc = await pickEncoder(v.recFormat | 0, W, H, fps, bits);
  if (!enc) { toast(`This browser can't encode ${W}×${H} video — try a smaller resolution`, 4500); return; }
  const want = v.recFormat === 1 ? 'webm' : 'mp4';
  if (enc.kind !== want) toast(`${want.toUpperCase()} isn't available at ${W}×${H} here — writing ${enc.kind.toUpperCase()}`, 4000);
  seq.stop();
  busy = true;
  showProgress(`Video frame 0 / ${frames}`);
  let writer = null;
  try {
    writer = new VideoWriter(enc, fps);
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const fv = { ...v, ...seq.sample(t, v.seqDuration, v.seqMode, v.seqEasing) };
      const scene = sceneUniforms(fv, effectiveScale(fv, t * 1000));
      $('progressLabel').textContent = `Video frame ${f + 1} / ${frames} · ${W}×${H} · ${spp} spp · ${enc.kind.toUpperCase()}`;
      const out = await renderImage(renderer, scene, W, H, spp, {
        onProgress: p => setProgress((f + p) / frames),
        isCancelled: () => cancelRequested,
      });
      await writer.add(out);
    }
    $('progressLabel').textContent = 'Finishing video…';
    const blob = await writer.finish();
    downloadBlob(blob, `kyma-${W}x${H}-${fps}fps-${stamp()}.${enc.kind}`);
    toast(`Saved ${(blob.size / 1048576).toFixed(1)} MB ${enc.kind.toUpperCase()} · ${frames} frames`, 3500);
  } catch (e) {
    if (e instanceof Cancelled) {
      if (writer && writer.count && confirm(`Cancelled. Save the ${writer.count} frames rendered so far as a video?`)) {
        try { downloadBlob(await writer.finish(), `kyma-partial-${W}x${H}-${stamp()}.${enc.kind}`); }
        catch (e2) { console.error(e2); toast('Could not finish the partial video', 4000); }
      } else { writer && writer.abort(); toast('Cancelled'); }
    } else {
      console.error(e); writer && writer.abort();
      toast('Video render failed: ' + (e.message || e), 4500);
    }
  } finally {
    busy = false;
    hideProgress();
    renderer.resetLive();
  }
}
const toggleRecord = () => (recorder ? stopRecording() : startRecording());
$('recVideo').addEventListener('click', toggleRecord);
recBtn2.addEventListener('click', toggleRecord);

// ── Pointer / wheel navigation ──────────────────────────────────────────────
const pointers = new Map();
let dragBtn = -1, pinchSpan = 0;

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragBtn = e.pointerType === 'mouse' ? e.button : 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchSpan = Math.hypot(a.x - b.x, a.y - b.y);
  }
  if (e.button === 1) e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  prev.x = e.clientX; prev.y = e.clientY;
  const v = state.values;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchSpan > 0 && span > 0) state.set('dist', v.dist * pinchSpan / span);
    pinchSpan = span;
    return;
  }
  if (dragBtn === 0) {
    state.setMany({ rotX: wrapPi(v.rotX + dx * 0.005), rotY: clamp(v.rotY + dy * 0.005, -1.5707, 1.5707) });
  } else if (dragBtn === 2) {
    state.set('dist', v.dist * Math.exp(dy * 0.01));
  } else if (dragBtn === 1) {
    const cam = cameraBasis(v);
    const k = v.dist * 0.0015 / v.lens;
    state.setMany({
      targetX: v.targetX - cam.right[0] * dx * k + cam.up[0] * dy * k,
      targetY: v.targetY - cam.right[1] * dx * k + cam.up[1] * dy * k,
      targetZ: v.targetZ - cam.right[2] * dx * k + cam.up[2] * dy * k,
    });
  }
});
const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchSpan = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  state.set('dist', state.values.dist * Math.exp(e.deltaY * unit * 0.001));
}, { passive: false });

function autofocusAt(px, py) {
  const v = state.values;
  const t = probePixel(v, px, py, canvas.clientWidth, canvas.clientHeight);
  if (t < 0) { toast('No surface there'); return; }
  state.set('focalDist', t);
  toast(`Focus ${t.toFixed(3)}` + (v.dofStrength > 0 ? '' : ' · raise Depth Focus to see it'));
}
canvas.addEventListener('dblclick', e => autofocusAt(e.offsetX, e.offsetY));

// ── Keyboard ────────────────────────────────────────────────────────────────
const keys = {};
const typing = () => ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || dlg.open;
window.addEventListener('keydown', e => {
  if (typing()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  switch (e.code) {
    case 'KeyH': toggleUIHidden(); break;
    case 'BracketLeft': setDock('left', !dockOpen('left')); break;
    case 'BracketRight': setDock('right', !dockOpen('right')); break;
    case 'Space': togglePlay(); break;
    case 'KeyK': addKeyframe(); break;
    case 'KeyF': autofocusAt(canvas.clientWidth / 2, canvas.clientHeight / 2); break;
    case 'Escape': seq.stop(); syncSeqUI(); break;
    default: break;
  }
  keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function fly(dt) {
  let mx = 0, my = 0, mz = 0;
  const v = state.values;
  const cam = cameraBasis(v);
  const addv = (d, s) => { mx += d[0] * s; my += d[1] * s; mz += d[2] * s; };
  if (keys.KeyW) addv(cam.forward, 1);
  if (keys.KeyS) addv(cam.forward, -1);
  if (keys.KeyD) addv(cam.right, 1);
  if (keys.KeyA) addv(cam.right, -1);
  if (keys.KeyE) addv(cam.up, 1);
  if (keys.KeyQ) addv(cam.up, -1);
  const len = Math.hypot(mx, my, mz);
  if (len === 0) return;
  const sprint = keys.ShiftLeft || keys.ShiftRight ? 3 : 1;
  const s = v.dist * 0.8 * sprint * dt / len; // speed scales with view distance
  state.setMany({ targetX: v.targetX + mx * s, targetY: v.targetY + my * s, targetZ: v.targetZ + mz * s }, 'fly');
}

// ── GPU context loss ────────────────────────────────────────────────────────
let contextLost = false;
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; cancelRequested = true; toast('GPU context lost — waiting for restore', 4000); });
canvas.addEventListener('webglcontextrestored', () => {
  try { renderer.restore(); contextLost = false; state.bump(); toast('GPU restored'); }
  catch (e) { console.error(e); fatal('GPU context could not be restored.\n' + e.message); }
});

// ── Main loop ───────────────────────────────────────────────────────────────
let last = performance.now(), lastSig = '', lastBaseSig = '', lastChange = 0, hudTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (busy || contextLost) return;

  const v = state.values;
  if (seq.playing) {
    const s = seq.update(dt, v.seqDuration, v.seqMode, v.seqEasing);
    if (s) state.setMany(s, 'seq');
    syncSeqUI();
  }
  // Sequence recording ends after one pass (Once stops itself; Loop and
  // Ping-Pong would run forever).
  if (recorder && recSeq && (!seq.playing || seq.time >= recSeq.dur)) {
    if (seq.playing) state.setMany(seq.sample(recSeq.dur, v.seqDuration, v.seqMode, v.seqEasing), 'seq');
    stopRecording();
  } else if (v.autoRoll) {
    const sp = v.rotSpeed, am = v.rollAmount;
    state.setMany({
      rotX: wrapPi(v.rotX + sp * dt * 0.3),
      rotY: Math.sin(now * 0.00015 * sp) * 0.2 * am,
      rollX: Math.sin(now * 0.00025 * sp) * 0.1 * am,
      rollY: Math.cos(now * 0.00035 * sp) * 0.1 * am,
      rollZ: Math.sin(now * 0.0001 * sp) * 0.15 * am,
    }, 'auto');
  }
  fly(dt);

  // Size: canvas tracks the centre viewer cell at DPR 1 (v1 crash fix kept); the live
  // accumulation buffer is optionally scaled down for speed.
  const [sw, sh] = recSize || stageSize();
  if (canvas.width !== sw || canvas.height !== sh) {
    canvas.width = sw;
    canvas.height = sh;
  }
  const lw = Math.max(1, Math.round(canvas.width * v.renderScale));
  const lh = Math.max(1, Math.round(canvas.height * v.renderScale));
  renderer.resizeLive(lw, lh);

  const eff = effectiveScale(v, now);
  const scene = sceneUniforms(v, eff);

  // Path tracing previews with the fast surface shader while anything is
  // changing, then restarts accumulation with the path tracer once the view
  // has been still for a moment. The PT program compiles in the background.
  const baseSig = `${state.version}|${eff}|${lw}x${lh}`;
  if (baseSig !== lastBaseSig) { lastBaseSig = baseSig; lastChange = now; }
  let previewing = false;
  if (v.renderMode === 1) {
    let ptReady = false;
    try { ptReady = !!renderer.program(scene, 1); } catch { /* reported by stepLive below */ ptReady = true; }
    previewing = now - lastChange < 180 || !ptReady;
    if (previewing) { scene.__mode = 0; scene.__tonemap = v.tonemap; }
  }
  const sig = baseSig + (previewing ? '|preview' : '');
  if (sig !== lastSig) { renderer.resetLive(); lastSig = sig; }

  try {
    const drew = renderer.stepLive(scene, previewing ? 1 : v.maxSamples);
    // The recorder only sees frames that are drawn: keep presenting while recording.
    if (drew || recorder) renderer.presentLive();
  } catch (e) {
    console.error(e);
    toast('Shader build failed for this combination — reverting to surface / box fold', 4000);
    state.setMany({ foldType: 0, foldType2: 0, renderMode: 0, surfVariant: 0 });
  }

  if (now - hudTimer > 200) {
    hudTimer = now;
    if (!recorder) syncRecInfo(); // keeps the Record summary true to keys / layout
    const cap = Math.min(v.maxSamples, renderer.sampleCap);
    const recTag = recorder ? (recSeq ? `● REC ${Math.min(seq.time, recSeq.dur).toFixed(1)}/${recSeq.dur.toFixed(1)} s · ` : '● REC · ') : '';
    const modeTag = v.renderMode === 1 ? (previewing ? 'PT preview · ' : 'path traced · ') : v.renderMode === 2 ? 'volume · ' : '';
    $('hud').textContent = recTag + (renderer.isCompiling() ? 'compiling shader… · ' : '') + modeTag + `${renderer.live.samples}/${cap} spp · ${lw}×${lh}`;
  }
}
requestAnimationFrame(frame);

// Debug / test hook.
window.__surf = { state, seq, renderer, VERSION };
