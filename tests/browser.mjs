// Optional headless-GPU validation (dev only; needs Playwright + Chrome):
//   python3 -m http.server 8000 &   then   node tests/browser.mjs [outDir]
// Checks: page boots without console errors, progressive accumulation runs,
// GLSL map() matches the CPU port in engine/de.js, the tiled exporter is
// pixel-identical to the live renderer, and screenshots every biome.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.SURF_URL || 'http://localhost:8000/index.html';
const OUT = process.argv[2] || '/tmp/surf-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
page.setDefaultTimeout(600000); // SwiftShader on small machines blocks the page for long stretches
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

await page.goto(URL);
await page.waitForFunction(() => window.__surf && window.__surf.renderer.live.samples > 0, null, { timeout: 600000 });
const fmt = await page.evaluate(() => window.__surf.renderer.fmt.name);
ok(true, `booted, accumulation format ${fmt}`);

// Progressive accumulation advances when idle.
await page.evaluate(() => window.__surf.state.set('maxSamples', 6));
await page.waitForFunction(() => window.__surf.renderer.live.samples >= 6, null, { timeout: 600000 });
ok(true, 'accumulated 6 samples while idle');
await page.screenshot({ path: `${OUT}/default.png` });

// GLSL ↔ CPU distance-estimator parity.
const parity = await page.evaluate(async () => {
  const { fractalMapSource, VERT } = await import('/tests/lib.mjs');
  const { compileProgram, setUniforms } = await import('/tests/lib.mjs');
  const { sceneUniforms } = await import('/tests/lib.mjs');
  const { makeDE } = await import('/tests/lib.mjs');
  const { BIOMES, VARIANT_DEFAULTS } = await import('/tests/lib.mjs');
  const { defaults } = await import('/tests/lib.mjs');
  const tail = `
uniform vec3 u_p;
vec4 pack(float v) { vec4 e = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0)); e -= e.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); return e; }
void main() { float tr; float d = map(u_p, tr); gl_FragColor = pack(clamp(d / 16.0, 0.0, 0.999999)); }`;
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const px = new Uint8Array(4);
  const sets = [['default', {}], ...Object.entries(BIOMES).map(([k, b]) => [k, b.v]),
    ['surfXY+cyl+tglad', { foldType: 3, cylinder: true, tgladWeight: 0.7, influence: 0.6, scaleVary: 0.3, axisOrder: 4, cMult: 0.2 }],
    ['postInv', { invEnabled: true, invMode: 1, invStrength: 0.7, invRadius: 0.8, alpha: 0.4, beta: -0.3 }],
    ...Array.from({ length: 11 }, (_, t) => [`fold ${t}`, { foldType: t, foldZ: 0.6, polarN: 5, tgladWeight: 0.3 }]),
    ['hybrid 0+6/2', { foldType: 0, foldType2: 7, hybridPeriod: 2 }], ['hybrid 4+7/1', { foldType: 4, foldType2: 8, hybridPeriod: 1, polarN: 7 }],
    ['pre+spin+start', { preAlpha: 0.5, preBeta: -0.3, spinZ: 0.11, spinX: -0.05, rotStart: 2, alpha: 0.4 }], ['inv limit 60', { invEnabled: true, invDELimit: 60, invRadius: 0.9 }], ...Array.from({ length: 16 }, (_, vi) => [`variant ${vi}`, { ...VARIANT_DEFAULTS[vi], surfVariant: vi, juliaCX: 0.3, juliaCY: -0.2, juliaCZ: 0.1 }]),
    ['mod2 stack+z+swap', { ...VARIANT_DEFAULTS[3], surfVariant: 3, vStack1: 1, vStack2: 5, vStack3: 6, vZFold: true, vSwapXY: true, vSphZ: 0.4, cMult: 0.3, vCSwizzle: 3, scaleVary: 0.1 }],
    ['mod3 flips+folder', { ...VARIANT_DEFAULTS[4], surfVariant: 4, vStack1: 6, vStack2: 2, vEvenFlipY: true, vEvenFlipZ: true, cMult: -0.4, vOffX: 0.2 }],
    ['multi mbox+zrefl', { ...VARIANT_DEFAULTS[6], surfVariant: 6, vStack1: 3, vStack2: 1, vStack3: 4, vMboxFold: true, vZFold: true, influence: 0.7 }],
    ['m3d flips+post', { ...VARIANT_DEFAULTS[7], surfVariant: 7, vFlip: 5, vPostY: 0.3, vOffZ: -0.2, scaleVary: 0.2 }],
    ['kleinV2 poly', { ...VARIANT_DEFAULTS[9], surfVariant: 9, vPolyOn: true, polarN: 5, vOffX: 0.2, vKleinIters: 6, vTailScale: 1.8 }],
    ['hybrid 3+8/3', { foldType: 3, foldType2: 9, hybridPeriod: 3, foldZ: 0.5 }],
    ['ifs fold+poly', { ...VARIANT_DEFAULTS[10], surfVariant: 10, vIfsX: 1, vIfsY: 1, vIfsZ: 2, vIfsOffX: 0.6, vIfsOffY: 0.3, vIfsOffZ: -0.2, vPreAbsZ: true, vPolyOn: true, polarN: 5, vZFold: true, vIfsAddY: 0.1, alpha: 0.3 }],
    ['object xform', { objX: 0.4, objY: -0.3, objZ: 0.2, objRotX: 20, objRotY: -35, objRotZ: 10, objScale: 1.3 }],
    ['mb inversion classic', { vSInvOn: true, vSInvOffX: 0.3, vSInvOffZ: -0.2, vSInvG: 1.4, vSInvAddY: 0.2, vSInvA: 1.3, vSInvStop: 2 }],
    ['mb inversion mod1', { ...VARIANT_DEFAULTS[2], surfVariant: 2, vSInvOn: true, vSInvOffY: -0.4, vSInvG: 0.8, vSInvA: 2.1, vSInvStart: 1, vSInvStop: 3 }],
    ['mb inversion mod4', { ...VARIANT_DEFAULTS[5], surfVariant: 5, vSInvOn: true, vSInvOffX: 0.5, vSInvG: 1.2, vSInvAddZ: 0.3, vSInvA: 0.9 }],
    ['mb inversion klein', { ...VARIANT_DEFAULTS[8], surfVariant: 8, vSInvOn: true, vSInvOffZ: 0.6, vSInvG: 1.1, vSInvA: 1.5, vSInvStop: 2 }],
    ['rep grid', { repMode: 1, repCountX: 2, repCountY: 1, repCountZ: 2, repSpaceX: 4, repSpaceY: 3, repSpaceZ: 5 }],
    ['rep grid varied ifs', { ...BIOMES.ifs_ring.v, repMode: 1, repCountX: 1, repCountY: 1, repCountZ: 1, repSpaceX: 30, repSpaceY: 30, repSpaceZ: 30, repRotVar: 60, repScaleVar: 0.3, repColVar: 1, repSeed: 3 }],
    ['rep ring', { ...BIOMES.kyma_ell.v, repMode: 2, repRingN: 7, repRingR: 6, repRingAxis: 1 }],
    ['rep ring fixed varied', { ...BIOMES.kyma_ell.v, repMode: 2, repRingN: 5, repRingR: 7, repRingAxis: 0, repRingRotate: false, repRotVar: 90, repScaleVar: 0.2 }],
    ['kyma loxodromic', { ...VARIANT_DEFAULTS[11], surfVariant: 11, vLoxX: 0.4, vLoxY: -0.3, vLoxZ: 0.9, juliaMode: true, juliaCX: 0.3 }],
    ['kyma torus', { ...VARIANT_DEFAULTS[12], surfVariant: 12, vTorusOnX: true, vTorusOnY: true, vTorusRX: 0.5, vTorusRY: 0.7, vTorusRZ: 0.9, influence: 1.3 }],
    ['kyma ellipsoid', { ...VARIANT_DEFAULTS[13], surfVariant: 13, vEllX: 0.6, vEllY: 1.4, vEllZ: 2 }],
    ['kyma vortex xyz', { ...VARIANT_DEFAULTS[14], surfVariant: 14, vVortexX: 0.3, vVortexY: -0.3, vVortexZ: 0.5 }],
    ['kyma vortex height', { ...VARIANT_DEFAULTS[14], surfVariant: 14, vVortexZ: 0.7, vVortexDZ: 0.3 }],
    ['kyma vortex mixed', { ...VARIANT_DEFAULTS[14], surfVariant: 14, vVortexX: 0.3, vVortexZ: 0.7, vVortexDZ: 0.05 }],
    ['kyma gyroid', { ...VARIANT_DEFAULTS[15], surfVariant: 15, vGyroFreq: 2.5, vGyroL: 0.3 }],
    ['wave ripple', { waveType: 1, waveAmp: 0.2, waveFreq: 3, wavePhase: 0.5, waveStop: 3 }],
    ['wave shear mod1', { ...VARIANT_DEFAULTS[2], surfVariant: 2, waveType: 2, waveAmp: 0.3, waveFreq: 2.5, wavePhaseStep: 0.4, waveAxY: -0.5, waveStop: 4 }],
    ['wave fold', { waveType: 3, waveAmp: 0.6, waveFreq: 2, wavePhase: 1, waveStop: 5 }],
    ['wave twist mod4', { ...VARIANT_DEFAULTS[5], surfVariant: 5, waveType: 4, waveAmp: 0.5, waveFreq: 2, waveStop: 3 }],
    ['wave gyroid ifs', { ...VARIANT_DEFAULTS[10], surfVariant: 10, vIfsX: 1, vIfsY: 1, waveType: 5, waveAmp: 0.25, waveFreq: 3, waveStart: 1, waveStop: 4 }],
    ['wave interference klein', { ...VARIANT_DEFAULTS[8], surfVariant: 8, waveType: 6, waveAmp: 0.3, waveFreq: 2, waveAxZ: 0.5, waveStop: 2 }],
    ['ifs minDE+c', { ...VARIANT_DEFAULTS[10], surfVariant: 10, vIfsX: 1, vIfsY: 1, vIfsOffX: 0.4, vIfsOffY: 0.4, vMinDE: true, vAddC: true, juliaCX: 0.2, juliaCY: -0.3, juliaCZ: 0.1, scaleVary: 0.2, vDEOffset: 0.5 }]];
  const report = [];
  for (const [name, o] of sets) {
    const v = { ...defaults(), ...o };
    // Gyroid Surf stretches space strongly at every iteration, so float32
    // rounding grows with depth (1 iteration agrees to ~0.03%; see README).
    // Compare it where 32-bit precision still holds.
    if ((v.surfVariant | 0) === 15) v.iterations = Math.min(v.iterations, 3);
    const prog = compileProgram(gl, VERT, '#define RENDER_MODE 0\n#define SURF_VARIANT ' + (v.surfVariant | 0) + '\n' + ((v.repMode | 0) > 0 ? '#define HAS_REP\n' : '') + fractalMapSource(v.foldType, v.foldType2 - 1, { variant: v.surfVariant, stack: [v.vStack1, v.vStack2, v.vStack3, v.vStack4, v.vStack5] }).replace(/^#define RENDER_MODE \d+\n#define SURF_VARIANT \d+\n/, '') + tail);
    gl.useProgram(prog.prog);
    setUniforms(gl, prog, sceneUniforms(v));
    const map = makeDE(v);
    let worst = 0, n = 0;
    for (let i = 0; i < 4000 && n < 64; i++) {
      const R = i < 2000 ? 3 : 8; // widen the box for dense folds
      const p = [(Math.random() * 2 - 1) * R, (Math.random() * 2 - 1) * R, (Math.random() * 2 - 1) * R];
      const cpu = map(p).d;
      if (cpu > 15 || cpu < 0.005) continue; // outside packable range / ill-conditioned near surface
      // Points where a float32-sized change of the input moves the CPU result
      // by > 0.2% can't be reproduced by any 32-bit GPU (Gyroid Surf has many).
      const nudge = [1, -1].map(sg => map(p.map((x, j) => x * (1 + sg * 6e-8 * (j + 1)))).d);
      if (nudge.some(d2 => Math.abs(d2 - cpu) > 2e-3 * cpu)) continue;
      setUniforms(gl, prog, { u_p: p });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const gpu = (px[0] / 255 + px[1] / 65025 + px[2] / 16581375 + px[3] / 4228250625) * 16;
      worst = Math.max(worst, Math.abs(gpu - cpu) / Math.max(cpu, 0.05));
      n++;
    }
    report.push({ name, worst, n });
  }
  return report;
});
for (const r of parity) ok(r.worst < 0.02 && r.n >= 8, `DE parity ${r.name.padEnd(17)} worst rel err ${(r.worst * 100).toFixed(3)}% over ${r.n} pts`);

// Tiled exporter must equal the live renderer at 1 spp (checks tiling, offsets, Y flip).
const tile = await page.evaluate(async () => {
  const { renderImage } = await import('/tests/lib.mjs');
  const { sceneUniforms } = await import('/tests/lib.mjs');
  const s = window.__surf;
  s.state.setMany({ maxSamples: 1, renderScale: 1, rotX: 0.6, rotY: 0.25, targetX: 0.3 });
  await new Promise(r => setTimeout(r, 400));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = document.getElementById('view');
  const W = cv.width, H = cv.height;
  const live = document.createElement('canvas'); live.width = W; live.height = H;
  live.getContext('2d').drawImage(cv, 0, 0);
  const a = live.getContext('2d').getImageData(0, 0, W, H).data;
  const out = await renderImage(s.renderer, sceneUniforms(s.state.values), W, H, 1, {});
  const b = out.getContext('2d').getImageData(0, 0, W, H).data;
  let maxd = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); maxd = Math.max(maxd, d); sum += d; }
  return { W, H, maxd, mean: sum / (W * H * 3) };
});
ok(tile.mean < 0.5 && tile.maxd <= 8, `tiled export == live (${tile.W}×${tile.H}, mean Δ ${tile.mean.toFixed(3)}, max Δ ${tile.maxd})`);

// Every render mode produces a finite, non-black image through the export path.
const modes = await page.evaluate(async () => {
  const { renderImage } = await import('/tests/lib.mjs');
  const { sceneUniforms } = await import('/tests/lib.mjs');
  const { defaults } = await import('/tests/lib.mjs');
  const out = [];
  for (const mode of [0, 1, 2]) {
    const v = { ...defaults(), renderMode: mode, foldType: 3, juliaCX: 0.6, juliaCY: 0.3, juliaCZ: 0.5, rotY: 0.45, dist: 4.5, ptSky: 1.5 };
    const c = await renderImage(window.__surf.renderer, sceneUniforms(v), 48, 32, 2, {});
    const d = c.getContext('2d').getImageData(0, 0, 48, 32).data;
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; min = Math.min(min, l); max = Math.max(max, l); }
    out.push({ mode, mean: sum / (48 * 32), contrast: max - min });
  }
  return out;
});
for (const m of modes) ok(m.mean > 4 && m.contrast > 10, `render mode ${['surface', 'path traced', 'volumetric'][m.mode]}: mean ${m.mean.toFixed(1)}, contrast ${m.contrast.toFixed(0)}`);

// Biome screenshots (few samples, swiftshader is slow).
for (const key of ['default', ...Object.keys(await page.evaluate(async () => (await import('/tests/lib.mjs')).BIOMES))]) {
  await page.evaluate(async k => {
    const { BIOMES } = await import('/tests/lib.mjs');
    const s = window.__surf;
    s.state.resetAll();
    if (k !== 'default') s.state.setMany(BIOMES[k].v);
    // 250-iteration Mandelbulber scenes take minutes a frame on SwiftShader.
    const heavy = s.state.values.iterations > 60;
    s.state.setMany(heavy ? { maxSamples: 1, renderScale: 0.2 } : { maxSamples: 4, renderScale: 0.5 });
  }, key);
  const t0 = Date.now();
  await page.waitForFunction(() => window.__surf.renderer.live.samples >= window.__surf.state.values.maxSamples && !window.__surf.renderer.isCompiling(), null, { timeout: 600000 });
  await page.screenshot({ path: `${OUT}/biome-${key}.png`, timeout: 600000 });
  console.log(`  shot  ${key} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
ok(true, `screenshots in ${OUT}`);
// Back to a cheap render before the layout checks: a full-res frame of the last
// preset can take most of a minute on SwiftShader and starve the resize check.
await page.evaluate(() => window.__surf.state.setMany({ renderScale: 0.25, maxSamples: 1 }));
await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1, null, { timeout: 600000 });

// ── UI wiring: buttons that were dead in v1, keyframes, export downloads ──
page.on('dialog', d => d.accept());
// SwiftShader renders on the CPU: a reset back to full render scale and 64
// samples makes each frame take seconds and starves UI clicks. Keep resets
// lightweight for the rest of the run (test-only; the app is unchanged).
await page.evaluate(() => {
  const s = window.__surf.state, orig = s.resetAll.bind(s);
  s.resetAll = (...a) => { orig(...a); s.setMany({ maxSamples: 1, renderScale: 0.25, exportSamples: 1 }); };
});
// Desktop layout with both docks open.
await page.setViewportSize({ width: 1600, height: 900 });
await page.evaluate(() => document.getElementById('app').classList.remove('no-left', 'no-right'));
await page.waitForTimeout(300);
const layout = await page.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  const c = document.getElementById('view');
  return { left: r('dockLeft'), right: r('dockRight'), stage: r('stage'), cw: c.width, ch: c.height };
});
ok(layout.left.right <= layout.stage.left + 1 && layout.stage.right <= layout.right.left + 1, `docks flank the viewer (L ${layout.left.width}px · stage ${layout.stage.width}px · R ${layout.right.width}px)`);
await page.waitForFunction(() => { const c = document.getElementById('view'); return c.width === c.clientWidth && c.height === c.clientHeight; }, null, { timeout: 600000 });
ok(true, 'canvas backing size tracks the centre cell');
// Every dock combination must give the viewer the remaining width.
for (const [cls, label] of [[[], 'both docks'], [['no-left'], 'left hidden'], [['no-right'], 'right hidden'], [['no-left', 'no-right'], 'both hidden']]) {
  const r = await page.evaluate(c => {
    const a = document.getElementById('app'); a.classList.remove('no-left', 'no-right'); c.forEach(k => a.classList.add(k));
    const st = document.getElementById('stage').getBoundingClientRect();
    const dl = document.getElementById('dockLeft').getBoundingClientRect(), dr = document.getElementById('dockRight').getBoundingClientRect();
    return { w: st.width, x: st.left, expect: innerWidth - (c.includes('no-left') ? 0 : dl.width) - (c.includes('no-right') ? 0 : dr.width) };
  }, cls);
  ok(Math.abs(r.w - r.expect) < 2, `viewer width with ${label}: ${r.w}px (expected ${r.expect}px)`);
}
await page.evaluate(() => document.getElementById('app').classList.remove('no-left', 'no-right'));
await page.keyboard.press('BracketLeft');
await page.waitForTimeout(200);
ok(await page.evaluate(() => document.getElementById('app').classList.contains('no-left')), '[ hides the left dock');
await page.keyboard.press('BracketLeft');
await page.screenshot({ path: `${OUT}/layout-docked.png`, timeout: 600000 });
await page.evaluate(() => { const s = window.__surf; s.state.resetAll(); s.state.setMany({ maxSamples: 1, renderScale: 0.25, exportSamples: 1 }); });
const clickText = t => page.locator('button', { hasText: t }).first().click({ timeout: 180000, noWaitAfter: true });
const before = await page.evaluate(() => JSON.stringify(window.__surf.state.values));
await clickText('Evolve');
const afterEvolve = await page.evaluate(() => JSON.stringify(window.__surf.state.values));
ok(before !== afterEvolve, 'Evolve changes the scene');
await clickText('Rebirth');
await clickText('Undo');
const afterUndo = await page.evaluate(() => JSON.stringify(window.__surf.state.values));
ok(afterUndo === afterEvolve, 'Undo restores pre-Rebirth state');
await clickText('Redo');
ok(await page.evaluate(() => JSON.stringify(window.__surf.state.values)) !== afterEvolve, 'Redo re-applies Rebirth');

// Discovery copy → load round trip through the dialog.
const disc = await page.evaluate(async () => (await import('/tests/lib.mjs')).encodeDiscovery(window.__surf.state.values));
await page.evaluate(() => window.__surf.state.resetAll());
await clickText('Load String');
await page.fill('#discText', disc, { timeout: 600000 });
await page.click('#discLoad', { timeout: 180000, noWaitAfter: true });
const reloaded = await page.evaluate(async () => (await import('/tests/lib.mjs')).encodeDiscovery(window.__surf.state.values));
ok(reloaded === disc, 'discovery string loads through the dialog');

// Keyframes: K adds, Space plays, sequence moves the camera.
await page.mouse.click(600, 300);
await page.evaluate(() => { const s = window.__surf.state; s.resetAll(); s.setMany({ rotX: 0, dist: 5, seqDuration: 0.5, renderScale: 0.25, maxSamples: 1, exportSamples: 1 }); });
await page.keyboard.press('KeyK');
await page.evaluate(() => window.__surf.state.setMany({ rotX: 1.0, dist: 3 }));
await page.keyboard.press('KeyK');
ok(await page.evaluate(() => window.__surf.seq.length) === 2, 'K adds keyframes');
await page.keyboard.press('Space');
await page.waitForFunction(() => !window.__surf.seq.playing, null, { timeout: 600000 });
const endDist = await page.evaluate(() => window.__surf.state.values.dist);
ok(Math.abs(endDist - 3) < 1e-6, `sequence ends on last key (dist ${endDist})`);

// Offline frame export → zip download (small viewer so SwiftShader stays quick).
await page.selectOption('#saveRes', 'viewport');
// Right dock stays open (the button lives there); a narrow window keeps the viewer small.
await page.evaluate(() => { const a = document.getElementById('app'); a.classList.add('no-left'); a.classList.remove('no-right'); });
await page.evaluate(() => window.__surf.state.setMany({ recSamples: 1, recRes: 0 })); // PNG frames use the Video & Frames settings
await page.setViewportSize({ width: 960, height: 300 });
await page.waitForTimeout(500);
const dl = page.waitForEvent('download', { timeout: 900000 }); // ~20 s a frame on SwiftShader
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Render PNG Frames')).click());
const zipFile = await dl;
const zipPath = `${OUT}/${zipFile.suggestedFilename()}`;
await zipFile.saveAs(zipPath);
ok(/kyma-frames-\d{3,}x\d{3,}-.*\.zip$/.test(zipPath), `frames zip downloaded: ${zipFile.suggestedFilename()}`);

// Save Image → PNG download (button lives in the right dock).
const dl2 = page.waitForEvent('download', { timeout: 600000 });
await clickText('Save Image');
const png = await dl2;
await png.saveAs(`${OUT}/${png.suggestedFilename()}`);
ok(/\.png$/.test(png.suggestedFilename()), `image downloaded: ${png.suggestedFilename()}`);

// Record Video: still view must still yield frames; with 2+ keys it plays the
// sequence from key 1 and stops/downloads by itself.
{
  const { execFileSync } = await import('node:child_process');
  const frames = f => { try { return +execFileSync('ffprobe', ['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0', f]).toString().trim(); } catch { return 0; } };
  await page.evaluate(() => { const s = window.__surf; s.seq.clear(); s.state.setMany({ renderScale: 0.25, maxSamples: 1, recMode: 0, recRes: 1, recQuality: 1 }); });
  await page.waitForTimeout(1500);
  let dlv = page.waitForEvent('download', { timeout: 600000 });
  await page.click('#recVideo');
  await page.waitForTimeout(2000);
  await page.click('#recVideo');
  let vid = await dlv; let vp = `${OUT}/${vid.suggestedFilename()}`; await vid.saveAs(vp);
  const stillFrames = frames(vp);
  ok(stillFrames > 10, `record still view → ${vid.suggestedFilename()} has ${stillFrames} frames`);
  await page.evaluate(() => { const s = window.__surf; s.state.setMany({ seqDuration: 1, seqMode: 1 }); s.seq.add(s.state.sceneSnapshot()); s.state.setMany({ rotX: s.state.values.rotX + 0.4 }); s.seq.add(s.state.sceneSnapshot()); });
  dlv = page.waitForEvent('download', { timeout: 600000 });
  await page.click('#recVideo');
  await page.waitForFunction(() => /REC/.test(document.getElementById('hud').textContent), null, { timeout: 30000 }).catch(() => {});
  const mid = await page.evaluate(() => ({ playing: window.__surf.seq.playing, hud: document.getElementById('hud').textContent }));
  ok(mid.playing && /REC/.test(mid.hud), `record plays the sequence (${mid.hud.slice(0, 24)})`);
  vid = await dlv; vp = `${OUT}/seq-${vid.suggestedFilename()}`; await vid.saveAs(vp);
  const after = await page.evaluate(() => ({ playing: window.__surf.seq.playing, label: document.getElementById('recVideo').textContent }));
  ok(frames(vp) > 2 && !after.playing && after.label === 'Record Video', `sequence recording auto-stopped (${frames(vp)} frames, Loop = one cycle)`);
  await page.evaluate(() => window.__surf.seq.clear());

  // Real-time at a chosen resolution: the drawing buffer is resized for the
  // recording (letterboxed on screen) and handed back to the layout afterwards.
  await page.evaluate(() => window.__surf.state.setMany({ recMode: 0, recRes: 2, recFormat: 1 }));
  dlv = page.waitForEvent('download', { timeout: 600000 });
  await page.evaluate(() => document.getElementById('recVideo').click());
  // Wait for real frames (a 720p SwiftShader frame can take longer than any fixed delay),
  // then a few seconds so software VP9 emits something.
  await page.waitForFunction(() => document.getElementById('view').width === 1280, null, { timeout: 600000 }); // resized (accumulation reset)
  await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1, null, { timeout: 600000 }); // and drawn
  await page.waitForTimeout(4000);
  const during = await page.evaluate(() => [canvas => [canvas.width, canvas.height]][0](document.getElementById('view')));
  await page.evaluate(() => document.getElementById('recVideo').click());
  vid = await dlv.catch(async e => { throw new Error(`real-time 720p: no download — toast "${await page.textContent('#toast')}" (${e.message.split('\n')[0]})`); });
  vp = `${OUT}/rt-${vid.suggestedFilename()}`; await vid.saveAs(vp);
  const dims = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0', vp]).toString().trim();
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => { const c = document.getElementById('view'); return c.width === c.clientWidth && c.height === c.clientHeight && !c.style.objectFit; });
  ok(during.join('x') === '1280x720' && dims === '1280,720' && back, `real-time 720p: buffer ${during.join('×')}, file ${dims}, restored ${back}`);

  // Offline (frame-exact) through WebCodecs + our muxers, both containers.
  // Small viewer so SwiftShader stays quick; 0.25 s at 24 fps, Once = 7 frames.
  await page.setViewportSize({ width: 480, height: 300 });
  await page.evaluate(() => {
    const s = window.__surf;
    document.getElementById('app').classList.add('no-left', 'no-right');
    s.state.setMany({ seqDuration: 0.25, seqMode: 0, recMode: 1, recRes: 1, recFps: 0, recSamples: 1 });
    s.seq.add(s.state.sceneSnapshot()); s.state.setMany({ rotX: s.state.values.rotX + 0.3 }); s.seq.add(s.state.sceneSnapshot());
  });
  await page.waitForTimeout(500);
  for (const [fmt, codec] of [[0, 'h264'], [1, 'vp9']]) {
    await page.evaluate(f => window.__surf.state.setMany({ recFormat: f }), fmt);
    dlv = page.waitForEvent('download', { timeout: 600000 });
    await page.evaluate(() => document.getElementById('recVideo').click());
    vid = await dlv; vp = `${OUT}/off-${vid.suggestedFilename()}`; await vid.saveAs(vp);
    const info = execFileSync('ffprobe', ['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,nb_read_frames,r_frame_rate','-of','csv=p=0', vp]).toString().trim();
    let clean = true;
    try { const e = execFileSync('ffmpeg', ['-v','error','-i', vp, '-f','null','-'], { stdio: ['ignore', 'pipe', 'pipe'] }); clean = !e.toString().trim(); } catch { clean = false; }
    ok(info === `${codec},24/1,7` && clean, `offline ${vid.suggestedFilename().split('.').pop()} → ${info} (decodes clean: ${clean})`);
  }
  await page.evaluate(() => { const s = window.__surf; s.seq.clear(); s.state.setMany({ recMode: 1, recRes: 0, recFps: 1, recSamples: 16, recFormat: 0, recQuality: 2 }); document.getElementById('app').classList.remove('no-left', 'no-right'); });
}

// Ground plane: picking a type in the panel loads its look; Place Under Fractal
// puts the plane inside the object's vertical span; every mode renders it.
{
  const g = await page.evaluate(async () => {
    const s = window.__surf;
    const { BIOMES } = await import('/tests/lib.mjs');
    s.state.setMany({ ...BIOMES.chalice.v, renderScale: 0.25, maxSamples: 1 });
    s.state.set('groundType', 2, 'ui');
    const col = s.state.values.groundColor;
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Place Under Fractal').click();
    return { col, y: s.state.values.groundY, toast: document.getElementById('toast').textContent };
  });
  const m = g.toast.match(/spans (-?[\d.]+) … (-?[\d.]+)/);
  ok(g.col === '#3d5a22' && m && g.y > +m[1] && g.y < +m[2], `ground: grass defaults ${g.col}, placed at y ${g.y} inside ${m ? m[1] + '…' + m[2] : '?'}`);
  for (const [type, mode] of [[5, 0], [7, 1], [3, 2]]) {
    await page.evaluate(([t, m]) => window.__surf.state.setMany({ groundType: t, renderMode: m, maxSamples: 1 }), [type, mode]);
    await page.waitForTimeout(300);
    const okR = await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1 && !window.__surf.renderer.isCompiling(), null, { timeout: 600000 }).then(() => true).catch(() => false);
    ok(okR, `ground type ${type} renders in mode ${mode}`);
  }
  await page.evaluate(() => window.__surf.state.setMany({ groundType: 0, renderMode: 0 }));
}

// Fine-tune chip on a rotation slider: window shrinks to 1/20 then 1/200, re-centres.
await page.setViewportSize({ width: 1600, height: 900 });
await page.evaluate(() => {
  document.getElementById('app').classList.remove('no-left', 'no-right');
  const s = window.__surf.state; s.resetAll(); s.setMany({ maxSamples: 1, renderScale: 0.25, alpha: 1.0 });
  [...document.querySelectorAll('.group-header')].find(h => h.textContent.includes('Folding & Space') && !h.classList.contains('active'))?.click();
});
const fineInfo = await page.evaluate(async () => {
  const row = document.querySelector('.slider-row[data-id="alpha"]');
  const chip = row.querySelector('.fine-toggle');
  const slider = row.querySelector('input[type=range]');
  const span = () => parseFloat(slider.max) - parseFloat(slider.min);
  const full = span();
  chip.click();
  const fine = span(), centre = (parseFloat(slider.max) + parseFloat(slider.min)) / 2;
  chip.click();
  const ultra = span();
  // Wheel nudge in ultra mode.
  slider.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  const afterWheel = window.__surf.state.values.alpha;
  chip.click();
  return { full, fine, ultra, centre, afterWheel, offSpan: span(), label: chip.textContent };
});
ok(Math.abs(fineInfo.fine - fineInfo.full / 20) < 1e-9 && Math.abs(fineInfo.ultra - fineInfo.full / 200) < 1e-9, `fine-tune windows: ${fineInfo.full.toFixed(3)} → ${fineInfo.fine.toFixed(4)} → ${fineInfo.ultra.toFixed(5)}`);
ok(Math.abs(fineInfo.centre - 1.0) < 1e-9, 'fine window centred on the current value');
ok(Math.abs(fineInfo.afterWheel - (1.0 + fineInfo.full / 200 / 100)) < 1e-9, `ultra wheel nudge = window/100 (alpha ${fineInfo.afterWheel.toFixed(6)})`);
ok(Math.abs(fineInfo.offSpan - fineInfo.full) < 1e-9, 'turning fine-tune off restores the full range');

// Unavailable controls are hidden, and hiding cascades through gate chains.
const hideInfo = await page.evaluate(async () => {
  const s = window.__surf.state; s.resetAll();
  const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const shown = sel => { const n = typeof sel === 'string' ? document.querySelector(sel) : sel; return !!n && n.offsetParent !== null; };
  const head = t => [...document.querySelectorAll('.sub-head')].find(h => h.textContent.startsWith(t));
  document.querySelectorAll('.group-header:not(.active)').forEach(h => h.click());
  await tick();
  const r = {};
  r.classicStackHidden = !shown(head('Fold Stack')) && !shown('.slider-row[data-id="vFold2"]');
  r.classicFoldAShown = shown(document.querySelector('.fold-desc'));
  s.set('surfVariant', 3); await tick();
  r.mod2StackShown = shown(head('Fold Stack')) && shown('.slider-row[data-id="vFixedR2"]');
  r.mod2KleinHidden = !shown(head('Klein Tail'));
  s.set('surfVariant', 8); await tick();
  const juliaToggle = [...document.querySelectorAll('.toggle-container')].find(t => t.textContent.startsWith('Julia Mode'));
  r.kleinJuliaHidden = !shown(juliaToggle) && !shown(head('Julia Seed')) && s.values.juliaMode === true;
  r.kleinTailShown = shown(head('Klein Tail'));
  s.set('surfVariant', 0); await tick();
  r.backJuliaShown = shown(head('Julia Seed'));
  r.invHidden = !shown('.slider-row[data-id="invRadius"]');
  s.set('invEnabled', true); await tick();
  r.invShown = shown('.slider-row[data-id="invRadius"]');
  s.set('renderMode', 1); await tick();
  r.ptShown = shown(head('Path Tracing')) && !shown(head('Volumetric Glow'));
  s.resetAll(); await tick();
  return r;
});
for (const [k, v] of Object.entries(hideInfo)) ok(v, `gating: ${k}`);

// Open every accordion group for a UI screenshot.
await page.setViewportSize({ width: 1400, height: 3200 });
await page.evaluate(() => {
  document.getElementById('app').classList.remove('no-left', 'no-right');
  document.querySelectorAll('.group-header:not(.active)').forEach(h => h.click());
  window.__surf.state.setMany({ juliaMode: false, shadows: true, foldType: 7, foldType2: 5, maxSamples: 1, renderScale: 0.25 });
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/ui-full.png`, timeout: 600000 });

// ── Materials, textures, crease (render, differ from the classic look, no NaN) ──
{
  const shoot = async over => {
    await page.evaluate(async o => {
      const { BIOMES } = await import('/tests/lib.mjs');
      const s = window.__surf; s.state.resetAll();
      s.state.setMany({ ...BIOMES.ifs_ring.v, dist: 6, maxSamples: 1, renderScale: 0.2, ...o });
      s.renderer.resetLive(); // no stale frame from the previous case
    }, over);
    await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1 && !window.__surf.renderer.isCompiling(), null, { timeout: 600000 });
    return page.evaluate(() => {
      const c = document.getElementById('view'), g = c.getContext('webgl');
      const w = c.width, h = c.height, buf = new Uint8Array(w * h * 4);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, buf);
      return Array.from(buf.filter((_, i) => i % 16 === 0)); // every 4th pixel's R channel
    });
  };
  const diff = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;
  const base = await shoot({});
  const cases = [
    ['metal', { matOn: true, matAssign: 0, matAType: 1, matAAmt: 1, matAMix: 0.5, matATint: '#e2b86a' }],
    ['glass', { matOn: true, matAssign: 0, matAType: 2, matAAmt: 0.85, matAMix: 0.5, matATint: '#bfe6ff' }],
    ['iridescent', { matOn: true, matAssign: 0, matAType: 3, matAAmt: 0.5 }],
    ['glow', { matOn: true, matAssign: 0, matAType: 4, matAAmt: 1.5, matAMix: 1, matATint: '#ff8000' }],
    ['3 slots by fold count', { matOn: true, matAssign: 1 }],
    ['triplanar texture + bump', { texMode: 3, texSrc: 2, texScale: 3 }],
    ['fractalized texture', { texMode: 1, texSrc: 2, texMap: 1, texFracStart: 3, texScale: 0.5, texBlend: 2 }],
    ['crease tint', { creaseAmt: 0.8, creaseCol: '#ff3010' }],
    ['path traced materials', { renderMode: 1, matOn: true, matAssign: 1, matBType: 2 }],
  ];
  const same = await shoot({ matOn: false, texMode: 0, creaseAmt: 0 });
  ok(diff(base, same) < 0.5, `materials off renders the classic image (mean diff ${diff(base, same).toFixed(2)})`);
  for (const [name, o] of cases) {
    const px = await shoot(o);
    const d = diff(base, px);
    ok(d > 1 && px.some(x => x > 0), `${name}: renders and changes the image (mean diff ${d.toFixed(1)})`);
  }
}

// ── Mutation grid ──
{
  await page.evaluate(async () => {
    const { BIOMES } = await import('/tests/lib.mjs');
    const s = window.__surf; s.state.resetAll();
    s.state.setMany({ ...BIOMES.ifs_shells.v, maxSamples: 1, renderScale: 0.2 });
    s.mutGrid.maxSamples = 1;
    s.mutGrid.open();
  });
  await page.waitForFunction(() => window.__surf.mutGrid.tiles.every(t => t.samples >= 1), null, { timeout: 900000 });
  const r = await page.evaluate(() => {
    const g = window.__surf.mutGrid, s = window.__surf.state, before = { ...s.values };
    const lit = g.tiles.filter(t => { const d = t.cv.getContext('2d').getImageData(0, 0, t.cv.width, t.cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2]; return n > 0; }).length;
    const i = g.tiles.findIndex((t, k) => k !== g.parentIndex && Object.keys(t.diff).length);
    const dk = g.tiles[i].diff;
    g.tiles[i].cell.click();
    const applied = Object.entries(dk).every(([k, v]) => s.values[k] === v);
    g.back();
    const restored = Object.keys(dk).every(k => s.values[k] === before[k]);
    const kinds = new Set(g.tiles.map(t => JSON.stringify(t.diff))).size;
    return { n: g.tiles.length, lit, applied, restored, kinds, live: window.__surf.renderer.live.samples };
  });
  ok(r.n === 9 && r.lit === 9, `mutation grid: 9 tiles rendered (${r.lit} lit)`);
  ok(r.kinds === 9, 'mutation grid: parent + 8 different children');
  ok(r.applied && r.restored, 'mutation grid: click breeds from the child, Back restores the parent');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__surf.mutGrid.isOpen && window.__surf.renderer.live.samples >= 1, null, { timeout: 600000 });
  ok(true, 'mutation grid: Esc closes and the viewer resumes');
}

// ── Click tools, repetition, deep zoom ──
{
  const px = async () => page.evaluate(() => {
    const c = document.getElementById('view'), g = c.getContext('webgl'), w = c.width, h = c.height, buf = new Uint8Array(w * h * 4);
    g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, buf);
    let e = 0, lit = 0;
    for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { const i = (y * w + x) * 4; e += Math.abs(buf[i] - buf[i - 4]) + Math.abs(buf[i + 1] - buf[i - 3]); if (buf[i] + buf[i + 1] + buf[i + 2] > 30) lit++; }
    return { edges: e / (w * h), lit: lit / (w * h), keys: [...window.__surf.renderer.programs.keys()] };
  });
  const scene = async o => {
    await page.evaluate(async o => {
      const { BIOMES } = await import('/tests/lib.mjs');
      const s = window.__surf; s.state.resetAll();
      s.state.setMany({ ...BIOMES.kyma_ell.v, maxSamples: 1, renderScale: 0.25, ...o });
      s.renderer.resetLive();
    }, o);
    await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1 && !window.__surf.renderer.isCompiling(), null, { timeout: 900000 });
    return px();
  };
  const single = await scene({});
  const grid = await scene({ repMode: 1, repCountX: 2, repCountY: 0, repCountZ: 2, repSpaceX: 9, repSpaceZ: 9, dist: 30 });
  const ring = await scene({ repMode: 2, repRingN: 8, repRingR: 7, repRingAxis: 1, dist: 22, repRotVar: 30, repColVar: 1 });
  ok(grid.keys.some(k => k.includes('|rep')) && grid.lit > 0.05 && ring.lit > 0.05 && Math.abs(grid.lit - single.lit) > 0.01, `repetition renders (grid ${(grid.lit * 100).toFixed(0)}%, ring ${(ring.lit * 100).toFixed(0)}% lit)`);

  // Deep zoom: a very close view is sharper with Deep Zoom than without.
  const close = { dist: 0.0005, targetX: 0, targetY: 0, targetZ: 0 };
  await scene({}); // pick on the single, unrepeated object
  const hit = await page.evaluate(async () => {
    const { pickPixel } = await import('/tests/lib.mjs');
    const v = window.__surf.state.values;
    const c = document.getElementById('view');
    return pickPixel(v, c.clientWidth / 2, c.clientHeight / 2, c.clientWidth, c.clientHeight).p;
  });
  if (hit) { close.targetX = hit[0]; close.targetY = hit[1]; close.targetZ = hit[2]; }
  const blurry = await scene({ ...close, deepZoom: false });
  const sharp = await scene({ ...close, deepZoom: true });
  ok(!!hit && sharp.keys.some(k => k.includes('|dz')) && sharp.edges > blurry.edges * 1.2, `Deep Zoom sharpens a ×8000 close-up (edge energy ${blurry.edges.toFixed(1)} → ${sharp.edges.toFixed(1)})`);
  const hud = await page.evaluate(() => document.getElementById('hud').textContent);
  await page.waitForTimeout(600);
  const hud2 = await page.evaluate(() => document.getElementById('hud').textContent);
  ok(/zoom ×/.test(hud2) && /precision OK|near float32|beyond float32/.test(hud2), `HUD shows zoom and precision ("${hud2.split('·').slice(-3).join('·').trim()}")`);

  // Click tools: a click without a drag places Light 2 off the surface, or zooms in.
  await scene({ clickMode: 2, lightPlace: 0.3 });
  const box = await page.locator('#view').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  const placed = await page.evaluate(async () => {
    const { pickPixel } = await import('/tests/lib.mjs');
    const v = window.__surf.state.values, c = document.getElementById('view');
    const h = pickPixel(v, c.clientWidth / 2, c.clientHeight / 2, c.clientWidth, c.clientHeight);
    const L = [v.light2X, v.light2Y, v.light2Z];
    const want = h.p.map((x, i) => x + h.n[i] * v.lightPlace * h.t);
    const m = document.querySelectorAll('.light-marker')[1];
    return { on: v.light2On, err: Math.hypot(...L.map((x, i) => x - want[i])), marker: m && m.style.display !== 'none' && document.querySelector('.light-markers').style.display !== 'none' };
  });
  ok(placed.on && placed.err < 1e-6 && placed.marker, `click places Light 2 ${0.3}×distance off the surface along its normal, marker shown (err ${placed.err.toExponential(1)})`);
  // Dragging still orbits and places nothing.
  const before = await page.evaluate(() => ({ x: window.__surf.state.values.light2X, r: window.__surf.state.values.rotX }));
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy, { steps: 4 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ x: window.__surf.state.values.light2X, r: window.__surf.state.values.rotX }));
  ok(after.x === before.x && after.r !== before.r, 'a drag orbits and does not move the light');
  // Zoom tool: each click halves the distance toward the clicked point; Deep Zoom switches on below 0.05.
  await page.evaluate(() => window.__surf.state.setMany({ clickMode: 4, deepZoom: false }));
  const d0 = await page.evaluate(() => window.__surf.state.values.dist);
  let zoomed = 0;
  for (let k = 0; k < 8; k++) {
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(150);
    zoomed++;
    if (await page.evaluate(() => window.__surf.state.values.dist < 0.03)) break;
  }
  const z = await page.evaluate(() => ({ d: window.__surf.state.values.dist, dz: window.__surf.state.values.deepZoom }));
  ok(z.d < d0 / 2 ** (zoomed - 1) && z.dz === (z.d < 0.05), `zoom tool: ${zoomed} clicks took the view from ${d0.toPrecision(3)} to ${z.d.toPrecision(3)}, Deep Zoom ${z.dz ? 'on' : 'off'}`);
  await page.evaluate(() => window.__surf.state.setMany({ clickMode: 0 }));
}

// ── Extra lights (Light 2 / 3) ──
{
  const shootL = async over => {
    await page.evaluate(async o => {
      const { BIOMES } = await import('/tests/lib.mjs');
      const s = window.__surf; s.state.resetAll();
      s.state.setMany({ ...BIOMES.ifs_ring.v, dist: 6, maxSamples: 1, renderScale: 0.2, ...o });
      s.renderer.resetLive();
    }, over);
    await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1 && !window.__surf.renderer.isCompiling(), null, { timeout: 900000 });
    return page.evaluate(() => {
      const c = document.getElementById('view'), g = c.getContext('webgl'), buf = new Uint8Array(c.width * c.height * 4);
      g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, buf);
      let r = 0, gg = 0, b = 0; for (let i = 0; i < buf.length; i += 4) { r += buf[i]; gg += buf[i + 1]; b += buf[i + 2]; }
      const n = buf.length / 4;
      return { r: r / n, g: gg / n, b: b / n, keys: [...window.__surf.renderer.programs.keys()] };
    });
  };
  const red = { light2On: true, light2Color: '#ff2000', light2Int: 2.5, light2X: -3, light2Y: 3, light2Z: 4 };
  for (const [name, base] of [['surface', {}], ['path traced', { renderMode: 1 }], ['volumetric', { renderMode: 2 }], ['with materials', { matOn: true, matAssign: 1 }]]) {
    const a = await shootL(base), b2 = await shootL({ ...base, ...red });
    ok(b2.r - a.r > 1.5 && b2.r - a.r > (b2.b - a.b) + 1 && b2.keys.some(k => k.endsWith('|xl')), `Light 2 (red) adds red light — ${name} (ΔR ${(b2.r - a.r).toFixed(1)}, ΔB ${(b2.b - a.b).toFixed(1)})`);
  }
  const noSh = await shootL({ ...red, shadows: true, light2Shadows: false }), sh = await shootL({ ...red, shadows: true, light2Shadows: true });
  ok(noSh.r - sh.r > 0.3, `Light 2 shadows darken it (ΔR ${(noSh.r - sh.r).toFixed(2)})`);
  const blue = await shootL({ light3On: true, light3Color: '#0040ff', light3Int: 2.5, light3Relative: true, light3X: 0, light3Y: 0, light3Z: 0 });
  const plain = await shootL({});
  ok(blue.b - plain.b > 1.5, `Light 3 as a camera headlight lights the view blue (ΔB ${(blue.b - plain.b).toFixed(1)})`);
  await page.evaluate(() => { window.__surf.state.setMany({ light2On: false }); });
  await page.waitForTimeout(1500);
  const hidden = await page.evaluate(() => { const n = document.querySelector('[data-id="light2X"]'); return !!n && !!n.closest('.gate-hidden'); });
  await page.evaluate(() => { window.__surf.state.setMany({ light2On: true }); });
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(() => { const n = document.querySelector('[data-id="light2X"]'); return !!n && !n.closest('.gate-hidden'); });
  ok(hidden && shown, 'Light 2 controls appear only when it is on');
}

// ── Kyma's own formulas (11–15): presets render, selector shows the right controls ──
// Presets load through the dropdown; the formula selector applies the defaults.
for (const key of ['kyma_lox', 'kyma_torus', 'kyma_ell', 'kyma_vortex', 'kyma_gyroid']) {
  await page.evaluate(k => { const s = document.getElementById('presetSelect'); s.value = k; s.dispatchEvent(new Event('change')); window.__surf.state.setMany({ maxSamples: 1, renderScale: 0.2 }); window.__surf.renderer.resetLive(); }, key);
  await page.waitForFunction(() => window.__surf.renderer.live.samples >= 1 && !window.__surf.renderer.isCompiling(), null, { timeout: 900000 });
  const r = await page.evaluate(() => {
    const c = document.getElementById('view'), g = c.getContext('webgl'), buf = new Uint8Array(c.width * c.height * 4);
    g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, buf);
    let lit = 0; for (let i = 0; i < buf.length; i += 4) if (buf[i] + buf[i + 1] + buf[i + 2] > 30) lit++;
    return { v: window.__surf.state.values.surfVariant, lit: lit / (buf.length / 4) };
  });
  ok(r.v >= 11 && r.lit > 0.05, `preset ${key}: formula ${r.v}, renders (${(r.lit * 100).toFixed(0)}% lit)`);
}
const OWN = { 11: ['vLoxX', 'vLoxY', 'vLoxZ'], 12: ['vTorusOnX', 'vTorusOnY', 'vTorusOnZ', 'vTorusRX', 'vTorusRY', 'vTorusRZ'], 13: ['vEllX', 'vEllY', 'vEllZ'], 14: ['vVortexX', 'vVortexY', 'vVortexZ', 'vVortexDX', 'vVortexDY', 'vVortexDZ'], 15: ['vGyroFreq', 'vGyroL'] };
const ALL = [...new Set(Object.values(OWN).flat())];
for (const vi of [11, 12, 13, 14, 15, 1]) {
  await page.evaluate(vi => {
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.startsWith('Loxodromic')));
    sel.value = String(vi); sel.dispatchEvent(new Event('change'));
  }, vi);
  await page.waitForTimeout(1500); // gates refresh on the next frame
  const r = await page.evaluate(([vi, ALL]) => {
    // Sliders carry data-id; on/off switches are found by their label (Ring X …).
    const open = id => {
      const n = document.querySelector(`#dockLeft [data-id="${id}"]`)
        || (id.startsWith('vTorusOn') ? [...document.querySelectorAll('#dockLeft label.toggle-container')].find(l => l.textContent.trim() === 'Ring ' + id.slice(-1)) : null);
      return !!n && !n.closest('.gate-hidden');
    };
    return { v: window.__surf.state.values.surfVariant, open: Object.fromEntries(ALL.map(id => [id, open(id)])), desc: document.body.textContent.includes(['', 'Kali / DarkBeam', '', '', '', '', '', '', '', '', '', 'Loxodromic Surf (Kyma):', 'Torus Surf (Kyma):', 'Ellipsoid Surf (Kyma):', 'Vortex Surf (Kyma):', 'Gyroid Surf (Kyma):'][vi]) };
  }, [vi, ALL]);
  const want = OWN[vi] || [];
  const right = ALL.every(id => r.open[id] === want.includes(id));
  ok(r.v === vi && right && r.desc, `formula selector → ${vi}: defaults + description, shows exactly its own controls ${right ? "" : JSON.stringify(r.open)}`);
}

ok(errors.length === 0, `no console errors${errors.length ? ':\n' + errors.join('\n') : ''}`);
await browser.close();
console.log(fail ? `${fail} FAILED` : 'browser checks passed');
process.exit(fail ? 1 : 0);
