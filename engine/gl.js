// Minimal raw-WebGL1 helpers.

export function compileProgram(gl, vsSrc, fsSrc) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = mk(gl.VERTEX_SHADER, vsSrc);
  const fs = mk(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  return finishProgram(gl, prog, vs, fs);
}

// Check status (blocks until the driver is done) and reflect active uniforms so
// setUniforms() can dispatch on the real GLSL type. Also used for programs that
// were linked asynchronously via KHR_parallel_shader_compile.
export function finishProgram(gl, prog, vs, fs) {
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(prog) || '');
    gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    throw new Error('Shader build failed:\n' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (!info) continue;
    uniforms[info.name] = { loc: gl.getUniformLocation(prog, info.name), type: info.type };
  }
  return { prog, uniforms };
}

export function setUniforms(gl, program, values) {
  for (const name in values) {
    const u = program.uniforms[name];
    if (!u) continue; // optimised out
    const v = values[name];
    switch (u.type) {
      case gl.FLOAT: gl.uniform1f(u.loc, v); break;
      case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: gl.uniform1i(u.loc, typeof v === 'boolean' ? (v ? 1 : 0) : v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      default: break;
    }
  }
}

// Pick the best renderable texture format for accumulation:
// FLOAT → HALF_FLOAT → UNSIGNED_BYTE (8-bit falls back to a low sample cap).
export function detectAccumFormat(gl) {
  const tryType = (type, linearExt) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, type, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return ok ? { type, linear: !!gl.getExtension(linearExt) } : null;
  };
  if (gl.getExtension('OES_texture_float')) {
    gl.getExtension('WEBGL_color_buffer_float');
    const r = tryType(gl.FLOAT, 'OES_texture_float_linear');
    if (r) return { ...r, name: 'float32', maxSamples: Infinity };
  }
  const half = gl.getExtension('OES_texture_half_float');
  if (half) {
    gl.getExtension('EXT_color_buffer_half_float');
    const r = tryType(half.HALF_FLOAT_OES, 'OES_texture_half_float_linear');
    if (r) return { ...r, name: 'float16', maxSamples: 1024 };
  }
  return { type: gl.UNSIGNED_BYTE, linear: true, name: 'rgba8', maxSamples: 16 };
}

export function createTarget(gl, w, h, type, linear) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

export function deleteTarget(gl, t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}
