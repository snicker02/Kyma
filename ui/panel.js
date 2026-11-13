// Builds both docks from the parameter schema and keeps them in sync with the
// state store. Replaces v1's ~300 lines of hand-copied slider markup and the
// 40-branch if/else chains that mapped ids to variables.
//
// Range sliders carry two chips:
//   R  edit the slider's min/max
//   F  fine-tune (params with `fine: true`): click cycles Off → Fine → Ultra.
//      The slider becomes a window 1/20 (Fine) or 1/200 (Ultra) of its normal
//      span, centred on the current value, and re-centres every time you
//      release it — so you can keep scrubbing in tiny increments without
//      running out of track. While fine-tuning, the mouse wheel over the
//      slider nudges by 1/100 of the window (Shift = ×10).
//
// Gated controls are HIDDEN (not dimmed) until the option they depend on is
// selected. Visibility cascades: a control is shown only if its gate is open
// AND its gate's own control is shown (e.g. Julia Seed needs Julia Mode on,
// and Julia Mode only exists for formulas that add c).

import { GROUPS, PARAMS, PARAM_BY_ID } from '../engine/params.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// Keep Greek letters lowercase inside uppercase-styled labels (ξ would render as Ξ).
const greek = t => t.replace(/[α-ω]/g, '<span class="nt">$&</span>');

const decimals = p => {
  if (p.int) return 0;
  const s = String(p.step ?? 0.001);
  return Math.min(4, Math.max(2, s.includes('.') ? s.split('.')[1].length + 1 : 0));
};

export const FINE_DIVISORS = [1, 20, 200];   // Off, Fine, Ultra
const FINE_LABELS = ['F', 'F', 'F²'];
const FINE_TITLES = [
  'Fine-tune: off (click for 1/20 range)',
  'Fine-tune: 1/20 range (click for 1/200)',
  'Fine-tune: 1/200 range (click to turn off)',
];

// Gate predicate: bool gates open when truthy; select gates when the value
// equals gateEq (or is one of them, when gateEq is an array).
const gateOpen = (v, eq) => (eq === undefined ? !!v : Array.isArray(eq) ? eq.includes(v) : v === eq);

const sameRule = (a, b) => a.gate === b.gate && JSON.stringify(a.gateEq) === JSON.stringify(b.gateEq);

// Every param id that some control depends on; changes to these re-run gating.
const GATE_IDS = new Set(PARAMS.filter(p => p.gate).map(p => p.gate));

export class Panel {
  // roots: { left: Element, right: Element } — each GROUP declares its side.
  constructor(roots, state) {
    this.roots = roots;
    this.state = state;
    this.groups = new Map();     // groupId → { header, content }
    this.controls = new Map();   // paramId → control record
    this.gatedNodes = [];        // [{ node, rule: { gate, gateEq } }]
    this._dirty = new Set();
    this._raf = 0;
    this._build();
    state.onChange(id => this._markDirty(id));
  }

  group(id) { return this.groups.get(id)?.content; }

  // ── Visibility ────────────────────────────────────────────────────────────
  // Is this param's control shown? (Its own gate open, recursively.)
  isVisible(id) {
    const p = PARAM_BY_ID.get(id);
    if (!p || !p.gate) return true;
    return gateOpen(this.state.get(p.gate), p.gateEq) && this.isVisible(p.gate);
  }

  _ruleOpen(rule) {
    return gateOpen(this.state.get(rule.gate), rule.gateEq) && this.isVisible(rule.gate);
  }

  // Register any element (including ones main.js adds) to show only when a
  // rule holds, e.g. gateNode(btn, { gate: 'renderMode', gateEq: 2 }).
  gateNode(node, rule) {
    if (!rule || !rule.gate) return;
    GATE_IDS.add(rule.gate);
    node.classList.add('gated');
    this.gatedNodes.push({ node, rule: { gate: rule.gate, gateEq: rule.gateEq } });
    node.classList.toggle('gate-hidden', !this._ruleOpen(rule));
  }

  applyGates() {
    for (const { node, rule } of this.gatedNodes) node.classList.toggle('gate-hidden', !this._ruleOpen(rule));
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  _build() {
    for (const g of GROUPS) {
      const wrap = el('div', 'accordion-group');
      const header = el('div', 'group-header' + (g.accent ? ' accent' : '') + (g.open ? ' active' : ''));
      header.append(el('span', 'title', g.title), el('span', 'arrow', '▼'));
      const content = el('div', 'group-content' + (g.open ? ' show' : ''));
      header.addEventListener('click', () => {
        const show = !content.classList.contains('show');
        header.classList.toggle('active', show);
        content.classList.toggle('show', show);
      });
      wrap.append(header, content);
      (this.roots[g.side] ?? this.roots.left).append(wrap);
      this.groups.set(g.id, { header, content });
    }

    const visible = PARAMS.filter(p => p.type !== 'hidden' && p.type !== 'text');
    for (let i = 0; i < visible.length; i++) {
      const p = visible[i];
      const content = this.group(p.group);
      if (p.section) {
        const h = this._subHead(p);
        content.append(h);
        // A section heading belongs to its first control's gate.
        if (p.gate) this.gateNode(h, p);
      }
      if (p.row) {
        const members = [p];
        while (visible[i + 1] && visible[i + 1].row === p.row && visible[i + 1].group === p.group) members.push(visible[++i]);
        const grid = el('div', `grid grid-${members.length}`);
        // Same gate for the whole row → hide the row as one (no empty gaps);
        // otherwise each cell hides on its own.
        const shared = p.gate && members.every(m => m.gate && sameRule(m, p));
        for (const m of members) grid.append(this._control(m, true, !shared));
        // Compact rows' range editors go below the cells and span the full row.
        for (const m of members) { const rc = this.controls.get(m.id).rc; if (rc) grid.append(rc); }
        if (shared) this.gateNode(grid, p);
        content.append(grid);
      } else {
        content.append(this._control(p, false, true));
      }
    }
    this.refreshAll();
  }

  _subHead(p) {
    const h = el('div', 'sub-head');
    h.append(el('span', '', greek(p.section)));
    return h;
  }

  _control(p, compact, gateSelf) {
    const set = v => this.state.set(p.id, v, 'ui');
    const rec = { p, compact, fine: 0, userMin: p.min, userMax: p.max, dragging: false };
    let node;
    // Reset-to-default button beside each input (dimmed while at the default).
    const resetBtn = () => {
      const b = el('button', 'reset-btn', '\u21ba');
      b.type = 'button';
      const shown = p.type === 'select' ? p.options[p.def] : p.type === 'bool' ? (p.def ? 'on' : 'off') : p.def;
      b.title = `Reset to default (${shown})`;
      b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        set(p.def);
        if (rec.fine) this._centreFine(rec);
      });
      rec.reset = b;
      return b;
    };

    if (p.type === 'range') {
      node = el('div', 'slider-row' + (compact ? ' compact' : ''));
      node.dataset.id = p.id;
      const lv = el('div', 'label-val');
      const lab = el('span', '', greek(p.label));
      const rt = el('span', 'range-toggle', 'R');
      rt.title = 'Edit slider range';
      lab.append(rt);
      if (p.fine) {
        const ft = el('span', 'range-toggle fine-toggle', 'F');
        ft.title = FINE_TITLES[0];
        ft.addEventListener('click', e => {
          e.stopPropagation();
          this.setFine(p.id, (rec.fine + 1) % FINE_DIVISORS.length);
        });
        lab.append(ft);
        rec.ft = ft;
      }
      const num = el('input', 'val-input');
      num.type = 'number';
      num.step = p.step ?? 0.001;
      const nb = el('span', 'val-wrap');
      nb.append(num, resetBtn());
      lv.append(lab, nb);
      const slider = el('input');
      slider.type = 'range';
      slider.min = p.min; slider.max = p.max; slider.step = p.step ?? 0.001;
      const rc = el('div', 'range-controls');
      const mk = (label, val, onChange) => {
        const box = el('div', 'range-input-box');
        const inp = el('input');
        inp.type = 'number'; inp.value = val; inp.step = 'any';
        inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) onChange(v); this._refresh(p.id); });
        box.append(el('label', '', label), inp);
        return box;
      };
      const pre = compact ? p.label + ' ' : '';
      rc.append(
        mk(pre + 'MIN', p.min, v => { rec.userMin = v; if (!rec.fine) slider.min = v; }),
        mk(pre + 'MAX', p.max, v => { rec.userMax = v; if (!rec.fine) slider.max = v; }),
      );
      rt.addEventListener('click', e => {
        e.stopPropagation();
        rt.classList.toggle('active');
        rc.classList.toggle('show');
      });
      slider.addEventListener('pointerdown', () => { rec.dragging = true; });
      slider.addEventListener('input', () => set(parseFloat(slider.value)));
      // Release: re-centre the fine window on the new value.
      slider.addEventListener('change', () => { rec.dragging = false; if (rec.fine) this._centreFine(rec); });
      window.addEventListener('pointerup', () => { if (rec.dragging) { rec.dragging = false; if (rec.fine) this._centreFine(rec); } });
      slider.addEventListener('wheel', e => {
        if (!rec.fine) return; // normal sliders leave the wheel to scroll the dock
        e.preventDefault();
        const w = this._fineWindow(rec);
        const stepv = (w / 100) * (e.shiftKey ? 10 : 1) * (e.deltaY > 0 ? -1 : 1);
        set(this.state.get(p.id) + stepv);
        this._centreFine(rec);
      }, { passive: false });
      num.addEventListener('change', () => { const v = parseFloat(num.value); if (Number.isFinite(v)) set(v); else this._refresh(p.id); });
      node.append(lv, slider);
      if (compact) rec.rc = rc; else node.append(rc);
      Object.assign(rec, { slider, num });
    } else if (p.type === 'bool') {
      node = el('label', 'toggle-container');
      const check = el('input', 'toggle-input');
      check.type = 'checkbox';
      check.addEventListener('change', () => set(check.checked));
      node.append(el('span', '', greek(p.label)), check);
      rec.check = check;
    } else if (p.type === 'select') {
      node = el('div', 'select-row');
      const select = el('select');
      p.options.forEach((o, i) => { const opt = el('option', '', o); opt.value = i; select.append(opt); });
      select.addEventListener('change', () => set(parseInt(select.value, 10)));
      const lv = el('div', 'label-val');
      lv.append(el('span', '', p.label), resetBtn());
      node.append(lv, select);
      rec.select = select;
    } else if (p.type === 'color') {
      node = el('div', 'color-row');
      const color = el('input');
      color.type = 'color';
      color.addEventListener('input', () => set(color.value));
      const lv = el('div', 'label-val');
      lv.append(el('span', '', p.label), resetBtn());
      node.append(lv, color);
      rec.color = color;
    }
    if (gateSelf && p.gate) {
      this.gateNode(node, p);
      if (rec.rc) this.gateNode(rec.rc, p);
    }
    rec.wrap = node;
    this.controls.set(p.id, rec);
    return node;
  }

  // ── Fine-tune ─────────────────────────────────────────────────────────────
  _fineWindow(rec) { return (rec.userMax - rec.userMin) / FINE_DIVISORS[rec.fine]; }

  setFine(id, level) {
    const rec = this.controls.get(id);
    if (!rec || !rec.p.fine) return;
    rec.fine = level;
    rec.ft.textContent = FINE_LABELS[level];
    rec.ft.title = FINE_TITLES[level];
    rec.ft.classList.toggle('active', level > 0);
    rec.wrap.classList.toggle('fine-on', level > 0);
    if (level) {
      this._centreFine(rec);
    } else {
      rec.slider.min = rec.userMin;
      rec.slider.max = rec.userMax;
      rec.slider.step = rec.p.step ?? 0.001;
      rec.num.step = rec.p.step ?? 0.001;
    }
    this._refresh(id);
  }

  _centreFine(rec) {
    const w = this._fineWindow(rec);
    const v = this.state.get(rec.p.id);
    rec.slider.min = v - w / 2;
    rec.slider.max = v + w / 2;
    rec.slider.step = w / 1000;
    rec.num.step = w / 1000;
    rec.slider.value = v;
  }

  _decimalsFor(rec) {
    const base = rec.compact ? Math.min(3, decimals(rec.p)) : decimals(rec.p);
    return base + (rec.fine ? rec.fine + 1 : 0);
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  _markDirty(id) {
    this._dirty.add(id);
    if (!this._raf) this._raf = requestAnimationFrame(() => this._flush());
  }

  _flush() {
    this._raf = 0;
    let gates = false;
    for (const id of this._dirty) { this._refresh(id); if (GATE_IDS.has(id)) gates = true; }
    this._dirty.clear();
    if (gates) this.applyGates();
  }

  _refresh(id) {
    const v = this.state.get(id);
    const c = this.controls.get(id);
    if (!c) return;
    if (c.reset) c.reset.classList.toggle('at-default', v === c.p.def);
    const active = document.activeElement;
    if (c.slider && active !== c.slider && !c.dragging) {
      // External change (undo, sequencer, auto-roll) left the fine window? Re-centre.
      if (c.fine && (v < parseFloat(c.slider.min) || v > parseFloat(c.slider.max))) this._centreFine(c);
      c.slider.value = v;
    }
    if (c.num && active !== c.num) c.num.value = Number(v).toFixed(this._decimalsFor(c));
    if (c.check) c.check.checked = !!v;
    if (c.select && active !== c.select) c.select.value = v;
    if (c.color && active !== c.color) c.color.value = v;
  }

  refreshAll() {
    for (const p of PARAMS) this._refresh(p.id);
    this.applyGates();
  }
}
