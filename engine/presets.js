// Biomes, Evolve / Rebirth, and the discovery-string codec.

import { PARAMS, PARAM_BY_ID, defaults, coerce, FOLD_NAMES, SURF_VARIANTS } from './params.js';
import { viewScore } from './de.js';
import { CUSTOM_GRADIENT, GRADIENTS } from './gradients.js';

// Partial presets — like v1, a biome only overrides what it names.
// Full scene (Brad, Nov 2026): Mandelbulber Amazing Surf, swap-YZ, Julia, sphere
// inversion. Every look parameter is set, so it lands the same whatever was loaded
// before. The presets after it are full scenes too, built as variations on it.
const CHALICE = {
    surfVariant: 1, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2,
    vZFold: false, vSwapXY: false, vSwapYZ: true, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0,
    vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 1, vOffX: 0, vOffY: 0, vOffZ: 0, vSphX: 0,
    vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vKleinIters: 8, vTailX: 1, vTailY: 1, vTailZ: 0,
    vTailScale: 2, vTailOffX: 0, vTailOffY: 0, vTailOffZ: 0, vPolyOn: false, vPolyAbsY: true, scale: 2,
    scaleVary: 0, influence: 1, minR: 0.8408964153, cylinder: false, foldType: 0, foldType2: 0,
    hybridPeriod: 2, polarN: 6, axisOrder: 0, tgladWeight: 0, foldX: 1, foldY: 1, foldZ: 1, juliaMode: true,
    juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: 0, beta: 0,
    gamma: 0, spinX: 0, spinY: 0, spinZ: 0, rotStart: 0, invEnabled: true, invMode: 0, invStrength: 1,
    invRadius: 1.705, invDELimit: 30, invCX: 0, invCY: 0.13, invCZ: -0.55, iterations: 16, maxSteps: 256,
    detail: 1, stepFactor: 1, maxDist: 100, missAsHit: false, debugView: 0, renderMode: 0, ptBounces: 3,
    ptRough: 0.5, ptMetal: 0, ptSun: 2.5, ptLightSize: 0.3, ptSky: 1, ptSkyColor: '#9fb4d9', ptEmit: 0,
    ptClamp: 20, volDensity: 20, volThick: 0.004, volGlow: 1.2, volLight: 0.5, volStepMin: 0.008,
    volSteps: 384, rotX: -0.16, rotY: -0.4743, dist: 12.298015555784776, lens: 1, rollX: 0, rollY: 0, rollZ: 0,
    autoRoll: false, rotSpeed: 0.5, rollAmount: 1, targetX: 0, targetY: 0, targetZ: 0, palette: 0,
    colorShift: 0, lightColor: '#e6f2ff', bgColor: '#010103', tonemap: 0, brightness: 1.2, vignette: 0.5,
    dofStrength: 0, focalDist: 5, envMode: 0, envIntensity: 1, envBlur: 0, envYaw: 0, envPitch: 0,
    envReflect: 0.4, envLight: 0.5, envFog: true, lightX: 2, lightY: 4, lightZ: 3, lightRelative: false,
    ambient: 0.2, volumetric: 1.5, fog: 0.2, stepAO: 1, aoStrength: 0, shadows: false, shadowSoft: 12,
    pulse: false
};


export const BIOMES = {
  spire: { label: 'Alien Spire', v: { scale: 2.1, minR: 0.15, iterations: 18, tgladWeight: 0.8, cMult: 0.05, palette: 3 } },
  city: { label: 'Glass City', v: { scale: 1.8, volumetric: 4.0, brightness: 1.5, foldX: 1.2, foldY: 1.2, foldZ: 0.1, palette: 2 } },
  ocean: { label: 'Neon Ocean', v: { scale: 2.4, minR: 0.8, influence: 1.2, colorShift: 0.5, tgladWeight: 0.2, palette: 0 } },
  reef: { label: 'Coral Reef', v: { foldType: 3, scale: 1.92, minR: 0.42, foldX: 1.0, foldY: 1.0, juliaCX: 0.6, juliaCY: 0.3, juliaCZ: 0.5, alpha: 0.2, palette: 6, colorShift: 0.31, iterations: 14 } },
  opal: { label: 'Opal Carpet', v: { foldType: 3, cylinder: true, scale: 2.2, minR: 0.3, foldX: 1.0, foldY: 1.0, juliaCX: 0.4, juliaCY: 0.2, juliaCZ: 0.8, palette: 7, iterations: 14, rotX: 0, rotY: 0.6, dist: 6, aoStrength: 0.6, invEnabled: false } },
  lace: { label: 'Apollonian Lace', v: { invEnabled: true, invMode: 0, invStrength: 0.55, invRadius: 1.4, invCX: 0, invCY: 0, invCZ: 1.0, scale: 2.1, minR: 0.4, palette: 5, iterations: 12, rotX: 0, rotY: 0, dist: 4 } },
  penrose: { label: 'Penrose Rosette', v: { foldType: 7, foldType2: 0, polarN: 5, palette: 5, rotX: 0, rotY: 0, dist: 9, rollX: 0, rollY: 0, rollZ: 0, targetX: 0, targetY: 0, targetZ: 0, invEnabled: false } },
  mandala: { label: 'Octo Mandala', v: { foldType: 7, foldType2: 0, polarN: 8, juliaCX: 0.3, juliaCY: 0.2, juliaCZ: 0, palette: 5, rotX: 0, rotY: 0, dist: 9, rollX: 0, rollY: 0, rollZ: 0, targetX: 0, targetY: 0, targetZ: 0, invEnabled: false } },
  bloom: { label: 'Hybrid Bloom', v: { foldType: 0, foldType2: 9, hybridPeriod: 2, foldZ: 0.8, aoStrength: 0.5, rotX: 0.5, rotY: 0.55, dist: 7, invEnabled: false } },
  chalice: { label: 'Crimson Chalice', v: CHALICE },
  ember: { label: 'Ash Grotto', v: { ...CHALICE, surfVariant: 2, minR: 0.8408964152537146, invRadius: 1.6, invCX: 0.2, invCY: 0.1, invCZ: -0.5, rotX: 0.35, rotY: -0.3, dist: 10, palette: 1, colorShift: 0.15, lightColor: '#ffd9b0', bgColor: '#070302', fog: 0.35 } },
  frost: { label: 'Frost Cathedral', v: { ...CHALICE, vSwapYZ: false, minR: 0.8408964152537146, invRadius: 1.4, invCY: -0.2, invCZ: 0.4, rotX: 0, rotY: -0.5, dist: 6.5, palette: 7, colorShift: 0.6, lightColor: '#d6ecff', bgColor: '#02050a', tonemap: 1, brightness: 1, aoStrength: 0.6 } },
  tide: { label: 'Night Geode', v: { ...CHALICE, surfVariant: 3, minR: 0.5, invRadius: 1.8, invCX: -0.3, invCY: 0.2, invCZ: -0.4, rotX: -0.6, rotY: -0.2, dist: 12, palette: 2, colorShift: 0.25, bgColor: '#01040a', fog: 0.4 } },
  orchid: { label: 'Orchid Spiral', v: { ...CHALICE, minR: 0.8408964152537146, gamma: 0.15, spinZ: 0.12, rotX: 0.6, rotY: -0.45, dist: 12, palette: 5, colorShift: 0.1 } },
  dust: { label: 'Stardust Veil', v: { ...CHALICE, minR: 0.8408964152537146, renderMode: 2, rotY: -0.47, dist: 12.3, palette: 5, colorShift: 0.3, bgColor: '#000000' } },
  m3d: { label: 'Copper Canopy', v: { ...CHALICE, surfVariant: 7, scale: 1.5, minR: 0.5, invRadius: 1.65, invCY: 0.2, invCZ: -0.5, rotX: 0.4, rotY: -0.4, dist: 11, palette: 1, colorShift: 0.55 } },
};

// Scenes by batjorge (fractal.batjorge.com), shared with permission. Imported
// from his Mandelbulber settings files with engine/mbimport.js: formula, camera
// and fractal transform exact; materials, sky and primitives approximated.
Object.assign(BIOMES, {
  bj_voyager: { group: 'batjorge', label: 'Voyager', v: { surfVariant: 10, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: false, vSwapXY: false, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 0, vOffX: 0, vOffY: 0, vOffZ: -0.5, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vPolyOn: false, vSInvOn: true, vSInvOffX: 0, vSInvOffY: 0, vSInvOffZ: 0, vSInvAddX: 0, vSInvAddY: 0, vSInvAddZ: -0.3, vSInvG: 1, vSInvA: 3.2, vSInvStart: 0, vSInvStop: 1, vPolyStop: 1, vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 0, vIfsY: 0, vIfsZ: 0, vIfsOffX: 0, vIfsOffY: 0, vIfsOffZ: 0, vIfsAddX: 0.4, vIfsAddY: 0.07, vIfsAddZ: 0, vAddC: false, vMinDE: false, vMinDEStop: 250, vMinDEStart: 0, scale: 1.21, scaleVary: 0, minR: 0, cylinder: false, polarN: 6, foldX: 3, foldY: 3.2, foldZ: 0.5, juliaMode: false, juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: -0.0866689364513, beta: -0.120070627044, gamma: -0.155100433555, rotStart: 0, invEnabled: false, iterations: 250, maxSteps: 1024, detail: 2, stepFactor: 0.5, maxStep: 3, maxDist: 50, rotX: 0.688126873013, rotY: -0.639241154898, dist: 7.00202620269, lens: 1.58579740118, rollX: 0, rollY: 0, rollZ: 0.0933784876723, targetX: 0.697734656427, targetY: -0.489855115246, targetZ: -0.61191010132, palette: 36, colorShift: 0, colorSource: 0, gradStops: '0.0000:#fd6029 0.0999:#698403 0.1999:#fff59b 0.2999:#f5bd22 0.3999:#0b5e87 0.5000:#c68876 0.5999:#a51c64 0.7000:#3b9fee 0.7999:#d4ffd4 0.9000:#aba53c', gradRepeat: 1, lightColor: '#e6e9ec', bgColor: '#8fb2d6', brightness: 0.96, dofStrength: 0.3, focalDist: 6.82330036163, objX: 0.186282456983, objY: -0.522736540494, objZ: 0.31496500004, objRotX: -12.7110765746, objRotY: 101.804426471, objRotZ: -65.0316103383, objScale: 1, groundType: 5, groundY: -0.261522806937, groundColor: '#0b2a3a', groundScale: 1.6, groundBump: 0.145, groundReflect: 0.85, groundRough: 0.05, groundTiltX: 0, groundTiltZ: 0, groundYaw: 0, groundOffX: 0, groundOffZ: 0, groundFade: 0.3, lightX: -20.2339492832, lightY: 17.641419834, lightZ: 3.58039371108, lightRelative: false, fog: 0.15, aoStrength: 0.6, shadows: true } },
  bj_cuentos: { group: 'batjorge', label: 'Cuentos', v: { surfVariant: 10, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: true, vSwapXY: false, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 0, vOffX: -0.3, vOffY: -0.71, vOffZ: -1, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vPolyOn: false, vSInvOn: true, vSInvOffX: -1.9, vSInvOffY: -0.2, vSInvOffZ: 0, vSInvAddX: 0, vSInvAddY: 0, vSInvAddZ: 0.5, vSInvG: 1, vSInvA: 2.6, vSInvStart: 0, vSInvStop: 1, vPolyStop: 1, vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 2, vIfsY: 2, vIfsZ: 2, vIfsOffX: 0.4, vIfsOffY: -2.4, vIfsOffZ: 1.2, vIfsAddX: 0, vIfsAddY: 0, vIfsAddZ: 0, vAddC: false, vMinDE: false, vMinDEStop: 250, vMinDEStart: 0, scale: 1.11, scaleVary: 0, minR: 0, cylinder: false, polarN: 6, foldX: 2.3, foldY: 3.2, foldZ: 0.00625, juliaMode: false, juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: -0.00672884850826, beta: -0.0887362425483, gamma: -0.121112257579, rotStart: 0, invEnabled: false, iterations: 250, maxSteps: 1024, detail: 2, stepFactor: 1, maxStep: 3, maxDist: 50, rotX: -1.13283345201, rotY: -0.191320556994, dist: 12.4199982418, lens: 1.48721985653, rollX: 0, rollY: 0, rollZ: 0.103603707128, targetX: -2.7511567707, targetY: 0.213364096544, targetZ: -1.4339276786, palette: 36, colorShift: 0, colorSource: 0, gradStops: '0.0000:#fd6029 0.0999:#698403 0.1999:#fff59b 0.2999:#f5bd22 0.3999:#0b5e87 0.5000:#c68876 0.5999:#a51c64 0.7000:#3b9fee 0.7999:#d4ffd4 0.9000:#aba53c', gradRepeat: 1, lightColor: '#ededed', bgColor: '#65818e', brightness: 1.08, dofStrength: 0.375, focalDist: 8.24814414978, objX: 0, objY: 0, objZ: 0, objRotX: 51.1415642396, objRotY: 25.1522556823, objRotZ: -130.007048121, objScale: 1, groundType: 5, groundY: -0.288149615176, groundColor: '#0b2a3a', groundScale: 0.8, groundBump: 0.0382882676494, groundReflect: 0.85, groundRough: 0.05, groundTiltX: 0, groundTiltZ: 0, groundYaw: 0, groundOffX: 0, groundOffZ: 0, groundFade: 0.3, lightX: -27.7512795205, lightY: 33.3176202991, lightZ: 25.9011008562, lightRelative: false, fog: 0.04, aoStrength: 0.6, shadows: true } },
  bj_setas: { group: 'batjorge', label: 'Una de Setas', v: { surfVariant: 2, vStack1: 5, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: false, vSwapXY: false, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 1, vOffX: -0.006, vOffY: 0.36, vOffZ: -0.139, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, scale: 1.121, scaleVary: 0, influence: 1, minR: 0.177827941004, cylinder: false, foldX: 0.84, foldY: 0.84, foldZ: 1, juliaMode: false, juliaCX: 0, juliaCY: 0, juliaCZ: 0, noC: true, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: -0.109834610653, beta: -0.0128962345535, gamma: 0.212014620071, rotStart: 0, invEnabled: false, iterations: 250, maxSteps: 1024, detail: 2.5, stepFactor: 2, maxStep: 3, maxDist: 50, rotX: -0.000893905491081, rotY: -0.711926480656, dist: 3.41524744957, lens: 5.01443894023, rollX: 0, rollY: 0, rollZ: 1.83109820709e-14, targetX: 4.73407684276, targetY: 0.917277319286, targetZ: 9.51599483039, palette: 36, colorShift: 0.48, colorSource: 0, gradStops: '0.0000:#eac385 0.2313:#093041 0.3743:#7a86b9 0.6229:#ee39d6 0.8457:#a7edd2', gradRepeat: 0.25, lightColor: '#ede5df', bgColor: '#0e38c1', brightness: 1.2, dofStrength: 0.4, focalDist: 3.25788784027, objX: 0, objY: 0, objZ: 0, objRotX: -90, objRotY: 0, objRotZ: 0, objScale: 1, groundType: 0, lightX: 14.145251977, lightY: 9.38510992469, lightZ: 4.38294156483, lightRelative: false, fog: 0.04, aoStrength: 0.6, shadows: true } },
  bj_amrand: { group: 'batjorge', label: 'Amrand', v: { surfVariant: 10, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: false, vSwapXY: false, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 0, vOffX: 0, vOffY: 0, vOffZ: 0, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vPolyOn: false, vSInvOn: false, vSInvOffX: 0, vSInvOffY: 0, vSInvOffZ: -1, vSInvAddX: 0, vSInvAddY: 0, vSInvAddZ: 0, vSInvG: 1, vSInvA: 1, vSInvStart: 0, vSInvStop: 1, vPolyStop: 1, vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 0, vIfsY: 0, vIfsZ: 0, vIfsOffX: 0, vIfsOffY: 0, vIfsOffZ: 0, vIfsAddX: 0.3, vIfsAddY: 0, vIfsAddZ: 0, vAddC: false, vMinDE: false, vMinDEStop: 250, vMinDEStart: 0, scale: 1.16, scaleVary: 0, minR: 0.387298334621, cylinder: false, polarN: 6, foldX: 0.87, foldY: 0.85, foldZ: 0.5, juliaMode: false, juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: -0.0196999259061, beta: -0.0755183355799, gamma: -0.207476191231, rotStart: 0, invEnabled: false, iterations: 250, maxSteps: 1024, detail: 0.5, stepFactor: 1, maxStep: 3, maxDist: 30, rotX: 0.409509124074, rotY: -0.103399798567, dist: 1.66308999141, lens: 5.43608728047, rollX: 0, rollY: 0, rollZ: -0.0725003837523, targetX: -1.34431964107, targetY: 0.12629770894, targetZ: 0.867958984893, palette: 36, colorShift: 0, colorSource: 0, gradStops: '0.0000:#fd6029 0.0999:#698403 0.1999:#fff59b 0.2999:#f5bd22 0.3999:#0b5e87 0.5000:#c68876 0.5999:#a51c64 0.7000:#3b9fee 0.7999:#d4ffd4 0.9000:#aba53c', gradRepeat: 1, lightColor: '#ebebeb', bgColor: '#8fb2d6', brightness: 1.2, dofStrength: 0.4, focalDist: 1.65825736523, objX: 0, objY: 0, objZ: 0, objRotX: -90, objRotY: 0, objRotZ: 0, objScale: 1, groundType: 0, lightX: 6.92853845115, lightY: 5.6377648967, lightZ: 1.95586910267, lightRelative: false, fog: 0.04, aoStrength: 0.6, shadows: true } },
});

// Amazing IFS scenes (v2.10): striped shells and ornament from the IFS fold +
// Fold-amounts colouring. Full scenes, so they load the same from any state.
Object.assign(BIOMES, {
  ifs_shells: { group: 'ifs', label: 'Striped Shells', v: { vPolyStop: 250, vMinDEStop: 250, vSInvOn: false, surfVariant: 10, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: false, vSwapXY: false, vSwapYZ: true, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 0, vOffX: 0, vOffY: 0, vOffZ: 0, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vKleinIters: 8, vTailX: 1, vTailY: 1, vTailZ: 0, vTailScale: 2, vTailOffX: 0, vTailOffY: 0, vTailOffZ: 0, vPolyOn: false, vPolyAbsY: true, vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 1, vIfsY: 1, vIfsZ: 1, vIfsOffX: 0.4506061554, vIfsOffY: 0.3697864532, vIfsOffZ: 0.184861359, vIfsAddX: 0, vIfsAddY: 0.0699347496, vIfsAddZ: 0, vAddC: false, vMinDE: false, vMinDEStart: 4, scale: 1.588699245, scaleVary: 0, influence: 1, minR: 0.3909022236, cylinder: false, foldType: 0, foldType2: 0, hybridPeriod: 2, polarN: 6, axisOrder: 0, tgladWeight: 0, foldX: 0.2408684731, foldY: 0.2538357854, foldZ: 0.3032530308, juliaMode: true, juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: 0.4549626112, beta: 0.3624757528, gamma: 0.1913203001, spinX: 0, spinY: 0, spinZ: 0, rotStart: 0, invEnabled: false, invMode: 0, invStrength: 1, invRadius: 1, invDELimit: 10, invCX: 0, invCY: 0, invCZ: 0, iterations: 14, maxSteps: 256, detail: 1, stepFactor: 1, maxDist: 100, missAsHit: false, debugView: 0, renderMode: 0, ptBounces: 3, ptRough: 0.5, ptMetal: 0, ptSun: 2.5, ptLightSize: 0.3, ptSky: 1, ptSkyColor: '#9fb4d9', ptEmit: 0, ptClamp: 20, volDensity: 20, volThick: 0.004, volGlow: 1.2, volLight: 0.5, volStepMin: 0.008, volSteps: 384, rotX: -1.000309022, rotY: -0.5555355191, dist: 9, lens: 1, rollX: 0, rollY: 0, rollZ: 0, autoRoll: false, rotSpeed: 0.5, rollAmount: 1, targetX: 0, targetY: 0, targetZ: 0, palette: 28, colorShift: 0, colorSource: 3, foldColW: 1, sphColW: 1, colorIters: 3, gradRepeat: 1, gradWrap: 0, gradReverse: false, gradHue: 0, gradSat: 1, gradC1: '#0b0b2b', gradC2: '#5e2ca5', gradC3: '#e0457b', gradC4: '#ffb347', gradC5: '#fff6d5', lightColor: '#e6f2ff', bgColor: '#5f86a8', tonemap: 0, brightness: 1.3, vignette: 0.5, dofStrength: 0.15, focalDist: 8.1, envMode: 0, envIntensity: 1, envBlur: 0, envYaw: 0, envPitch: 0, envReflect: 0.4, envLight: 0.5, envFog: true, lightX: 1.5, lightY: 2.5, lightZ: 3, lightRelative: true, ambient: 0.3, volumetric: 1.5, fog: 0.05, stepAO: 1, aoStrength: 0.5, shadows: true, shadowSoft: 12, pulse: false } },
  ifs_bowl: { group: 'ifs', label: 'Ribbon Bowl', v: { vPolyStop: 250, vMinDEStop: 250, vSInvOn: false, surfVariant: 10, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: false, vSwapXY: false, vSwapYZ: true, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 0, vOffX: 0, vOffY: 0, vOffZ: 0, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vKleinIters: 8, vTailX: 1, vTailY: 1, vTailZ: 0, vTailScale: 2, vTailOffX: 0, vTailOffY: 0, vTailOffZ: 0, vPolyOn: true, vPolyAbsY: true, vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 1, vIfsY: 0, vIfsZ: 1, vIfsOffX: 0.5088310242, vIfsOffY: 0.3004768372, vIfsOffZ: 0.7635133117, vIfsAddX: 0, vIfsAddY: 0, vIfsAddZ: 0, vAddC: false, vMinDE: false, vMinDEStart: 6, scale: 1.651166248, scaleVary: 0, influence: 1, minR: 0.2209088612, cylinder: false, foldType: 0, foldType2: 0, hybridPeriod: 2, polarN: 6, axisOrder: 0, tgladWeight: 0, foldX: 0.5074466705, foldY: 0.3568065643, foldZ: 0.2553943634, juliaMode: true, juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: -0.01859498024, beta: -0.1751625538, gamma: -0.4573366642, spinX: 0, spinY: 0, spinZ: 0, rotStart: 0, invEnabled: false, invMode: 0, invStrength: 1, invRadius: 1, invDELimit: 10, invCX: 0, invCY: 0, invCZ: 0, iterations: 14, maxSteps: 256, detail: 1, stepFactor: 1, maxDist: 100, missAsHit: false, debugView: 0, renderMode: 0, ptBounces: 3, ptRough: 0.5, ptMetal: 0, ptSun: 2.5, ptLightSize: 0.3, ptSky: 1, ptSkyColor: '#9fb4d9', ptEmit: 0, ptClamp: 20, volDensity: 20, volThick: 0.004, volGlow: 1.2, volLight: 0.5, volStepMin: 0.008, volSteps: 384, rotX: -0.2635883455, rotY: -0.4560403705, dist: 16.5, lens: 1, rollX: 0, rollY: 0, rollZ: 0, autoRoll: false, rotSpeed: 0.5, rollAmount: 1, targetX: 0, targetY: 0, targetZ: 0, palette: 30, colorShift: 0, colorSource: 3, foldColW: 1, sphColW: 1, colorIters: 4, gradRepeat: 1, gradWrap: 0, gradReverse: false, gradHue: 0, gradSat: 1, gradC1: '#0b0b2b', gradC2: '#5e2ca5', gradC3: '#e0457b', gradC4: '#ffb347', gradC5: '#fff6d5', lightColor: '#e6f2ff', bgColor: '#7a8a3a', tonemap: 0, brightness: 1.3, vignette: 0.5, dofStrength: 0.15, focalDist: 14.85, envMode: 0, envIntensity: 1, envBlur: 0, envYaw: 0, envPitch: 0, envReflect: 0.4, envLight: 0.5, envFog: true, lightX: 1.5, lightY: 2.5, lightZ: 3, lightRelative: true, ambient: 0.3, volumetric: 1.5, fog: 0.05, stepAO: 1, aoStrength: 0.5, shadows: true, shadowSoft: 12, pulse: false } },
  ifs_ring: { group: 'ifs', label: 'Ring Reliquary', v: { vPolyStop: 250, vMinDEStop: 250, vSInvOn: false, surfVariant: 10, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0, vFoldValue: 2, vFold2: 2, vZFold: false, vSwapXY: false, vSwapYZ: true, vEvenFlipY: false, vEvenFlipZ: false, vFlip: 0, vCSwizzle: 0, vMboxFold: false, vFixedR2: 1, vDEOffset: 0, vOffX: 0, vOffY: 0, vOffZ: 0, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vKleinIters: 8, vTailX: 1, vTailY: 1, vTailZ: 0, vTailScale: 2, vTailOffX: 0, vTailOffY: 0, vTailOffZ: 0, vPolyOn: true, vPolyAbsY: true, vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 1, vIfsY: 0, vIfsZ: 1, vIfsOffX: 0.2186544418, vIfsOffY: 0.3502332896, vIfsOffZ: 0.496761632, vIfsAddX: 0, vIfsAddY: 0, vIfsAddZ: 0.3919864655, vAddC: false, vMinDE: true, vMinDEStart: 5, scale: 1.550363922, scaleVary: 0, influence: 1, minR: 0.342587595, cylinder: false, foldType: 0, foldType2: 0, hybridPeriod: 2, polarN: 5, axisOrder: 0, tgladWeight: 0, foldX: 0.3186204433, foldY: 0.3988933086, foldZ: 0.2122098446, juliaMode: true, juliaCX: 0, juliaCY: 0, juliaCZ: 0, cMult: 0, preAlpha: 0, preBeta: 0, preGamma: 0, alpha: 0.227340579, beta: -0.2300640345, gamma: -0.354989171, spinX: 0, spinY: 0, spinZ: 0, rotStart: 0, invEnabled: false, invMode: 0, invStrength: 1, invRadius: 1, invDELimit: 10, invCX: 0, invCY: 0, invCZ: 0, iterations: 14, maxSteps: 256, detail: 1, stepFactor: 1, maxDist: 100, missAsHit: false, debugView: 0, renderMode: 0, ptBounces: 3, ptRough: 0.5, ptMetal: 0, ptSun: 2.5, ptLightSize: 0.3, ptSky: 1, ptSkyColor: '#9fb4d9', ptEmit: 0, ptClamp: 20, volDensity: 20, volThick: 0.004, volGlow: 1.2, volLight: 0.5, volStepMin: 0.008, volSteps: 384, rotX: -0.2479092342, rotY: 0.295173955, dist: 11.2, lens: 1, rollX: 0, rollY: 0, rollZ: 0, autoRoll: false, rotSpeed: 0.5, rollAmount: 1, targetX: 0, targetY: 0, targetZ: 0, palette: 29, colorShift: 0, colorSource: 3, foldColW: 1, sphColW: 1, colorIters: 4, gradRepeat: 1, gradWrap: 0, gradReverse: false, gradHue: 0, gradSat: 1, gradC1: '#0b0b2b', gradC2: '#5e2ca5', gradC3: '#e0457b', gradC4: '#ffb347', gradC5: '#fff6d5', lightColor: '#e6f2ff', bgColor: '#0d1a2e', tonemap: 0, brightness: 1.3, vignette: 0.5, dofStrength: 0.15, focalDist: 10.08, envMode: 0, envIntensity: 1, envBlur: 0, envYaw: 0, envPitch: 0, envReflect: 0.4, envLight: 0.5, envFog: true, lightX: 1.5, lightY: 2.5, lightZ: 3, lightRelative: true, ambient: 0.3, volumetric: 1.5, fog: 0.05, stepAO: 1, aoStrength: 0.5, shadows: true, shadowSoft: 12, pulse: false } },
});


const r = (a, b) => a + Math.random() * (b - a);
const ri = n => Math.floor(Math.random() * n);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// Is a control live for the current values? (bool gate, or select gate with gateEq.)
export function isActive(p, values) {
  if (!p.gate) return true;
  const g = values[p.gate];
  if (p.gateEq === undefined) return !!g;
  return Array.isArray(p.gateEq) ? p.gateEq.includes(g) : g === p.gateEq;
}

// ── Surf-variant defaults (Mandelbulber's, converted to this app's units) ──
// Our Min Radius r thresholds the sphere fold at r². Mandelbulber's reference
// Amazing Surf / Mod 1 / Multi(Abox) threshold at sqrt(minR05) = sqrt(0.5), so
// r = 0.5^(1/4) ≈ 0.8409; Mod 2/4 and M3D use minR² = 0.25 → r = 0.5; Klein's
// minR0 = 0 is approximated by a tiny radius (0 would divide by zero).
const MB_COMMON = { foldX: 1, foldY: 1, foldZ: 1, scaleVary: 0, cMult: 0, cylinder: false, vStack1: 1, vStack2: 0, vStack3: 0, vStack4: 0, vStack5: 0,
  vFoldValue: 2, vFold2: 2, vOffX: 0, vOffY: 0, vOffZ: 0, vSphX: 0, vSphY: 0, vSphZ: 0, vPostX: 0, vPostY: 0, vPostZ: 0, vFixedR2: 1, vDEOffset: 1,
  vZFold: false, vSwapXY: false, vEvenFlipY: false, vEvenFlipZ: false, vMboxFold: false, vFlip: 0, vCSwizzle: 0 };
const R4 = Math.pow(0.5, 0.25);
export const VARIANT_DEFAULTS = {
  0: {},
  1: { ...MB_COMMON, scale: 2, minR: R4, influence: 1 },
  2: { ...MB_COMMON, scale: 2, minR: R4, influence: 1 },
  3: { ...MB_COMMON, scale: 2, minR: 0.5 },
  4: { ...MB_COMMON, scale: 2, minR: 0.1 },
  5: { ...MB_COMMON, scale: 2, minR: 0.5 },
  6: { ...MB_COMMON, scale: 2, minR: R4, influence: 1 },
  7: { ...MB_COMMON, scale: 1.5, minR: 0.5 },
  8: { ...MB_COMMON, scale: 1, minR: 0.01, vKleinIters: 8, vSwapYZ: true, vTailX: 1, vTailY: 1, vTailZ: 0, vTailScale: 2, vTailOffX: 0, vTailOffY: 0, vTailOffZ: 0 },
  9: { ...MB_COMMON, scale: 1, minR: 0.01, vKleinIters: 8, vTailX: 1, vTailY: 1, vTailZ: 0, vTailScale: 2, vTailOffX: 0, vTailOffY: 0, vTailOffZ: 0, vPolyOn: false, vPolyAbsY: true, polarN: 8 },
  // Mandelbulber's Amazing IFS defaults: fold limits 0.5, min R² 0.25, scale 2,
  // DE offset 0, no c, IFS fold off.
  10: { ...MB_COMMON, scale: 2, minR: 0.5, foldX: 0.5, foldY: 0.5, foldZ: 0.5, vZFold: false, vDEOffset: 0,
    vPreAbsX: false, vPreAbsY: false, vPreAbsZ: false, vIfsX: 0, vIfsY: 0, vIfsZ: 0, vIfsOffX: 0, vIfsOffY: 0, vIfsOffZ: 0,
    vIfsAddX: 0, vIfsAddY: 0, vIfsAddZ: 0, vAddC: false, vMinDE: false, vMinDEStart: 0, vMinDEStop: 250, vPolyStop: 1,
 vPolyOn: false, polarN: 6, vOffX: 0, vOffY: 0, vOffZ: 0 },
};

export const VARIANT_DESC = [
  'This app\'s own engine: 11 fold types plus a hybrid fold B, applied to all three axes. Kept for your existing work.',
  'Kali / DarkBeam Amazing Surf as Mandelbulber runs it: X/Y box fold only, combined sphere fold and scale, c·swap · C-Mult then c added after rotation, bailout 100.',
  'Mod 1: a stack of X/Y folds, a pre-sphere offset, an Abox sphere fold (minimum radius r → 1/r²), then a separate scale step blended by Influence.',
  'Mod 2: fold stack, optional Z fold and X/Y swap, a Mandelbox sphere fold with movable centre and adjustable outer radius², additive scale. C-Mult adds a swizzled c BEFORE folding.',
  'Mod 3: like Mod 2, with Y/Z sign flips on even iterations; C-Mult adds the swizzled c AFTER scaling. Try the Clamped Folder slot.',
  'Mod 4: X/Y (+Z) box fold, offset, combined sphere fold and additive scale, swapped-c add, post offset. Pair it with Spherical Inversion (Pre-Fold), as Mandelbulber does.',
  'Multi: up to five stacked folds of five kinds, optional Z reflect, an Abox sphere fold with an optional Mandelbox sphere fold on top, Influence-blended scale.',
  'M3D: the Mandelbulb3D original. Default scale 1.5, no Influence, plain (unswapped) c, DE offset, optional sign flips, post offset.',
  'Klein: surf iterations (with Y/Z swap) for the first N, then a full box fold × scale tail that produces Kleinian-like limit structure. No c is added.',
  'Klein V2: Klein with an optional N-fold polyfold (Polar Sectors) at the start of each iteration; Y/Z swap applies whenever Z folding is off.',
  'Amazing IFS: Amazing Surf Mod 4 with an IFS fold (per axis |z| − offset) after the box fold. No c by default, so it makes bounded sculptures, not sheets. Smooth DE (min over iterations) and Fold amounts colouring give the glossy striped look.',
];

// Small mutation of 3–5 geometric params (~6% of each slider span).
export function evolve(values, strength = 0.06) {
  // Only parameters that currently do something, and always at least one real
  // change (picking hidden params or rounding back to the same value used to make
  // about 7% of clicks do nothing).
  const pool = PARAMS.filter(p => p.mutate && isActive(p, values));
  const out = {};
  const count = 3 + ri(3);
  for (let tries = 0; Object.keys(out).length < count && tries < 40; tries++) {
    const p = pool[ri(pool.length)];
    if (!p || p.id in out) continue;
    const span = p.max - p.min;
    let nv = values[p.id] + gauss() * span * strength;
    nv = coerce(p, Math.max(p.min, Math.min(p.max, nv)));
    if (nv !== values[p.id]) out[p.id] = nv;
  }
  return out;
}

// Fresh random geometry, validated on the CPU so you don't land inside the
// fractal or stare at empty space. Returns { values, score, tries }.
export function rebirth(current, tries = 24) {
  let best = null;
  for (let t = 0; t < tries; t++) {
    const g = {
      scale: (Math.random() < 0.18 ? -1 : 1) * r(1.5, 2.7),
      scaleVary: Math.random() < 0.75 ? 0 : r(-0.4, 0.4),
      influence: Math.random() < 0.6 ? 1 : r(0.7, 1.3),
      minR: r(0.08, 0.95),
      foldX: r(0.5, 1.6), foldY: r(0.5, 1.6),
      foldZ: Math.random() < 0.5 ? 0 : r(0, 1.4),
      juliaCX: r(-1, 1), juliaCY: r(-1, 1), juliaCZ: r(-1, 1),
      alpha: Math.random() < 0.5 ? 0 : r(-0.6, 0.6),
      beta: Math.random() < 0.5 ? 0 : r(-0.6, 0.6),
      gamma: Math.random() < 0.5 ? 0 : r(-0.6, 0.6),
      preAlpha: Math.random() < 0.7 ? 0 : r(-0.5, 0.5),
      preBeta: Math.random() < 0.7 ? 0 : r(-0.5, 0.5),
      preGamma: Math.random() < 0.7 ? 0 : r(-0.5, 0.5),
      spinX: Math.random() < 0.8 ? 0 : r(-0.12, 0.12),
      spinY: Math.random() < 0.8 ? 0 : r(-0.12, 0.12),
      spinZ: Math.random() < 0.8 ? 0 : r(-0.12, 0.12),
      rotStart: 0,
      tgladWeight: Math.random() < 0.6 ? 0 : r(0, 1),
      cMult: Math.random() < 0.7 ? 0 : r(-0.3, 0.3),
      colorShift: Math.random(),
      palette: (i => (i >= CUSTOM_GRADIENT ? i + 1 : i))(ri(GRADIENTS.length - 1)), // any built-in (not Custom)
      foldType: ri(FOLD_NAMES.length),
      foldType2: Math.random() < 0.7 ? 0 : 1 + ri(FOLD_NAMES.length),
      hybridPeriod: 2 + ri(3),
      polarN: 3 + ri(6),
      axisOrder: Math.random() < 0.7 ? 0 : ri(6),
      cylinder: Math.random() < 0.15,
      rotX: r(-Math.PI, Math.PI), rotY: r(-0.6, 0.6),
      rollX: 0, rollY: 0, rollZ: 0,
      targetX: 0, targetY: 0, targetZ: 0,
      dist: r(2.5, 7),
    };
    const cand = { ...current, ...g };
    const s = viewScore(cand, 5);
    // Want: camera outside the surface, a healthy mix of hit and sky, not a wall in the face.
    const fitness = (s.clearance > 0.02 ? 1 : 0) * (1 - Math.abs(s.hitFrac - 0.6)) * (1 - s.nearFrac);
    if (!best || fitness > best.fitness) best = { values: g, fitness, score: s, tries: t + 1 };
    if (s.clearance > 0.02 && s.hitFrac >= 0.3 && s.hitFrac <= 0.92 && s.nearFrac < 0.2) break;
  }
  return best;
}

// ── Discovery string ───────────────────────────────────────────────────────
// SURF2:<base64url(JSON of non-default values)>

const PREFIX = 'SURF2:';

const b64urlEncode = str => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

const round = x => (typeof x === 'number' ? Number(x.toPrecision(7)) : x);

export function encodeDiscovery(values) {
  const d = defaults();
  const o = {};
  for (const p of PARAMS) {
    const v = values[p.id];
    if (v !== d[p.id]) o[p.id] = round(v);
  }
  return PREFIX + b64urlEncode(JSON.stringify(o));
}

// Returns a full, validated value set (defaults filled in) or throws.
export function decodeDiscovery(str) {
  str = String(str).trim();
  let obj;
  if (str.startsWith(PREFIX)) obj = JSON.parse(b64urlDecode(str.slice(PREFIX.length)));
  else if (str.startsWith('{')) {
    const j = JSON.parse(str);
    obj = j.params ?? j; // also accept a project file pasted in
  } else throw new Error('Not a discovery string');
  if (!obj || typeof obj !== 'object') throw new Error('Malformed discovery string');
  const out = defaults();
  for (const id in obj) {
    const p = PARAM_BY_ID.get(id);
    if (!p) continue;
    const v = coerce(p, obj[id]);
    if (v !== undefined) out[id] = v;
  }
  return out;
}

export const PROJECT_VERSION = 2;

export function makeProject(values, keys) {
  return { app: 'kyma', version: PROJECT_VERSION, params: { ...values }, keyframes: keys };
}

export function parseProject(text) {
  const j = JSON.parse(text);
  if (!j || typeof j !== 'object') throw new Error('Not a project file');
  const params = decodeDiscovery(JSON.stringify(j.params ?? {}));
  return { params, keyframes: Array.isArray(j.keyframes) ? j.keyframes : [] };
}
