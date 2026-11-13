# Kyma v2.13.0

**Kyma** (κῦμα, Greek for "wave") is a progressive WebGL1 raymarcher for Kali's **Amazing Surf** fractal family. It includes all nine of Mandelbulber's surf formulas, path tracing, volumetric glow and environment lighting. It has no dependencies and no build step. It was formerly *Amazing Surf*; old project files, discovery strings (`SURF2:`) and saved panel layouts still load.

## Run

ES modules need a local server, because `file://` blocks module imports:

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Layout

The UI is docked in three columns:

| Left dock — **Formula** | Centre | Right dock — **Scene & Output** |
|---|---|---|
| Presets (dropdown) | Viewer | Save image / record video |
| Geometric core | | View & navigation |
| Fold types (A, hybrid B, polar sectors, axis swap) | | Color & lens (gradient, exposure, DOF) |
| Folding & space (limits, Julia, rotations) | | Environment (backdrop / 360° panorama) |
| | | Atmosphere & light |
| Spherical inversion | | Animation sequencer + offline frames |
| Iteration (iterations, ray steps, detail) | | Quality & output |
| *Evolve · Rebirth · Undo · Redo* | | *Discovery string · project · reset* |

The left dock describes what the fractal *is*; the right dock controls how it is seen, animated and exported. `[` and `]` toggle the docks and `H` hides all UI. The viewer always takes the remaining width. Below 900 px the docks become slide-over drawers.

## Surf variants

**Surf Variant → Formula** selects the per-iteration formula. Besides this app's own engine, it offers the nine formulas in Mandelbulber 2's surf family (Kali's Amazing Surf, with features added by DarkBeam). They are reimplemented here from Mandelbulber's source (`formula/definition/fractal_amazing_surf*.cpp`). The math is ported, not the GPL code.

| Variant | What it adds |
|---|---|
| **Classic (v2 engine)** | This app's engine: 11 fold types + hybrid fold B on all three axes. |
| **Amazing Surf (Mandelbulber)** | The reference ordering: X/Y box fold, combined sphere fold + scale, swapped-c add, c added after rotation. |
| **Mod 1** | Fold stack, pre-sphere offset, Abox sphere fold (r → 1/r²), then a separate Influence-blended scale. |
| **Mod 2** | Fold stack, Z fold, X/Y swap, Mandelbox sphere fold with movable centre and outer radius², additive scale, swizzled C-Mult add *before* folding. |
| **Mod 3** | Mod 2 plus Y/Z sign flips on even iterations; the C-Mult add moves *after* scaling. |
| **Mod 4** | X/Y(+Z) box fold, offsets before and after the sphere fold, combined sphere fold + additive scale, DE offset. Mandelbulber pairs it with sphere inversion. |
| **Multi** | Up to five stacked folds, Z reflect, Abox sphere fold with an optional Mandelbox sphere fold on top. |
| **M3D** | The Mandelbulb3D original: scale 1.5 by default, no Influence, unswapped c, sign flips, DE offset, post offset. |
| **Klein / Klein V2** | Surf iterations for the first N, then a full box fold × scale tail (Kleinian-like). No c is added. V2 adds an N-fold polyfold. |

**Fold stack** (Mod 1/2/3/Multi): five slots applied in order to X/Y. Each slot is one of Box (Tglad), Inverse Fold `f−||z|−f|`, Abs Offset `|z+f|`, Conditional Reflect, DarkBeam Double `f2−||z+f|−f2|−f`, or Clamped Folder. Each Mandelbulber variant offers a subset of these; here every stack variant can use all six.

**Picking a variant loads Mandelbulber's defaults**, converted to this app's units. Ctrl+Z undoes this. **Load Variant Defaults** restores them later. Controls a variant doesn't use are **hidden**, and appear when you select a formula or option that uses them. Hiding cascades: on Klein, for example, Julia Mode disappears (Klein adds no c), and so does the Julia Seed that depends on it.

Things to know:

- **Variants that look alike.** At their defaults, Mod 1–4 and Multi reduce to almost the same surface as the reference Amazing Surf. Mod 2/3/4 differ only in minR, and Klein is identical to Klein V2. That is how Mandelbulber built the family: one core with optional extras. The differences come from each variant's options.
- **Min Radius conversion.** Here Min Radius *r* means the sphere fold switches at r². Mandelbulber's reference and Mod 1 use `√minR05`, so their default 0.5 becomes r ≈ 0.841 here. Klein's `minR0 = 0` becomes r = 0.01, because 0 would divide by zero.
- **Fewer per-transform iteration limits.** Mandelbulber gives most transforms their own start/stop iteration controls. Here they share **Rotations Start at Iteration** and the Klein switch iteration. Rational "soft offset" modes and c rotation/inversion (Mod 2/3) are not ported.
- **Derivative tracking.** Where Mandelbulber's analytic DE uses an approximate factor (e.g. `|m|` when Influence ≠ 1), the true applied factor is used here. The 0.5 DE factor is kept; **Step Factor 2** reproduces Mandelbulber's step lengths.
- **Conditional Reflect is discontinuous** unless Value = 2 × Limit. This is the same as Mandelbulber, and it can cause small DE artefacts.
- **Bailout.** Variants 1–9 use Mandelbulber's bailout of 100. Classic keeps v1's fixed iteration count.

## Fold types

| # | Fold | Character |
|---|---|---|
| 0 | Type 1 (Box) | Classic Mandelbox box fold; Fold Weight adds Tglad smoothing |
| 1 | Type 2 | Inverted box: pillowed cells |
| 2 | Type 3 | Double reflection around ±2: ridged, terraced |
| 3 | Surf XY | Reference Mandelbulber Amazing Surf: X/Y only |
| 4 | Tetrahedral + Box | Sierpinski mirror symmetry |
| 5 | Octahedral + Box | abs + sort (Menger-style), cubic and stepped |
| 6 | Icosahedral + Box | Knighty three-plane fold, five-fold quasi-crystal |
| 7 | Polar Kaleidoscope | N angular sectors around Z, then XY box; rosettes face-on |
| 8 | Smooth Box (tanh) | `2f·tanh(z/f) − z`: box fold with rounded creases |
| 9 | Abs Shift (Kali) | `abs(z) − limit`: kaleidoscopic IFS step |
| 10 | Diagonal Box | Box fold in a frame rotated 45° about Z |

**Hybrid Fold B** swaps in a second fold on every Nth iteration, the way Mandelbulber hybrids do.

All folds are isometries or 1-Lipschitz, so the distance estimate stays conservative; `tests/run.mjs` checks this numerically. Each A/B combination compiles to its own **specialised shader** that contains only that code. A runtime branch over all folds measured 2.1× slower even for the plain box fold, while the specialised default program is ~30% faster than v2.0. New combinations compile in the background (`KHR_parallel_shader_compile`), and the previous image stays up until the new program is ready.

## Rotations

The fold controls sit under **Folding & Space**:

- **Pre-Fold Rotation (Pre α/β/γ).** Rotates z *before* the fold, which tilts the fold planes themselves. This has the biggest effect on structure.
- **Post-Fold Rotation (α/β/γ).** The original v1 rotation, applied after scale and offset.
- **Iteration Spin (SX/SY/SZ).** Iteration *k* is rotated by spin^k, so the twist compounds with depth: spirals and vortex detail.
- **Rotations Start at Iteration.** Leaves the first N iterations unrotated, so the coarse shape stays intact while the fine detail turns.

All of these are isometries, so the distance estimate stays exact.

## Fine-tune sliders

Rotation sliders (pre/post rotation, spin, roll, orbit, panorama yaw/pitch) have an **F** chip next to **R**. Clicking it cycles through three settings:

- **F (amber).** The slider spans 1/20 of its normal range.
- **F².** The slider spans 1/200.
- **Off.** The normal range is restored.

The window is centred on the current value and re-centres each time you release the slider, so you can keep scrubbing in tiny increments without running out of track. While fine-tuning, the mouse wheel over the slider nudges by 1/100 of the window (Shift = ×10). The number box shows extra decimals.

## Render modes

**Render Mode** is at the top of the right dock. Each mode compiles to its own specialised shader, so the surface mode pays nothing for the others.

### Surface (fast)

Direct lighting, as before. The debug views and Auto-fix Cut-offs work in this mode.

### Path traced (global illumination)

A unidirectional path tracer. At each hit, one shadow ray goes to a random point on the light sphere (next-event estimation). A Fresnel-weighted choice then picks a cosine-weighted diffuse bounce or a roughness-blurred mirror bounce. Russian roulette starts after the second bounce.

- **Light sources.** Rays that escape are lit by the **environment image**, or by a sky color when there is no image, so a panorama becomes the scene's lighting.
- **Controls:** Bounces, Roughness, Metallic, Light Intensity and Size (soft shadows), Sky/Image Light, Sky Color, Trap Emission (the fractal glows where the orbit trap is small) and a Firefly Clamp.
- **Interaction.** It previews with the surface shader while anything moves, then converges once you stop. The PT shader compiles in the background.
- **Output.** Radiance is linear and is shown through the filmic tone curve. Raise **Live Max Samples** and **Export Samples** for clean stills.

### Volumetric glow

The distance field is treated as a density, `density·exp(−DE/thickness)`, and integrated front to back with emission and absorption. Solid shapes become glowing shells, and "dust" settings (where the DE plateaus and rays get stranded) become luminous clouds instead of cut-off surfaces.

- Empty space is skipped by stepping in proportion to the DE.
- **Light Shading** adds cheap self-shadowing toward the light.

## Cut-off surfaces (black gaps where the fractal should be)

A ray that uses every **Max Ray Step** without reaching the surface is drawn as background. With some settings, especially pre-fold inversion on every iteration, the orbit never escapes. The distance estimate then plateaus just above the hit threshold, so rays crawl forward in tiny steps and get stranded.

- **Iteration → Auto-fix Cut-offs** probes your current view on the CPU and lowers **Surface Detail** until rays converge.
- **Debug View → Miss Reason** shows each ray's fate: green = hit, red = ran out of steps, blue = passed Max Distance.
- If you see **red**, lower **Surface Detail** (most effective), raise **Max Ray Steps** (up to 1024), raise **Step Factor** (> 1 risks overshoot), or turn on **Shade Stranded Rays as Surface**.
- If you see **blue** (cut off with distance), raise **Max Distance**.
- **Spherical Inversion → DE Scale Limit** sets how far the inversion's derivative is trusted. Raising it never overshoots, but it marches more slowly near the inversion centre.

## Tone curve

**Color & Lens → Tone Curve** chooses between **Legacy**, the original look, and **Filmic (ACES)**. Path tracing always uses Filmic.

## Amazing IFS (variant 10)

Mandelbulber's *Amazing IFS* (fractal_amazing_ifs.cpp; formula by Kali, features by DarkBeam) is Amazing Surf Mod 4 with three additions. Kyma follows its iteration order exactly:

1. Optional per-axis **Pre-Fold Abs**, then the **Pre-Sphere Offset**, then an optional **Polyfold** (N sectors, Y mirrored).
2. The box fold. X and Y always fold; Z folds with **Fold Z Axis Too**. Mandelbulber's default fold limit is 0.5.
3. The **IFS fold**, per axis: *Mirror + shift* (z = |z| − offset), *Shift only* (z − offset) or *Off*. This is what turns the surf into clustered, symmetric sculptures.
4. The **Post-IFS Offset**, then the sphere fold with additive scale (Scale, Min R, Scale Vary, DE Offset), then rotation.
5. **Add c** is off by default, as in Mandelbulber, so the formula builds one bounded object rather than an endless sheet. Turn it on to add the pixel or Julia seed.

**Smooth DE (min over iterations)** is Mandelbulber's custom DE (`aux.dist`): the smallest |z|/DE seen from **Smooth DE From Iteration** onwards. Starting at 2–4 lets the large early surfaces win, which gives solid, glossy shells instead of fine lace. Starting at 0 gives the plain bounding box.

Its built-in sphere inversion is Kyma's **Sphere Inversion** (start of iteration). The test suite includes a line-by-line JavaScript port of the Mandelbulber C++ and checks Kyma's distance estimate against it at 480 random points, both linear and smooth DE, to 1e-7. The GPU shader matches the CPU version within 1%.

**Color Source → Fold amounts (continuous)** is Mandelbulber's extended aux colour for the surf family:

- each box-fold reflection adds **Box-Fold Color** × (|z| − 1);
- each sphere-fold pass outside Min R adds **Sphere-Fold Color** × (r² − Min R²)/100.

Because the sum varies smoothly over a surface, a banded gradient (Circus Stripes, Awning Teal …) wraps the shells in stripes. Keep **Color Iterations** low (3–6) so the stripes follow the big shapes.

Presets: **Striped Shells**, **Ribbon Bowl** and **Ring Reliquary** in the *Amazing IFS* section of the dropdown.

## Mandelbulber import & batjorge scenes

**Import Mandelbulber Settings…** (Presets panel) loads a Mandelbulber 2 settings file (`.fract`, or the `.txt` that pastebin exports) whose formula is a single **Amazing IFS** (id 239) or **Amazing Surf Mod 1** (id 77).

Imported exactly:
- every formula parameter, including Amazing IFS's built-in sphere inversion and its iteration ranges;
- *don't add c constant*;
- the iteration count (up to 250);
- fractal position / rotation, which become the Object Transform;
- the camera: eye, target, roll and vertical field of view;
- Mandelbulber's 3.0 cap on each ray-march step (**Max Step**) and its DE factor.

The test suite carries a line-by-line JavaScript port of the two Mandelbulber formulas and of its distance loop (`tests/mb_reference.mjs`, written against the C++ and not against Kyma). It checks each bundled file at 150 points to within 1e-13, and checks the camera exactly. On the GPU the imported scenes match the CPU to under 0.001%.

Approximated, with a dialog listing each one after import:
- image-textured materials use the material's colour gradient, as the *Imported (Mandelbulber)* gradient;
- HDR skies become a sky colour;
- the first water or plane primitive becomes the ground plane, with the world rotated so that plane is level and the camera is above it;
- the main light uses its direction only;
- DOF and fog are approximated.

Spheres and other primitives, hybrids and other formulas are not imported.

The dropdown's **batjorge.com · Mandelbulber scenes** section holds four scenes by Jorge (batjorge, https://fractal.batjorge.com), included with his permission: **Voyager**, **Cuentos**, **Amrand** (Amazing IFS) and **Una de Setas** (Amazing Surf Mod 1). His original files are in `presets/batjorge/`. The forms and framing are his; the surfaces differ, because his colours come from photo textures and HDR skies that aren't part of the files.

These scenes run 250 iterations, as in Mandelbulber, so expect them to be slower than the other presets.

## Reset buttons

Every slider, dropdown and colour has a **↺** button beside its value that sets it back to its default (0 for most offsets and rotations). The button is dimmed while the value is already at the default.

## Ground plane

A horizontal plane at **Height** that the fractal stands on (right dock, *Ground Plane*). It is a separate surface in the ray march, not part of the formula, so it changes nothing about the fractal's shape, colour or distance estimate. It receives the fractal's shadows (**Receives Shadows**) and contact darkening (Surface AO).

| Ground | What it is |
|---|---|
| Matte | Plain colour, for a studio floor or shadow catcher |
| Grass | Two-colour patches with blade streaks, on rolling hills (**Terrain**) |
| Sand | Dunes with wind ripples and grain |
| Rock | Lumpy rock with cracks |
| Water | Wave normals (**Waves**), Fresnel reflection of the fractal and sky, sun glint |
| Mirror | Flat reflection, tinted by Color |
| Checker | Studio tiles (**Texture Scale** = tile size) |

- Picking a type in the panel loads its starting colours and terrain (Ctrl+Z undoes it).
- **Place Under Fractal** finds the bottom of the object in view and sets the plane just above it, so the base sits slightly sunk in.
- **Horizon Haze** blends the ground into the sky (or the panorama) with distance, so there's no hard edge where Max Distance ends.
- Fine detail (blades, grain, tiles) fades out with distance to avoid shimmer.
- In **Path Traced** mode the ground is a real material: diffuse for the textures, a rough mirror for Mirror (Reflectivity = metalness, Blur = roughness) and a Fresnel dielectric for Water. It bounces light onto the fractal.
- In **Volumetric** mode the glow stops at the ground, which shows behind it.

**Plane Orientation** tilts the plane (**Tilt X / Tilt Z**, ±45°) about the point under the origin, at **Height**. **Spin** turns the texture and terrain, and **Slide X / Z** moves them across the plane, which is useful for finding a nicer patch of dunes or waves. **Level Plane** zeroes all five.

## Object transform

The *Object Transform* panel (right dock) moves the fractal itself: **Position** X/Y/Z, **Rotation** (pitch, yaw, roll in degrees) and **Object Scale**. The camera, light and ground don't move.

- The formula is evaluated in the object's own frame. Rotating and moving keep the distance estimate exact, and scale multiplies it back out, so the shape, colours and cut-off behaviour are unchanged. The test suite checks DE(pos + s·R·q) = s·DE(q), and the GPU matches the CPU to 0.0001%.
- **Drop onto Ground** moves the object up or down so its base sits just into the ground plane, leaving the plane where it is. **Place Under Fractal** in the Ground panel does the reverse and moves the plane. **Reset Object** returns to the origin.
- Every transform value can be keyframed, so the sequencer can turn an object on a still plane, or hold the object while the plane tilts.

These are procedural textures, not geometry: grass has no individual blades, and water doesn't refract. Pair the ground with an environment panorama for a sky.

## Gradients

The surface colour comes from a gradient indexed by the orbit trap. **Gradient** has 27 built-ins plus **Custom (5 colors)**:

- **Original eight** (Cosmic Neon … Ice & Fire): the v1 cosine palettes, rebuilt exactly (within 1/255), so old projects and discovery strings look the same.
- **Perceptual maps**: Inferno, Magma, Viridis, Twilight.
- **Warm**: Sunset Strip, Lava, Blood Moon, Copper.
- **Cool / natural**: Ocean Depths, Aurora, Emerald, Rust & Teal.
- **Neutral**: Chrome, Bone, Ink Wash.
- **Bright**: Spectrum, Vaporwave, Candy, Pastel Dream.

- **Stripes & ornament** (v2.9): Circus Stripes, Awning Teal, Lime Ribbon, Candy Cane, Orange Sash (hard-edged bands), Gilded Filigree, Moss & Gold, Shell Pink.

**Color Source** chooses what indexes the gradient:

- *Orbit trap* (default): the closest the orbit comes to the origin, which gives smooth colour flow.
- *Fold count (stripes)*: each box-fold that actually reflects a component adds **Box-Fold Color**, and each sphere-fold that rescales adds **Sphere-Fold Color** (half for the middle zone). This is the idea behind Mandelbulber's extended "aux colour". The count is constant over each region, so a banded gradient gives crisp stripes and segments. **Color Iterations** counts only the first N iterations: 2–5 gives broad regions, and more gives finer, busier detail.
- *Trap + folds*: both added together.
- *Fold amounts (continuous)*: how far each fold reflected, not just whether it did (see Amazing IFS). This gives smooth stripes.

Multi-stop gradients are blended in OKLab, so transitions keep even brightness instead of going muddy midway. Controls:

- **Gradient Offset**: slides the colours along the surface (was Color Phase).
- **Gradient Repeat**: how many times the gradient cycles across the same structure.
- **Wrap**: *Repeat* jumps from the last colour back to the first; *Mirror* runs there and back with no seam; *Auto* mirrors gradients that don't loop (Inferno, Lava…) and repeats the ones that do.
- **Reverse**, **Gradient Hue** (a rotation around the grey axis, so brightness holds) and **Gradient Saturation**.
- **Custom**: five colour stops, looping.

The strip under the dropdown shows the actual gradient after every modifier; click it to step to the next one. Offset, Repeat, Hue, Saturation and the custom stops all animate in the sequencer.

## Environment

The **Environment** group sets the background in one of three modes: a **Solid Color**, a **Backdrop** (an image cover-fitted to the view) or a **Panorama** (an equirectangular 360° sky with yaw and pitch).

- **Image-based lighting.** Fresnel reflections and image-tinted ambient light are applied to the surface. Fog can take the image color.
- **Built-in images.** Studio, Sunset, Nebula and Aurora are generated procedurally, with no image files.
- **Your own images.** Use **Load Image…** or drop an image on the viewer. 2:1 images load as panoramas; any other shape loads as a backdrop.
- **Projects.** Saved projects embed uploaded images (JPEG) and remember presets by name. Discovery strings carry the settings but not the image.
- **Blur and tiling.** Images are normalised to a mipmapped power-of-two texture. Blur uses explicit LOD via `EXT_shader_texture_lod` where available, which avoids a mip seam where the panorama wraps.

## Files

```
index.html          docked three-column shell
css/style.css       all styling
main.js             wiring: loop, input, docks, exports, history, sequencer UI
engine/
  params.js         parameter schema (single source of truth; group → dock side)
  state.js          observable store; `version` drives accumulation resets
  glsl.js           shader sources; fractalFrag(foldA, foldB) specialisation
  gl.js             raw WebGL1 helpers, float-target detection
  renderer.js       program cache, progressive ping-pong accumulation
  camera.js         orbit / fly / roll camera basis
  de.js             CPU port of the distance estimator (autofocus, Rebirth, tests)
  sequencer.js      keyframes: Catmull-Rom / ease, loop, ping-pong
  presets.js        biomes, Evolve, Rebirth, discovery-string codec
  export.js         tiled multi-sample PNG rendering
  zip.js            store-only ZIP writer for frame sequences
  video.js          WebCodecs encoder wrapper: codec/level selection, bitrate presets
  mux.js            dependency-free MP4 (H.264) and WebM (VP8/VP9) muxers
  gradients.js      gradient library, OKLab blending, modifiers → 256-texel LUT
  mbimport.js       Mandelbulber .fract importer (Amazing IFS, Amazing Surf Mod 1)
  environment.js    procedural sky presets, image → power-of-two env texture
  vec.js            vector/matrix helpers
ui/panel.js         builds both docks from the schema
tests/run.mjs       node logic tests      (npm test)
tests/browser.mjs   headless-GPU checks   (dev only, needs Playwright)
```

Adding a parameter takes three steps:
1. Add one line to `engine/params.js`.
2. Add its uniform in `sceneUniforms()` (`renderer.js`).
3. Declare it in the shader.

To add a fold to the classic engine:
1. Append its GLSL body to `FOLD_GLSL` (`glsl.js`).
2. Add the matching case to `applyFold` in `de.js`.
3. Add its name to `FOLD_NAMES` (`params.js`).

The tests check that the GPU and CPU versions agree and that the fold is 1-Lipschitz.

## Controls

| Input | Action |
|---|---|
| Left drag | Orbit |
| Right drag / wheel / pinch | Dolly |
| Middle drag | Pan |
| WASD, Q/E, Shift | Fly the orbit target (Shift = sprint) |
| Double-click / F | Autofocus depth of field under the cursor / centre |
| K / Space / Esc | Add keyframe / play–stop / stop |
| `[` / `]` / H | Toggle left dock / right dock / all UI |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |

## Rendering & export

- **Progressive.** It renders one sample per pixel while you interact, then accumulates for anti-aliasing and converged depth of field up to **Live Max Samples**. After that the GPU goes idle.
- **Save Image.** Renders 512² tiles × N samples, with pacing so no single draw can trigger the Windows TDR watchdog. Supports viewport, 1080p, 1440p, 4K and 8K.
- **Video & Frames Export panel** (right dock). These settings drive both Record Video and Render PNG Frames; a summary line shows exactly what the next recording will be.
  - **Record Mode.** *Offline (frame-exact)*, the default, needs 2+ keyframes: every frame is fully rendered (tiled, **Samples / Frame**), then encoded with the browser's WebCodecs encoder and packed into MP4 or WebM by Kyma's own muxer. Timestamps are exact, so the video plays at the right speed however long each frame took — this is the mode for 4K and clean path-traced or volumetric animation. *Real-time* records the viewer as it plays (1 sample per moving frame). With 2+ keyframes it rewinds, records one pass (Once), one cycle (Loop) or there-and-back (Ping-Pong) and stops by itself; with none it records the live view until Stop Rec. Offline without keyframes falls back to real-time.
  - **Resolution.** *As Save Image* (follows the dropdown beside Save Image), Viewer, 720p, 1080p, 1440p or 4K. Sizes are rounded to even numbers for the encoders. Real-time resizes the drawing buffer to the chosen size (letterboxed on screen while recording) and is capped at 1440p — a sustained 4K live capture of this shader is what reset GPU drivers in v1.
  - **Frame Rate** 24 / 30 / 60. **Quality** Draft / Good / High / Maximum = 0.05 / 0.1 / 0.2 / 0.4 bits per pixel per frame (1080p30 High ≈ 12 Mb/s, Maximum ≈ 25 Mb/s). **Format** MP4 (H.264) or WebM (VP9); if the browser can't encode the chosen one at that size, the other is used and you're told.
  - Cancelling an offline render offers to save the frames finished so far as a video.
- **Render PNG Frames.** The same frames as an offline recording, saved losslessly as a zip of PNGs. Assemble it with:
  `ffmpeg -framerate 30 -i frame_%05d.png -c:v libx264 -crf 14 -pix_fmt yuv420p out.mp4`

## Testing

```
npm test                                  # logic: schema, camera, DE, folds, sequencer, codec, zip,
                                          # and glslangValidator over all 132 fold programs
python3 -m http.server 8000 & node tests/browser.mjs
```

`tests/browser.mjs` checks:
- GPU vs CPU distance-estimator parity for every fold and hybrid;
- that the exporter matches the live render;
- dock layout geometry;
- the UI wiring and the downloads.

---

Created with help from Claude AI
