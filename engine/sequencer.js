// Keyframe sequencer.
//
// Changes from v1:
//  • "Trans. Duration" now really is the time per transition (v1 used it as the
//    length of the whole sequence regardless of key count).
//  • Keyframes capture the FULL scene — including the WASD fly position, palette,
//    fold type, axis order, Julia/inversion switches — so playback reproduces
//    what you keyed. v1 dropped the fly target, so flown shots snapped back.
//  • Smooth (Catmull-Rom) and eased interpolation, shortest-arc angles,
//    seamless closed loops, ping-pong.

import { PARAMS, interpOf, coerce } from './params.js';
import { hexToRgb, rgbToHex, wrapPi } from './vec.js';

export const MODE = { ONCE: 0, LOOP: 1, PINGPONG: 2 };
export const EASE = { LINEAR: 0, SMOOTH: 1, EASE: 2 };

const KEYED = PARAMS.filter(p => interpOf(p) !== 'none');

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

export class Sequencer {
  constructor() { this.keys = []; this.playing = false; this.time = 0; }

  get length() { return this.keys.length; }

  add(snapshot) { this.keys.push(this._clean(snapshot)); }
  replace(i, snapshot) { if (this.keys[i]) this.keys[i] = this._clean(snapshot); }
  remove(i) { this.keys.splice(i, 1); if (this.keys.length < 2) this.stop(); }
  clear() { this.keys = []; this.stop(); }
  move(from, to) {
    if (from === to || !this.keys[from]) return;
    const [k] = this.keys.splice(from, 1);
    this.keys.splice(Math.max(0, Math.min(this.keys.length, to)), 0, k);
  }

  _clean(s) {
    const o = {};
    for (const p of KEYED) if (s[p.id] !== undefined) o[p.id] = s[p.id];
    return o;
  }

  // Total running time in seconds.
  duration(seg, mode) {
    const n = this.keys.length;
    if (n < 2) return 0;
    if (mode === MODE.LOOP) return n * seg;
    if (mode === MODE.PINGPONG) return 2 * (n - 1) * seg;
    return (n - 1) * seg;
  }

  play() { if (this.keys.length > 1) { this.playing = true; this.time = 0; } return this.playing; }
  stop() { this.playing = false; }

  // Advance playback; returns the interpolated scene or null when stopped.
  update(dt, seg, mode, ease) {
    if (!this.playing) return null;
    this.time += dt;
    const dur = this.duration(seg, mode);
    if (mode === MODE.ONCE && this.time >= dur) {
      this.time = dur;
      this.playing = false;
    }
    return this.sample(this.time, seg, mode, ease);
  }

  // Fractional key index for a time.
  position(time, seg, mode) {
    const n = this.keys.length;
    if (n < 2) return 0;
    const s = time / seg;
    if (mode === MODE.LOOP) return ((s % n) + n) % n;
    if (mode === MODE.PINGPONG) {
      const period = 2 * (n - 1);
      const q = ((s % period) + period) % period;
      return q <= n - 1 ? q : period - q;
    }
    return Math.max(0, Math.min(n - 1, s));
  }

  // Normalised 0..1 progress for the timeline playhead.
  progress(seg, mode) {
    const d = this.duration(seg, mode);
    return d > 0 ? Math.min(1, this.time / d) : 0;
  }

  sample(time, seg, mode, ease) {
    const n = this.keys.length;
    if (n === 0) return null;
    if (n === 1) return { ...this.keys[0] };
    const pos = this.position(time, seg, mode);
    const cyclic = mode === MODE.LOOP;
    let i = Math.floor(pos);
    let f = pos - i;
    if (!cyclic && i >= n - 1) { i = n - 2; f = 1; }
    const idx = k => (cyclic ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k)));
    const i0 = idx(i - 1), i1 = idx(i), i2 = idx(i + 1), i3 = idx(i + 2);
    if (ease === EASE.EASE) f = f * f * (3 - 2 * f);
    const smooth = ease === EASE.SMOOTH;

    const out = {};
    for (const p of KEYED) {
      const k1 = this.keys[i1], k2 = this.keys[i2];
      if (k1[p.id] === undefined) continue;
      const mode_ = interpOf(p);
      if (mode_ === 'step' || k2[p.id] === undefined) { out[p.id] = k1[p.id]; continue; }
      const k0 = this.keys[i0][p.id] ?? k1[p.id];
      const k3 = this.keys[i3][p.id] ?? k2[p.id];

      if (mode_ === 'color') {
        const c = [hexToRgb(k0), hexToRgb(k1[p.id]), hexToRgb(k2[p.id]), hexToRgb(k3)];
        const rgb = [0, 1, 2].map(ch => smooth
          ? catmull(c[0][ch], c[1][ch], c[2][ch], c[3][ch], f)
          : c[1][ch] + (c[2][ch] - c[1][ch]) * f);
        out[p.id] = rgbToHex(rgb);
        continue;
      }

      let a0 = k0, a1 = k1[p.id], a2 = k2[p.id], a3 = k3;
      if (mode_ === 'angle') {
        // Unwrap around a1 so we always take the shortest arc.
        a0 = a1 + wrapPi(a0 - a1);
        a2 = a1 + wrapPi(a2 - a1);
        a3 = a2 + wrapPi(a3 - a2);
      }
      let val = smooth ? catmull(a0, a1, a2, a3, f) : a1 + (a2 - a1) * f;
      if (mode_ === 'angle') val = wrapPi(val);
      const c = coerce(p, val);
      out[p.id] = c === undefined ? a1 : c;
    }
    return out;
  }

  toJSON() { return this.keys.map(k => ({ ...k })); }
  fromJSON(arr) { this.keys = Array.isArray(arr) ? arr.map(k => this._clean(k)) : []; this.stop(); }
}
