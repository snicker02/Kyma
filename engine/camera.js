// Orbit + fly camera.
//
// v1 bug fixed here: v1 uploaded the INVERSE of its lookAt·roll matrix and then
// read its columns as the camera basis, i.e. it used the transpose. For any
// horizontal orbit angle b the view direction was rotated by −b while the eye
// moved by +b, so the orbit target sat 2b off-centre and WASD moved you in a
// different direction from where you were looking. We now build the basis
// directly: right/up/back are the columns of lookAt·roll.

import { add, sub, mul, dot, cross, normalize, mat3Mul, rotX, rotY, rotZ } from './vec.js';

// Returns { eye, target, right, up, forward } for a parameter set.
export function cameraBasis(v) {
  const a = v.rotY, b = v.rotX, d = v.dist;
  const ca = Math.cos(a);
  // Same orbit placement as v1: (0,0,d) rotated by Euler(rotY, rotX, 0, 'YXZ').
  const orbit = [d * ca * Math.sin(b), -d * Math.sin(a), d * ca * Math.cos(b)];
  const target = [v.targetX, v.targetY, v.targetZ];
  const eye = add(target, orbit);

  const fwd0 = normalize(mul(orbit, -1));
  let hint = [0, 1, 0];
  if (Math.abs(dot(fwd0, hint)) > 0.99) hint = [1, 0, 0];
  const side = normalize(cross(fwd0, hint));
  const up0 = cross(side, fwd0);

  // lookAt matrix L has columns (side, up0, -fwd0); camera = L · Roll,
  // Roll = Ry(rollY)·Rx(rollX)·Rz(rollZ) (Euler 'YXZ', as in v1).
  const L = [
    side[0], up0[0], -fwd0[0],
    side[1], up0[1], -fwd0[1],
    side[2], up0[2], -fwd0[2],
  ];
  const roll = mat3Mul(mat3Mul(rotY(v.rollY), rotX(v.rollX)), rotZ(v.rollZ));
  const R = mat3Mul(L, roll);
  const right = [R[0], R[3], R[6]];
  const up = [R[1], R[4], R[7]];
  const back = [R[2], R[5], R[8]];
  return { eye, target, right, up, forward: mul(back, -1) };
}

// Ray direction for a pixel, matching the shader exactly.
export function pixelRay(cam, lens, px, py, w, h) {
  const s = Math.min(w, h);
  const ux = (px - 0.5 * w) / s;
  const uy = (py - 0.5 * h) / s;
  return normalize(add(add(mul(cam.forward, lens), mul(cam.right, ux)), mul(cam.up, uy)));
}

export function lightWorldPos(v, cam) {
  const l = [v.lightX, v.lightY, v.lightZ];
  if (!v.lightRelative) return l;
  // Camera-space offset: +X right, +Y up, +Z back toward the viewer.
  return add(cam.eye, add(add(mul(cam.right, l[0]), mul(cam.up, l[1])), mul(cam.forward, -l[2])));
}

