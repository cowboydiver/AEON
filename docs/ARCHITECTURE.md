# AEON Architecture

Phase 0 (walking skeleton). This file is the contract between the simulation
kernel, the CLI harness and the renderer. Read it before touching
`sim-kernel`.

## Monorepo shape and dependency direction

```
apps/web ──▶ planet-renderer ──▶ sim-kernel        sim-cli ──▶ sim-kernel
```

`sim-kernel` imports nothing at runtime. Renderer and CLI import kernel grid
math instead of duplicating it — the grid is shared truth.

## Cube-sphere grid

The planet surface is 6 cube faces, each an N×N cell grid (default N = 128).

### Flat index scheme

```
i = face * N * N + row * N + col        face ∈ [0,6), row/col ∈ [0,N)
```

Every per-cell field is a `Float32Array` of length `6·N²` in exactly this
order. Simulation and rendering share it; each face is a contiguous `N²`
slice, which is also how face textures are uploaded.

### Faces

Faces are ordered `+X, -X, +Y, -Y, +Z, -Z`. Each face has an orthonormal frame
(normal `n`, `u` along growing col, `v` along growing row), defined in
`sim-kernel/src/grid.ts` (`FACE_NORMAL`, `FACE_U`, `FACE_V`) — that table is
the single source of truth. All frames satisfy `u × v = +n` (mesh triangles
wound counter-clockwise in (s, t) face outward).

### Mapping formula (tangent-adjusted cube-sphere)

A cell parameter `s ∈ [-1, 1]` along a face axis maps to the unit sphere via:

```
w   = tan(s · π/4)                    tangent warp (inverse: s = atan(w)·4/π)
p   = n + w_u · u + w_v · v           point on the unit cube face
dir = p / |p|                         radial projection to the sphere
```

Cell centers use `s = ((col + 0.5) / N) · 2 − 1` (rows likewise); mesh
vertices use the same formula at corner parameters `s = (col / N) · 2 − 1`.
The tangent warp equalizes cell *angles* along each axis, reducing the max/min
per-cell solid-angle ratio from ~5.2 (plain cube projection) to ~1.3. Tests
assert per-cell solid angles stay within ±35% of the mean and sum to 4π within
1%.

`directionToIndex(dir, N)` inverts the mapping: dominant axis → face, then
`atan`-unwarp the two in-face coordinates → row/col. Used by the CLI's
equirectangular sampler and, later, by surface-mode picking.

### Neighbors across seams

`neighbors(i, N)` returns the 4 edge-adjacent cells in order
`[col−1, col+1, row−1, row+1]`, crossing face seams where needed. There are no
diagonal adjacencies; cube-corner cells still have exactly 4 neighbors (2
same-face, 2 across seams).

Seam mapping is derived at module load by folding each face edge onto its
neighbor using only exact ±1 dot products of the face frames (which face the
edge lands on, which of its axes runs along the edge, whether the along-edge
index flips) — no hand-written adjacency table. Because both faces warp their
shared edge with the same odd `tan` function, along-edge cell k on one face
aligns exactly with cell k (or N−1−k) on the other. Symmetry
(`j ∈ neighbors(i) ⇔ i ∈ neighbors(j)`) is tested for every cell at N = 3
and N = 8.

```
        +----+            Unfolded cube (face indices):
        | +Y |
   +----+----+----+----+       rows of the +Z face meet +Y/-Y,
   | -X | +Z | +X | -Z |       cols wrap -X → +Z → +X → -Z → -X.
   +----+----+----+----+
        | -Y |
        +----+
```

## Field schema (Phase 0)

Defined once in `sim-kernel/src/fields.ts` (`FIELDS`); everything else derives
from it. All fields are `Float32Array` per cell.

| Field           | Unit       | Range (Phase 0)  | Meaning                                        |
| --------------- | ---------- | ---------------- | ---------------------------------------------- |
| `elevation`     | m          | ≈ −6000 … +4500  | Height relative to the 0 m datum (sea level)   |
| `crustAge`      | yr         | 0                | Age of crust at the cell (zeros until tectonics) |
| `temperature`   | K          | ≈ 215 … 305      | Mean surface air temperature (latitude + lapse placeholder) |
| `precipitation` | kg/m²/yr   | 0                | Annual precipitation (zeros until climate)     |
| `iceFraction`   | 0–1        | 0                | Ice cover fraction (zeros until cryosphere)    |
| `biome`         | index      | 0                | Biome class (zeros until biomes)               |

Iteration over fields always uses `FIELD_NAMES` (insertion order of the
`FIELDS` const) — never `Object.keys` of some other object — so ordering is
deterministic by construction.

## State, params, systems, step loop

```
PlanetState = { timeYears, params: PlanetParams, globals: Globals, fields }
PlanetParams = { seed, radiusMeters, gridN, stepYears, keyframeIntervalYears,
                 starLuminosity, dayLengthHours, obliquityDeg }   // immutable per run
Globals     = { landFraction }
```

A **system** is a pure function `(state, dtYears, ctx) => PlanetState` with a
name, applied in a fixed order by `step()`:

```
step(state, dt, ctx):  state' = systemN(...system2(system1(state, dt, ctx)...))
                       state'.timeYears += dt
```

Systems never mutate their input; they return the same state (no change) or a
new state with replaced field arrays. `ctx` carries the run's forked PRNG
(`createRng(seed).fork('sim')`) — no globals. Phase 0's pipeline is a single
`identity` system; `initialTerrain` runs once inside `createInitialState`
(seeded 5-octave fractal value noise on `hash3`, sea level at the exact 70th
percentile ⇒ ~30% land, plus a placeholder latitude/lapse-rate temperature).

`run(params, untilYears, onKeyframe)` steps `params.stepYears` (default 1 Myr)
at a time and emits keyframes. Keyframe emission counts integer steps
(`stepsPerKeyframe = round(interval / step)`) so it never depends on float
accumulation.

## Keyframe format

```
Keyframe = { timeYears: number, fields: Record<FieldName, Float32Array> }
```

Deep snapshot — arrays are copies, safe to transfer to other threads (the web
app transfers them worker → main). One keyframe is emitted for the initial
state, then one per `keyframeIntervalYears` (default 10 Myr), plus a final one
if `untilYears` is off-interval. The renderer's texture set is named `fieldsA`
so a second set (`fieldsB`) and a blend uniform can be added for timeline
scrubbing without rework.

## Determinism contract

- Same `seed` + same `PlanetParams` ⇒ bit-identical field arrays at every
  step, on every machine.
- All randomness flows through `rng.ts` (sfc32, seeded via splitmix32) or the
  murmur3-style integer hashes in `hash.ts`. `Math.random`, `Date.now`,
  `performance.now` and argless `new Date()` are banned in `sim-kernel/src`
  by ESLint (with a fixture test proving the rule fires). Non-deterministic
  key-order iteration is banned by convention and review.
- `rng.fork(label)` derives streams purely from (parent seed, label), so fork
  results never depend on how many draws the parent made.
- **What is hashed:** FNV-1a over the raw little-endian bytes of every field,
  after `createInitialState` and after 10 steps, for seeds {1, 42, 1337},
  committed as Vitest snapshots in
  `packages/sim-kernel/test/__snapshots__/golden.test.ts.snap`.
- **When goldens may be regenerated:** only for a deliberate, understood
  change to physical behavior or grid math, via
  `pnpm -F sim-kernel test -- -u`, with the physical/algorithmic reason in the
  commit message. Any change to grid math is a breaking change: update this
  file in the same commit and say so loudly. Never regenerate to silence a
  test you don't understand.
- Residual risk, accepted for Phase 0: the mapping and noise use JS
  transcendentals (`tan`, `atan`, `pow`, `sqrt`), whose last-ulp behavior is
  technically implementation-defined. All current targets (Node ≥ 22, Chromium)
  are V8 with identical results; if a non-V8 target ever matters, the kernel
  needs software math for these four functions.

## Rendering (Phase 0)

Six face meshes (one per cube face) share uniforms (`exaggeration`,
`sunDirection`); each samples its own elevation `DataTexture` in a TSL node
material: radial vertex displacement
`position · (1 + elevation / radiusMeters · exaggeration)`, hypsometric color
ramp (blues below datum, green→brown→white above), Lambert-ish lighting from
the sun uniform.

Face textures are (N+2)×(N+2) **R16F** (half float filters on every WebGPU
adapter; R32F linear filtering needs the optional `float32-filterable`
feature). The 1-texel border is filled from adjacent faces via the kernel's
seam-aware `neighbors()`, and diagonal border texels hold the mean of the
three cells meeting at each cube corner — so linear filtering yields
identical values on both sides of every seam (no cracks). Mesh vertices sit
at cell corners and sample at padded UV `(col+1)/(N+2)`, i.e. exactly between
the four surrounding cell centers.

The web app generates state in a Web Worker and uploads keyframes with
`uploadKeyframe`. WebGPU only; no WebGL fallback in Phase 0.
