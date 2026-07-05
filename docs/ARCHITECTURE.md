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
| `precipitation` | kg/m²/yr   | ≈ 100 … 1800     | Annual precipitation: static latitude-band proxy until Phase 3 |
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
                createdAtYears,
                sutureLockUntilYears,      // rift children can't suture before this (#57 follow-up)
                continentalFraction, alive }
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
elevation (`crustType = 0`) then *relaxes toward* a pure function of age —
half-space cooling (`bathymetry.ts`): ridge crest at −2500 m deepening as
0.35 m·√age(yr) to the abyssal floor at −6000 m (Parsons & Sclater 1977
values). The relaxation is rate-bounded (#59,
`OCEAN_RELIEF_RELAX_M_PER_YR` = 200 m/Myr — above the steady subsidence
increment, so settled seafloor tracks the curve to float32 precision within
a few steps, and the youngest crust lags it by ≤150 m for ~3 Myr): inactive
arc and trench relief has *memory* and decays over Myr instead of snapping
to the curve the step a margin moves off the cell. Continental elevation is
advected, never subsided. New crust from divergent gaps starts on the ridge
crest and subsides as it ages and drifts — spreading stripes for free. At
t = 0 the noise ocean is given a depth-consistent age by inverting the curve
(deep floor = old crust) and snapped onto it; initial continents start at a
2 Gyr shield age. Ownership of new ridge crust follows the gap-repair
majority rule — roughly half to each flank, matching symmetric spreading.
#16 exempts active convergent margins from the subsidence relaxation to
build trenches and arcs.

### Convergent boundaries (#16)

Advection overlaps (a cell claimed by more than one plate) are convergence:
the overriding side (per `overrides()`) keeps the surface and the losing
side's **oceanic** crust is consumed — an ownership transfer, never a hole.
**Continental crust does not subduct (#59, direction (b)):** a displaced
continental cell's content is *bulldozed* one cell deeper into its own
plate along the convergence direction — onto a same-plate oceanic cell it
re-roots there (area conserved; onto forward ocean first, else any ocean —
lateral extrusion, the Indochina-style escape), onto continental ground the
collision shortens and thickens (half the displaced positive relief piles
on, capped at 9 km). The symmetric case (a *moving* continental source
whose content won at no target) piles onto the cell behind it. The only
genuine continental consumption left is a salient's last sliver with no
same-plate neighbor — the exception that keeps the pass one-shot instead of
a shortening solver. Without this, every continent–continent margin
destroyed one continental cell per overlap: 4.5 Gyr N=64 runs ground
continental crust from 40% of the sphere to ~5% dust, starving the rift
gates (#58's root). Convergent topography is driven by `boundaryStress`
every step, scaled by stress/0.05 m·yr⁻¹ (clamped): the **subducting
oceanic** side is pinned up to 2500 m below its age-depth floor (trench);
the **overriding continental** side gets orogenic uplift (0.6 mm/yr at
reference speed, before erosion) spread 3 cells inland with linear falloff,
capped at 9 km; an **overriding oceanic** side accumulates arc elevation
(1.25 mm/yr at reference speed, scaled by `max(1, N/32)` — arc magmatic
flux is per unit margin length, and the one-cell-wide boundary line it
lands on thins ∝ 1/N, so a constant per-cell rate starved creation at fine
grids; the #59-residual deep-time land dip at N=128) toward a 1 km island
ceiling;
**continent–continent** contact is collision — symmetric uplift on both
sides, 4 cells wide, no subduction. Arc maturation into continental crust
is **accretionary** (#59): an arc that builds above −500 m becomes
continental only inside the accretionary belt — within `max(1, round(N/32))`
cells of pre-existing continental crust, a fixed *physical* belt width
(~300 km, real accreted-terrane scale) so the maturation frontier area
stays resolution-independent — and new continent grows compactly at
continent margins. At deep-time equilibrium
most continental crust has been recycled through this term, so continents
take the *shape* of the creation process — ungated maturation freckled
along herringbone advection trails dissolved them into lace by ~3 Gyr.
**Isolated continental slivers founder (#59):** a continental cell with no
continental 4-neighbor is pinned below sea level
(`MICROCONTINENT_FOUNDER_ELEVATION_M` = −200 m, Zealandia-style — it keeps
its crustal identity and can re-accrete, but stranded collision debris no
longer stands as immortal one-cell peaks speckling the deep-time ocean).
Oceanic cells on active convergent margins (stress > 0.005 m/yr) are exempt
from subsidence relaxation; when a margin deactivates they rejoin it and
decay to the age-depth curve over a few Myr (#59 arc memory — a half-built
arc survives the margin flickering off it, which is what keeps arc creation
effective at fine grids). Plate speeds do not slow in collisions in Phase 1
(documented simplification); the 9 km cap plus #19's erosion bound the
consequences. Old mountain belts advect with their plates and persist until
erosion (#19) ages them.

### Wilson cycles (#18)

The `wilson` system (after tectonics in the pipeline) reorganizes plates so
deep time tells a story. **Suturing:** plate pairs in continent–continent
convergent contact (≥3 boundary cells, both sides continental, stress
positive) for a continuous 15 Myr merge — smaller absorbed into larger, the
combined plate takes the area-weighted mean angular-velocity vector, and
relative motion across the suture stops. Without this, fixed plate speeds
grind colliding continents away forever (integration runs lost 2/3 of
continental area in 500 Myr). **Rifting (#59 fragment kinematics):** a
plate that is old (≥150 Myr since creation/last rift), large (≥8% of the
sphere) and carrying a continent (continental area ≥2% **of the sphere** —
plate-relative fraction was tried first and silently disabled rifting, and
the earlier 5% gate dead-locked low-continent worlds) rifts with
probability 0.006/Myr. The rift *carves off a contiguous continental
fragment* — a hash-drawn 20–40% of the plate, grown by jittered Dijkstra
from a continental seed cell — and gives it an Euler pole perpendicular to
its own centroid, so the fragment **translates** across the sphere at
ω·R instead of spinning in place; the parent keeps its kinematics. The
travel azimuth is ocean-seeking: a hash-phased fan of 8 candidate headings
is scored by the oceanic crust along the forward great circle beyond the
fragment's edge, and the most oceanic heading wins — continents rift toward
the superocean, so the fragment's leading edge subducts ocean instead of
grinding continent through the post-rift lock. (The previous scheme — a
50/50 two-seed split with opposite rotations about the centroids-normal
pole — could not disperse a sphere-spanning plate: its halves are antipodal
hemispheres, already maximally separated, and can only shear about their
shared in-plane pole and re-suture. That geometry, not any tuning constant,
is why deep time stayed supercontinent-locked; see
PHASE_2_STAGE0_FINDINGS.md.) **Size-dependent rift pressure (#61, replacing
the #59 oversize brake):** rift likelihood rises smoothly with plate area — a
single ramp (`riftSizeRamp`) that is 1 below `RIFT_SIZE_RATE_KNEE` (0.3 of the
sphere), passes through the old 8× brake at `RIFT_SIZE_RATE_REF_FRACTION` (0.55),
and keeps climbing. It scales both halves of the old brake: the draw probability
uses `min(8, ramp)` (saturating at the brake magnitude above 0.55, so nothing
rifts faster than the measured-good #59 rate), and the maturity age gate is
`RIFT_MIN_AGE_YEARS / ramp` (full below the knee, ≈19 Myr at 0.55, shrinking to a
~2.7 Myr floor near whole-sphere — the old hard age waiver made continuous). This
removes the
discontinuity at 0.55 and the MIN_PLATES coupling (the old brake existed only to
compensate for the lowered suture floor). Suturing keeps assembling
supercontinents, and one plate used to own ~100% of cells from ~1.2 Gyr on
(plate ≠ land); under pressure a sphere-monopoly sheds fragments every few tens
of Myr until it disperses, so the measured worst >85%-of-sphere monopoly window
is ≤ ~100 Myr (was ~3 Gyr); an invariant test pins it <400 Myr. The
dispersed-window fraction beats the #59 baseline at N=64 for all three golden
seeds (72–74% vs 66–72%) and matches or beats it at 5 of 6 seed×grid points —
the deep-time metric is chaotically sensitive to any sub-0.55 rifting (which
removing the discontinuity necessarily introduces), so it is not reproduced
number-for-number, but the world stays fully dispersed everywhere. **Post-rift suture lock:** a fresh rift margin is
passive: a rift stamps both halves with `sutureLockUntilYears = now +
RIFT_SUTURE_COOLDOWN_YEARS` (30 Myr) and a locked plate's contact is not
recorded, so it can't re-suture until the lock lifts (then needs a fresh
15 Myr). Both directions emit events (`plateSuture`/`plateRift`), and
plates whose last cell is consumed by advection are retired each step with
a `plateConsumed` event, so the live count the bounds gate on stays honest
(zombie cell-less plates used to hold the suture floor "satisfied"
indefinitely). The live count stays within [MIN_PLATES, MAX_PLATES] =
[2, 16] — the floor was lowered from 4 in #59 because a world parked *at*
the floor has its collisions barred from suturing, so they grind continent
forever (seed 1 sat there from ~0.25 Gyr and bled continental crust to
starvation); with the size-dependent rift pressure guaranteeing a post-suture
monopoly re-fragments, collisions can be allowed to complete. Dead plates keep
their table slot.
Contact bookkeeping lives in `PlanetState.wilson.contactSince` (pair-keyed
start times, rebuilt each step — never iterated by key order). The rift
decision draw is `hash3(seed', plate, timeQuantum)` rather than the issue's
`rng.fork('wilson')` sketch: a fork taken inside a pure system would restart
its stream every step, so a position/time hash is the deterministic
equivalent (documented deviation). Euler-pole wander was considered and not
implemented.

### Erosion & climate proxy (#19)

`erosion` (after wilson): conservative Jacobi diffusion of elevation over
the 4-neighbor graph, continental-crust pairs only, flux ∝ height difference
(slope) × mean-pair precipitation (clamped 0.05–2× at 1000 kg/m²/yr
reference) × base-level damping (×0.1 when either endpoint is submerged —
without it coastal diffusion submerges land planet-wide). Pairwise
antisymmetric fluxes conserve continental volume exactly; oceanic elevation
is isostatic (#15) and untouched. `climateProxy` (last): refreshes
`temperature` each step from current elevation (latitude + lapse formula
shared with the init pass) and owns the static latitude-band `precipitation`
proxy (ITCZ peak, subtropical dry belts, mid-latitude storm tracks, dry
poles) — **replaced wholesale by Phase 3 moisture transport**.

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
                plates: PlateRecord[], events: SimEvent[],
                wilson: { contactSince } }
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

Discrete events (plate rifts/sutures/consumptions now; impacts, oxygenation
later) are recorded in simulation order on `PlanetState.events`. Event kinds are a const
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

## Field quantization codec (Phase 2, #22)

`sim-kernel/src/codec.ts` compresses the display subset of a keyframe's float
fields into a compact, versioned, **self-describing** binary container for
storage (IndexedDB, #24) and GPU upload (#25). It is pure and lives in the
kernel by the dependency rule, and **never touches simulation bytes** — encode/
decode are pure functions of a field array, so quantization can never perturb
the deterministic sim (goldens are unaffected).

```
container = header ┃ per-field entries ┃ quantized data
header  = magic 'AEON' u32 | HISTORY_FORMAT_VERSION u16 | fieldCount u8 | pad | cellCount u32
entry   = fieldId u8 | format u8 (0=u8,1=u16) | flags u8 (bit0 categorical) | pad | min f32 | max f32 | dataOffset u32
```

The header carries each field's format and range, so decoding needs only the
buffer and pruning/adding fields (Phase 3) doesn't break readers of the same
`HISTORY_FORMAT_VERSION`. Stored set and quantization (`QUANT_TABLE`, ranges
verified against Phase 1 runs):

| field | format | range | precision |
|-------|--------|-------|-----------|
| elevation | Uint16 | −11,000 … +9,500 m | ~0.31 m |
| crustAge | Uint16 | 0 … 7.0 Gyr | ~107 kyr |
| temperature | Uint8 | 180 … 320 K | ~0.55 K |
| plateId | Uint8 | 0 … 255 exact | exact (asserts < 256) |
| crustType | Uint8 | {0,1} exact | exact |

Continuous fields use a linear float↔uint map (out-of-range clamps to the ends);
**categorical fields (`plateId`, `crustType`) use an identity map and round-trip
bit-exact — they must never be interpolated** (the GPU path holds/nearest-picks
them). `precipitation` is analytic (recomputed from latitude), `boundaryStress`
is derivable and visually unused, and `iceFraction`/`biome` are still zero — none
are stored. Two versions gate reuse: `HISTORY_FORMAT_VERSION` (codec byte
layout) and `KERNEL_BEHAVIOR_VERSION` (sim behavior; see below); together with
the run params they key the keyframe cache. Codec correctness is locked by
byte-level goldens over encoded keyframes plus round-trip fidelity tests (Spike A
confirmed the elevation map is visually lossless: max error 0.156 m = half a
step, **0** coastline cells migrated across the 0 m datum at N=128).

## History streaming & timeline (Phase 2, #23/#26)

Keyframe cadence has one source of truth: `keyframes(params, untilYears)` in
`step.ts`, a generator yielding a keyframe for t=0 then one per interval (and a
final one), returning the final state. `run()` is a thin eager wrapper over it.
Pulling one keyframe at a time lets a consumer yield between pulls while
producing byte-identical history. `encodeHistory` (codec.ts) composes that
cadence with the codec, yielding `EncodedKeyframe { index, timeYears,
landFraction, transferable payload }`.

The web app (`apps/web`) streams a full history in a Web Worker:
`simWorker.ts` pulls `encodeHistory`, posts each keyframe with its buffer
**transferred**, and yields via a `MessageChannel` macrotask so a superseding
`runHistory` or a `cancel` is honored between keyframes (only the newest
`requestId` stays active). `usePlanetWorker` accumulates keyframes in a ref
(retained for the scrubber), decodes the latest to render the planet evolving
live, and exposes `select(position | null)` to pin the view to a **fractional**
keyframe position (deep-time scrub) or follow the streaming edge. Scrubbing maps
a continuous position to a bracketing keyframe pair `(i, i+1)` and a fraction,
which the GPU blends (see "Keyframe blending" below); only the two bracketing
keyframes are decoded (cached, so a fraction change inside one bracket decodes
nothing) and the interpolated `timeYears`/`landFraction` drive the HUD.

The default extent is the full 4.5 Gyr @ 10 Myr. A **memory budget** (#27)
guards it: `planHistory(gridN, untilYears, interval, budget = MAX_RETAINED_HISTORY_BYTES)`
sizes the retained history against `MAX_RETAINED_HISTORY_BYTES` (0.5 GB) using
`encodedKeyframeBytes(gridN)` — the exact byte size of one encoded keyframe,
derived from the same layout `encodeKeyframe` writes. If the request fits it is
passed through unchanged (`clamped: false`); if not, the interval is coarsened by
an integer factor (never below the requested one, so cadence stays a multiple of
the ask) until the whole span fits — the tail of history is never dropped, only
sampled more sparsely, and the app flags the coarser step. At N=128, 4.5 Gyr @
10 Myr is 451 keyframes ≈ 0.35 GB, so it streams as asked.

A streamed history is persisted to **IndexedDB** (`history/historyCache.ts`, #24)
so a same-context reload hydrates the whole timeline instantly with no worker run.
The cache key folds in `(seed, gridN, untilYears, keyframeIntervalYears,
HISTORY_FORMAT_VERSION, KERNEL_BEHAVIOR_VERSION)`, so a codec-layout or deliberate
kernel-behavior change automatically invalidates (a bumped version = a new key =
a miss). On `generate`: a **complete** manifest whose keyframe set is present and
contiguous is a hit → hydrate; any miss/partial/corrupt/version-mismatch is a
miss → run the worker (#23) and write each keyframe through as it arrives (so the
records exist for the next complete run to seal). A partial run is always a miss —
it never surfaces a broken timeline. Storage is LRU by manifest `updatedAt`;
`QuotaExceededError` evicts the oldest history (never the one being written) and
retries the write once. `usePlanetWorker` exposes `source: 'cache' | 'worker' |
null` (shown as a `cached` badge / `data-history-source` attribute), and `App`
reads optional `?seed=` / `?until=` URL knobs for deep-linking and a fast cache
e2e. Determinism makes this sound: the same key always maps to the same bytes, so
a cached history is bit-identical to re-simulating it.

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
  test you don't understand. **Any deliberate golden regeneration must also bump
  `KERNEL_BEHAVIOR_VERSION` (`constants.ts`) in the same commit** — it is the
  Phase 2 cache-invalidation key, so a behavior change can never serve stale
  persisted keyframes.
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

## Keyframe blending (Phase 2, #25)

Each face material samples **two** keyframe texture sets — `fieldsA` and
`fieldsB` — and blends them with a shared `blend` uniform, so scrubbing morphs
the whole planet between bracketing keyframes entirely on the GPU. Two field
kinds, two rules (`textures.ts` carries the per-field filter and corner
strategy; the material in `material.ts` carries the sampling rule):

- **Continuous** (`elevation`): `mix(A, B, blend)`, filtered **linearly**, drives
  both the radial vertex displacement and the hypsometric ramp — continents
  *morph* rather than pop, and because the (N+2)² seam border is blended with the
  *same* uniform (borders live in the same textures) no cracks open mid-blend.
- **Categorical** (`plateId`): picked hold/nearest with `blend < 0.5 ? A : B`,
  filtered **nearest**, and **never lerped** — a lerp between plate ids 3 and 7 is
  a meaningless 5. Categorical borders take the neighbor id (not a mean) and
  categorical corners the own corner cell, so ids stay valid. It drives a subtle
  per-plate tint gated by the `plateTint` uniform (0 = pure elevation ramp), which
  keeps plate boundaries crisp across a blend. The codec's bit-exact categorical
  round-trip (#22) is what makes this crispness possible.

A **plate-debug toggle** (web app checkbox → `plateDebug` uniform, 0/1) swaps the
hypsometric surface for a flat per-plate colour so the tectonic partition is
legible at a glance. Each plate's hue comes from `fract(id · φ⁻¹)` (golden-ratio
stride, so consecutive ids get well-separated hues) run through a cosine palette;
the pick is the same nearest `plateId` sample, so plate regions stay crisp and the
overlay costs a single uniform flip (no re-upload). Radial displacement and
Lambert shading are kept, so the plates read on the 3D globe.

Residency ping-pongs between the two sets (`residency.ts`, `KeyframeBlender`): a
fractional scrub inside one bracket only moves the `blend` uniform (no upload, so
the scrub stays tactile), and crossing a keyframe boundary re-uploads **only the
one set that changed** — keeping the still-needed keyframe resident and flipping
the blend interpretation (`f` vs `1 − f`) rather than re-uploading both. One
upload per boundary crossing, either scrub direction. Prefetch into a third set
is intentionally omitted: with only two sets the incoming keyframe would evict a
still-displayed one, and Spike B (see `docs/spikes/PHASE_2_SPIKES.md`) showed the
single-set swap is cheap enough that the playhead never waits on it.
