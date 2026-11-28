// Kyma's formula parameters (the LEFT dock: what the fractal is). The right
// dock (scene & output) is Organon's; see core/engine/params.js for the field
// reference. defineParams() runs once, when this module loads.

import { defineParams, marchParams, PI } from '../core/engine/params.js';
export * from '../core/engine/params.js';

export const GROUPS_LEFT = [
  { id: 'presets', side: 'left',  title: 'Biome Presets', accent: true, open: true },
  { id: 'variant', side: 'left',  title: 'Surf Variant', accent: true, open: true },
  { id: 'geo',     side: 'left',  title: 'Geometric Core', open: true },
  { id: 'ftype',   side: 'left',  title: 'Fold Types', accent: true, open: true },
  { id: 'fold',    side: 'left',  title: 'Folding & Space' },
  { id: 'inv',     side: 'left',  title: 'Spherical Inversion', accent: true },
  { id: 'wave',    side: 'left',  title: 'Wave Warp', accent: true },
  { id: 'iter',    side: 'left',  title: 'Iteration' },
];

export const SURF_VARIANTS = ['Classic (v2 engine)', 'Amazing Surf (Mandelbulber)', 'Mod 1', 'Mod 2', 'Mod 3', 'Mod 4', 'Multi', 'M3D (Mandelbulb3D)', 'Klein', 'Klein V2', 'Amazing IFS', 'Loxodromic Surf (Kyma)', 'Torus Surf (Kyma)', 'Ellipsoid Surf (Kyma)', 'Vortex Surf (Kyma)', 'Gyroid Surf (Kyma)'];
export const STACK_FOLDS = ['Off', 'Box (Tglad)', 'Inverse Fold  f−||z|−f|', 'Abs Offset  |z+f|', 'Conditional Reflect', 'DarkBeam Double', 'Clamped Folder'];
// Variant groups (indices into SURF_VARIANTS) used to gate controls.
const V_STACK = [2, 3, 4, 6];         // fold-stack variants
const V_ALL_BUT_KLEIN = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15];
const V_KYMA = [11, 12, 13, 14, 15]; // Kyma's own surf variants // variants that take c (IFS only with Add c)

export const FOLD_NAMES = ['Type 1 (Box)', 'Type 2', 'Type 3', 'Surf XY (Mandelbulber)', 'Tetrahedral + Box', 'Octahedral + Box', 'Icosahedral + Box', 'Polar Kaleidoscope', 'Smooth Box (tanh)', 'Abs Shift (Kali)', 'Diagonal Box', 'Kali Type 2 (XY)', 'Kali Type 3 (XY)'];

export const FORMULA_PARAMS = [
  // ── Surf variant (Mandelbulber surf family, reimplemented) ─────────────────
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

  // ── Kyma's own surf variants (11–15) ──
  { id: 'vLoxX', label: 'TX', type: 'range', group: 'variant', min: -3, max: 3, step: 0.001, def: 0, hardMin: -50, hardMax: 50, row: 'vlox', section: 'Spiral Twist about X / Y / Z', gate: 'surfVariant', gateEq: 11, mutate: true },
  { id: 'vLoxY', label: 'TY', type: 'range', group: 'variant', min: -3, max: 3, step: 0.001, def: 0, hardMin: -50, hardMax: 50, row: 'vlox', gate: 'surfVariant', gateEq: 11, mutate: true },
  { id: 'vLoxZ', label: 'TZ', type: 'range', group: 'variant', min: -3, max: 3, step: 0.001, def: 0.6, hardMin: -50, hardMax: 50, row: 'vlox', gate: 'surfVariant', gateEq: 11, mutate: true },
  { id: 'vTorusOnX', label: 'Ring X', type: 'bool', group: 'variant', def: false, row: 'vton', section: "Rings around X / Y / Z (on, radius)", gate: 'surfVariant', gateEq: 12 },
  { id: 'vTorusOnY', label: 'Ring Y', type: 'bool', group: 'variant', def: false, row: 'vton', gate: 'surfVariant', gateEq: 12 },
  { id: 'vTorusOnZ', label: 'Ring Z', type: 'bool', group: 'variant', def: true, row: 'vton', gate: 'surfVariant', gateEq: 12 },
  { id: 'vTorusRX', label: 'RX', type: 'range', group: 'variant', min: 0, max: 2, step: 0.001, def: 0.6, hardMin: 0, hardMax: 20, row: 'vtor', gate: 'surfVariant', gateEq: 12, mutate: true },
  { id: 'vTorusRY', label: 'RY', type: 'range', group: 'variant', min: 0, max: 2, step: 0.001, def: 0.6, hardMin: 0, hardMax: 20, row: 'vtor', gate: 'surfVariant', gateEq: 12, mutate: true },
  { id: 'vTorusRZ', label: 'RZ', type: 'range', group: 'variant', min: 0, max: 2, step: 0.001, def: 0.6, hardMin: 0, hardMax: 20, row: 'vtor', gate: 'surfVariant', gateEq: 12, mutate: true },
  { id: 'vEllX', label: 'EX', type: 'range', group: 'variant', min: 0.2, max: 3, step: 0.001, def: 1, hardMin: 0.02, hardMax: 20, row: 'vell', section: 'Ellipsoid Stretch', gate: 'surfVariant', gateEq: 13, mutate: true },
  { id: 'vEllY', label: 'EY', type: 'range', group: 'variant', min: 0.2, max: 3, step: 0.001, def: 1, hardMin: 0.02, hardMax: 20, row: 'vell', gate: 'surfVariant', gateEq: 13, mutate: true },
  { id: 'vEllZ', label: 'EZ', type: 'range', group: 'variant', min: 0.2, max: 3, step: 0.001, def: 1.8, hardMin: 0.02, hardMax: 20, row: 'vell', gate: 'surfVariant', gateEq: 13, mutate: true },
  { id: 'vVortexX', label: 'TX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, hardMin: -20, hardMax: 20, row: 'vvt', section: 'Vortex Twist about X / Y / Z', gate: 'surfVariant', gateEq: 14, mutate: true },
  { id: 'vVortexY', label: 'TY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, hardMin: -20, hardMax: 20, row: 'vvt', gate: 'surfVariant', gateEq: 14, mutate: true },
  { id: 'vVortexZ', label: 'TZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0.4, hardMin: -20, hardMax: 20, row: 'vvt', gate: 'surfVariant', gateEq: 14, mutate: true },
  { id: 'vVortexDX', label: 'HX', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, hardMin: -20, hardMax: 20, row: 'vvd', section: 'Twist per Height along X / Y / Z', gate: 'surfVariant', gateEq: 14, mutate: true },
  { id: 'vVortexDY', label: 'HY', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, hardMin: -20, hardMax: 20, row: 'vvd', gate: 'surfVariant', gateEq: 14, mutate: true },
  { id: 'vVortexDZ', label: 'HZ', type: 'range', group: 'variant', min: -2, max: 2, step: 0.001, def: 0, hardMin: -20, hardMax: 20, row: 'vvd', gate: 'surfVariant', gateEq: 14, mutate: true },
  { id: 'vGyroFreq', label: 'Gyroid Frequency', type: 'range', group: 'variant', min: 0.2, max: 8, step: 0.001, def: 2, hardMin: 0.01, hardMax: 100, gate: 'surfVariant', gateEq: 15, mutate: true, fine: true },
  { id: 'vGyroL', label: 'Gyroid Fold Limit', type: 'range', group: 'variant', min: 0.02, max: 2, step: 0.001, def: 0.4, hardMin: 0.001, hardMax: 20, gate: 'surfVariant', gateEq: 15, mutate: true, fine: true },

  // ── Geometric core ──────────────────────────────────────────────────────
  { id: 'scale', label: 'Base Scale', type: 'range', group: 'geo', min: -4, max: 4, step: 0.001, def: 2, mutate: true },
  { id: 'scaleVary', label: 'Scale Vary', type: 'range', group: 'geo', min: -2, max: 2, step: 0.001, def: 0, mutate: true },
  { id: 'influence', label: 'Influence', type: 'range', group: 'geo', min: 0, max: 2, step: 0.001, def: 1, mutate: true, gate: 'surfVariant', gateEq: [0, 1, 2, 6, ...V_KYMA] },
  { id: 'minR', label: 'Min Radius', type: 'range', group: 'geo', min: 0, max: 2.5, step: 0.001, def: 0.5, hardMin: 0, mutate: true },
  { id: 'cylinder', label: 'Cylindrical Sphere-Fold', type: 'bool', group: 'geo', def: false },

  // ── Fold types ──────────────────────────────────────────────────────────
  { id: 'foldType', label: 'Fold A', type: 'select', group: 'ftype', options: FOLD_NAMES, def: 0, gate: 'surfVariant', gateEq: 0 },
  { id: 'foldType2', label: 'Hybrid Fold B', type: 'select', group: 'ftype', options: ['Off', ...FOLD_NAMES], def: 0, row: 'hybrid', gate: 'surfVariant', gateEq: 0 },
  { id: 'hybridPeriod', label: 'B Every N', type: 'range', group: 'ftype', min: 1, max: 8, step: 1, def: 2, int: true, hardMin: 1, hardMax: 40, row: 'hybrid', gate: 'surfVariant', gateEq: 0 },
  { id: 'polarN', label: 'Polar Sectors', type: 'range', group: 'ftype', min: 2, max: 16, step: 1, def: 6, int: true, hardMin: 1, hardMax: 64, gate: 'surfVariant', gateEq: [0, 9, 10] },
  { id: 'axisOrder', label: 'Axis Swap', type: 'select', group: 'ftype', options: ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'], def: 0, row: 'axis' },
  { id: 'classicDE', label: 'Distance Estimate', type: 'select', group: 'ftype', options: ['Kyma  |z| / 2dr', 'Kali  (|z| − |S−1|)/dr − |S|^(1−N)'], def: 0, gate: 'surfVariant', gateEq: 0 },
  { id: 'tgladWeight', label: 'Fold Weight', type: 'range', group: 'ftype', min: 0, max: 2, step: 0.01, def: 0, mutate: true, row: 'axis', gate: 'surfVariant', gateEq: 0 },

  // ── Folding & space ─────────────────────────────────────────────────────
  { id: 'foldX', label: 'FX', type: 'range', group: 'fold', min: 0, max: 4, step: 0.01, def: 1, row: 'fold', section: 'Fold Limits', mutate: true },
  { id: 'foldY', label: 'FY', type: 'range', group: 'fold', min: 0, max: 4, step: 0.01, def: 1, row: 'fold', mutate: true },
  { id: 'foldZ', label: 'FZ', type: 'range', group: 'fold', min: 0, max: 4, step: 0.01, def: 0, row: 'fold', mutate: true },
  { id: 'preTransX', label: 'TX', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, hardMin: -5, hardMax: 5, row: 'ptr', section: 'Pre-Translation (after the fold, Classic)', gate: 'surfVariant', gateEq: 0, mutate: true },
  { id: 'preTransY', label: 'TY', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, hardMin: -5, hardMax: 5, row: 'ptr', gate: 'surfVariant', gateEq: 0, mutate: true },
  { id: 'preTransZ', label: 'TZ', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, hardMin: -5, hardMax: 5, row: 'ptr', gate: 'surfVariant', gateEq: 0, mutate: true },
  { id: 'juliaMode', label: 'Julia Mode', type: 'bool', group: 'fold', def: true, gate: 'surfVariant', gateEq: V_ALL_BUT_KLEIN },
  { id: 'juliaCX', label: 'JX', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, row: 'julia', section: 'Julia Seed (C)', gate: 'juliaMode', mutate: true },
  { id: 'juliaCY', label: 'JY', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, row: 'julia', gate: 'juliaMode', mutate: true },
  { id: 'juliaCZ', label: 'JZ', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, row: 'julia', gate: 'juliaMode', mutate: true },
  { id: 'noC', label: "Don't Add c", type: 'bool', group: 'fold', def: false, gate: 'surfVariant', gateEq: [0, 1, 2, 3, 4, 5, 6, 7, ...V_KYMA] },
  { id: 'cMult', label: 'C-Mult', type: 'range', group: 'fold', min: -2, max: 2, step: 0.01, def: 0, mutate: true, gate: 'surfVariant', gateEq: [0, 1, 3, 4, 5, 6, ...V_KYMA] },
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
  { id: 'waveAmp', mutate: true, label: 'Amplitude', type: 'range', group: 'wave', min: -1, max: 1, step: 0.001, def: 0.15, hardMin: -10, hardMax: 10, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'waveFreq', mutate: true, label: 'Frequency', type: 'range', group: 'wave', min: 0.1, max: 20, step: 0.01, def: 3, hardMin: 0.001, hardMax: 200, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'wavePhase', mutate: true, label: 'Phase (animate me)', type: 'range', group: 'wave', min: -PI, max: PI, step: 0.001, def: 0, hardMin: -1000, hardMax: 1000, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'wavePhaseStep', label: 'Phase Shift per Iteration', type: 'range', group: 'wave', min: -PI, max: PI, step: 0.001, def: 0, hardMin: -100, hardMax: 100, gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6], fine: true },
  { id: 'waveAxX', label: 'WX', type: 'range', group: 'wave', min: -2, max: 2, step: 0.01, def: 1, row: 'wax', section: 'Axis Weights (Shear / Fold / Gyroid / Interference)', gate: 'waveType', gateEq: [2, 3, 5, 6] },
  { id: 'waveAxY', label: 'WY', type: 'range', group: 'wave', min: -2, max: 2, step: 0.01, def: 1, row: 'wax', gate: 'waveType', gateEq: [2, 3, 5, 6] },
  { id: 'waveAxZ', label: 'WZ', type: 'range', group: 'wave', min: -2, max: 2, step: 0.01, def: 1, row: 'wax', gate: 'waveType', gateEq: [2, 3, 5, 6] },
  { id: 'waveStart', label: 'From Iter', type: 'range', group: 'wave', min: 0, max: 20, step: 1, def: 0, int: true, hardMin: 0, hardMax: 249, row: 'wavi', gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6] },
  { id: 'waveStop', label: 'Until Iter', type: 'range', group: 'wave', min: 1, max: 40, step: 1, def: 3, int: true, hardMin: 1, hardMax: 250, row: 'wavi', gate: 'waveType', gateEq: [1, 2, 3, 4, 5, 6] },

  // ── Iteration ───────────────────────────────────────────────────────────
  { id: 'iterations', label: 'Iterations', type: 'range', group: 'iter', min: 1, max: 250, step: 1, def: 16, int: true, hardMin: 1, hardMax: 250 },
  ...marchParams(),
];

defineParams({
  groups: GROUPS_LEFT,
  params: FORMULA_PARAMS,
  scene: {
    expSmooth: true, // Organon 1.1: adds the 'Exp smoothing' colour source
    // Colour sources: Kyma adds the continuous fold amounts (Mandelbulber's
    // aux.color for the surf family) and a separate sphere-fold weight.
    override: {
      colorSource: { options: ['Orbit trap', 'Fold count (stripes)', 'Trap + folds', 'Fold amounts (continuous)'] },
      foldColW: { label: 'Box-Fold Color', gateEq: [1, 2, 3], row: 'fcol' },
      colorIters: { gateEq: [1, 2, 3], hardMax: undefined },
    },
    after: {
      foldColW: [{ id: 'sphColW', label: 'Sphere-Fold Color', type: 'range', group: 'style', min: 0, max: 2, step: 0.01, def: 0.5, gate: 'colorSource', gateEq: [1, 2, 3], row: 'fcol' }],
    },
  },
});
