# Phase 0 Report — Walking Skeleton

## What was built

All five SCAFFOLD_SPEC milestones, one commit each:

1. **Workspace** — pnpm monorepo (`sim-kernel`, `planet-renderer`, `sim-cli`,
   `apps/web`, `docs/`), shared strict-ESM `tsconfig.base.json`, Vitest
   projects, flat ESLint with a `sim-kernel/src`-scoped ban on `Math.random`,
   `Date.now`, `performance.now` (plus argless `new Date()`), and a fixture
   test that lints banned code virtually inside and outside the kernel path to
   prove the rule fires only where intended.
2. **sim-kernel** — sfc32 PRNG with label-derived `fork` streams; murmur3-style
   `hash2`/`hash3` and FNV-1a in exact 32-bit integer math; tangent-adjusted
   cube-sphere grid with seam adjacency *derived* from the face frames (no
   hand-written table); `FIELDS`/`PlanetState`/`createInitialState`; fractal
   value-noise initial terrain with sea level at the exact 70th percentile
   (~30% land); pure-system `step()`/`run()` with deep-copied keyframes.
   43 tests in ~2 s, including golden FNV-1a snapshots for seeds {1, 42, 1337}.
   Zero runtime dependencies; the kernel tsconfig sets `"types": []` so Node
   or DOM API usage fails typechecking.
3. **sim-cli** — `--seed/--until/--keyframe-interval/--grid-n/--report/--dump/--out`;
   per-keyframe report (time, land %, min/mean/max elevation, per-field FNV-1a
   checksum); 512×256 equirectangular PNGs with hypsometric elevation tint;
   non-zero exit on any NaN/∞. Two consecutive runs produce byte-identical
   PNGs (sha256-compared); the seed 42 elevation map shows continent-scale
   blobs, inspected by eye.
4. **planet-renderer + web** — six face meshes built from the kernel's own
   `faceSTToDirection`; TSL node materials with R32F face `DataTexture`s
   (`fieldsA`), radial displacement, hypsometric ramp, sun-direction uniform;
   `uploadKeyframe` packs the kernel's flat field into contiguous face slices.
   Web app: R3F + `WebGPURenderer` (async init), kernel in a Web Worker with
   transferred buffers, seed input + Regenerate, orbit controls, deterministic
   starfield, explicit "WebGPU unavailable" screen. Playwright e2e screenshots
   the canvas and asserts lit/chromatic pixel fractions; the screenshot shows
   the same continents as the CLI PNG for seed 42.
5. **Docs** — `docs/ARCHITECTURE.md` (grid formula, index scheme, field schema,
   pipeline/keyframe shapes, determinism contract) and this report.

## Deviations from the spec, and why

- **three pinned to 0.184.0, not latest (0.185.1).** three 0.185 passes
  `swizzle: 'rgba'` in every `createView()` descriptor; Chromium ≤ 142 rejects
  it (`TypeError` in the render loop → permanently black canvas). Verified
  empirically: 0.185 fails, 0.184 renders. Revisit when the fix lands
  upstream or older Chromium stops mattering.
- **@playwright/test pinned to 1.56.1, not latest (1.61.x).** The execution
  environment pre-installs Chromium build 1194, which is exactly what 1.56.x
  expects; browser downloads are disabled here. Bump freely where downloads
  are allowed.
- **e2e runs a headed browser under Xvfb** (`apps/web/scripts/run-e2e.mjs`).
  In plain headless Chromium on SwiftShader, the first present to a WebGPU
  canvas kills the GPU device ("A valid external Instance reference no longer
  exists") — offscreen rendering works, presentation does not, under every
  headless flag combination tried. Headed + `--enable-features=Vulkan
  --use-vulkan=swiftshader` under Xvfb presents correctly. The wrapper uses
  the real display when one exists.
- **`initialTerrain` also fills `temperature`** (latitude + lapse-rate
  placeholder). The spec only demanded elevation; a second populated field
  makes the CLI's `--dump temperature`, the golden hashes and the report
  exercise more than one field for nearly free. Everything else
  (`crustAge`, `precipitation`, `iceFraction`, `biome`) stays zero as
  specified.
- **`pnpm sim` output path**: the CLI resolves `--out` against `INIT_CWD`, so
  `--out tmp/` writes to the repo root as the docs imply, even though pnpm
  runs the script inside `packages/sim-cli`.

## Surprises / notes for later phases

- **The WebGPU-in-headless rabbit hole** was the big one: three device-loss
  layers (three 0.185's swizzle, headless-shell lacking `navigator.gpu` on
  non-secure origins, and SwiftShader losing the device on canvas present)
  each produced the same symptom — a black canvas — and had to be bisected
  with raw-WebGPU probes outside three/React.
- **Deriving seam adjacency beat writing it.** Computing the edge maps from
  the face-frame table with exact ±1 dot products made the classic cube-seam
  bug class structurally impossible; the all-cells symmetry test passed on the
  first run.
- **Visible-but-acceptable seams in the render:** face textures clamp at
  edges, so hairline color discontinuities appear along face boundaries.
  Fixable later with a 1-texel border exchange (or per-face geometry sampling
  neighbor cells); irrelevant to Phase 0 acceptance.
- **JS transcendentals are the only determinism soft spot** (documented in
  ARCHITECTURE.md): all current targets are V8, so golden hashes are stable
  everywhere we run, but a non-V8 target would need software `tan/atan/pow`.
- Kernel initial-state generation at N = 128 costs ~0.2 s — comfortably
  workerable; full histories will want progress messages over the existing
  worker protocol (the message shape already carries `timeYears`).
