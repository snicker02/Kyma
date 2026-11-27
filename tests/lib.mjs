// Test-side view of Kyma: the formula installed on the Organon engine, with
// the names the tests use (they predate the split into core/ + formula/).
import { fractalFrag } from '../formula/glsl.js';
import '../formula/index.js';

export { PARAMS, GROUPS, PARAM_BY_ID, defaults, coerce, interpOf, effectiveIterations, defineParams, SCENE_PARAMS, SCENE_GROUPS } from '../core/engine/params.js';
export { FOLD_NAMES, SURF_VARIANTS, STACK_FOLDS, FORMULA_PARAMS } from '../formula/params.js';
export { State } from '../core/engine/state.js';
export { cameraBasis, pixelRay, lightWorldPos, extraLightPos } from '../core/engine/camera.js';
export * from '../core/engine/vec.js';
export { makeDE, repHash, repeatMap, marchInfo, march, probePixel, pickPixel, viewScore, suggestVolumeShell } from '../core/engine/de.js';
export { makeWave, makeSurfStep, sigRank1, gyroFoldMap, ICO_N, localDE } from '../formula/de.js';
export { Sequencer, MODE, EASE } from '../core/engine/sequencer.js';
export { encodeDiscovery, decodeDiscovery, evolve, rebirth, makeProject, parseProject, isActive, migrateLegacy, PROJECT_VERSION } from '../core/engine/presets.js';
export { BIOMES, VARIANT_DEFAULTS, VARIANT_DESC } from '../formula/presets.js';
export { sceneUniforms, jitterFor, lensFor, specOf, specKey, Renderer, envRotation, halton } from '../core/engine/renderer.js';
export { VERT, DISPLAY_FRAG } from '../core/engine/glsl.js';
export { FOLD_GLSL, STACK_GLSL, DEFAULT_STACK, fractalFrag, fractalMapSource } from '../formula/glsl.js';
export const FRACTAL_FRAG = fractalFrag(0, -1);
export { ZipWriter, crc32 } from '../core/engine/zip.js';
export { compileProgram, setUniforms } from '../core/engine/gl.js';
export { renderImage } from '../core/engine/export.js';
export { TEX_GEN, TEX_KEYS } from '../core/engine/textures.js';
export { importMandelbulber, parseFract } from '../core/engine/mbimport.js';
export { MB_FORMULAS } from '../formula/mbimport.js';
export { breed } from '../core/ui/mutation.js';
