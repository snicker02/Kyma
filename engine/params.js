// Parameter schema — the single source of truth for every tweakable value.
// The UI, the state store, the sequencer, the discovery-string codec and the
// uniform upload all derive from this list, so adding a parameter is one line.
//
// Fields:
//   id        state key
//   label     UI label
//   type      'range' | 'bool' | 'select' | 'color' | 'hidden'
//   group     panel group id (see GROUPS)
//   min/max   default slider range (user can widen with the R toggle)
//   hardMin/hardMax  absolute clamp applied by the state store (shader safety)
//   step      slider step
//   def       default value
//   int       round to integer
//   options   select options [label, ...] (value = index)
//   row       params sharing a row key render as a compact 3-column grid
//   section   sub-heading rendered before this param
//   gate      id of a param that enables/disables this control (bool, or
//             a select when combined with gateEq: enabled iff value === gateEq,
//             or value is in gateEq when it is an array)
//   fine      offers the F (fine-tune) chip — rotation sliders
//   interp    'lerp' (default numeric) | 'angle' | 'color' | 'step' | 'none'
//   noReset   changing it does not restart progressive accumulation
//   mutate    included in Evolve mutations

// side: which dock the group lives in. Left = the formula (what the fractal
// IS); right = the scene and output (how it's seen, animated and exported).
import { GRADIENT_NAMES, WRAP_MODES, CUSTOM_GRADIENT } from './gradients.js';

export const GROUPS = [
  { id: 'presets', side: 'left',  title: 'Biome Presets', accent: true, open: true },
  { id: 'variant', side: 'left',  title: 'Surf Variant', accent: true, open: true },
  { id: 'geo',     side: 'left',  title: 'Geometric Core', open: true },
  { id: 'ftype',   side: 'left',  title: 'Fold Types', accent: true, open: true },
  { id: 'fold',    side: 'left',  title: 'Folding & Space' },
  { id: 'inv',     side: 'left',  title: 'Spherical Inversion', accent: true },
  { id: 'wave',    side: 'left',  title: 'Wave Warp', accent: true },
  { id: 'iter',    side: 'left',  title: 'Iteration' },

  { id: 'render',  side: 'right', title: 'Render Mode', accent: true, open: true },
  { id: 'view',    side: 'right', title: 'View & Navigation' },
  { id: 'object',  side: 'right', title: 'Object Transform' },
  { id: 'style',   side: 'right', title: 'Color & Lens', accent: true },
  { id: 'env',     side: 'right', title: 'Environment', accent: true },
  { id: 'ground',  side: 'right', title: 'Ground Plane', accent: true },
  { id: 'light',   side: 'right', title: 'Atmosphere & Light' },
  { id: 'seq',     side: 'right', title: 'Animation Sequencer', accent: true },
  { id: 'video',   side: 'right', title: 'Video & Frames Export' },
  { id: 'quality', side: 'right', title: 'Quality & Output' },
];

const PI = 3.1416;

export const SURF_VARIANTS = ['Classic (v2 engine)', 'Amazing Surf (Mandelbulber)', 'Mod 1', 'Mod 2', 'Mod 3', 'Mod 4', 'Multi', 'M3D (Mandelbulb3D)', 'Klein', 'Klein V2', 'Amazing IFS'];
export const STACK_FOLDS = ['Off', 'Box (Tglad)', 'Inverse Fold  f−||z|−f|', 'Abs Offset  |z+f|', 'Conditional Reflect', 'DarkBeam Double', 'Clamped Folder'];
// Variant groups (indices into SURF_VARIANTS) used to gate controls.
const V_STACK = [2, 3, 4, 6];         // fold-stack variants
const V_ALL_BUT_KLEIN = [0, 1, 2, 3, 4, 5, 6, 7, 10]; // variants that take c (IFS only with Add c)

export const FOLD_NAMES = ['Type 1 (Box)', 'Type 2', 'Type 3', 'Surf XY (Mandelbulber)', 'Tetrahedral + Box', 'Octahedral + Box', 'Icosahedral + Box', 'Polar Kaleidoscope', 'Smooth Box (tanh)', 'Abs Shift (Kali)', 'Diagonal Box'];

export const GROUND_TYPES = ['Off', 'Matte', 'Grass', 'Sand', 'Rock', 'Water', 'Mirror', 'Checker'];

export const PARAMS = [
  // ════ LEFT DOCK — FORMULA ════════════════════════════════════════════════

  // ── Surf variant (Mandelbulber surf family, reimplemented) ─────────────────
  { id: 'surfVariant', label: 'Formula', type: 'select', group: 'variant', options: SURF_VARIANTS, def: 0 },
  { id: 'vStack1', label: 'Slot 1', type: 'select', group: 'variant', options: STACK_FOLDS, def: 1, row: 'stackA', section: 'Fold Stack (applied in order, X/Y)', gate: 'surfVariant', gateEq: V_STACK },
  { id: 'vStack2', label: 'Slot 2', type: 'select', group: 'variant', options: STACK_FOLDS, def: 0, row: 'stackA', gate: 'surfVariant', gateEq: V_STACK },
  { id: 'vStack3', label: 'Slot 3', type: 'select', group: 'variant', options: STACK_FOLDS, def: 0, row: 'stackB', gate: 'surfVariant', gateEq: V_STACK },
  { id: 'vStack4', label: 'Slot 4', type: 'select', group: 'variant', options: STACK_FOLDS, def: 0, row: 'stackB', gate: 'surfVariant', gateEq: V_STACK },
  { id: 'vStack5', label: 'Slot 5', type: 'select', group: 'variant', options: STACK_FOLDS, def: 0, gate: 'surfVariant', gateEq: V_STACK },
  { id: 'vFoldValue', label: 'Reflect V', type: 'range', group: 'variant', min: 0, max: 4, step: 0.01, def: 2, row: 'vfv', gate: 'surfVariant', gateEq: V_STACK, mutate: true },
  { id: 'vFold2', label: 'Fold f2', type: 'range', group: 'variant', min: 0, max: 4, step: 0.01, def: 2, row: 'vfv', gate: 'surfVariant', gateEq: V_STACK, mutate: true },
  { id: 'vZFold', label: 'Fold Z Axis Too', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: [3, 4, 5, 6, 8, 9, 10] },
  { id: 'vSwapXY', label: 'Swap X/Y After Fold', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: [3, 4, 8, 9] },
  { id: 'vSwapYZ', label: 'Swap Y/Z (Klein)', type: 'bool', group: 'variant', def: true, gate: 'surfVariant', gateEq: 8 },
  { id: 'vEvenFlipY', label: 'Flip Y on Even Iterations', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: 4 },
  { id: 'vEvenFlipZ', label: 'Flip Z on Even Iterations', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: 4 },
  { id: 'vFlip', label: 'Pre Sign Flip', type: 'select', group: 'variant', options: ['None', 'X', 'Y', 'Z', 'XY', 'XZ', 'YZ', 'XYZ'], def: 0, gate: 'surfVariant', gateEq: 7 },
  { id: 'vCSwizzle', label: 'C Swizzle (C-Mult add)', type: 'select', group: 'variant', options: ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'], def: 0, gate: 'surfVariant', gateEq: [3, 4, 6] },
  { id: 'vMboxFold', label: 'Add Mandelbox Sphere Fold', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: 6 },
  { id: 'vFixedR2', label: 'Outer Radius² (fixed)', type: 'range', group: 'variant', min: 0.1, max: 4, step: 0.001, def: 1, hardMin: 0.0001, gate: 'surfVariant', gateEq: [3, 4, 6], mutate: true },
  { id: 'vDEOffset', label: 'DE Offset', type: 'range', group: 'variant', min: 0, max: 2, step: 0.01, def: 1, gate: 'surfVariant', gateEq: [5, 7, 8, 9, 10] },
  { id: 'vOffX', label: 'OX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'voff', section: 'Pre-Sphere Offset', gate: 'surfVariant', gateEq: [2, 3, 4, 5, 6, 7, 9, 10], mutate: true },
  { id: 'vOffY', label: 'OY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'voff', gate: 'surfVariant', gateEq: [2, 3, 4, 5, 6, 7, 9, 10], mutate: true },
  { id: 'vOffZ', label: 'OZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'voff', gate: 'surfVariant', gateEq: [2, 3, 4, 5, 6, 7, 9, 10], mutate: true },
  { id: 'vSphX', label: 'SX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vsph', section: 'Sphere-Fold Centre', gate: 'surfVariant', gateEq: [3, 4, 6], mutate: true },
  { id: 'vSphY', label: 'SY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vsph', gate: 'surfVariant', gateEq: [3, 4, 6], mutate: true },
  { id: 'vSphZ', label: 'SZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vsph', gate: 'surfVariant', gateEq: [3, 4, 6], mutate: true },
  { id: 'vPostX', label: 'PX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vpost', section: 'Post Offset', gate: 'surfVariant', gateEq: [5, 7, 8, 9], mutate: true },
  { id: 'vPostY', label: 'PY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vpost', gate: 'surfVariant', gateEq: [5, 7, 8, 9], mutate: true },
  { id: 'vPostZ', label: 'PZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vpost', gate: 'surfVariant', gateEq: [5, 7, 8, 9], mutate: true },
  { id: 'vKleinIters', label: 'Surf Iterations, then Box Tail', type: 'range', group: 'variant', min: 1, max: 20, step: 1, def: 8, int: true, hardMin: 0, hardMax: 40, section: 'Klein Tail', gate: 'surfVariant', gateEq: [8, 9] },
  { id: 'vTailX', label: 'TX', type: 'range', group: 'variant', min: 0, max: 4, step: 0.01, def: 1, row: 'vtail', gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vTailY', label: 'TY', type: 'range', group: 'variant', min: 0, max: 4, step: 0.01, def: 1, row: 'vtail', gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vTailZ', label: 'TZ', type: 'range', group: 'variant', min: 0, max: 4, step: 0.01, def: 0, row: 'vtail', gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vTailScale', label: 'Tail Scale', type: 'range', group: 'variant', min: -4, max: 4, step: 0.001, def: 2, gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vTailOffX', label: 'TOX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vtoff', gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vTailOffY', label: 'TOY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vtoff', gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vTailOffZ', label: 'TOZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.01, def: 0, row: 'vtoff', gate: 'surfVariant', gateEq: [8, 9], mutate: true },
  { id: 'vPolyOn', label: 'Polyfold (N = Polar Sectors)', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: [9, 10] },
  { id: 'vPolyAbsY', label: 'Polyfold: Mirror Y', type: 'bool', group: 'variant', def: true, gate: 'surfVariant', gateEq: 9 },
  // Amazing IFS (variant 10)
  { id: 'vPolyStop', label: 'Polyfold Until Iter', type: 'range', group: 'variant', min: 1, max: 40, step: 1, def: 1, int: true, hardMin: 1, hardMax: 250, gate: 'surfVariant', gateEq: 10 },
  { id: 'vPreAbsX', label: '|X|', type: 'bool', group: 'variant', def: false, row: 'vpre', section: 'Pre-Fold Abs', gate: 'surfVariant', gateEq: 10 },
  { id: 'vPreAbsY', label: '|Y|', type: 'bool', group: 'variant', def: false, row: 'vpre', gate: 'surfVariant', gateEq: 10 },
  { id: 'vPreAbsZ', label: '|Z|', type: 'bool', group: 'variant', def: false, row: 'vpre', gate: 'surfVariant', gateEq: 10 },
  { id: 'vIfsX', label: 'X', type: 'select', group: 'variant', options: ['Off', 'Mirror + shift', 'Shift only'], def: 0, row: 'vifs', section: 'IFS Fold  z = |z| − offset', gate: 'surfVariant', gateEq: 10 },
  { id: 'vIfsY', label: 'Y', type: 'select', group: 'variant', options: ['Off', 'Mirror + shift', 'Shift only'], def: 0, row: 'vifs', gate: 'surfVariant', gateEq: 10 },
  { id: 'vIfsZ', label: 'Z', type: 'select', group: 'variant', options: ['Off', 'Mirror + shift', 'Shift only'], def: 0, row: 'vifs', gate: 'surfVariant', gateEq: 10 },
  { id: 'vIfsOffX', label: 'IX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, row: 'vifso', gate: 'surfVariant', gateEq: 10, mutate: true, fine: true },
  { id: 'vIfsOffY', label: 'IY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, row: 'vifso', gate: 'surfVariant', gateEq: 10, mutate: true, fine: true },
  { id: 'vIfsOffZ', label: 'IZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, row: 'vifso', gate: 'surfVariant', gateEq: 10, mutate: true, fine: true },
  { id: 'vIfsAddX', label: 'AX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, row: 'vifsa', section: 'Post-IFS Offset', gate: 'surfVariant', gateEq: 10, mutate: true },
  { id: 'vIfsAddY', label: 'AY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, row: 'vifsa', gate: 'surfVariant', gateEq: 10, mutate: true },
  { id: 'vIfsAddZ', label: 'AZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, row: 'vifsa', gate: 'surfVariant', gateEq: 10, mutate: true },
  { id: 'vAddC', label: 'Add c (pixel / Julia)', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: 10 },
  { id: 'vMinDE', label: 'Smooth DE (min over iterations)', type: 'bool', group: 'variant', def: false, gate: 'surfVariant', gateEq: 10 },
  { id: 'vMinDEStop', label: 'Smooth DE Until Iteration', type: 'range', group: 'variant', min: 1, max: 250, step: 1, def: 250, int: true, hardMin: 1, hardMax: 250, gate: 'vMinDE' },
  { id: 'vMinDEStart', label: 'Smooth DE From Iteration', type: 'range', group: 'variant', min: 0, max: 20, step: 1, def: 0, int: true, hardMin: 0, hardMax: 39, gate: 'vMinDE' },

  // ── Geometric core ──────────────────────────────────────────────────────
  { id: 'scale', label: 'Base Scale', type: 'range', group: 'geo', min: -4, max: 4, step: 0.001, def: 2, mutate: true },
  { id: 'scaleVary', label: 'Scale Vary', type: 'range', group: 'geo', min: -2, max: 2, step: 0.001, def: 0, mutate: true },
  { id: 'influence', label: 'Influence', type: 'range', group: 'geo', min: 0, max: 2, step: 0.001, def: 1, mutate: true, gate: 'surfVariant', gateEq: [0, 1, 2, 6] },
  { id: 'minR', label: 'Min Radius', type: 'range', group: 'geo', min: 0, max: 2.5, step: 0.001, def: 0.5, hardMin: 0, mutate: true },
  { id: 'cylinder', label: 'Cylindrical Sphere-Fold', type: 'bool', group: 'geo', def: false },

  // ── Fold types ──────────────────────────────────────────────────────────
  { id: 'foldType', label: 'Fold A', type: 'select', group: 'ftype', options: FOLD_NAMES, def: 0, gate: 'surfVariant', gateEq: 0 },
  { id: 'foldType2', label: 'Hybrid Fold B', type: 'select', group: 'ftype', options: ['Off', ...FOLD_NAMES], def: 0, row: 'hybrid', gate: 'surfVariant', gateEq: 0 },
  { id: 'hybridPeriod', label: 'B Every N', type: 'range', group: 'ftype', min: 1, max: 8, step: 1, def: 2, int: true, hardMin: 1, hardMax: 40, row: 'hybrid', gate: 'surfVariant', gateEq: 0 },
  { id: 'polarN', label: 'Polar Sectors', type: 'range', group: 'ftype', min: 2, max: 16, step: 1, def: 6, int: true, hardMin: 1, hardMax: 64, gate: 'surfVariant', gateEq: [0, 9, 10] },
  { id: 'axisOrder', label: 'Axis Swap', type: 'select', group: 'ftype', options: ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'], def: 0, row: 'axis' },
  { id: 'tgladWeight', label: 'Fold Weight', type: 'range', group: 'ftype', min: 0, max: 2, step: 0.01, def: 0, mutate: true, row: 'axis', gate: 'surfVariant', gateEq: 0 },

  // ── Folding & space ─────────────────────────────────────────────────────
  { id: 'foldX', label: 'FX', type: 'range', group: 'fold', min: 0, max: 4, step: 0.01, def: 1, row: 'fold', section: 'Fold Limits', mutate: true },
  { id: 'foldY', label: 'FY', type: 'range', group: 'fold', min: 0, max: 4, step: 0.01, def: 1, row: 'fold', mutate: true },
  { id: 'foldZ', label: 'FZ', type: 'range', group: 'fold', min: 0, max: 4, step: 0.01, def: 0, row: 'fold', mutate: true },
  { id: 'juliaMode', label: 'Julia Mode', type: 'bool', group: 'fold', def: true, gate: 'surfVariant', gateEq: V_ALL_BUT_KLEIN },
  { id: 'juliaCX', label: 'JX', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, row: 'julia', section: 'Julia Seed (C)', gate: 'juliaMode', mutate: true },
  { id: 'juliaCY', label: 'JY', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, row: 'julia', gate: 'juliaMode', mutate: true },
  { id: 'juliaCZ', label: 'JZ', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, row: 'julia', gate: 'juliaMode', mutate: true },
  { id: 'noC', label: "Don't Add c", type: 'bool', group: 'fold', def: false, gate: 'surfVariant', gateEq: [0, 1, 2, 3, 4, 5, 6, 7] },
  { id: 'cMult', label: 'C-Mult', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, mutate: true, gate: 'surfVariant', gateEq: [0, 1, 3, 4, 5, 6] },
  { id: 'preAlpha', label: 'Pre α', type: 'range', group: 'fold', min: -PI, max: PI, step: 0.001, def: 0, section: 'Pre-Fold Rotation (tilts the fold planes)', mutate: true, fine: true },
  { id: 'preBeta', label: 'Pre β', type: 'range', group: 'fold', min: -PI, max: PI, step: 0.001, def: 0, mutate: true, fine: true },
  { id: 'preGamma', label: 'Pre γ', type: 'range', group: 'fold', min: -PI, max: PI, step: 0.001, def: 0, mutate: true, fine: true },
  { id: 'alpha', label: 'α (Alpha)', type: 'range', group: 'fold', min: -PI, max: PI, step: 0.001, def: 0, section: 'Post-Fold Rotation (α, β, γ)', mutate: true, fine: true },
  { id: 'beta', label: 'β (Beta)', type: 'range', group: 'fold', min: -PI, max: PI, step: 0.001, def: 0, mutate: true, fine: true },
  { id: 'gamma', label: 'γ (Gamma)', type: 'range', group: 'fold', min: -PI, max: PI, step: 0.001, def: 0, mutate: true, fine: true },
  { id: 'spinX', label: 'SX', type: 'range', group: 'fold', min: -0.5, max: 0.5, step: 0.001, def: 0, row: 'spin', section: 'Iteration Spin (grows each iteration)', mutate: true, fine: true },
  { id: 'spinY', label: 'SY', type: 'range', group: 'fold', min: -0.5, max: 0.5, step: 0.001, def: 0, row: 'spin', mutate: true, fine: true },
  { id: 'spinZ', label: 'SZ', type: 'range', group: 'fold', min: -0.5, max: 0.5, step: 0.001, def: 0, row: 'spin', mutate: true, fine: true },
  { id: 'rotStart', label: 'Rotations Start at Iteration', type: 'range', group: 'fold', min: 0, max: 20, step: 1, def: 0, int: true, hardMin: 0, hardMax: 40 },

  // ── Spherical inversion ─────────────────────────────────────────────────
  { id: 'invEnabled', label: 'Enable Inversion', type: 'bool', group: 'inv', def: false },
  { id: 'invMode', label: 'Placement', type: 'select', group: 'inv', options: ['Pre-Fold', 'Post-Fold'], def: 0, gate: 'invEnabled', row: 'invtop' },
  { id: 'invStrength', label: 'Amount', type: 'range', group: 'inv', min: 0, max: 1, step: 0.01, def: 1, gate: 'invEnabled', row: 'invtop' },
  { id: 'invRadius', label: 'Sphere Radius', type: 'range', group: 'inv', min: 0.05, max: 3, step: 0.001, def: 1, hardMin: 0.001, gate: 'invEnabled' },
  { id: 'invDELimit', label: 'DE Scale Limit', type: 'range', group: 'inv', min: 1, max: 100, step: 0.1, def: 10, hardMin: 1, gate: 'invEnabled' },
  { id: 'invCX', label: 'CX', type: 'range', group: 'inv', min: -2, max: 2, step: 0.01, def: 0, row: 'invc', section: 'Inversion Center', gate: 'invEnabled' },
  { id: 'invCY', label: 'CY', type: 'range', group: 'inv', min: -2, max: 2, step: 0.01, def: 0, row: 'invc', gate: 'invEnabled' },
  { id: 'invCZ', label: 'CZ', type: 'range', group: 'inv', min: -2, max: 2, step: 0.01, def: 0, row: 'invc', gate: 'invEnabled' },
  { id: 'vSInvOn', label: 'Mandelbulber Inversion', type: 'bool', group: 'inv', def: false, section: 'Mandelbulber-Style (all formulas)' },
  { id: 'vSInvOffX', label: 'OX', type: 'range', group: 'inv', min: -3, max: 3, step: 0.001, def: 0, row: 'vsio', gate: 'vSInvOn' },
  { id: 'vSInvOffY', label: 'OY', type: 'range', group: 'inv', min: -3, max: 3, step: 0.001, def: 0, row: 'vsio', gate: 'vSInvOn' },
  { id: 'vSInvOffZ', label: 'OZ', type: 'range', group: 'inv', min: -3, max: 3, step: 0.001, def: 0, row: 'vsio', gate: 'vSInvOn' },
  { id: 'vSInvAddX', label: 'AX', type: 'range', group: 'inv', min: -3, max: 3, step: 0.001, def: 0, row: 'vsia', gate: 'vSInvOn' },
  { id: 'vSInvAddY', label: 'AY', type: 'range', group: 'inv', min: -3, max: 3, step: 0.001, def: 0, row: 'vsia', gate: 'vSInvOn' },
  { id: 'vSInvAddZ', label: 'AZ', type: 'range', group: 'inv', min: -3, max: 3, step: 0.001, def: 0, row: 'vsia', gate: 'vSInvOn' },
  { id: 'vSInvG', label: 'Radius²', type: 'range', group: 'inv', min: 0.01, max: 5, step: 0.001, def: 1, row: 'vsis', gate: 'vSInvOn' },
  { id: 'vSInvA', label: 'Post Scale', type: 'range', group: 'inv', min: 0.1, max: 5, step: 0.001, def: 1, row: 'vsis', gate: 'vSInvOn' },
  { id: 'vSInvStart', label: 'From Iter', type: 'range', group: 'inv', min: 0, max: 20, step: 1, def: 0, int: true, hardMin: 0, hardMax: 249, row: 'vsii', gate: 'vSInvOn' },
  { id: 'vSInvStop', label: 'Until Iter', type: 'range', group: 'inv', min: 1, max: 40, step: 1, def: 1, int: true, hardMin: 1, hardMax: 250, row: 'vsii', gate: 'vSInvOn' },

  // ── Wave Warp (all formulas) ────────────────────────────────────────────
  { id: 'waveType', label: 'Wave Shape', type: 'select', group: 'wave', options: ['Off', 'Ripple (radial shells)', 'Sine Shear', 'Wave Fold', 'Twist Wave', 'Gyroid Wave', 'Interference'], def: 0, interp: 'step' },
  { id: 'waveAmp', label: 'Amplitude', type: 'range', group: 'wave', min: -1, max: 1, step: 0.001, def: 0.15, hardMin: -10, hardMax: 10, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'waveFreq', label: 'Frequency', type: 'range', group: 'wave', min: 0.1, max: 20, step: 0.01, def: 3, hardMin: 0.001, hardMax: 200, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'wavePhase', label: 'Phase (animate me)', type: 'range', group: 'wave', min: -PI, max: PI, step: 0.001, def: 0, hardMin: -1000, hardMax: 1000, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'wavePhaseStep', label: 'Phase Shift per Iteration', type: 'range', group: 'wave', min: -PI, max: PI, step: 0.001, def: 0, hardMin: -100, hardMax: 100, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'waveAxX', label: 'WX', type: 'range', group: 'wave', min: -2, max: 2, step: 0.01, def: 1, row: 'wax', section: 'Axis Weights (Shear / Fold / Gyroid / Interference)', gate: 'waveType', gateEq: [2, 3, 5, 6] },
  { id: 'waveAxY', label: 'WY', type: 'range', group: 'wave', min: -2, max: 2, step: 0.01, def: 1, row: 'wax', gate: 'waveType', gateEq: [2, 3, 5, 6] },
  { id: 'waveAxZ', label: 'WZ', type: 'range', group: 'wave', min: -2, max: 2, step: 0.01, def: 1, row: 'wax', gate: 'waveType', gateEq: [2, 3, 5, 6] },
  { id: 'waveStart', label: 'From Iter', type: 'range', group: 'wave', min: 0, max: 20, step: 1, def: 0, int: true, hardMin: 0, hardMax: 249, row: 'wavi', gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6] },
  { id: 'waveStop', label: 'Until Iter', type: 'range', group: 'wave', min: 1, max: 40, step: 1, def: 3, int: true, hardMin: 1, hardMax: 250, row: 'wavi', gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6] },

  // ── Iteration ───────────────────────────────────────────────────────────
  { id: 'iterations', label: 'Iterations', type: 'range', group: 'iter', min: 1, max: 250, step: 1, def: 16, int: true, hardMin: 1, hardMax: 250 },
  { id: 'maxSteps', label: 'Max Ray Steps', type: 'range', group: 'iter', min: 64, max: 1024, step: 1, def: 256, int: true, hardMin: 16, hardMax: 1024, interp: 'none', section: 'Ray Marching (fixes cut-off surfaces)' },
  { id: 'detail', label: 'Surface Detail', type: 'range', group: 'iter', min: 0.05, max: 4, step: 0.01, def: 1, hardMin: 0.01, interp: 'none' },
  { id: 'stepFactor', label: 'Step Factor', type: 'range', group: 'iter', min: 0.1, max: 2, step: 0.01, def: 1, hardMin: 0.01, hardMax: 4, interp: 'none' },
  { id: 'maxStep', label: 'Max Step (0 = off)', type: 'range', group: 'iter', min: 0, max: 10, step: 0.01, def: 0, hardMin: 0, interp: 'none' },
  { id: 'maxDist', label: 'Max Distance', type: 'range', group: 'iter', min: 5, max: 500, step: 1, def: 100, hardMin: 0.1, interp: 'none' },
  { id: 'missAsHit', label: 'Shade Stranded Rays as Surface', type: 'bool', group: 'iter', def: false, interp: 'none' },
  { id: 'debugView', label: 'Debug View', type: 'select', group: 'iter', options: ['Off', 'Step Heatmap', 'Miss Reason (red = out of steps)'], def: 0, interp: 'none' },

  // ════ RIGHT DOCK — SCENE & OUTPUT ═════════════════════════════════════════

  // ── Render mode ─────────────────────────────────────────────────────────
  { id: 'renderMode', label: 'Mode', type: 'select', group: 'render', options: ['Surface (fast)', 'Path Traced (global illumination)', 'Volumetric Glow (dust / fog)'], def: 0, interp: 'none' },
  { id: 'ptBounces', label: 'Bounces', type: 'range', group: 'render', min: 1, max: 6, step: 1, def: 3, int: true, hardMin: 1, hardMax: 6, gate: 'renderMode', gateEq: 1, section: 'Path Tracing', interp: 'none' },
  { id: 'ptRough', label: 'Roughness', type: 'range', group: 'render', min: 0, max: 1, step: 0.01, def: 0.5, hardMin: 0, hardMax: 1, gate: 'renderMode', gateEq: 1 },
  { id: 'ptMetal', label: 'Metallic', type: 'range', group: 'render', min: 0, max: 1, step: 0.01, def: 0, hardMin: 0, hardMax: 1, gate: 'renderMode', gateEq: 1 },
  { id: 'ptSun', label: 'Light Intensity', type: 'range', group: 'render', min: 0, max: 10, step: 0.01, def: 2.5, hardMin: 0, gate: 'renderMode', gateEq: 1 },
  { id: 'ptLightSize', label: 'Light Size (soft shadows)', type: 'range', group: 'render', min: 0, max: 2, step: 0.01, def: 0.3, hardMin: 0, gate: 'renderMode', gateEq: 1 },
  { id: 'ptSky', label: 'Sky / Image Light', type: 'range', group: 'render', min: 0, max: 4, step: 0.01, def: 1, hardMin: 0, gate: 'renderMode', gateEq: 1 },
  { id: 'ptSkyColor', label: 'Sky Color (no image)', type: 'color', group: 'render', def: '#9fb4d9', gate: 'renderMode', gateEq: 1 },
  { id: 'ptEmit', label: 'Trap Emission', type: 'range', group: 'render', min: 0, max: 5, step: 0.01, def: 0, hardMin: 0, gate: 'renderMode', gateEq: 1 },
  { id: 'ptClamp', label: 'Firefly Clamp', type: 'range', group: 'render', min: 1, max: 100, step: 0.5, def: 20, hardMin: 0.5, gate: 'renderMode', gateEq: 1, interp: 'none' },
  { id: 'volDensity', label: 'Density', type: 'range', group: 'render', min: 0, max: 200, step: 0.1, def: 20, hardMin: 0, gate: 'renderMode', gateEq: 2, section: 'Volumetric Glow' },
  { id: 'volThick', label: 'Shell Thickness', type: 'range', group: 'render', min: 0.0005, max: 0.05, step: 0.0001, def: 0.004, hardMin: 0.00001, gate: 'renderMode', gateEq: 2 },
  { id: 'volGlow', label: 'Glow', type: 'range', group: 'render', min: 0, max: 5, step: 0.01, def: 1.2, hardMin: 0, gate: 'renderMode', gateEq: 2 },
  { id: 'volLight', label: 'Light Shading', type: 'range', group: 'render', min: 0, max: 1, step: 0.01, def: 0.5, hardMin: 0, hardMax: 1, gate: 'renderMode', gateEq: 2 },
  { id: 'volStepMin', label: 'Min Step', type: 'range', group: 'render', min: 0.001, max: 0.05, step: 0.0005, def: 0.008, hardMin: 0.0001, gate: 'renderMode', gateEq: 2, interp: 'none' },
  { id: 'volSteps', label: 'Volume Steps', type: 'range', group: 'render', min: 64, max: 1024, step: 1, def: 384, int: true, hardMin: 16, hardMax: 1024, gate: 'renderMode', gateEq: 2, interp: 'none' },

  // ── View & navigation ───────────────────────────────────────────────────
  { id: 'rotX', label: 'Orbit Horiz', type: 'range', group: 'view', min: -PI, max: PI, step: 0.001, def: 0, interp: 'angle', fine: true },
  { id: 'rotY', label: 'Orbit Vert', type: 'range', group: 'view', min: -1.55, max: 1.55, step: 0.001, def: 0, hardMin: -1.5707, hardMax: 1.5707, fine: true },
  { id: 'dist', label: 'View Distance', type: 'range', group: 'view', min: 0.01, max: 20, step: 0.001, def: 5, hardMin: 0.0002 },
  { id: 'lens', label: 'Lens (Focal Length)', type: 'range', group: 'view', min: 0.2, max: 4, step: 0.01, def: 1, hardMin: 0.05 },
  { id: 'rollX', label: 'Roll X (ξ)', type: 'range', group: 'view', min: -PI, max: PI, step: 0.001, def: 0, section: 'Orbit Roll System (ξ, η, ζ)', interp: 'angle', fine: true },
  { id: 'rollY', label: 'Roll Y (η)', type: 'range', group: 'view', min: -PI, max: PI, step: 0.001, def: 0, interp: 'angle', fine: true },
  { id: 'rollZ', label: 'Roll Z (ζ)', type: 'range', group: 'view', min: -PI, max: PI, step: 0.001, def: 0, interp: 'angle', fine: true },
  { id: 'autoRoll', label: 'Cinematic Auto-Roll', type: 'bool', group: 'view', def: false, section: 'Auto Motion', interp: 'none', noReset: true },
  { id: 'rotSpeed', label: 'Roll Speed', type: 'range', group: 'view', min: 0, max: 2, step: 0.01, def: 0.5, noReset: true },
  { id: 'rollAmount', label: 'Roll Amount', type: 'range', group: 'view', min: 0, max: 2, step: 0.01, def: 1, noReset: true },
  { id: 'targetX', type: 'hidden', group: 'view', def: 0 },
  { id: 'targetY', type: 'hidden', group: 'view', def: 0 },
  { id: 'targetZ', type: 'hidden', group: 'view', def: 0 },

  // ── Color & lens ────────────────────────────────────────────────────────
  // Gradient: one 256-texel LUT in the shader (engine/gradients.js); the first
  // eight are the original cosine palettes, rebuilt exactly.
  { id: 'palette', label: 'Gradient', type: 'select', group: 'style', options: GRADIENT_NAMES, def: 0 },
  { id: 'colorShift', label: 'Gradient Offset', type: 'range', group: 'style', min: 0, max: 1, step: 0.01, def: 0, mutate: true },
  { id: 'colorSource', label: 'Color Source', type: 'select', group: 'style', options: ['Orbit trap', 'Fold count (stripes)', 'Trap + folds', 'Fold amounts (continuous)'], def: 0 },
  { id: 'foldColW', label: 'Box-Fold Color', type: 'range', group: 'style', min: 0, max: 2, step: 0.01, def: 0.25, gate: 'colorSource', gateEq: [1, 2, 3], row: 'fcol' },
  { id: 'sphColW', label: 'Sphere-Fold Color', type: 'range', group: 'style', min: 0, max: 2, step: 0.01, def: 0.5, gate: 'colorSource', gateEq: [1, 2, 3], row: 'fcol' },
  { id: 'colorIters', label: 'Color Iterations', type: 'range', group: 'style', min: 1, max: 40, step: 1, def: 6, int: true, hardMin: 1, gate: 'colorSource', gateEq: [1, 2, 3] },
  // Stops for the 'Imported' gradient: "pos:#rrggbb pos:#rrggbb …", pos 0…1 (Mandelbulber import).
  { id: 'gradStops', type: 'text', group: 'style', def: '' },
  { id: 'gradRepeat', label: 'Gradient Repeat', type: 'range', group: 'style', min: 0.1, max: 32, step: 0.01, def: 1, hardMin: 0.01 },
  { id: 'gradWrap', label: 'Wrap', type: 'select', group: 'style', options: WRAP_MODES, def: 0, row: 'gradA' },
  { id: 'gradReverse', label: 'Reverse', type: 'bool', group: 'style', def: false, row: 'gradA' },
  { id: 'gradHue', label: 'Gradient Hue', type: 'range', group: 'style', min: -180, max: 180, step: 1, def: 0 },
  { id: 'gradSat', label: 'Gradient Saturation', type: 'range', group: 'style', min: 0, max: 2, step: 0.01, def: 1, hardMin: 0 },
  { id: 'gradC1', label: 'Stop 1', type: 'color', group: 'style', def: '#0b0b2b', interp: 'color', row: 'gradC', gate: 'palette', gateEq: CUSTOM_GRADIENT },
  { id: 'gradC2', label: 'Stop 2', type: 'color', group: 'style', def: '#5e2ca5', interp: 'color', row: 'gradC', gate: 'palette', gateEq: CUSTOM_GRADIENT },
  { id: 'gradC3', label: 'Stop 3', type: 'color', group: 'style', def: '#e0457b', interp: 'color', row: 'gradC', gate: 'palette', gateEq: CUSTOM_GRADIENT },
  { id: 'gradC4', label: 'Stop 4', type: 'color', group: 'style', def: '#ffb347', interp: 'color', row: 'gradC2', gate: 'palette', gateEq: CUSTOM_GRADIENT },
  { id: 'gradC5', label: 'Stop 5', type: 'color', group: 'style', def: '#fff6d5', interp: 'color', row: 'gradC2', gate: 'palette', gateEq: CUSTOM_GRADIENT },
  { id: 'lightColor', label: 'Lite Color', type: 'color', group: 'style', def: '#e6f2ff', interp: 'color', row: 'colors' },
  { id: 'bgColor', label: 'Background', type: 'color', group: 'style', def: '#010103', interp: 'color', row: 'colors' },
  { id: 'tonemap', label: 'Tone Curve', type: 'select', group: 'style', options: ['Legacy (v1 look)', 'Filmic (ACES)'], def: 0 },
  { id: 'brightness', label: 'Exposure', type: 'range', group: 'style', min: 0.1, max: 5, step: 0.01, def: 1.2 },
  { id: 'vignette', label: 'Vignette', type: 'range', group: 'style', min: 0, max: 2, step: 0.01, def: 0.5 },
  { id: 'dofStrength', label: 'Depth Focus', type: 'range', group: 'style', min: 0, max: 2, step: 0.01, def: 0, hardMin: 0, section: 'Depth of Field (dbl-click to focus)' },
  { id: 'focalDist', label: 'Focal Dist', type: 'range', group: 'style', min: 0.1, max: 20, step: 0.01, def: 5, hardMin: 0.0001 },

  // ── Environment (image source is chosen in the UI; see engine/environment.js) ──
  { id: 'envMode', label: 'Background', type: 'select', group: 'env', options: ['Solid Color', 'Backdrop (fit to view)', 'Panorama (360° sky)'], def: 0 },
  { id: 'envIntensity', label: 'Background Brightness', type: 'range', group: 'env', min: 0, max: 3, step: 0.01, def: 1 },
  { id: 'envBlur', label: 'Background Blur', type: 'range', group: 'env', min: 0, max: 8, step: 0.01, def: 0 },
  { id: 'envYaw', label: 'Panorama Yaw', type: 'range', group: 'env', min: -PI, max: PI, step: 0.001, def: 0, interp: 'angle', fine: true },
  { id: 'envPitch', label: 'Panorama Pitch', type: 'range', group: 'env', min: -1.5707, max: 1.5707, step: 0.001, def: 0, fine: true },
  { id: 'envReflect', label: 'Reflections', type: 'range', group: 'env', min: 0, max: 2, step: 0.01, def: 0.4, section: 'Image-Based Lighting' },
  { id: 'envLight', label: 'Ambient from Image', type: 'range', group: 'env', min: 0, max: 2, step: 0.01, def: 0.5 },
  { id: 'envFog', label: 'Fog Takes Image Color', type: 'bool', group: 'env', def: true },

  // ── Atmosphere & light ──────────────────────────────────────────────────
  // ── Object transform: moves the fractal, not the camera / light / ground ──
  { id: 'objX', label: 'X', type: 'range', group: 'object', min: -10, max: 10, step: 0.01, def: 0, row: 'opos', section: 'Position', fine: true },
  { id: 'objY', label: 'Y', type: 'range', group: 'object', min: -10, max: 10, step: 0.01, def: 0, row: 'opos', fine: true },
  { id: 'objZ', label: 'Z', type: 'range', group: 'object', min: -10, max: 10, step: 0.01, def: 0, row: 'opos', fine: true },
  { id: 'objRotX', label: 'Pitch', type: 'range', group: 'object', min: -180, max: 180, step: 0.1, def: 0, row: 'orot', section: 'Rotation (degrees)', fine: true },
  { id: 'objRotY', label: 'Yaw', type: 'range', group: 'object', min: -180, max: 180, step: 0.1, def: 0, row: 'orot', fine: true },
  { id: 'objRotZ', label: 'Roll', type: 'range', group: 'object', min: -180, max: 180, step: 0.1, def: 0, row: 'orot', fine: true },
  { id: 'objScale', label: 'Object Scale', type: 'range', group: 'object', min: 0.1, max: 5, step: 0.01, def: 1, hardMin: 0.01, fine: true },

  // ── Ground plane ────────────────────────────────────────────────────────
  { id: 'groundType', label: 'Ground', type: 'select', group: 'ground', options: GROUND_TYPES, def: 0 },
  { id: 'groundY', label: 'Height', type: 'range', group: 'ground', min: -10, max: 10, step: 0.01, def: -2, fine: true, gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundColor', label: 'Color', type: 'color', group: 'ground', def: '#4a6b2e', interp: 'color', row: 'gcol', gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundColor2', label: 'Color 2', type: 'color', group: 'ground', def: '#8fae4a', interp: 'color', row: 'gcol', gate: 'groundType', gateEq: [2, 3, 4, 7] },
  { id: 'groundScale', label: 'Texture Scale', type: 'range', group: 'ground', min: 0.05, max: 10, step: 0.01, def: 1, hardMin: 0.01, gate: 'groundType', gateEq: [2, 3, 4, 5, 7] },
  { id: 'groundBump', label: 'Terrain / Waves', type: 'range', group: 'ground', min: 0, max: 3, step: 0.01, def: 0.3, gate: 'groundType', gateEq: [2, 3, 4, 5] },
  { id: 'groundReflect', label: 'Reflectivity', type: 'range', group: 'ground', min: 0, max: 1, step: 0.01, def: 0.6, gate: 'groundType', gateEq: [5, 6] },
  { id: 'groundRough', label: 'Blur (path traced)', type: 'range', group: 'ground', min: 0, max: 1, step: 0.01, def: 0.05, gate: 'groundType', gateEq: [5, 6] },
  { id: 'groundTiltX', label: 'Tilt X', type: 'range', group: 'ground', min: -45, max: 45, step: 0.1, def: 0, row: 'gtilt', section: 'Plane Orientation (degrees)', fine: true, gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundTiltZ', label: 'Tilt Z', type: 'range', group: 'ground', min: -45, max: 45, step: 0.1, def: 0, row: 'gtilt', fine: true, gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundYaw', label: 'Spin', type: 'range', group: 'ground', min: -180, max: 180, step: 0.1, def: 0, row: 'gtilt', fine: true, gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundOffX', label: 'Slide X', type: 'range', group: 'ground', min: -20, max: 20, step: 0.01, def: 0, row: 'goff', gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundOffZ', label: 'Slide Z', type: 'range', group: 'ground', min: -20, max: 20, step: 0.01, def: 0, row: 'goff', gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundFade', label: 'Horizon Haze', type: 'range', group: 'ground', min: 0, max: 2, step: 0.01, def: 0.3, gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'groundShadows', label: 'Receives Shadows', type: 'bool', group: 'ground', def: true, gate: 'groundType', gateEq: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'lightX', label: 'LX', type: 'range', group: 'light', min: -10, max: 10, step: 0.1, def: 2, row: 'light', section: 'Light Position' },
  { id: 'lightY', label: 'LY', type: 'range', group: 'light', min: -10, max: 10, step: 0.1, def: 4, row: 'light' },
  { id: 'lightZ', label: 'LZ', type: 'range', group: 'light', min: -10, max: 10, step: 0.1, def: 3, row: 'light' },
  { id: 'lightRelative', label: 'Headlight (follows camera)', type: 'bool', group: 'light', def: false },
  { id: 'ambient', label: 'Ambient', type: 'range', group: 'light', min: 0, max: 1, step: 0.01, def: 0.2 },
  { id: 'volumetric', label: 'Volumetric', type: 'range', group: 'light', min: 0, max: 10, step: 0.01, def: 1.5, hardMin: 0 },
  { id: 'fog', label: 'Fog', type: 'range', group: 'light', min: 0, max: 2, step: 0.01, def: 0.2 },
  { id: 'stepAO', label: 'Step AO (march glow)', type: 'range', group: 'light', min: 0, max: 2, step: 0.01, def: 1, section: 'Occlusion & Shadow' },
  { id: 'aoStrength', label: 'Surface AO', type: 'range', group: 'light', min: 0, max: 2, step: 0.01, def: 0, hardMin: 0 },
  { id: 'shadows', label: 'Soft Shadows', type: 'bool', group: 'light', def: false },
  { id: 'shadowSoft', label: 'Shadow Sharpness', type: 'range', group: 'light', min: 2, max: 64, step: 0.5, def: 12, hardMin: 0.5, gate: 'shadows' },

  // ── Sequencer ────────────────────────────────────────────────────────────
  { id: 'seqDuration', label: 'Trans. Duration (s)', type: 'range', group: 'seq', min: 0.5, max: 20, step: 0.1, def: 3, hardMin: 0.05, interp: 'none', noReset: true },
  { id: 'seqMode', label: 'Playback', type: 'select', group: 'seq', options: ['Once', 'Loop (seamless)', 'Ping-Pong'], def: 0, interp: 'none', noReset: true, row: 'seqsel' },
  { id: 'seqEasing', label: 'Interpolation', type: 'select', group: 'seq', options: ['Linear', 'Smooth (Catmull-Rom)', 'Ease In-Out'], def: 1, interp: 'none', noReset: true, row: 'seqsel' },
  { id: 'pulse', label: 'Scale Pulse', type: 'bool', group: 'seq', def: false, interp: 'step', noReset: true },

  // ── Video & frames export ───────────────────────────────────────────────
  { id: 'recMode', label: 'Record Mode', type: 'select', group: 'video', options: ['Real-time (live view)', 'Offline (frame-exact)'], def: 1, interp: 'none', noReset: true },
  { id: 'recRes', label: 'Resolution', type: 'select', group: 'video', options: ['As Save Image', 'Viewer', '720p', '1080p', '1440p', '4K'], def: 0, interp: 'none', noReset: true, row: 'recA' },
  { id: 'recFps', label: 'Frame Rate', type: 'select', group: 'video', options: ['24 fps', '30 fps', '60 fps'], def: 1, interp: 'none', noReset: true, row: 'recA' },
  { id: 'recQuality', label: 'Quality', type: 'select', group: 'video', options: ['Draft', 'Good', 'High', 'Maximum'], def: 2, interp: 'none', noReset: true, row: 'recB' },
  { id: 'recFormat', label: 'Format', type: 'select', group: 'video', options: ['MP4 (H.264)', 'WebM (VP9)'], def: 0, interp: 'none', noReset: true, row: 'recB' },
  { id: 'recSamples', label: 'Samples / Frame (offline)', type: 'range', group: 'video', min: 1, max: 256, step: 1, def: 16, int: true, hardMin: 1, interp: 'none', noReset: true },

  // ── Quality & output ────────────────────────────────────────────────────
  { id: 'renderScale', label: 'Live Render Scale', type: 'range', group: 'quality', min: 0.25, max: 1, step: 0.05, def: 1, hardMin: 0.1, hardMax: 1, interp: 'none', noReset: true },
  { id: 'maxSamples', label: 'Live Max Samples', type: 'range', group: 'quality', min: 1, max: 256, step: 1, def: 64, int: true, hardMin: 1, interp: 'none', noReset: true },
  { id: 'exportSamples', label: 'Export Samples / Pixel', type: 'range', group: 'quality', min: 1, max: 512, step: 1, def: 48, int: true, hardMin: 1, interp: 'none', noReset: true },
];

export const PARAM_BY_ID = new Map(PARAMS.map(p => [p.id, p]));

export function defaults() {
  const o = {};
  for (const p of PARAMS) o[p.id] = p.def;
  return o;
}

export function interpOf(p) {
  if (p.interp) return p.interp;
  if (p.type === 'bool' || p.type === 'select') return 'step';
  if (p.type === 'color') return 'color';
  if (p.type === 'text') return 'step';
  return 'lerp';
}

// Coerce + clamp a raw value into the param's domain. Returns undefined when the
// value is unusable (NaN, malformed colour) so callers can ignore it.
export function coerce(p, v) {
  switch (p.type) {
    case 'bool': return !!v;
    case 'select': {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) return undefined;
      return Math.max(0, Math.min(p.options.length - 1, n));
    }
    case 'text': return typeof v === 'string' ? v.slice(0, 4000) : undefined;
    case 'color': {
      if (typeof v !== 'string') return undefined;
      const s = v.trim().toLowerCase();
      return /^#[0-9a-f]{6}$/.test(s) ? s : undefined;
    }
    default: {
      let n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      if (p.int) n = Math.round(n);
      if (p.hardMin !== undefined && n < p.hardMin) n = p.hardMin;
      if (p.hardMax !== undefined && n > p.hardMax) n = p.hardMax;
      return n;
    }
  }
}
