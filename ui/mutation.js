// Mutation grid (JWildfire-style): the current scene as the parent plus 8 or 15
// mutated children, each rendered live in its own small tile. Click a child to
// make it the parent and breed again; Back steps to the previous parent.
//
// Tiles share the main WebGL context: each has its own small accumulation pair,
// samples are spread round-robin under a per-frame time budget, and finished
// tiles are copied into 2D canvases. The main viewer pauses while the grid is
// open (main.js checks `isOpen`).

import { sceneUniforms } from '../engine/renderer.js';
import { createTarget, deleteTarget } from '../engine/gl.js';
import { evolve } from '../engine/presets.js';
import { viewScore } from '../engine/de.js';
import { PARAM_BY_ID } from '../engine/params.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export const TILE_SAMPLES = 8;
const BUDGET_MS = 14;

// Children: evolve() diffs, kept only if the CPU probe sees a usable view
// (camera outside the surface, some surface on screen). Up to 6 tries each.
export function breed(parent, count, strength, { lockColour = false } = {}) {
  const kids = [];
  for (let k = 0; k < count; k++) {
    let best = null;
    for (let t = 0; t < 6; t++) {
      let m = evolve(parent, strength, lockColour ? { exclude: ['colorShift'] } : {});
      if (!Object.keys(m).length) continue;
      const s = viewScore({ ...parent, ...m }, 4);
      const fit = (s.clearance > 0.02 ? 1 : 0) * Math.min(1, s.hitFrac / 0.08);
      if (!best || fit > best.fit) best = { m, fit };
      if (fit >= 1) break;
    }
    kids.push(best ? best.m : {});
  }
  return kids;
}

export class MutationGrid {
  constructor({ renderer, state, stage, onPick, onClose, toast }) {
    this.r = renderer;
    this.state = state;
    this.stage = stage;
    this.onPick = onPick;
    this.onClose = onClose;
    this.toast = toast || (() => {});
    this.isOpen = false;
    this.size = 3;
    this.strength = 0.08;
    this.lockColour = false;
    this.maxSamples = TILE_SAMPLES;
    this.history = [];
    this.tiles = [];
    this._build();
  }

  _build() {
    const root = el('div', 'mut-grid hidden');
    const bar = el('div', 'mut-bar');
    const title = el('span', 'mut-title', 'Mutation Grid');
    const sizeSel = el('select', 'mut-sel');
    sizeSel.innerHTML = '<option value="3">3 × 3</option><option value="4">4 × 4</option>';
    sizeSel.addEventListener('change', () => { this.size = +sizeSel.value; this._layout(); this.reroll(); });
    const strLab = el('label', 'mut-lab', 'Strength');
    const str = el('input');
    str.type = 'range'; str.min = '0.01'; str.max = '0.3'; str.step = '0.01'; str.value = String(this.strength);
    const strVal = el('span', 'mut-val', this.strength.toFixed(2));
    str.addEventListener('input', () => { this.strength = +str.value; strVal.textContent = this.strength.toFixed(2); });
    str.addEventListener('change', () => this.reroll());
    strLab.append(str, strVal);
    const lockLab = el('label', 'mut-lab');
    const lock = el('input');
    lock.type = 'checkbox';
    lock.addEventListener('change', () => { this.lockColour = lock.checked; this.reroll(); });
    lockLab.append(lock, document.createTextNode('Lock colour'));
    const back = el('button', 'action-btn sm', '↶ Back');
    const reroll = el('button', 'action-btn sm', '⟳ Re-roll');
    const done = el('button', 'action-btn sm primary', '✓ Done');
    back.addEventListener('click', () => this.back());
    reroll.addEventListener('click', () => this.reroll());
    done.addEventListener('click', () => this.close());
    bar.append(title, sizeSel, strLab, lockLab, back, reroll, done);
    const grid = el('div', 'mut-cells');
    const note = el('div', 'mut-note', 'Click a child to breed from it · click the parent (outlined) to re-roll · Esc closes');
    root.append(bar, grid, note);
    this.stage.append(root);
    Object.assign(this, { root, grid, backBtn: back, sizeSel, note });
    window.addEventListener('keydown', e => { if (this.isOpen && e.key === 'Escape') { e.preventDefault(); this.close(); } }, true);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.history = [];
    this.root.classList.remove('hidden');
    this._layout();
    this.reroll();
    this._loop = () => { if (!this.isOpen) return; this._step(); this._raf = requestAnimationFrame(this._loop); };
    this._raf = requestAnimationFrame(this._loop);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this._raf);
    this.root.classList.add('hidden');
    this._freeTiles();
    this.onClose && this.onClose();
  }

  // Parent index: centre of a 3×3, top-left of a 4×4.
  get parentIndex() { return this.size === 3 ? 4 : 0; }

  _layout() {
    this._freeTiles();
    const n = this.size * this.size;
    this.grid.style.gridTemplateColumns = `repeat(${this.size}, 1fr)`;
    this.grid.style.gridTemplateRows = `repeat(${this.size}, 1fr)`;
    this.grid.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const cell = el('div', 'mut-cell' + (i === this.parentIndex ? ' parent' : ''));
      const cv = el('canvas');
      const tag = el('span', 'mut-tag', i === this.parentIndex ? 'parent' : '');
      cell.append(cv, tag);
      cell.addEventListener('click', () => this.pick(i));
      this.grid.append(cell);
      this.tiles.push({ cell, cv, tag, diff: {}, values: null, A: null, B: null, samples: 0, w: 0, h: 0 });
    }
  }

  _freeTiles() {
    const gl = this.r.gl;
    for (const t of this.tiles) { deleteTarget(gl, t.A); deleteTarget(gl, t.B); }
    if (this.out8) { deleteTarget(gl, this.out8); this.out8 = null; }
    this.tiles = [];
  }

  // Fresh children of the current scene.
  reroll() {
    if (!this.isOpen) return;
    const parent = { ...this.state.values };
    const kids = breed(parent, this.tiles.length - 1, this.strength, { lockColour: this.lockColour });
    let k = 0;
    this.tiles.forEach((t, i) => {
      t.diff = i === this.parentIndex ? {} : kids[k++];
      t.values = { ...parent, ...t.diff };
      t.samples = 0;
      const names = Object.keys(t.diff).map(id => PARAM_BY_ID.get(id)?.label || id);
      t.tag.textContent = i === this.parentIndex ? 'parent' : `${names.length} gene${names.length === 1 ? '' : 's'}`;
      t.cell.title = i === this.parentIndex ? 'Parent (current scene) — click to re-roll' : 'Changed: ' + (names.join(', ') || 'nothing');
    });
    this.backBtn.disabled = !this.history.length;
  }

  pick(i) {
    const t = this.tiles[i];
    if (!t || !t.values) return;
    if (i === this.parentIndex) { this.reroll(); return; }
    this.history.push({ ...this.state.values });
    this.onPick && this.onPick(t.diff);
    this.reroll();
  }

  back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.onPick && this.onPick(prev, true);
    this.reroll();
  }

  // Render: one sample per tile in turn until the frame budget is spent.
  _step() {
    const r = this.r, gl = r.gl;
    if (gl.isContextLost()) { this.close(); return; }
    const t0 = performance.now();
    let guard = 0;
    while (performance.now() - t0 < BUDGET_MS && guard++ < this.tiles.length * 2) {
      const pending = this.tiles.filter(t => t.values && t.samples < this.maxSamples);
      if (!pending.length) break;
      // Fewest samples first, so every tile appears quickly.
      const t = pending.reduce((a, b) => (b.samples < a.samples ? b : a));
      this._ensureTargets(t);
      const scene = sceneUniforms(t.values);
      if (scene.__mode === 1) { scene.__mode = 0; scene.__tonemap = t.values.tonemap; } // path tracing → surface preview
      if (!r.drawSample(scene, t.B, t.A, { resolution: [t.w, t.h], offset: [0, 0], sampleIndex: t.samples })) break; // compiling
      [t.A, t.B] = [t.B, t.A];
      t.samples++;
      this._present(t, scene.__tonemap | 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _ensureTargets(t) {
    const r = this.r, gl = r.gl;
    const rect = this.tiles[0].cell.getBoundingClientRect(); // one size for all tiles
    const w = Math.max(16, Math.min(480, Math.round(rect.width))), h = Math.max(16, Math.min(480, Math.round(rect.height)));
    if (t.A && t.w === w && t.h === h) return;
    deleteTarget(gl, t.A); deleteTarget(gl, t.B);
    [t.A, t.B] = r.makeAccumPair(w, h);
    t.w = w; t.h = h; t.samples = 0;
    t.cv.width = w; t.cv.height = h;
    t.img = t.cv.getContext('2d').createImageData(w, h);
    t.buf = new Uint8Array(w * h * 4);
    // All tiles share one size; the display pass fills its whole target.
    if (!this.out8 || this.out8.w !== w || this.out8.h !== h) {
      deleteTarget(gl, this.out8);
      this.out8 = createTarget(gl, w, h, gl.UNSIGNED_BYTE, false);
    }
  }

  _present(t, tonemap) {
    const r = this.r, gl = r.gl, { w, h } = t;
    r.drawDisplay(t.A.tex, this.out8, tonemap);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, t.buf);
    const d = t.img.data, b = t.buf;
    for (let y = 0; y < h; y++) {
      const s = y * w * 4, o = (h - 1 - y) * w * 4; // readPixels is bottom-up
      for (let x = 0; x < w * 4; x += 4) { d[o + x] = b[s + x]; d[o + x + 1] = b[s + x + 1]; d[o + x + 2] = b[s + x + 2]; d[o + x + 3] = 255; }
    }
    t.cv.getContext('2d').putImageData(t.img, 0, 0);
  }
}
