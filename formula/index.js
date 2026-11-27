// Kyma — the Amazing Surf formula family as an Organon formula module.
// Importing this file defines Kyma's parameters, builds its presets and
// installs the formula into the engine (core/engine/formula.js).

import { installFormula } from '../core/engine/formula.js';
import './params.js'; // defineParams() — must run before anything reads PARAMS
import { UNIFORMS, source, defines, spec, specKey, DEFAULT_SPEC } from './glsl.js';
import { uniforms } from './uniforms.js';
import { localDE } from './de.js';
import { BIOMES, migrateLegacy, rebirthCandidate, REBIRTH_TARGET } from './presets.js';
import { importFract } from './mbimport.js';
import { setupUI } from './ui.js';

export const VERSION = '2.22.0';

const formula = {
  id: 'kyma',
  name: 'Kyma',
  version: VERSION,
  brand: {
    globalName: '__surf',               // tests/browser.mjs and older notes use window.__surf
    discoveryPrefix: 'SURF2:',          // links shared before the rename still load
    legacyDockKey: 'amazing-surf.docks', // pre-rename panel layouts still load
  },

  // Shader + uniforms (glsl.js, uniforms.js).
  glsl: { uniforms: UNIFORMS, source, defines },
  uniforms,
  spec,
  specKey,
  defaultSpec: DEFAULT_SPEC,

  // CPU distance estimator (de.js), in lock-step with mapLocal().
  localDE,

  // Presets (presets.js), grouped in the menu.
  presets: BIOMES,
  presetGroups: [
    ['Classic engine', k => !BIOMES[k].group && !BIOMES[k].v.surfVariant],
    ['Mandelbulber Amazing Surf', k => !BIOMES[k].group && !!BIOMES[k].v.surfVariant],
    ['Amazing IFS', k => BIOMES[k].group === 'ifs'],
    ['Kyma Originals (new formulas)', k => BIOMES[k].group === 'kyma'],
    ['Kyma Waves', k => BIOMES[k].group === 'wave'],
    ["Brad's scenes", k => BIOMES[k].group === 'brad'],
    ['batjorge.com · Mandelbulber scenes', k => BIOMES[k].group === 'batjorge'],
  ],
  // Also reset to defaults when a preset is applied (unless it sets them).
  presetReset: /^(sphColW|vSInv\w+|wave\w+|noC|maxStep)$/,
  migrateLegacy,
  rebirth: { candidate: rebirthCandidate, target: REBIRTH_TARGET },

  // Mandelbulber import (mbimport.js).
  importFract,
  importTitle: 'Load a Mandelbulber .fract settings file (single Amazing IFS or Amazing Surf Mod 1 formula)',

  // Formula panel extras (ui.js).
  setupUI,
  shaderFallback: {
    message: 'Shader build failed for this combination — reverting to surface / box fold',
    values: () => ({ foldType: 0, foldType2: 0, surfVariant: 0 }),
  },
};

export default installFormula(formula);
