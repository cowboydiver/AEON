# SCAFFOLD_SPEC.md — Phase 0: Walking Skeleton

**Objective:** Stand up the monorepo with a minimal but *real* vertical slice: a
deterministic kernel that produces a planet state, a CLI that renders that state to
PNG, a WebGPU planet in the browser displaying it, and the full test/verification
loop working. No tectonics, no climate, no timeline yet — just the skeleton every
later phase hangs on.

Read `CLAUDE.md` first. Its hard rules apply from the first commit.

Work in the order of the milestones below. Each milestone ends with its acceptance
checks passing. Commit at each milestone boundary.

---

## Milestone 1 — Workspace

Set up:

- pnpm workspace with `packages/sim-kernel`, `packages/planet-renderer`,
  `packages/sim-cli`, `apps/web`, `docs/`.
- TypeScript `strict: true` via a shared `tsconfig.base.json`. ESM throughout.
- Vitest configured for `sim-kernel` and `planet-renderer`.
- ESLint (flat config) with a `sim-kernel`-scoped override banning
  `Math.random`, `Date.now`, and `performance.now` (`no-restricted-properties` /
  `no-restricted-globals`). Add a trivial fixture proving the rule fires.
- Root scripts: `pnpm test`, `pnpm lint`, `pnpm sim` (delegates to `sim-cli`),
  `pnpm -F web dev`.
- Use the latest stable versions of all dependencies (check the registry; do not
  assume versions from memory). For `three`, verify the installed release exports
  `WebGPURenderer` from `three/webgpu` and TSL from `three/tsl`.

**Accept when:** `pnpm test` and `pnpm lint` run green on a fresh clone; the lint
fixture demonstrably rejects `Math.random` inside `sim-kernel`.

---

## Milestone 2 — sim-kernel core

All in `packages/sim-kernel/src/`, zero runtime dependencies.

### 2.1 `rng.ts` + `hash.ts`
- Seedable PRNG (sfc32 or xoshiro128**; your choice, document it) exposing
  `next(): number` in [0,1), `nextInt(n)`, and `fork(label: string)` for derived
  deterministic streams.
- Integer position hash `hash2(seed, a, b)` / `hash3(seed, a, b, c)` → uint32
  (e.g. a murmur3-style finalizer). This is the primitive that later makes any
  surface location at any time reproducible, so it must be exact-integer math only.

### 2.2 `grid.ts` — cube-sphere grid
- Grid = 6 faces × N × N cells, default `N = 128`. Flat index
  `i = face * N * N + row * N + col`.
- Functions: `cellCount(N)`, `indexToFaceRC(i, N)`, `faceRCToIndex(...)`,
  `cellCenterDirection(i, N): [x, y, z]` (unit vector, using the standard
  tangent-adjusted cube-sphere mapping to reduce area distortion — document the
  exact formula in `ARCHITECTURE.md`), `neighbors(i, N): number[]` returning the
  4 edge-adjacent cells **including across face seams**.
- Seam correctness is the classic bug farm here. Test it explicitly (see 2.5).

### 2.3 `fields.ts` + `state.ts`
- `FIELDS` const defining the Phase 0 field set: `elevation` (m, relative to datum),
  `crustAge` (yr), `temperature` (K), `precipitation` (kg/m²/yr), `iceFraction`
  (0–1), `biome` (index; still all zeros in Phase 0).
- `PlanetState`: `{ timeYears: number, params: PlanetParams, globals: Globals,
  fields: Record<FieldName, Float32Array> }`.
- `PlanetParams` (immutable per run): `seed`, `radiusMeters`, `gridN`, plus
  placeholders `starLuminosity`, `dayLengthHours`, `obliquityDeg` (unused for now
  but shaped into the type so later phases don't churn the API).
- `createInitialState(params): PlanetState`.

### 2.4 One trivial system + the step loop
- `systems/initialTerrain.ts`: on state creation, fill `elevation` with seeded
  fractal value noise (implemented on top of `hash3`, 4–6 octaves) shaped so
  roughly 30% of cells sit above the 0 m datum — placeholder continents. This is
  throwaway physics but real plumbing.
- `step.ts`: `step(state, dtYears, ctx): PlanetState` applying an ordered list of
  systems (currently just a no-op `identity` system — the point is the pipeline
  shape), and `run(params, untilYears, onKeyframe)` emitting a keyframe every
  `keyframeIntervalYears` (param, default 10e6).
- Keyframe = deep snapshot `{ timeYears, fields }` with copied arrays.

### 2.5 Tests
- PRNG: same seed ⇒ same first 1 000 draws; `fork` streams are independent and
  deterministic.
- Grid: `neighbors` is symmetric (j ∈ neighbors(i) ⇔ i ∈ neighbors(j)) for **all**
  cells at N = 8, including corners; every cell has exactly 4 neighbors;
  `cellCenterDirection` returns unit vectors; sum of per-cell solid angles ≈ 4π
  within 1%.
- Golden hashes: FNV-1a of every field after `createInitialState` and after 10
  steps, for seeds {1, 42, 1337}, stored as committed snapshots.
- Kernel suite total runtime < 30 s.

**Accept when:** all above pass and the package has zero entries in
`dependencies` (dev-deps only).

---

## Milestone 3 — sim-cli

`packages/sim-cli`, Node-only, may depend on `sim-kernel` and `pngjs`.

- `pnpm sim -- --seed 42 --until 100e6 --report`: runs the sim, prints a table per
  keyframe: time, land fraction, min/mean/max elevation, and a stable checksum per
  field.
- `--dump elevation,temperature --out tmp/`: writes one equirectangular PNG per
  listed field per keyframe (sample the cube-sphere by lat/long → nearest cell;
  512×256 is fine). Grayscale mapped over the field's min/max, hypsometric tint
  for `elevation` (blues below datum, greens/browns/white above).
- `--seed`, `--until`, `--keyframe-interval`, `--grid-n` all wired through.
- Exit non-zero on NaN/Infinity in any field — the harness is also a tripwire.

**Accept when:** the elevation PNG for seed 42 shows coherent continent-scale
blobs (not per-pixel noise), and two consecutive runs produce byte-identical PNGs.

---

## Milestone 4 — planet-renderer + web app

### 4.1 `packages/planet-renderer`
- Depends on `three` only (no React). Exports:
  - `createPlanetMesh(gridN, radiusMeters)`: cube-sphere geometry (6 subdivided
    plane faces projected with the *same* mapping as `grid.ts` — duplicate the
    formula here rather than importing the kernel? No: import the kernel's pure
    grid math; the dependency direction allows it).
  - `createPlanetMaterial(...)`: TSL node material sampling per-face data
    textures for `elevation` (vertex displacement, exaggeration factor uniform)
    and color (hypsometric ramp + simple ocean color below datum + Lambert-ish
    lighting from a sun direction uniform).
  - `uploadKeyframe(fields)`: packs kernel `Float32Array`s into the 6 face
    `DataTexture`s.
- Structure the material so a second keyframe texture set and a blend uniform can
  be added later without rework (name things `fieldsA` now).

### 4.2 `apps/web`
- Vite + React + React Three Fiber, using Three's `WebGPURenderer` (async init —
  follow the current three.js WebGPU + R3F integration pattern; check three.js
  docs/examples for the release you installed). If WebGPU is unavailable, show a
  clear message; do not silently fall back to WebGL in Phase 0.
- Runs the kernel in a Web Worker: worker generates the initial state for a seed,
  posts the keyframe (transfer the buffers), main thread uploads and renders.
- Scene: the planet, orbit controls, a sun light, starfield-black background.
  A single "Seed" input + "Regenerate" button. No timeline yet.
- Playwright e2e: load page, wait for first rendered frame, screenshot to
  `apps/web/e2e/artifacts/`, assert the canvas is non-black (sample pixels).

**Accept when:** `pnpm -F web dev` shows a lit, bumpy, ocean-and-land planet whose
continents visibly match the CLI's PNG for the same seed; e2e passes and the
screenshot confirms it.

---

## Milestone 5 — docs

- `docs/ARCHITECTURE.md`: grid mapping formula and index scheme (with a diagram in
  ASCII or Mermaid), field schema table (name, unit, range, meaning), the system
  pipeline shape, keyframe format, and the determinism contract (what is hashed,
  when goldens may be regenerated).
- Update `CLAUDE.md`'s command list if any script names ended up different.

---

## Out of scope for Phase 0 (do not build yet)

Tectonics, climate/energy balance, timeline scrubber and keyframe blending,
IndexedDB caching, quantized/compressed keyframes, atmosphere/cloud shaders,
quadtree LOD, surface mode. The skeleton must merely make all of these *possible*
without rework.

## Definition of done

- Fresh clone → `pnpm i && pnpm test && pnpm lint` green.
- `pnpm sim -- --seed 42 --until 100e6 --report --dump elevation --out tmp/`
  produces sane numbers and a continent-looking PNG, reproducibly.
- Browser shows the same planet; e2e screenshot proves it.
- `ARCHITECTURE.md` accurately describes what was built.
- A short `PHASE0_REPORT.md` at repo root: what was built, any deviations from
  this spec and why, and anything that surprised you.
