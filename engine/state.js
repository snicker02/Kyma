// Observable parameter store. `version` bumps on any change to a parameter that
// affects the rendered image, which is what the progressive renderer watches to
// decide when to throw away its accumulated samples.

import { PARAMS, PARAM_BY_ID, defaults, coerce } from './params.js';

export class State {
  constructor() {
    this.values = defaults();
    this.version = 0;
    this._listeners = new Set();
  }

  get(id) { return this.values[id]; }

  // Returns true when the value actually changed.
  set(id, raw, source = null) {
    const p = PARAM_BY_ID.get(id);
    if (!p) return false;
    const v = coerce(p, raw);
    if (v === undefined || this.values[id] === v) return false;
    this.values[id] = v;
    if (!p.noReset) this.version++;
    for (const fn of this._listeners) fn(id, v, source);
    return true;
  }

  setMany(obj, source = null) {
    let changed = false;
    for (const id in obj) changed = this.set(id, obj[id], source) || changed;
    return changed;
  }

  snapshot() { return { ...this.values }; }

  // Snapshot of only the params that are meaningful inside a keyframe / preset.
  sceneSnapshot() {
    const o = {};
    for (const p of PARAMS) if (p.interp !== 'none') o[p.id] = this.values[p.id];
    return o;
  }

  resetAll(source = null) { this.setMany(defaults(), source); }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  bump() { this.version++; }
}
