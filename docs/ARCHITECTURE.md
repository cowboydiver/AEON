# AEON Architecture

Phase 0 (walking skeleton) + Phase 1 (tectonics, in progress). This file is
the contract between the simulation kernel, the CLI harness and the renderer.
Read it before touching `sim-kernel`.

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

## Field schema

Defined once in `sim-kernel/src/fields.ts` (`FIELDS`); everything else derives
from it. All fields are `Float32Array` per cell.

| Field           | Unit       | Range            | Meaning                                        |
| --------------- | ---------- | ---------------- | ---------------------------------------------- |
| `elevation`     | m          | ≈ −6000 … +4500  | Height relative to the 0 m datum (sea level)   |
| `crustAge`      | yr         | 0 … sim age (+2 Gyr shield offset) | Age of crust: 0 at spreading centers, +dt per step everywhere. Initial ocean gets a depth-consistent age; initial continents start at 2 Gyr |
| `temperature`   | K          | ≈ 215 … 305      | Mean surface air temperature (latitude + lapse placeholder) |
| `precipitation` | kg/m²/yr   | 0                | Annual precipitation (zeros until #19)         |
| `iceFraction`   | 0–1        | 0                | Ice cover fraction (zeros until cryosphere)    |
| `biome`         | index      | 0                | Biome class (zeros until biomes)               |
| `plateId`       | index      | 0 … numPlates−1  | Owning plate, index into `PlanetState.plates`. Small integers stored in float32 (exact up to 2^24) |
| `crustType`     | flag       | {0, 1}           | 0 = oceanic (subductable), 1 = continental (buoyant, never subducts) |
| `boundaryStress`| m/yr       | ≈ ±0.1, 0 interior | Signed normal closing speed at boundary cells: + convergent, − divergent, ≈0 transform. Derived, recomputed every step |

### Plates (Phase 1)

The grid is partitioned into `params.numPlates` (default 10) contiguous
plates at t = 0 (`plates.ts`, spike-#9 winner): seed sites drawn from
`rng.fork('plates')` with rejection sampling for minimum angular separation
`0.7·√(4π/numPlates)` (relaxed ×0.85 per 64 failed draws), then simultaneous
Dijkstra growth over `neighbors()` with edge cost `1 + 1.5·hash01(cell)` —
a deterministic warped-metric Voronoi, contiguous by construction. Priority
ties break (cost, cell, plate).

Per-plate bookkeeping lives in `PlanetState.plates: PlateRecord[]`, fixed
order by plate index — **iterate by index, never object-key order**:

```
PlateRecord = { eulerPole (unit Vec3), angularVelRadPerYr,
                accumulatedRadians,        // un-applied rotation (#13)
                advectionCount,            // events so far, drives quantum dither
                createdAtYears, continentalFraction, alive }
```

Kinematics are assigned at creation from `rng.fork('plateKinematics')`:
uniform pole on the sphere, speed uniform in 1.5–8 × 10⁻⁹ rad/yr
(≈ 1–5 cm/yr on an Earth-radius sphere). Dead plates (sutured away, #18)
keep their slot so `plateId` values stay stable forever.

`crustType` is initialized as the top `CONTINENTAL_CRUST_FRACTION` (40%,
Earth's ~41% incl. shelves) of initial elevation — the threshold sits below
sea level, so continental shelves are continental crust that starts
submerged. Initial elevation itself is still the Phase 0 noise terrain;
plates are an overlay until #15/#16 make elevation follow them.

### Crust advection (#13, spike-#10 winner)

The `tectonics` system moves crust by **semi-Lagrangian gather**. Every step
accumulates each live plate's rotation (`accumulatedRadians += ω·dt`). A
plate advects when its accumulated angle crosses its **dithered quantum** —
between 1 and 2.5 cell widths ((π/2)/N), chosen deterministically per
(seed, plate, advectionCount) — and then rotates by the *full* accumulated
angle and resets, so no sub-cell motion is ever discarded. The dither exists
because a fixed quantum makes cells that rotate slower than it (near the
plate's Euler pole) see the same sub-cell rounding at every event and stall
systematically (a #13 blob-transport test finding, 6-cell lag over 500 Myr;
dithered: ≤1 cell). Residual error is an unbiased ~0.5-cell/event random
walk (accepted spike-#10 limitation).

At an advection event, each cell gathers claims: a moved plate p claims cell
i iff p owned i's backward-rotated source cell (interiors are exact by
construction); an unmoved plate claims exactly its current cells. Crust
properties — `elevation`, `crustAge`, `crustType` (`ADVECTED_FIELDS`) —
travel from the winning claim's source cell; values are copied, never
interpolated. Overlap resolution is provisional until #16 (moved beats
static, then lower plate index). Unclaimed cells are divergent gaps,
repaired by deterministic majority-of-assigned-neighbors passes and filled
as provisional young ocean (crustAge 0, oceanic, ridge depth −2500 m) — #15
replaces this with real ridge bathymetry. Hot loops read the memoized
`cellCenterTable(N)` / `neighborTable(N)` (pure derived data, like the
seam-fold EDGE_MAPS).

### Divergent boundaries & bathymetry (#15)

`crustAge` ticks +dt every step for every cell, *before* advection (crust
carries its aged value; divergent gap fill writes 0 afterwards). Oceanic
elevation (`crustType = 0`) is then a pure function of age — half-space
cooling (`bathymetry.ts`): ridge crest at −2500 m deepening as
0.35 m·√age(yr) to the abyssal floor at −6000 m (Parsons & Sclater 1977
values). Continental elevation is advected, never subsided. New crust from
divergent gaps therefore starts on the ridge crest and subsides as it ages
and drifts — spreading stripes for free. At t = 0 the noise ocean is given a
depth-consistent age by inverting the curve (deep floor = old crust) and
snapped onto it; initial continents start at a 2 Gyr shield age. Ownership
of new ridge crust follows the gap-repair majority rule — roughly half to
each flank, matching symmetric spreading. #16 exempts active convergent
margins from the hard subsidence set to build trenches and arcs.

### Convergent boundaries (#16)

Advection overlaps (a cell claimed by more than one plate) are convergence:
the overriding side (per `overrides()`) keeps the surface and the losing
side's crust is consumed — an ownership transfer, never a hole. Convergent
topography is driven by `boundaryStress` every step, scaled by
stress/0.05 m·yr⁻¹ (clamped): the **subducting oceanic** side is pinned up
to 2500 m below its age-depth floor (trench); the **overriding continental**
side gets orogenic uplift (0.6 mm/yr at reference speed, before erosion)
spread 3 cells inland with linear falloff, capped at 9 km; an **overriding
oceanic** side accumulates arc elevation toward a 1 km island ceiling;
**continent–continent** contact is collision — symmetric uplift on both
sides, 4 cells wide, no subduction. Oceanic cells on active convergent
margins (stress > 0.005 m/yr) are exempt from the subsidence hard-set; when
a margin deactivates they rejoin it, so dead trenches heal and dead arcs
sink to the age-depth curve immediately (documented simplification — no
seamount persistence). Plate speeds do not slow in collisions in Phase 1
(documented simplification); the 9 km cap plus #19's erosion bound the
consequences. Old mountain belts advect with their plates and persist until
erosion (#19) ages them.

### Boundary classification (#14)

A cell is a boundary cell iff any 4-neighbor has a different `plateId`. Each
step, `boundaries.ts` recomputes `boundaryStress`: the two plates' rigid
surface velocities (ω × r) are differenced and projected onto the tangent
unit vector from the cell toward its **dominant other plate** (most frequent
differing neighbor, ties to the lower id). Positive = closing (convergent),
negative = opening (divergent); pure shear projects to ≈0 (transform).
Interior cells are exactly 0. Boundary *type* is derived from the sign plus
a tangential threshold when needed — there is deliberately no boundaryType
field. Transforms are classified and visualized in Phase 1; their
topographic effect is deliberately minimal. Subduction polarity between two
sides (`overrides()`): continental beats oceanic, younger oceanic beats
older oceanic (colder = denser), remaining ties to the lower plate id.

Iteration over fields always uses `FIELD_NAMES` (insertion order of the
`FIELDS` const) — never `Object.keys` of some other object — so ordering is
deterministic by construction.

## State, params, systems, step loop

```
PlanetState = { timeYears, params: PlanetParams, globals: Globals, fields,
                plates: PlateRecord[], events: SimEvent[] }
PlanetParams = { seed, radiusMeters, gridN, stepYears, keyframeIntervalYears,
                 numPlates,
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

## Event log (Phase 1, #17)

```
SimEvent = { timeYears, kind: SimEventKind, data?: Record<string, number> }
```

Discrete events (plate rifts/sutures now; impacts, oxygenation later) are
recorded in simulation order on `PlanetState.events`. Event kinds are a const
object in `events.ts` (`EVENT_KINDS`), single source of truth like `FIELDS`.
Payloads are numbers only, so events are trivially deterministic and
serializable. **Purity rule:** a system never mutates the list — it returns a
new state with `events: [...state.events, e]`, and `e.timeYears` must equal
the state's current time. Event structure alone never perturbs field bytes
(tested); keyframes carry a deep copy of the log so far, and `sim-cli
--report` prints events under the keyframe row they precede. Phase 2 renders
them as timeline markers.

## Keyframe format

```
Keyframe = { timeYears: number, fields: Record<FieldName, Float32Array>,
             events: SimEvent[] }
```

Deep snapshot — arrays and events are copies, safe to transfer to other
threads (the web app transfers the field buffers worker → main). One keyframe is emitted for the initial
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
