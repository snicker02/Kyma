// Phone / small-tablet layout: every panel section becomes a tab under the
// viewer, instead of two slide-over drawers. Desktop layout is untouched.
//
// The docks keep their DOM; this only adds a tab bar and CSS state:
//   body.mtabs              tab layout is on (viewport ≤ 900 px wide)
//   .app.mt-left/.mt-right  which dock the active tab lives in
//   .app[data-mt]           'group' (one accordion group), 'foot' (Evolve /
//                           Undo actions) or 'save' (image/video/project)
//   .accordion-group.mt-active  the group shown for a 'group' tab

import { GROUPS } from '../engine/params.js';

const KEY = 'kyma.mtab';

export function initMobileTabs({ app, panel, stage }) {
  const mq = window.matchMedia('(max-width: 900px)');
  const bar = document.createElement('nav');
  bar.className = 'mtab-bar';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Panels');
  stage.after(bar);

  const tabs = [];
  const add = (id, label, side, kind, wrap = null) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mtab';
    b.textContent = label;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => select(id));
    bar.append(b);
    tabs.push({ id, side, kind, wrap, btn: b });
  };

  const left = GROUPS.filter(g => g.side === 'left');
  const right = GROUPS.filter(g => g.side !== 'left');
  const wrapOf = g => panel.groups.get(g.id)?.header.parentElement || null;
  for (const g of left) add(g.id, g.title, 'left', 'group', wrapOf(g));
  add('_actions', 'Evolve · Undo', 'left', 'foot');
  for (const g of right) add(g.id, g.title, 'right', 'group', wrapOf(g));
  add('_save', 'Save & Project', 'right', 'save');

  let current = null;
  function select(id, scroll = true) {
    const t = tabs.find(x => x.id === id) || tabs[0];
    current = t.id;
    app.classList.toggle('mt-left', t.side === 'left');
    app.classList.toggle('mt-right', t.side === 'right');
    app.dataset.mt = t.kind;
    for (const x of tabs) {
      const on = x === t;
      x.btn.classList.toggle('active', on);
      x.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      if (x.wrap) x.wrap.classList.toggle('mt-active', on);
    }
    // Start each tab at its top.
    const dock = app.querySelector(t.side === 'left' ? '.dock-left' : '.dock-right');
    const body = dock && dock.querySelector('.dock-body');
    if (body) body.scrollTop = 0;
    if (scroll) t.btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    try { localStorage.setItem(KEY, t.id); } catch { /* storage unavailable */ }
  }

  function apply() {
    document.body.classList.toggle('mtabs', mq.matches);
    if (mq.matches && !current) {
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
      select(saved || tabs[0].id, false);
    }
  }
  if (mq.addEventListener) mq.addEventListener('change', apply); else mq.addListener(apply);
  apply();
  return { select, get current() { return current; } };
}
