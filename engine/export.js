// Offline high-quality rendering: tiled + multi-sample, never one huge draw.
//
// Every draw call covers at most one 512×512 tile at one sample, the same
// per-draw cost that v1 found safe against the Windows GPU watchdog (TDR).
// The number of draws per animation frame adapts to how fast the GPU is
// keeping up, so a fast card finishes quickly and a slow one stays responsive.

import { createTarget, deleteTarget } from './gl.js';

export class Cancelled extends Error { constructor() { super('Cancelled'); } }

const TILE = 512;
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

export async function renderImage(renderer, scene, W, H, samples, { onProgress, isCancelled } = {}) {
  const gl = renderer.gl;
  await renderer.whenReady(scene); // specialised fold program may still be compiling
  const [A, B] = renderer.makeAccumPair(TILE, TILE);
  const out8 = createTarget(gl, TILE, TILE, gl.UNSIGNED_BYTE, false);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const buf = new Uint8Array(TILE * TILE * 4);
  samples = Math.max(1, Math.min(samples, renderer.sampleCap));

  const tilesX = Math.ceil(W / TILE), tilesY = Math.ceil(H / TILE);
  const total = tilesX * tilesY * samples;
  let done = 0, batch = 1, inBatch = 0;

  try {
    for (let y = 0; y < H; y += TILE) {
      for (let x = 0; x < W; x += TILE) {
        const tw = Math.min(TILE, W - x), th = Math.min(TILE, H - y);
        let src = A, dst = B;
        for (let s = 0; s < samples; s++) {
          renderer.drawSample(scene, dst, src, { resolution: [W, H], offset: [x, y], sampleIndex: s });
          [src, dst] = [dst, src];
          done++;
          if (++inBatch >= batch) {
            inBatch = 0;
            const t0 = performance.now();
            await nextFrame();
            const dt = performance.now() - t0;
            if (dt < 22) batch = Math.min(batch * 2, 64);
            else if (dt > 60) batch = Math.max(1, batch >> 1);
            if (gl.isContextLost()) throw new Error('GPU context lost during render');
            if (isCancelled && isCancelled()) throw new Cancelled();
            onProgress && onProgress(done / total);
          }
        }
        renderer.drawDisplay(src.tex, out8, scene.__tonemap | 0);
        gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const img = ctx.createImageData(tw, th);
        for (let r = 0; r < th; r++) {
          const srcRow = r * tw * 4;
          const dstRow = (th - 1 - r) * tw * 4; // readPixels is bottom-up
          for (let c = 0; c < tw * 4; c += 4) {
            img.data[dstRow + c] = buf[srcRow + c];
            img.data[dstRow + c + 1] = buf[srcRow + c + 1];
            img.data[dstRow + c + 2] = buf[srcRow + c + 2];
            img.data[dstRow + c + 3] = 255;
          }
        }
        ctx.putImageData(img, x, H - y - th);
      }
    }
    onProgress && onProgress(1);
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    deleteTarget(gl, A); deleteTarget(gl, B); deleteTarget(gl, out8);
  }
  return canvas;
}

export const canvasToPngBlob = canvas => new Promise((res, rej) =>
  canvas.toBlob(b => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
