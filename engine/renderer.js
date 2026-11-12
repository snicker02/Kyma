// Progressive WebGL1 renderer.
//
// Each frame renders ONE sample per pixel into a ping-pong accumulation buffer
// (float when the GPU allows). While anything changes the buffer restarts, so
// interaction costs the same as v1; when the view is still, samples pile up
// (anti-aliasing + converged depth-of-field) and rendering stops entirely at the
// sample cap, leaving the GPU idle instead of redrawing the same image forever.
//
// Fold types are compiled into specialised programs (see glsl.js). Programs are
// cached per (foldA, foldB) and, where KHR_parallel_shader_compile exists,
// built off the main thread: the previous image stays up until the new one is
// ready instead of the page hitching.

import { VERT, DISPLAY_FRAG, fractalFrag } from './glsl.js';
import { compileProgram, finishProgram, setUniforms, detectAccumFormat, createTarget, deleteTarget } from './gl.js';
import { cameraBasis, lightWorldPos } from './camera.js';
import { gradientSpec, gradientKey, gradientScale, buildGradientLUT, LUT_SIZE } from './gradients.js';
import { fractalRotation, mat3ToColumnMajor, hexToRgb, fract, mat3Mul, rotX, rotY } from './vec.js';

// Panorama orientation: yaw about Y, then pitch about X.
export const envRotation = (yaw, pitch) => mat3Mul(rotX(pitch), rotY(yaw));

const G = 1.32471795724474602596; // plastic number → R2 sequence
const A1 = 1 / G, A2 = 1 / (G * G);

export function jitterFor(n) {
  if (n === 0) return [0, 0];
  return [fract(0.5 + A1 * n) - 0.5, fract(0.5 + A2 * n) - 0.5];
}

export function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

export function lensFor(n) { return [halton(n + 1, 2), halton(n + 1, 3)]; }

// Scene-level uniforms from a parameter set. `scaleOverride` carries the pulse.
// Keys starting with "__" are program-selection data, not uniforms.
export function sceneUniforms(v, scaleOverride) {
  const cam = cameraBasis(v);
  const gspec = gradientSpec(v);
  return {
    __foldA: v.foldType,
    __foldB: v.foldType2 - 1,
    __mode: v.renderMode,
    __variant: v.surfVariant,
    __stack: [v.vStack1, v.vStack2, v.vStack3, v.vStack4, v.vStack5],
    u_vFoldValue: v.vFoldValue,
    u_vFold2: v.vFold2,
    u_vZFold: v.vZFold,
    u_vSwapXY: v.vSwapXY,
    u_vSwapYZ: v.vSwapYZ,
    u_vEvenFlipY: v.vEvenFlipY,
    u_vEvenFlipZ: v.vEvenFlipZ,
    u_vFlip: v.vFlip,
    u_vCSwizzle: v.vCSwizzle,
    u_vMboxFold: v.vMboxFold,
    u_vFixedR2: v.vFixedR2,
    u_vDEOffset: v.vDEOffset,
    u_vOff: [v.vOffX, v.vOffY, v.vOffZ],
    u_vSph: [v.vSphX, v.vSphY, v.vSphZ],
    u_vPost: [v.vPostX, v.vPostY, v.vPostZ],
    u_vKleinIters: v.vKleinIters,
    u_vTail: [v.vTailX, v.vTailY, v.vTailZ],
    u_vTailScale: v.vTailScale,
    u_vTailOff: [v.vTailOffX, v.vTailOffY, v.vTailOffZ],
    u_vPolyOn: v.vPolyOn,
    u_vPreAbs: [v.vPreAbsX ? 1 : 0, v.vPreAbsY ? 1 : 0, v.vPreAbsZ ? 1 : 0],
    u_vIfsMode: [v.vIfsX | 0, v.vIfsY | 0, v.vIfsZ | 0],
    u_vIfsOff: [v.vIfsOffX, v.vIfsOffY, v.vIfsOffZ],
    u_vIfsAdd: [v.vIfsAddX, v.vIfsAddY, v.vIfsAddZ],
    u_vAddC: !!v.vAddC,
    u_vMinDE: !!v.vMinDE,
    u_vMinDEStart: v.vMinDEStart | 0,
    u_vPolyAbsY: v.vPolyAbsY,
    __tonemap: v.renderMode === 1 ? 1 : v.tonemap, // path tracing outputs linear radiance
    u_ptBounces: v.ptBounces,
    u_ptRough: v.ptRough,
    u_ptMetal: v.ptMetal,
    u_ptSky: v.ptSky,
    u_ptSkyColor: hexToRgb(v.ptSkyColor),
    u_ptSun: v.ptSun,
    u_ptLightSize: v.ptLightSize,
    u_ptEmit: v.ptEmit,
    u_ptClamp: v.ptClamp,
    u_volDensity: v.volDensity,
    u_volThick: v.volThick,
    u_volGlow: v.volGlow,
    u_volStepMin: v.volStepMin,
    u_volSteps: v.volSteps,
    u_volLight: v.volLight,
    u_scale: scaleOverride ?? v.scale,
    u_scaleVary: v.scaleVary,
    u_minR: v.minR,
    u_influence: v.influence,
    u_axisOrder: v.axisOrder,
    u_tgladWeight: v.tgladWeight,
    u_cMult: v.cMult,
    u_juliaMode: v.juliaMode,
    u_cylinder: v.cylinder,
    u_juliaC: [v.juliaCX, v.juliaCY, v.juliaCZ],
    u_fold: [v.foldX, v.foldY, v.foldZ],
    u_rotMatrix: mat3ToColumnMajor(fractalRotation(v.alpha, v.beta, v.gamma)),
    u_preRot: mat3ToColumnMajor(fractalRotation(v.preAlpha, v.preBeta, v.preGamma)),
    u_preRotOn: v.preAlpha !== 0 || v.preBeta !== 0 || v.preGamma !== 0,
    u_spinMatrix: mat3ToColumnMajor(fractalRotation(v.spinX, v.spinY, v.spinZ)),
    u_spinOn: v.spinX !== 0 || v.spinY !== 0 || v.spinZ !== 0,
    u_rotStart: v.rotStart,
    u_invDELimit: v.invDELimit,
    u_iterations: v.iterations,
    u_hybridPeriod: v.hybridPeriod,
    u_polarN: v.polarN,
    u_invEnabled: v.invEnabled,
    u_invMode: v.invMode,
    u_invRadius: v.invRadius,
    u_invStrength: v.invStrength,
    u_invCenter: [v.invCX, v.invCY, v.invCZ],
    u_camPos: cam.eye,
    u_camRight: cam.right,
    u_camUp: cam.up,
    u_camForward: cam.forward,
    u_lens: v.lens,
    u_dof: v.dofStrength,
    u_focalDist: v.focalDist,
    u_maxSteps: v.maxSteps,
    u_detail: v.detail,
    u_stepFactor: v.stepFactor,
    u_maxDist: v.maxDist,
    u_missAsHit: v.missAsHit,
    u_debugView: v.debugView,
    u_envMode: v.envMode,
    u_envIntensity: v.envIntensity,
    u_envBlur: v.envBlur,
    u_envRot: mat3ToColumnMajor(envRotation(v.envYaw, v.envPitch)),
    u_envReflect: v.envReflect,
    u_envLight: v.envLight,
    u_envFog: v.envFog,
    u_fog: v.fog,
    u_volumetric: v.volumetric,
    u_brightness: v.brightness,
    u_vignette: v.vignette,
    u_colorShift: v.colorShift,
    u_colorSource: v.colorSource | 0,
    u_foldColW: v.foldColW ?? 1,
    u_sphColW: v.sphColW ?? 1,
    u_colorIters: v.colorIters ?? 40,
    u_gradScale: gradientScale(gspec),
    __grad: gradientKey(gspec),
    __gradSpec: gspec,
    u_lightPos: lightWorldPos(v, cam),
    u_lightColor: hexToRgb(v.lightColor),
    u_bgColor: hexToRgb(v.bgColor),
    u_ambient: v.ambient,
    u_stepAO: v.stepAO,
    u_aoStrength: v.aoStrength,
    u_shadows: v.shadows,
    u_groundType: v.groundType | 0,
    u_groundY: v.groundY ?? -2,
    u_groundCol: hexToRgb(v.groundColor || '#4a6b2e'),
    u_groundCol2: hexToRgb(v.groundColor2 || '#8fae4a'),
    u_groundScale: Math.max(0.01, v.groundScale ?? 1),
    u_groundBump: v.groundBump ?? 0.3,
    u_groundReflect: v.groundReflect ?? 0.6,
    u_groundRough: v.groundRough ?? 0.05,
    u_groundFade: v.groundFade ?? 0.3,
    u_groundShadows: v.groundShadows ?? true,
    u_shadowSoft: v.shadowSoft,
  };
}

// Fold-stack variants (Mod 1/2/3, Multi) are the only ones that read the stack;
// classic is the only one that reads fold A/B.
const STACK_VARIANTS = new Set([2, 3, 4, 6]);

// Canonical specialisation for a scene: fields a program doesn't use are
// normalised away so they don't multiply the number of compiled programs.
export function specOf(scene, modeOverride) {
  const variant = scene.__variant | 0;
  const classic = variant === 0;
  const a = classic ? scene.__foldA | 0 : 0;
  let b = classic ? scene.__foldB | 0 : -1;
  if (b === a) b = -1;
  const stack = STACK_VARIANTS.has(variant) ? (scene.__stack || [1, 0, 0, 0, 0]).map(x => x | 0) : [1, 0, 0, 0, 0];
  return { a, b, variant, stack, mode: (modeOverride ?? scene.__mode) | 0 };
}

export function specKey(sp) {
  return `v${sp.variant}|${sp.a}|${sp.b}|${sp.stack.join('')}|m${sp.mode}`;
}

// Back-compat helper (classic engine).
export function foldKey(a, b, mode = 0) {
  return specKey(specOf({ __variant: 0, __foldA: a, __foldB: b, __mode: mode }));
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.live = { a: null, b: null, w: 0, h: 0, samples: 0 };
    this._init();
  }

  _init() {
    const gl = this.canvas.getContext('webgl', {
      antialias: false, alpha: false, depth: false, stencil: false,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    this.envTex = null; // old context's texture is gone; envSource survives for re-upload
    this.fmt = detectAccumFormat(gl);
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    this.texLod = !!gl.getExtension('EXT_shader_texture_lod');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this._uploadEnv();
    this.programs = new Map(); // key → { ready, prog?, pending?, error? }
    this.display = compileProgram(gl, VERT, DISPLAY_FRAG);
    // The default (box fold) program is built synchronously so first paint is immediate.
    this.programs.set(foldKey(0, -1), { ready: true, prog: compileProgram(gl, VERT, fractalFrag(0, -1, { texLod: this.texLod, mode: 0, variant: 0 })) });
    // Single oversized triangle covers the viewport.
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.live = { a: null, b: null, w: 0, h: 0, samples: 0 };
  }

  // Rebuild every GPU resource after a context restore (environment included).
  restore() { this._init(); }

  // Environment image: a power-of-two canvas (see engine/environment.js) or
  // null to clear. Mipmapped so blur / diffuse lighting can sample coarse LODs;
  // REPEAT horizontally so a 360° panorama wraps seamlessly.
  setEnvironment(canvas, aspect = 2) {
    this.envSource = canvas || null;
    this.envAspect = canvas ? aspect : 2;
    this._uploadEnv();
  }

  _uploadEnv() {
    const gl = this.gl;
    if (this.envTex) gl.deleteTexture(this.envTex);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (this.envSource) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.envSource);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    this.envTex = tex;
  }

  get sampleCap() { return this.fmt.maxSamples; }

  // Returns the compiled program for a scene (optionally forcing a render
  // mode), or null while it is still compiling in the background. Throws if
  // compilation failed.
  program(scene, modeOverride) {
    const sp = specOf(scene, modeOverride);
    const key = specKey(sp);
    let e = this.programs.get(key);
    if (!e) {
      e = this._startCompile(sp);
      this.programs.set(key, e);
    }
    if (!e.ready) this._poll(e);
    if (e.error) throw e.error;
    return e.ready ? e.prog : null;
  }

  isCompiling() {
    for (const e of this.programs.values()) if (!e.ready && !e.error) return true;
    return false;
  }

  _startCompile(sp) {
    const gl = this.gl;
    const opts = { texLod: this.texLod, mode: sp.mode, variant: sp.variant, stack: sp.stack };
    const a = sp.a, b = sp.b;
    if (!this.parallel) {
      try { return { ready: true, prog: compileProgram(gl, VERT, fractalFrag(a, b, opts)) }; }
      catch (err) { return { ready: false, error: err }; }
    }
    // Kick off the compile without querying status (querying would block).
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = mk(gl.VERTEX_SHADER, VERT);
    const fs = mk(gl.FRAGMENT_SHADER, fractalFrag(a, b, opts));
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    return { ready: false, pending: { prog, vs, fs, a, b } };
  }

  _poll(e) {
    const gl = this.gl, p = e.pending;
    if (!p || !gl.getProgramParameter(p.prog, this.parallel.COMPLETION_STATUS_KHR)) return;
    e.pending = null;
    try { e.prog = finishProgram(gl, p.prog, p.vs, p.fs); e.ready = true; }
    catch (err) { e.error = err; }
  }

  // Resolves when the program for `scene` is ready (used by offline export).
  async whenReady(scene) {
    while (!this.program(scene)) await new Promise(r => requestAnimationFrame(r));
  }

  makeAccumPair(w, h) {
    const gl = this.gl;
    return [createTarget(gl, w, h, this.fmt.type, this.fmt.linear), createTarget(gl, w, h, this.fmt.type, this.fmt.linear)];
  }

  resizeLive(w, h) {
    if (this.live.w === w && this.live.h === h && this.live.a) return;
    deleteTarget(this.gl, this.live.a);
    deleteTarget(this.gl, this.live.b);
    [this.live.a, this.live.b] = this.makeAccumPair(w, h);
    this.live.w = w; this.live.h = h; this.live.samples = 0;
  }

  resetLive() { this.live.samples = 0; }

  // Draw one sample of `scene` into `dst`, blending with `src`. Returns false
  // (and draws nothing) if the scene's program is still compiling.
  // Colour gradient LUT on texture unit 2; rebuilt only when its spec changes.
  _syncGradient(scene) {
    if (!scene.__gradSpec || scene.__grad === this.gradKey) return;
    const gl = this.gl;
    if (!this.gradTex) this.gradTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.gradTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildGradientLUT(scene.__gradSpec));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // periodic: blend across the seam
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    this.gradKey = scene.__grad;
  }

  drawSample(scene, dst, src, { resolution, offset, sampleIndex }) {
    const prog = this.program(scene);
    if (!prog) return false;
    const gl = this.gl;
    this._syncGradient(scene);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.gradTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.envTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    setUniforms(gl, prog, scene);
    setUniforms(gl, prog, {
      u_resolution: resolution,
      u_pixelOffset: offset,
      u_bufferSize: [dst.w, dst.h],
      u_jitter: jitterFor(sampleIndex),
      u_lensSample: lensFor(sampleIndex),
      u_prev: 0,
      u_env: 1,
      u_grad: 2,
      u_envAspect: this.envAspect ?? 2,
      u_blend: 1 / (sampleIndex + 1),
      u_sampleIndex: sampleIndex,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  // Tone-map an accumulation texture into `dst` (null = canvas).
  drawDisplay(srcTex, dst, tonemap = 0) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    if (dst) gl.viewport(0, 0, dst.w, dst.h);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.display.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    setUniforms(gl, this.display, { u_tex: 0, u_tonemap: tonemap });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // One live progressive step. Returns true if a new sample was drawn.
  stepLive(scene, maxSamples) {
    const L = this.live;
    const cap = Math.min(maxSamples, this.fmt.maxSamples);
    if (L.samples >= cap) return false;
    if (!this.drawSample(scene, L.b, L.a, { resolution: [L.w, L.h], offset: [0, 0], sampleIndex: L.samples })) return false;
    L.tonemap = scene.__tonemap | 0;
    [L.a, L.b] = [L.b, L.a];
    L.samples++;
    return true;
  }

  presentLive() { this.drawDisplay(this.live.a.tex, null, this.live.tonemap | 0); }
}
