// Kyma's formula-panel extras: the surf-variant description and "Load Variant
// Defaults", and the fold-type description. Organon calls setupUI() once,
// after the panel is built.

import { FOLD_NAMES, SURF_VARIANTS as SURF_VARIANT_NAMES } from './params.js';
import { VARIANT_DEFAULTS, VARIANT_DESC } from './presets.js';

export function setupUI({ state, panel, el, toast, pushHistory, pushSnapshot }) {
  // ── Surf variant ────────────────────────────────────────────────────────────
  const variantDesc = el('div', 'fold-desc');
  panel.controls.get('surfVariant').wrap.after(variantDesc);
  const variantDefaultsBtn = el('button', 'action-btn sm', 'Load Variant Defaults');
  variantDefaultsBtn.title = "Reset this formula's parameters to Mandelbulber's defaults (converted to this app's units)";
  variantDesc.after(variantDefaultsBtn);
  panel.gateNode(variantDefaultsBtn, { gate: 'surfVariant', gateEq: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15] });
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
      pushSnapshot(snap);
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
    'Full icosahedral symmetry (folds into one of the 120 mirror cells), then a box fold. Five-fold, quasi-crystal structure.',
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
}
