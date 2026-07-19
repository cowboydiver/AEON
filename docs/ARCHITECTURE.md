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
| `temperature`   | K          | ≈ 205 … 305      | Mean surface air temperature from the Phase 3 zonal energy balance (#30): zonal EBM profile − lapse·elevation + bounded land continentality |
| `precipitation` | kg/m²/yr   | 0 … ~8000 (mean ~1000) | Annual precipitation from moisture transport (#32): ocean evaporation advected along the #31 winds and rained out (base + orographic). Fast diagnostic, re-solved each step, no memory. Σ = Σ evaporation (water conserved). Wettest orographic cells can exceed 8000 at coarse N |
| `iceFraction`   | 0–1        | 0 … 1 (mean ~0.05–0.15) | Ice cover fraction from the #33 mass balance (accumulate where cold + wet, ablate where warm). A **slow** reservoir with cross-step memory; feeds the #30 ice-albedo term and, where grounded, locks ocean water to lower sea level. First departs 0 at step 1 (it advances/retreats over the timeline) |
| `biome`         | index      | 0 … 7 (categorical) | Whittaker biome class from the #35 lookup over (temperature, precipitation): `0` ocean (below the sea-level mask), then land classes `1` tundra, `2` taiga, `3` grassland, `4` temperate forest, `5` desert, `6` savanna, `7` tropical forest. Fast diagnostic, re-solved each step, no memory. **Categorical**: bit-exact through the codec, nearest-picked (never lerped) at render — drives the from-orbit colour ramp. Populated at t=0 |
| `plateId`       | index      | 0 … numPlates−1  | Owning plate, index into `PlanetState.plates`. Small integers stored in float32 (exact up to 2^24) |
| `crustType`     | flag       | {0, 1}           | 0 = oceanic (subductable), 1 = continental (buoyant, never subducts) |
| `boundaryStress`| m/yr       | ≈ ±0.1, 0 interior | Signed normal closing speed at boundary cells: + convergent, − divergent, ≈0 transform. Derived, recomputed every step |
| `sutureYears`   | yr         | 0 … sim age (0 = never) | Sim time when a continent-continent suture last welded this cell (#60). Crust property: advects with plate motion; fresh ocean and fresh arc crust carry 0. Appended last: the codec wire fieldId is the FIELD_NAMES index |
| `sedimentM`     | m          | 0 … shelf fill   | Sediment on oceanic crust exported from the continents by erosion (#65); the age-depth relaxation target adds it on top, saturating at `SEDIMENT_SHELF_CEILING_M` (−200 m). Crust property: advects with plate motion; always 0 on continental crust and fresh ocean (crust that matures/re-roots to continental consumes it). Appended last (codec wire-id constraint) |
| `windU`         | m/s        | ≈ ±30 (bound ±60) | Prevailing zonal (east–west) surface wind, signed (+ eastward), from the #31 band model. Fast diagnostic: recomputed every step from rotation + temperature gradient, carries no memory. Appended last (codec wire-id constraint) |
| `windV`         | m/s        | ≈ ±12 (bound ±60) | Prevailing meridional (north–south) surface wind, signed (+ northward), from the #31 band model. Fast diagnostic: recomputed every step, carries no memory. Appended last (codec wire-id constraint) |
| `marineLife`    | 0–1        | 0 … 1 (0 on land) | Marine photosynthetic productivity over ocean cells (#37): 0 everywhere until the gated-stochastic abiogenesis onset, then `light × temperatureWindow × shelf-nutrient`. Fast diagnostic, re-solved each step, no memory (the O₂ *reservoir* holds the history); drives the O₂ source term and the render ocean tint (#38). Appended last (codec wire-id constraint) |

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
                continentalFraction, alive,
                // Tectonics V2 (default-on since KERNEL_BEHAVIOR_VERSION 17; all 0 flag-off):
                omegaVec,                  // ω⃗, derived kinematic state under forceKinematics (#111 stage 1)
                tensionN, slabPullN,       // gross−|net| slab-pull force (opposed pull, #127 item 2.1) / attached slab pull, N — diagnostics + tensionRift input
                blanketYears }             // tensionRift supercontinent thermal-blanket age (#113 stage 3)
```

Initial kinematics are seeded at creation from `rng.fork('plateKinematics')`:
uniform pole on the sphere, speed uniform in 1.5–8 × 10⁻⁹ rad/yr
(≈ 1–5 cm/yr on an Earth-radius sphere). **Under the promoted default
(`forceKinematics`, Tectonics V2 stage 1, #111, default-on since
`KERNEL_BEHAVIOR_VERSION` 17) this seed is only the t=0 state: from the first
step each live plate's ω⃗ (`omegaVec`) is re-derived every step by a rigid-plate
torque balance (`plateDynamics.ts`) — ridge push, slab pull and basal drag —
so speeds and poles are dynamic state, not frozen constants** (see the Wilson
section and #111 for the balance). Flag-off (the legacy spine, still exercised
by the pinned `--no-force-kinematics` tests) the assigned pole/speed persist
unchanged. Dead plates (sutured away, #18) keep their slot so `plateId` values
stay stable forever.

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
properties — `elevation`, `crustAge`, `crustType`, `sutureYears`, `sedimentM`
(`ADVECTED_FIELDS`) — travel from the winning claim's source cell; values
are copied, never interpolated. Overlap resolution is provisional until #16 (moved beats
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
values) — plus the cell's `sedimentM` (#65): shelves filled by coastal
export stand above bare crust of the same age (the deposit cap in erosion
keeps the target at or below −200 m, so a filled shelf is shallow platform,
never land). The relaxation is rate-bounded (#59,
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
plate along the convergence direction. The landing cell is picked at apply
time against the resolved **post-advection** crust map (#67), and the pick
is compactness-seeking: same-plate oceanic ground *attached* to continental
crust first (forward, then anywhere), then unattached ocean (forward, then
anywhere — lateral extrusion, the Indochina-style escape), then continental
ground, where the collision shortens and thickens (half the displaced
positive relief piles on, capped at 9 km). A detached re-root is a one-cell
micro-continent the founder clamp then sinks — conserving area as confetti
is conserving it in a form the planet can never read as a continent, the
measured "collision debris" shape leak of #67. The symmetric case (a
*moving* continental source whose content won at no target) piles onto the
cell behind it. The only
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
Maturation is applied in one pass after the margin loop (#67), so no margin
cell's collision/polarity branch observes a same-step maturation; a
stricter attachment-gated variant (mature only when 4-connected to the
continent through cells at maturation elevation) was measured in #67 and
rejected — it starved creation (land minima fell 2–4 points) for no shape
gain once margin consolidation existed.
**Isolated continental slivers founder (#59):** a continental cell with no
continental 4-neighbor is pinned below sea level
(`MICROCONTINENT_FOUNDER_ELEVATION_M` = −200 m, Zealandia-style — it keeps
its crustal identity and can re-accrete, but stranded collision debris no
longer stands as immortal one-cell peaks speckling the deep-time ocean).
**Margin consolidation (#67):** each tectonics step ends by pair-flipping
stray one-cell continental islands (zero continental 4-neighbors — the same
debris the founder clamp sinks) against enclosed ocean holes (≥3
continental 4-neighbors: gap-fill scars and advection tears inside
continents), both sides in ascending cell order, `min(#islands, #holes)`
pairs, so continental cell count is exactly conserved. The island reverts
to seafloor at its age-depth floor; the hole fills as continental basin
floor inheriting its lowest continental neighbor's elevation, oldest
neighbor's age, and the neighbors' weld memory. Unpaired islands stay
foundered; unpaired holes stay open water. This is the measured #67 lever
that welds deep-time lace back into bold continents: largest continental
component 0.08–0.10 → 0.22–0.31 of continental area at N=64/4.5 Gyr while
land minima *rose* (compact masses expose less margin to collision
consumption).
Oceanic cells on active convergent margins (stress > 0.005 m/yr) are exempt
from subsidence relaxation; when a margin deactivates they rejoin it and
decay to the age-depth curve over a few Myr (#59 arc memory — a half-built
arc survives the margin flickering off it, which is what keeps arc creation
effective at fine grids). Under the promoted default (`forceKinematics`,
#111) plate speeds **do** slow in collisions: the torque balance loses the
colliding plate's driving force to basal drag, so a stalling contact
decelerates — the very signal the stall-detected suture (`emergentSuture`,
below) keys on. (On the legacy flag-off spine, speeds were fixed and did not
slow — a documented Phase 1 simplification; the 9 km cap plus #19's erosion
bounded the consequences.) Old mountain belts advect with their plates and
persist until erosion (#19) ages them.

### Wilson cycles (#18)

> **Tectonics V2 promotion (stage 5, #115, `KERNEL_BEHAVIOR_VERSION` 17).**
> As of the stage-5 promotion the three V2 mechanisms are **default-on**:
> `forceKinematics` (torque-balance ω⃗, #111), `emergentSuture` (stall-detected
> merge, #112), and `tensionRift` (tension²-hazard rift timing, #113), with the
> post-rift cooldown kept at 120 Myr (`riftSutureCooldownYears`; stage 4 #114
> measured its retirement and declined it — see `TECTONICS_V2_STAGE4_FINDINGS.md`).
> The prose below describes both paths; where it names a "legacy"/"flag-off"
> scheme (the fixed 60 Myr suture countdown, the `riftSizeRamp`/`RIFT_MIN_AGE`
> size-ramp rift trigger, the perpendicular translating-pole + ocean-seeking
> azimuth fan) that is now the **`--no-*` flag-off spine**, exercised only by
> the pinned legacy tests; the promoted default runs the V2 mechanisms. The
> promoted world's measured Earth-scoreboard (with its honest misses — the
> deep-time speed–slab-attachment correlation washes out in the busier stack;
> census speed runs ~6 cm/yr) is in `TECTONICS_V2_STAGE5_SCOREBOARD.md`.
>
> **Dependency guard (#127 item 6).** `tensionRift` and `emergentSuture` both
> read state only `forceKinematics` produces — the boundary tension `tensionN`
> and the force-balance closing-speed collapse — so either one on with
> `forceKinematics` off is a silently degenerate world: `tensionRift` gives a
> rift-dead planet (`tensionN` is 0 forever and the flag deletes the legacy
> age/size hazard), `emergentSuture` grinds every real collision to the 150 Myr
> `SUTURE_TIMEOUT_YEARS` backstop. `validateKinematicDependencies`
> (state.ts, called from `createPlanetParams` and `createInitialState`) throws on
> the combo; the sim-cli resolves it loudly (`--no-force-kinematics` cascades the
> two dependents off, `--ab force-kinematics` ablates the whole stack) and the web
> sidebar cascades + grays the dependents via `resolveMechanismDependencies`.

The `wilson` system (after tectonics in the pipeline) reorganizes plates so
deep time tells a story. The whole trigger clock was retuned 4× slower in
#66 toward Earth-like Wilson periods (the pre-#66 values passed the
dispersal metrics but reorganized every ~20 Myr globally — faster than the
10 Myr keyframe spacing, which read as flicker); the values below are the
retuned ones, and the measured mean interval between reorganizations
involving the same plate is ~140 Myr at N=64 (`pnpm sim --report` prints
the tempo). **Suturing:** plate pairs in continent–continent
convergent contact (≥3 boundary cells, both sides continental, stress
positive) for a continuous 60 Myr merge — smaller absorbed into larger, the
combined plate takes the area-weighted mean angular-velocity vector, and
relative motion across the suture stops. Without this, fixed plate speeds
grind colliding continents away forever (integration runs lost 2/3 of
continental area in 500 Myr). **Rifting (#59 fragment kinematics):** a
plate that is old (≥600 Myr since creation/last rift), large (≥8% of the
sphere) and carrying a continent (continental area ≥2% **of the sphere** —
plate-relative fraction was tried first and silently disabled rifting, and
the earlier 5% gate dead-locked low-continent worlds) rifts with
probability 0.0015/Myr. The rift *carves off a contiguous continental
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
sphere), reaches `RIFT_SIZE_RATE_REF_MULTIPLE` (16) at
`RIFT_SIZE_RATE_REF_FRACTION` (0.55, the old #59 brake threshold),
and keeps climbing. It scales both halves of the old brake: the draw probability
uses `min(16, ramp)` (saturating above 0.55, so nothing rifts faster than the
reference oversize rate — half the #59 brake's absolute rate, the slowest that
holds dispersal on all three golden seeds, re-measured in #66), and the
maturity age gate is
`RIFT_MIN_AGE_YEARS / ramp` (full below the knee, 37.5 Myr at 0.55, shrinking to
a ~5 Myr floor near whole-sphere — the old hard age waiver made continuous). This
removes the
discontinuity at 0.55 and the MIN_PLATES coupling (the old brake existed only to
compensate for the lowered suture floor). Suturing keeps assembling
supercontinents, and one plate used to own ~100% of cells from ~1.2 Gyr on
(plate ≠ land); under pressure a sphere-monopoly sheds fragments within ~100 Myr
until it disperses, so the measured worst >85%-of-sphere monopoly window
is ≤ 60 Myr at N=64 (was ~3 Gyr pre-#59); an invariant test pins it <400 Myr.
The dispersed-window fraction after the #66 retune is 93–94% at N=64 on all
three golden seeds with every Gyr bucket alive — the deep-time metric is
chaotically sensitive to the oversize rate (between 12× and 16× it is bimodal:
seed 42 collapses to ~49% at 12×), which is why the oversize safety net is the
one knob the #66 clock scaling did not slow proportionally.
**Tension-driven rift timing (`tensionRift`, Tectonics V2 stage 3, #113,
default on since KERNEL_BEHAVIOR_VERSION 17, #115):** under the flag the
flat-hazard × bimodal-size-ramp scheme is
replaced by a physical hazard drawn at the *same* hash site — only the
acceptance threshold changes. λ = `RIFT_HAZARD_AT_REF_PER_MYR` (0.0075/Myr) ×
min(4, (`tensionN`/`RIFT_TENSION_REF_N`)²) × a supercontinent thermal-blanket
factor, and the per-step draw must clear 1 − exp(−λ·dtMyr) (`riftTensionHazardProbability`).
`tensionN` (gross − |net| over slab-pull forces only — #127 item 2.1 — written
by `plateDynamics` under `forceKinematics`) is the physical scalar the size ramp
was faking: a supercontinent ringed by opposed subduction carries high gross /
low net slab pull and rifts *because it is being pulled apart* — continuous, no
knee. Ridge push and continental collision damping (both compression-side) are
excluded, so an actively colliding plate no longer accrues rift hazard. The blanket
is the one deliberately *pseudo-mantle* term: `blanketYears` accrues while a
plate holds ≥ `BLANKET_CONTINENT_FRACTION` (25%) of the sphere as continent and
multiplies the hazard by 1 + (`BLANKET_MAX_FACTOR`−1)(1 − e^(−blanketYears/`BLANKET_EFOLD_YEARS`))
(`blanketFactor`), a quiet-interior slow fuse superseded by `mantleAnchors` later.
Under the flag the age gate and size ramp are deleted; the plate-slot safety
gates (area ≥ 8%, continental ≥ 2% of the sphere, `MAX_PLATES`) stay. The
**carve machinery is byte-identical** (fragment seed, jittered Dijkstra, size
draw — proposal §7 says change *when*, never *where*); only the fragment
*kinematics* change: it inherits the parent's ω⃗/pole and the halves separate
because ridge push registers on the new divergent margin next step, retiring the
perpendicular translating-pole construction and the ocean-seeking azimuth fan
(their stateless position-hash draws go dead flag-on; flag-off they still
evaluate, so goldens are byte-identical). Requires `forceKinematics` for a
non-zero `tensionN`; zero new RNG.
**Post-rift suture lock:** a fresh rift margin is
passive: a rift stamps both halves with `sutureLockUntilYears = now +
RIFT_SUTURE_COOLDOWN_YEARS` (120 Myr) and a locked plate's contact is not
recorded, so it can't re-suture until the lock lifts (then needs a fresh
60 Myr). **Stall-triggered suture (`emergentSuture`, #112, Tectonics V2
stage 2, default on since KERNEL_BEHAVIOR_VERSION 17, #115):** when the flag is on (after its branched-A/B
`emergentSutureOnsetYears`), wilson replaces the fixed `SUTURE_AFTER_YEARS`
countdown with *detection* of the collision death `forceKinematics` produces.
The contact scan drops its stress gate and instead counts continent–continent
*adjacency* cells per pair and their summed *signed* normal stress (+ convergent);
a pair merges (`plateSuture`) once a full `SUTURE_STALL_AFTER_YEARS` (20 Myr)
tumbling window elapses whose average |net closing rate| stayed below
`SUTURE_STALL_SPEED_M_PER_YR` (2 mm/yr). The criterion is a **net-signed
shortening integral** (issue #112 pre-registered fallback, proposal §2.4), not the
per-cell |closing speed| mean the first cut used: that magnitude mean has an
advection-quantum noise floor that never falls below 2 mm/yr, so it measured dead
(0 stalls across the acceptance grid, every suture via the timeout). Summing the
*signed* net closing lets jitter cancel over the contact, and evaluating the rate
only at the window boundary (net summed across the whole 20 Myr first) makes a
lone jittering step unable to reset the clock; a window that reaches threshold
re-arms the anchor. The derived reset tolerance is 2 mm/yr × 20 Myr (≈40 km net
shortening/window) — no independent tuned constant. A low net rate alone is not
enough (#127 item 2.2): the net-signed test is blind to a shearing transform
(all tangential slip) or a boundary rotating about a nearby pole (signed normal
segments cancel), both of which read net≈0 while the plates still move at plate
speed. A **gross relative-motion gate** also requires the pair's mean
|v_own − v_other| — the smooth Euler-pole-derived speed, free of the û-projection
jitter that forced the net-signed integral — to stay below
`SUTURE_SHEAR_MAX_M_PER_YR` (8 mm/yr): a genuine stalled collision is
near-comoving, so only near-comoving pairs stall-weld. The loud timeout is
deliberately NOT gated, so a long-lived head-on grind still merges (tagged). A loud backstop
merges any contact that persists `SUTURE_TIMEOUT_YEARS` (150 Myr) without ever
stalling and emits a distinct **`sutureTimeout`** event, so the stall-never-fires
failure mode (a plate driven by a remote slab) is visible in the log rather than
a silent grind. A separating rift pair loses its cont–cont adjacency as ocean
opens between the halves, so it drops out of the scan rather than ever
registering a convergent stall — the pre-#59 re-suture pathology cannot recur.
Merged kinematics under the flag are the drag-tensor-weighted blend
ω⃗ = (K_a+K_b)⁻¹(K_a·ω⃗_a + K_b·ω⃗_b) (the fixed point the combined plate relaxes
to; `kWeightedOmega`/`plateDragTensor` in `plateDynamics.ts`), and the winner's
`accumulatedRadians` is preserved; flag-off keeps the legacy area-weighted mean
and the `accumulatedRadians` reset byte-for-byte. Both directions emit events
(`plateSuture`/`plateRift`), and
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
**Suture-line memory (#60):** suturing stamps the continent-continent weld
cells (both sides of the closed ocean's scar, a 2-cell belt) with the merge
time in `sutureYears`, an advected crust property — the weld record travels
with the merged continent however far it drifts. **Recording-only by
measurement:** the rift carve deliberately does not read it. Seven
carve-weighting variants (crust-age stiffness absolute and plate-relative, a
continental quota, weld walls with flank seeding under permanent / 800 Myr /
200 Myr / spent-on-rift memory, and craton rim tolls at two strengths) were
prototyped against #60's goal of compact, persistent deep-time continents,
and every one made continents *less* coherent (mean largest continental
component 0.11 → 0.04–0.08 of continental area) or broke the #59/#61
dispersal metrics (dispersed keyframes 0.72–0.74 → as low as 0.51) — the
raggedness driver is the per-boundary process layer (arc freckling,
quantized-advection herringbone, collision debris), not carve geometry, so
steering rift lines into continental interiors only manufactures more
boundary length through continent. The full variant table, failure
mechanisms and follow-up direction are in `PHASE_2_STAGE0_FINDINGS.md`
("#60"). Because nothing reads the field, every pre-existing field's bytes
are bit-identical to the pre-#60 kernel in every run.
Contact bookkeeping lives in `PlanetState.wilson.contactSince` (pair-keyed
start times, rebuilt each step — never iterated by key order); alongside it two
`emergentSuture`-only maps (always empty on the flag-off path): `stallSince`,
the anchor time of each pair's current tumbling stall window, and
`shorteningIntegral`, the net signed shortening (m) accumulated since that
anchor. Their quotient over the elapsed window is the average net closing rate
the boundary test uses; the anchor re-arms (and the integral resets) when a
completed window's rate reaches `SUTURE_STALL_SPEED_M_PER_YR`. The rift
decision draw is `hash3(seed', plate, timeQuantum)` rather than the issue's
`rng.fork('wilson')` sketch: a fork taken inside a pure system would restart
its stream every step, so a position/time hash is the deterministic
equivalent (documented deviation). Euler-pole wander was considered and not
implemented.

### Erosion, energy balance, winds, moisture, ice, sea level & carbon (#19, #65, #30, #31, #32, #33, #34)

`erosion` (after wilson): Jacobi diffusion of elevation over the 4-neighbor
graph, continental-crust pairs only, flux ∝ height difference (slope) ×
mean-pair precipitation (clamped 0.05–2× at 1000 kg/m²/yr reference) ×
base-level damping (×0.1 when either endpoint is submerged — without it
coastal diffusion submerges land planet-wide). Pairwise antisymmetric fluxes
make the diffusion pure redistribution; oceanic *elevation* is isostatic
(#15) and never written. **#65 added the two sinks that let old mountains
die** (pure conservation ratcheted continental hypsometry monotonically
upward — orogeny kept injecting and nothing ever left):

- **Coastal sediment export:** a continental cell above the datum next to a
  *submerged oceanic* cell exports flux ∝ its height above sea level
  (base level — not the full drop to the ocean floor) at the normal erosion
  rate. The volume leaves the continental budget and accumulates in the
  oceanic neighbor's `sedimentM`, which the #15 relaxation target adds on
  top; deposition is capped so the target never exceeds
  `SEDIMENT_SHELF_CEILING_M` (−200 m) — full shelves stop accepting. The
  flux vanishes at 0 m, so export alone can never sink a coastline. The
  conservation invariant is now Σ(continental elevation) + Σ(`sedimentM`);
  sediment leaves that ledger only by subduction or by accretion into
  maturing/re-rooting continental crust.
- **Orogenic root decay:** continental elevation above
  `OROGENIC_ROOT_REFERENCE_M` (1 km; under the `freeboard` mechanism the
  reference rides the dynamic sea level — `landDatumOffsetM`, datums.ts)
  relaxes toward it exponentially with
  `OROGENIC_ROOT_DECAY_TAU_YEARS` (300 Myr) — isostatic re-equilibration of
  the over-thickened root (Caledonides/Appalachians-style aging).
  Deliberately non-conservative (root loss is subsidence, not transport)
  and inactive at or below the reference, so it can never submerge land.
  Active-margin belts stay high — orogeny out-injects the decay ~20× even
  at the 9 km cap — while belts welded into interiors by sutures retire to
  low relief within ~0.5–1 Gyr instead of persisting as immortal plateaus.

The precipitation erosion reads is now real: `climateProxy` (the static
latitude-band proxy, and before that the temperature placeholder) is **deleted**,
replaced by the `moisture` system below. Erosion reads the previous step's
`precipitation` — a one-step lag, since moisture runs after erosion in the
pipeline — exactly as the energy balance reads the previous step's ice/CO₂.

`blockIsostasy` (#84, **default-off prototype** behind `params.blockIsostasy`;
after erosion, before the climate stack): small continental blocks cannot hold
high topography. Each step it labels the 4-connected components of
`crustType == 1` (fixed-order iterative BFS) and relaxes elevation standing
above the component's area-dependent ceiling toward it at
`BLOCK_ISOSTASY_RELAX_M_PER_YR` (never a hard-set, never raises). Component
area is the sum of true per-cell solid angles × R² (`cellSolidAngleTable` in
grid.ts) — the warp leaves ±35% residual per-cell area distortion, enough to
matter at the founder threshold, so cells × mean area is not used. The ceiling
is `MICROCONTINENT_FOUNDER_ELEVATION_M` below `BLOCK_FOUNDER_AREA_M2`
(300k km² — the block founders as submerged platform; `crustType` untouched,
so the crustal-area ledger is untouched and the block can re-accrete), rises
as sqrt of normalized area, and reaches `OROGENY_MAX_ELEVATION_M` at
`BLOCK_FULL_OROGENY_AREA_M2` (2 Mkm²), above which the system is inert. It
generalizes the one-cell founder clamp in tectonics to the 2+-cell splinters
every other repair pass misses — the #60 "tall-island confetti" residual.
Non-conservative by design (subsidence, not transport), same justification
as orogenic root decay. Flag-off runs are byte-identical to the pre-#84
kernel (the goldens pin this); the flag-on path has its own goldens.
`params.blockIsostasyOnsetYears` (default 0) keeps the system inert before
that sim year: since it consumes no RNG, a flag-on run with onset Y is
bit-identical to a flag-off run until Y, which is the **branched A/B**
instrument (`pnpm sim -- --ab <mechanism> --ab-branch <years>`;
`--ab-block-isostasy <years>` is the original alias) — paired keyframes
just after the branch measure the mechanism's direct effect, isolated from
the chaotic whole-trajectory divergence that defeats plain on/off
comparisons.

The #84 A/B verdict (Δ land components ≈ 0: foundered splinters are
replaced by the boundary processes at the same rate) motivated four further
**mechanism prototypes** (#88–#91), every one carrying the same
`<name>` + `<name>OnsetYears` param pair and measurable with the same
harness. After the ISSUE_88_91_FINDINGS.md campaign, **`crustFates` and
`marinePlanation` were promoted to default-ON** (KERNEL_BEHAVIOR_VERSION 15;
main goldens regenerated deliberately) — the promoted pair measures
healthier than the old baseline over full 4.5 Gyr histories (N=128 seed 42:
land min 11.4%, final land 14.3%, ~20 consolidated continental components
vs 275 baseline). `compactArcs` and `emergentArcTaper` **stay default-off**:
measured together at default-on they starve continental creation into a
near-waterworld (N=64 final land 2–5%, N=128 land min 5.3% — far below the
standing 10% land-sanity floor). The pre-promotion kernel path is pinned
unchanged by the legacy all-mechanisms-off goldens, and each mechanism's
isolated flag-on path has its own golden spine. The mechanism registry
(`sim-kernel/src/mechanisms.ts`, exported as `MECHANISMS` +
`defaultMechanismToggles()`) is the single source of truth UIs use for
mechanism toggles — the web app's sidebar reads labels and live default
states from it, and folds non-default toggle states into the history-cache
key:

- **`crustFates` (#88, its own system, after wilson):** attacks the
  crustType lace directly. Labels components (shared `components.ts` BFS);
  a component under `CRUST_FATE_SMALL_AREA_M2` (300k km²) within
  `CRUST_FATE_MERGE_GAP_CELLS` (2) of ocean of a large component **docks**:
  the strait flips to continental crust (lower endpoint's elevation, older
  endpoint's age, suture-stamped weld) and the whole terrane transfers to
  the large component's plate so advection carries it with the continent
  (Wrangellia-style; `boundaryStress` is recomputed after a transfer — the
  #55 rule). Out-of-range small components subside toward the founder level
  at `CRUST_FATE_SUBSIDENCE_M_PER_YR` and, once the WHOLE component is at
  or below it (already invisible in the land mask — no popping), the crust
  record retires: crustType → 0, sutureYears → 0, elevation left for the
  oceanic age-depth relaxation. Retirement is the kernel's one deliberate
  crustal-area ledger debit; dock welds are the matching small credit. An
  all-small world bails (no docking target; foundering everything would be
  destruction, not consolidation).
- **`compactArcs` (#89, arc-maturation gate in boundaries.ts):** a belt
  maturation candidate also needs ≥ `COMPACT_ARC_MIN_CONT_NEIGHBORS` (2)
  continental 4-neighbors in the pre-topography crust map, so creation
  fills margin concavities (blobs) instead of stringing coast-parallel
  chains — the #84-measured re-supply of the lace. Deliberately weaker than
  the rejected #67 attachment gate (which required connectivity through
  other mature-elevation arc cells and starved creation): a gated cell
  stays an oceanic arc and can mature later once the continent grows
  around it.
- **`marinePlanation` (#90, erosion.ts):** the conservative erosion-side
  lever. Components under `MARINE_PLANATION_AREA_M2` (strength ramps
  linearly with smallness) get their subsea diffusion damping lifted toward
  1 and a coastal export term that grades toward the shelf/founder level
  (−200 m) at `MARINE_PLANATION_RATE_M_PER_YR` — wave attack neither scales
  with precipitation nor stops at sea level (the asymptote that made
  islands immortal). Mass moves into oceanic `sedimentM` under the usual
  shelf-room cap, so the Σ(cont elevation) + Σ(`sedimentM`) invariant
  extends over the new flux unchanged — planed and foundered platforms are
  the same −200 m object downstream.
- **`emergentArcTaper` (#91, arc growth in boundaries.ts):** arc elevation
  growth above sea level (previous step's `seaLevelM`, the usual lag) is
  scaled by `ARC_EMERGENT_GROWTH_FACTOR` (0.05), placing emergent growth in
  the same band as `OCEAN_RELIEF_RELAX_M_PER_YR` decay — so herringbone-
  flickering margins hold *submerged* arcs and only long-lived subduction
  stands emergent +1 km chains. Margin age is integrated by dwell time; no
  new field. Submarine growth and the −500 m maturation gate are untouched,
  so the continental-creation budget is unaffected by construction.
- **`seaLevelDatums` (no tracking issue — specified and measured in
  `SEA_LEVEL_DATUM_FINDINGS.md`; cross-cutting, `datums.ts`):** re-keys the
  platform/arc datum constants to the **dynamic sea level**. The #33 sea
  level falls ~3 km over the first 500 Myr as ocean basins mature, which
  beaches every absolute-datum "submerged platform" constant: measured on
  seed 42/N=64, the submerged share of continental crust collapses 25% →
  0% by 0.5 Gyr and never recovers, so late-time oceans sit exclusively on
  oceanic crust (Earth floods ~25% of its continental crust). With the flag
  on, the affected call sites add `platformDatumOffsetM(state)` (= previous
  step's `seaLevelM`, the usual lag; exactly 0 flag-off) to the founder
  clamp (tectonics), the sediment shelf ceiling + marine-planation target
  (erosion), the arc maturation gate + island ceiling (boundaries), the
  crustFates founder/retirement level — restoring the "no land-mask pop"
  retirement semantics — and the whole `blockElevationCap` ramp. The
  oceanic **age-depth curve stays absolute**: the sea-level solve fills the
  hypsometry with a conserved volume, so a seafloor target that tracked sea
  level would chase it downward without bound (measured — see the findings
  doc and the `bathymetryDatum` bullet below, which re-keys only the ridge
  crest for exactly this reason; the land-relief constants
  `OROGENY_MAX_ELEVATION_M`/`OROGENIC_ROOT_REFERENCE_M` are re-keyed by
  the `freeboard` mechanism below, which owns that regime change). Measured flag-on (seed 42/N=64/4.5 Gyr): the shallow-ocean
  share recovers from a 1–7% decay to a sustained 7–13% (real shelf
  fringes) and arc maturation re-submerges, but flooded *continental*
  crust does not return — drowned platforms are transient (crustFates
  retires them) and large continents still never subside, which is the
  freeboard mechanism's job.
- **`freeboard` (no tracking issue — scoped, specified and measured in
  `SEA_LEVEL_DATUM_FINDINGS.md`; `systems/freeboard.ts` + call-site
  re-keys via `landDatumOffsetM` in `datums.ts`):** freeboard regulation,
  the regime change the datum re-key above deliberately excluded —
  continental crust *floats*. Three pieces, all reading the previous
  step's `seaLevelM` (the standard lag): (1) the cell-count mean of
  continental elevation relaxes toward `seaLevelM + FREEBOARD_TARGET_M`
  (400 m) by a uniform, rate-bounded (20 m/Myr) epeirogenic shift —
  relief-preserving, floored at the continental buoyancy floor
  `seaLevelM − 2500 m` (without the floor, orogenic injection plus the
  compensating sink ratcheted flooded interiors to −17 km — measured, see
  the findings doc); (2) passive margins — continental cells within 2
  cells of *same-plate* oceanic crust, convergent cells excluded —
  subside toward `seaLevelM − 150 m` at 20 m/Myr (post-rift thermal
  subsidence as a mean rate, no per-cell rift clock); (3) the land-relief
  datums re-key: orogeny/collision caps at `seaLevelM + 9 km`, orogenic
  root decay toward `seaLevelM + 1 km`. Runs after `blockIsostasy`,
  before the climate stack. Measured with `seaLevelDatums` also on (the
  designed pairing — without it the absolute arc-maturation gate starves
  creation and continental crust decays to 13–16%): 30–65% of continental
  crust stays flooded at every checkpoint over 4.5 Gyr (Earth ~25%;
  baseline 0%), 9–27% of ocean area sits on continental crust (Earth
  ~17%), sea level equilibrates at −3.3..−3.7 km, and continental crust
  holds 24–36% of the sphere. The #101 calibration sweep (targets
  400/600/800 m × the golden seeds) measured the flooded share
  *insensitive* to `FREEBOARD_TARGET_M` — the overshoot vs Earth's ~25%
  is structural (rate-bound relaxation + a flooded lobe piled against the
  buoyancy floor), so the target keeps its cleanly-anchored 400 m; see
  the findings doc. Default OFF — measurement prototype.
- **`bathymetryDatum` (#102; `seaKeyedOceanicDepthForAge` in
  `bathymetry.ts` + `bathymetryDatumOffsetM` in `datums.ts`):** the
  age-depth re-key — the third datum layer, retiring the emergent
  mid-ocean-ridge chains (design crest −2500 m absolute vs a deep-time sea
  at −3.4..−3.9 km left every spreading center standing ~1 km proud). All
  five consumers of the age-depth reference (thermal-subsidence target,
  trench pinning, divergent gap fill, consolidation island flips, sediment
  shelf room) read a curve whose **crest caps at `seaLevelM −
  OCEAN_RIDGE_MIN_SUBMERGENCE_M` (500 m — deliberately equal to the arc
  maturation gate depth, so fresh ridge crust is born AT the gate and the
  arc-driven continental-creation budget survives the re-key; a 1000 m
  crest was measured to cost 5–7 points of continental crust)** — never
  shallower than the design crest — while the **abyssal end stays
  absolute** and the √age slope rescales to reach the abyss at the
  unchanged 100 Myr. The abyss is the volume anchor: full 1:1 tracking of
  the curve was measured (#102) to have NO equilibrium — the keyed basin
  capacity (~3.9 km global-equivalent) exceeds the conserved inventory
  (~1.7 km) ~2.3×, so the (sea, floor) pair co-falls at the ocean-relief
  relax rate (~200 m/Myr; −900 km by 4.5 Gyr, measured) and the freeboard
  anchor is outrun ~10:1. The crest-cap shape tracks only the young ridge
  flank, keeps the sea-level bisection sloped by construction, and
  engages smoothly once the sea falls past −2 km (no onset shock).
  Measured paired on the full datum stack (all golden seeds, 4.5 Gyr):
  emergent young crust 37–65% → ~2%, crests ~0.7 km submerged, sea
  stationary, freeboard-side metrics within seed scatter — Earth's 2.5 km
  crest submergence would need ~0.9 km-equivalent more water than the #33
  inventory holds (a water-inventory follow-up, not a datum one).
  Flag-off (offset 0) returns the design curve bit-exactly. See
  `SEA_LEVEL_DATUM_FINDINGS.md` for the trajectories, the dt-halving
  check, and the crest-depth calibration. Default OFF — measurement
  prototype, designed to run with `seaLevelDatums` + `freeboard` on.

`energyBalance` (#30): the Phase 3 climate hub. A Budyko–Sellers **zonal
energy-balance model** solved on `ENERGY_BALANCE_BANDS` (90) equal-area
latitude bands (uniform in sin φ). Per band: absorbed shortwave =
annual-mean insolation × co-albedo, where insolation is
`starLuminosity / (4π·d²)` shaped by the obliquity-dependent annual-mean
latitudinal profile (a fixed function of `obliquityDeg`, memoized per run — no
seasonal cycle, §7.2) and albedo is the cell-count mean of per-cell planetary
albedo (ocean/land keyed off the **dynamic sea level** `elevation ≥ seaLevelM`,
blended toward `ALBEDO_ICE` by `iceFraction` — the **#33 ice-albedo feedback**,
now reading the real ice field the `ice` system integrates, which is what makes
snowball states reachable). This
is balanced against a **linear OLR** closure `A + B·(T − 273.15)` whose
intercept drops by `CO2_FORCING·ln(co2 / CO2_REFERENCE_PPM)` — the **#34
greenhouse hook**, reading `globals.co2` (now the dynamic carbonate–silicate
reservoir the `carbon` system drives, at the previous step's value) — and
against North-style meridional diffusion `D·d/dx[(1−x²)·dT/dx]`. Linear OLR
makes the balance a single deterministic **tridiagonal solve** (Thomas
algorithm, fixed sweep order — never `while (!converged)`), and because the
transport is written in conservative flux form it telescopes to zero over the
sphere, so the **global net top-of-atmosphere flux closes to machine
precision** (the #30 invariant). The zonal profile maps to the per-cell
`temperature` field as `zonal(lat) − lapse·max(0, elevation) +` a bounded land
continentality term (land amplifies its departure from the global-mean zonal
temperature, clamped to ±`CONTINENTALITY_MAX_K`); `globals.meanTemperatureK` is
the cell-count-mean surface temperature (a diagnostic). The **lapse keys off
absolute altitude above the fixed 0 m datum, not `seaLevelM`** — atmospheric
altitude tracks the solid surface, and keying it to a sea level that swings
kilometres as ocean basins mature would spuriously cool/warm the whole planet;
`seaLevelM` (#33) governs only the land/ocean **mask** here (which cells are land
for albedo and the continentality term) and is read as the *previous* step's
value, the same one-step lag as ice/CO₂.

`winds` (after energyBalance, #31): the prevailing surface wind field
`windU`/`windV`, a deterministic **band model** (not a fluid solve, §6). Two
knobs set it. **Rotation → band count:** the number of circulation cells per
hemisphere is `round(WIND_CELLS_PER_HEMISPHERE_EARTH · (24 /
dayLengthHours)^WIND_ROTATION_EXPONENT)` clamped to
[1, `WIND_MAX_CELLS_PER_HEMISPHERE`] — Earth's 24 h day gives the three-cell
Hadley/Ferrel/Polar structure, faster rotators get more (narrower) bands
(Rhines-scale jet spacing), and a day past ~96 h collapses to a single
equator-to-pole Hadley cell. **Temperature gradient → strength:** the whole
field scales by the equator-to-pole surface temperature contrast (equatorial
band |sin lat| < `WIND_EQUATORIAL_SINLAT` minus polar band |sin lat| >
`WIND_POLAR_SINLAT`) over `WIND_TEMP_GRADIENT_REF_K`, clamped to
[`WIND_GRADIENT_FACTOR_MIN`, `WIND_GRADIENT_FACTOR_MAX`], so an icehouse blows
harder than a well-mixed hothouse. Per hemisphere both components share the
half-sine envelope `sin(nCells·π·|lat|/90°)` (zero at the equator, every cell
boundary, and the poles): `windU` is even in latitude — easterly near the
equator (the trades), alternating outward once per cell — and `windV` is odd —
equatorward at the surface, so the Hadley cell yields the diagonal NE/SE trades
and the Ferrel cell the SW/NW-erlies. Winds are clamped to ±`WIND_MAX_M_PER_S`
(the codec bound). Like temperature the field is a *fast* diagnostic — no
memory, re-solved each step — and it writes only the two new fields, leaving
every other field's bytes untouched (`KERNEL_BEHAVIOR_VERSION` 10 is the
schema-grew bump, not a physics change to existing fields). Consumed in-kernel
by moisture transport (#32) and, in Phase 5, by cloud advection.

`moisture` (after winds, #32): fills `precipitation` by an **evaporate → advect →
precipitate** solve — rain shadows *emerge* from the transport, they are not
painted on. Ocean cells (below the dynamic sea level) inject an evaporation source scaled by
a Clausius–Clapeyron temperature factor (warm seas evaporate more); the moisture
column is advected along `windU`/`windV` by a **conservative upwind donor
scheme** — each cell sheds a wind-speed-scaled fraction to the neighbours the
wind points toward (`outFrac`, summing to 1) — and rained out at a rate `q·λ`,
`λ` a base drizzle plus an **orographic** term that grows where the wind climbs
toward higher land (height above sea level). A windward slope rains hard and
depletes the column before the crest, so the lee is left in the dried-out air;
sea air also rains out with distance inland, so continental interiors dry.
Steady state is a **fixed-count upwind Jacobi relaxation** (sweeps ∝ N —
`relaxSweepCount` — so the fetch is resolution-independent; a fixed schedule, not
a `while (!converged)`), then precipitation is closed **exactly** to the
evaporation total (`Σ precipitation = Σ evaporation`, the water-mass invariant)
by one global scale — a uniform factor that preserves every windward/lee ratio.
Fast diagnostic, no memory. Its output feeds erosion on the next step. (The
wettest orographic cells can exceed the codec's future 0–8000 range at coarse N;
that saturates visually only and never reaches erosion, which caps at
`EROSION_PRECIP_FACTOR_MAX`. The raw field is finite and non-negative.)

`ice` (after moisture, #33): integrates `iceFraction` — the first climate
reservoir with genuine **cross-step memory** (a *slow* reservoir, dt-integrated,
not a fast diagnostic). Each cell relaxes toward a temperature-set **equilibrium
cover** `coldFrac(T)` that ramps 0 → 1 over a deliberately WIDE band below
freezing (`ICE_FULL_COVER_BELOW_K`): a sharp ice line (full white the instant a
cell crosses freezing) makes the #30 ice-albedo feedback supercritical and
snowballs the default planet by ~1 Gyr on all three golden seeds; grading the
target over tens of K keeps `d(albedo)/dT` gentle enough for a **stable partial
polar cap**, while a strong cold perturbation (fainter star / low CO₂, #34) still
drives the target toward 1 everywhere so a snowball stays reachable — the
bistability lives in the coupled feedback, not a hard threshold. Growth toward
the target is gated by **moisture supply** (ocean cells are saturated; land is
precipitation-limited — the "cold + wet" criterion), retreat by a baseline
sublimation/flow rate plus a positive-degree-day **ablation** term ∝
`max(0, T − freeze)` (the "warm" criterion). The step change is `(target − ice)·
(1 − exp(−rate·dt))`, rate-limited and clamped to [0, 1]; dt-correct so a coarser
`stepYears` rescales the approach, not the trajectory. Reads this step's
temperature/precipitation and the previous step's `seaLevelM` (land/ocean mask);
feeds `iceFraction` back to the energy balance (albedo) and to `seaLevel`.

`seaLevel` (after ice, #33): re-solves the global sea level and land fraction —
**derived**, holding no state of its own. The conserved quantity is
`waterInventoryM` (calibrated at init from the initial coastline). Grounded ice
(cells above the shoreline) withdraws its water-equivalent
(`ICE_SHEET_WATER_EQUIV_M` per unit cover) from the ocean; floating **sea ice**
(cells below the shoreline) already displaces its own water and locks nothing (it
whitens albedo but not the coastline). Sea level is the level at which the
remaining liquid fills the hypsometry — `oceanVolume(seaLevelM) =
waterInventoryM − grounded-ice` — found by a **fixed-count bisection**
(`SEA_LEVEL_SOLVE_ITERATIONS`, deterministic, never a `while (!converged)`) over
the elevation range, and `landFraction` is recomputed as the emergent share of
cells at or above it. Grounded ice is classified against the previous step's
level (a one-step lag, like every other cross-system read). The **water-mass
invariant** — liquid ocean + grounded ice = the init inventory — holds to
bisection precision every step (tested over the golden seeds). Sea level also
falls over early deep time as ocean basins mature to abyssal depth (the same
conserved volume sits lower in a deeper container), then ice modulates it.

`carbon` (after seaLevel, #34): the **carbonate–silicate CO₂ thermostat** — the
deep-time negative feedback that regulates climate. Like `ice` it is a **slow
reservoir** with cross-step memory (`globals.co2`, ppm), integrated with `dt`;
unlike the fast diagnostics it carries state. The balance is `d(co2)/dt =
outgassing − weathering`:

- **Outgassing** (source) is volcanic degassing tied to tectonic activity — the
  mean `|boundaryStress|` over *active boundary cells* (ridges and arcs both
  degas, so convergence and divergence count alike; averaging over boundary
  cells, not all cells, makes it grid-independent, since the boundary share
  falls ∝ 1/N). It scales a reference rate by that activity, clamped to
  [`CO2_OUTGAS_ACTIVITY_FACTOR_MIN`, `MAX`]. The **floor is > 0** — a quiet world
  still leaks mantle CO₂ — which is what guarantees snowball recovery.
- **Weathering** (sink) is silicate weathering: a reference rate ×
  `(co2/CO2_REFERENCE_PPM)^CO2_WEATHER_CO2_EXPONENT` (the direct pCO₂ dependence)
  × a **weathering potential** — the cell-count mean over *exposed land*
  (`elevation ≥ seaLevelM`) of `(1 − iceFraction)·tempFactor(T)·precipFactor(precip)`.
  So it rises with surface temperature (activation-energy kinetics), runoff and
  the continental area Phase-1 tectonics builds, needs liquid water (ice-sealed
  land contributes nothing), and vanishes on a frozen planet.

Warm ⇒ high weathering ⇒ CO₂ drawn down ⇒ cooling: a **negative feedback**,
because temperature itself rises with CO₂ through the #30 greenhouse. Its fixed
point is where weathering = outgassing, and the reference rates are calibrated so
the default planet settles at a few hundred ppm with Earth-like temperatures. The
**snowball failure mode is a feature**: a cold perturbation (a fainter star, or a
low `initialCo2Ppm`) tips the #33 ice-albedo runaway into a snowball; the ice
seals the land, weathering shuts off, and unopposed outgassing accumulates CO₂
until the greenhouse deglaciates it and the thermostat draws CO₂ back down — the
classic carbonate–silicate recovery (an invariant test triggers a snowball with a
transient faint star and pins the recovery; the CO₂ build-up is load-bearing).
Integration is explicit forward-Euler, **rate-limited** to
`CO2_MAX_CHANGE_FRAC_PER_MYR` of the current CO₂ per Myr and clamped to
[`CO2_MIN_PPM`, `CO2_MAX_PPM`]: the fractional cap prevents the explicit-lag
overshoot that would set the feedback oscillating (the phase's named risk), and
the 4.5 Gyr invariant pins CO₂ far inside its clamps with no divergence. Pure and
dt-correct: a function of `boundaryStress`, `temperature`, `precipitation`,
`iceFraction`, `elevation`, `seaLevelM` and the current `co2` only — and because
`carbon` runs **last**, all of those are *this* step's freshly-solved values (it
reads no lagged input, unlike erosion/energyBalance which read the previous
`seaLevelM`). `carbon` writes only `globals.co2` (no per-cell field); the
one-step lag is on its **output** — the next step's energy balance reads this
`co2` as the greenhouse forcing (the same lag `ice`/`seaLevel` feed the energy
balance through).

**Timescale split & lag (§0/§3).** Temperature is a *fast* quasi-static
diagnostic — every step re-solves it from the current boundary conditions, it
carries no memory. The *slow* reservoirs and the dynamic sea level it reads (ice
albedo, `seaLevelM` land mask, CO₂ greenhouse) are consumed at the top of the
step as their end-of-previous-step values; the #33/#34 systems that update them
run later in the pipeline, closing the feedback with a one-step explicit lag
rather than a per-step joint solve (erosion likewise reads the previous
`seaLevelM` as its base level, and the energy balance the previous `co2`). The
step order is `tectonics → wilson → erosion → energyBalance → winds → moisture →
ice → seaLevel → carbon → marineLife → oxygen → biome` (the #37 biosphere block —
`marineLife`/`oxygen` — inserts after `carbon`; see "Ocean life & oxygenation"
below). `biome` (#35) runs **last** of all — a fast
diagnostic classifying the fully-solved temperature/precipitation over the
dynamic sea-level mask into the categorical `biome` field the renderer colours
by; nothing downstream reads it, so it never perturbs another field (its golden
diff is purely the `biome` entry going from all-zero to classified).
`createInitialState` runs energy balance, then winds, moisture, then biome once
(after terrain/plates) so the t=0 keyframe already carries a physical
temperature, prevailing-wind, precipitation and biome field; the slow `ice`,
derived `seaLevel` and slow `carbon` reservoir are deliberately **not** run at
init (they carry memory and start at their seeds — `iceFraction` 0, `seaLevelM`
0, `co2 = initialCo2Ppm` — advancing from step 1), so the t=0 keyframe's
slow-reservoir field bytes are identical to the pre-#33/#34 kernel.

### Ocean life & oxygenation (#37, Phase 4)

The biosphere block inserts two systems between `carbon` and `biome`, so the full
step order becomes `… → carbon → marineLife → oxygen → biome`. Life reads this
step's fully-solved climate and dynamic land mask; in this milestone it feeds back
into **no** physical field (the albedo/weathering coupling arrives with vegetation,
#39), so with the biosphere enabled every pre-existing field is byte-identical and
the only new field bytes are `marineLife`. Both systems are identity when
`params.biosphereEnabled` is false (the ablation switch, default true), and neither
is run at init.

- **`marineLife`** (fast diagnostic) does two things. First, **abiogenesis**: while
  `abiogenesisYear < 0`, a per-step Bernoulli trial with probability
  `(1 − exp(−abiogenesisRatePerYear·dt)) × oceanHabitableFraction` decides whether
  life originates; on success it sets `abiogenesisYear` and emits `abiogenesis`.
  The draw is `hash2(seed', quantizedTime)` — deterministic, seed-dependent, and
  **independent of `ctx.rng`** (a fork inside a pure system would restart its
  stream every step; and the biosphere must consume no sim PRNG so a
  `biosphereEnabled=false` ablation is byte-identical), exactly the construction the
  #18 rift decision uses. Second, once life exists, it fills the per-ocean-cell
  productivity `light × temperatureWindow × shelf-nutrient` (0 on land), reusing the
  #30 annual-mean insolation band profile for `light`.
- **`oxygen`** (slow reservoir) integrates `globals.oxygen` with `dt`:
  `grossSource = OXY_SOURCE · meanProductivity · BURIAL_FRACTION` minus a
  volcanic-reductant sink (∝ tectonic activity) and an oxidative sink (∝ O₂), with a
  **reductant buffer** (`globals.oxygenReductant`) that net-positive flux must
  oxidize before O₂ can accumulate. The buffer is the physical origin of the
  **anoxic latency**: O₂ stays pinned near zero after abiogenesis until the buffer
  is spent, then rises over a few hundred Myr to a bounded plateau
  (`net_source / OXY_OX_SINK`) — the Great-Oxidation S-curve. Its timing/shape vary
  with the seed's climate and tectonic history, so the **Great Oxidation is
  emergent, not scripted**: `greatOxidation` fires on the first crossing of
  `GOE_THRESHOLD_PAL` (a threshold ~200× below the plateau, crossed once). The
  **redox budget closes** (spec §5): `solveOxygen` returns every flux, and for its
  solution `oxygen == clamp(prev + grossSource − volcanicSink − reductantAbsorbed −
  oxidativeSink, 0, OXYGEN_MAX_PAL)` and `reductant == prevReductant −
  reductantAbsorbed` — every PAL of atmospheric O₂ ties to organic carbon buried
  minus the sinks. The reservoir is dt-correct (rates are per Myr, integrated with
  `dt`), so a coarser `stepYears` rescales the increment, not the trajectory.

Measured over the golden seeds (N=32, 4.5 Gyr): abiogenesis at 4–551 Myr and the
Great Oxidation at 159–652 Myr — reliably completing on every seed yet
seed-dependent, with an anoxic latency between the two — rising to a bounded
~2 PAL plateau. (The absolute plateau is grid-sensitive, ~1.5 PAL at N=16 to
~2.2 PAL at N=32/128, so tests key off relative thresholds; M0 caution 1.)

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
                wilson: { contactSince, stallSince, shorteningIntegral } }  // stallSince/shorteningIntegral: #112, emergentSuture only
PlanetParams = { seed, radiusMeters, gridN, stepYears, keyframeIntervalYears,
                 numPlates,
                 starLuminosity, dayLengthHours, obliquityDeg,
                 initialCo2Ppm,
                 // mechanism toggles (#84/#88-#91 + datum re-keys + freeboard +
                 //   Tectonics V2 #111/#112):
                 //   blockIsostasy, crustFates, compactArcs, marinePlanation,
                 //   emergentArcTaper, seaLevelDatums, freeboard,
                 //   bathymetryDatum, forceKinematics, emergentSuture + *OnsetYears
                 // biosphere (#37): biosphereEnabled (default true — the ablation
                 //   switch), abiogenesisRatePerYear, initialOxygenPAL
                 // planet knobs: initialLandFraction (#106, default 0.3 — t=0
                 //   coastline: the sea quantile), waterInventoryScale (#105,
                 //   default 1.0 — dimensionless multiplier on the derived water
                 //   inventory). They compose as base(landFraction) × scale.
                 // diagnostics: plateCensus (#110, default false — the Tectonics
                 //   V2 stage-0 force-balance census; not a mechanism, no onset)
               }   // immutable per run
Globals     = { landFraction, co2, meanTemperatureK, seaLevelM, waterInventoryM,
                oxygen, oxygenReductant, abiogenesisYear,
                // Plate-census diagnostics (#110), written each step by
                // plateCensusSystem ONLY when params.plateCensus (else 0):
                //   plateSpeed{Median,Min,Max}MPerYr, oceanicContinentalSpeedRatio,
                //   speedContinentalityCorr, poleStability. Diagnostic-only —
                //   never read back, never cross the codec, NOT in the golden
                //   field hashes, so toggling the census is byte-identical.
                plateSpeedMedianMPerYr, plateSpeedMinMPerYr, plateSpeedMaxMPerYr,
                oceanicContinentalSpeedRatio, speedContinentalityCorr,
                poleStability,
                // #67 boundary-churn proxy: cumulative margin-consolidation
                // pair-flips, accumulated by the tectonics pass under
                // params.plateCensus (0 otherwise):
                marginConsolidationFlipsTotal }
```

The **plate census** (Tectonics V2 stage 0, #110) is a pure, RNG-free
`plateCensusSystem` that runs LAST in the pipeline and is exact identity unless
`params.plateCensus` is set. When on it reads the current plate table +
`plateId`/`crustType` and writes the six `Globals` scalars above (per-plate
characteristic speed |ω|·R distribution, the Forsyth & Uyeda ocean/continent
speed ratio and speed–continentality correlation, and Euler-pole stability — the
count-mean cosine between a plate's current pole and the previous census step's,
recorded on the diagnostic-only `PlateRecord.prevEulerPole`, exactly 1.0 on the
immutable-pole baseline). The field-derivable half of the census (seafloor age
over oceanic crust + age–area histogram, plateness = top-decile boundary-stress
share) lives in sim-cli's `--plate-census` report. The one census scalar the
kernel accumulates OUTSIDE `plateCensusSystem` is `marginConsolidationFlipsTotal`
— the tectonics consolidation pass adds its per-step #67 pair-flip count (a
boundary-churn proxy) to it, but only under `params.plateCensus`, so the default
path is untouched; the report differences it into a flips-per-100-Myr churn rate.
Diagnostics route through `globals` because keyframes carry
`fields`/`globals`/`events` only — never plate records.

`starLuminosity` (insolation) and `obliquityDeg` (annual-mean insolation
profile) are activated by the #30 energy balance; `dayLengthHours` is activated
by the #31 wind bands. `initialCo2Ppm` seeds `globals.co2`, the slow
carbonate–silicate reservoir the `carbon` system (#34) integrates each step from
tectonic outgassing minus silicate weathering (the deep-time thermostat); the
energy balance reads it as the greenhouse forcing and maintains
`globals.meanTemperatureK` (#30).
`globals.seaLevelM` (dynamic sea level) and `globals.waterInventoryM` (the
conserved total-water global-equivalent layer thickness) are the #33 sea-level
state: the inventory is calibrated once at init from the initial ocean volume at
the 0 m datum (so t=0 sea level is exactly 0 and the `initialLandFraction` land
share is preserved), then held constant while `seaLevel` re-solves `seaLevelM`
each step.
The `initialLandFraction` parameter (#106, default 0.3) sets that t=0 coastline:
`applyInitialTerrain` places its sea quantile at `1 − initialLandFraction`, so a
planet can start ocean-dominated (low fraction) or land-dominated (high). It must
stay strictly below `CONTINENTAL_CRUST_FRACTION` (0.4): the gap between the two is
the initial submerged continental shelf (25% of continental crust flooded at the
default 0.3 — the Earth-like #101/#102 construction), and continental crust is
pinned at the Cogley 40% while the land fraction varies, so the initial flooded
share moves with it (less land ⇒ more shelf; 75% flooded at 0.1, 2.5% at 0.39).
At land fraction ≥ crust fraction every continental cell is emergent, oceanic
highs snap down in the plates pass, and the shelf starves — the CLI validates
`0 < f < 0.4`; the kernel trusts the value like `numPlates`. The default is the
`0.3` literal, so a default planet's t=0 fields are byte-identical to the pre-#106
kernel.
The `waterInventoryScale` parameter (#105, default 1.0) multiplies that derived
base, making the planet's water endowment a chosen property rather than an
artifact of the terrain noise. The base is still derived (so the two init knobs
compose — land fraction shapes the world, water scale sets the endowment relative
to it — and it also adapts to grid resolution, all as base × scale); the
default 1.0 multiplies by exactly 1.0, so the inventory — and every field — is
byte-identical to the pre-#105 kernel (`--water-scale` validates > 0 at the CLI
boundary). Scale > 1 raises the deep-time sea and
can flood the ocean-ridge crests natively (making the #102 `bathymetryDatum`
crest cap redundant on high-water worlds); scale < 1 gives a low-water planet.
The measurement campaign — the early-flooding "waterworld" regime, the
scale/seed sweep, and the endowment at which the ridge chains retire without the
crest cap — is in `docs/SEA_LEVEL_DATUM_FINDINGS.md`.
`globals.landFraction` is now emergent from `seaLevelM` (finalized by the
`seaLevel` system — cells with `elevation ≥ seaLevelM`); at t=0, with `seaLevelM
= 0`, it equals the 0 m-datum land share as before.
`globals.oxygen` (atmospheric O₂, PAL), `globals.oxygenReductant` (the
reduced-species buffer, PAL) and `globals.abiogenesisYear` (onset time or −1) are
the #37 biosphere reservoirs, integrated by the `oxygen`/`marineLife` systems (see
"Ocean life & oxygenation" below). Like the other slow reservoirs they are seeded
at init (`oxygen = initialOxygenPAL`, `oxygenReductant = REDUCTANT_BUFFER_PAL`,
`abiogenesisYear = −1`) and NOT advanced there, so they first depart their seed at
step 1; being well-mixed globals (like `co2`) they cost no per-keyframe codec
bytes and ride in `Keyframe.globals` for the HUD/narration to read.

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
percentile ⇒ ~30% land; the energy balance sets the initial temperature
afterwards).

`run(params, untilYears, onKeyframe)` steps `params.stepYears` (default 1 Myr)
at a time and emits keyframes. Keyframe emission counts integer steps
(`stepsPerKeyframe = round(interval / step)`) so it never depends on float
accumulation.

## Event log (Phase 1, #17)

```
SimEvent = { timeYears, kind: SimEventKind, data?: Record<string, number> }
```

Discrete events — plate rifts/sutures/consumptions, the `plateSlotPressure`
heads-up (the never-reclaimed plate-slot table first crossed
`PLATE_SLOT_WARN_COUNT`, a warning well before the codec's `plateId < 256`
ceiling, #127 item 7), and the #37 biosphere events `abiogenesis` (life
originates, sets `abiogenesisYear`) and `greatOxidation` (`oxygen` first crosses
the oxidation threshold, the emergent Great Oxidation) — are recorded in
simulation order on `PlanetState.events`. Event kinds are a const
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
             globals: Globals, events: SimEvent[] }
```

Deep snapshot — arrays and events are copies (and `globals` a shallow copy of
the scalar whole-planet quantities, so a consumer like the CLI `--report` or a
HUD can read `co2` / `meanTemperatureK` / `seaLevelM` without re-deriving),
safe to transfer to other threads (the web app transfers the field buffers
worker → main). The codec reads `.fields` only, so `globals` never touches the
stored/rendered path. One keyframe is emitted for the initial
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
| temperature | Uint8 | 180 … 330 K | ~0.59 K |
| plateId | Uint8 | 0 … 255 exact | exact (asserts < 256) |
| crustType | Uint8 | {0,1} exact | exact |
| precipitation | Uint8 | 0 … 8000 kg/m²/yr | ~31 kg/m²/yr |
| iceFraction | Uint8 | 0 … 1 | ~1/255 |
| biome | Uint8 | 0 … 255 exact | exact (asserts < 256) |
| marineLife | Uint8 | 0 … 1 | ~1/255 |

Continuous fields use a linear float↔uint map (out-of-range clamps to the ends);
**categorical fields (`plateId`, `crustType`, `biome`) use an identity map and
round-trip bit-exact — they must never be interpolated** (the GPU path
holds/nearest-picks them). As of #35 the Phase 3 climate viz fields join the
stored set — the single §1 stored-field-set growth (`HISTORY_FORMAT_VERSION`
1→2), adding `precipitation` (#32), `iceFraction` (#33), `biome` (#35) and
`windU`/`windV` (#31) together, with `temperature`'s max widened 320→330 K for
hot-CO₂ states — because the renderer now needs them: `biome` drives the colour
ramp, `iceFraction` whitens it, and the winds/precipitation ride along for Phase 5
and `--dump`. New fields are **appended** so their on-wire `fieldId` (the
`FIELD_NAMES` index) is stable and the header stays self-describing. As of #37
(HISTORY_FORMAT_VERSION 2→3) `marineLife` joins the stored set (the ocean life
story, render-tinted in #38) and — to hold the ~0.5 GB retained-history budget —
`windU`/`windV` **drop back out** (unused at render, stored since #35 only for
Phase 5 cloud advection; the sim still computes them and `--dump windU` reads them
off the full keyframe). Net −1 stored field (12→11 B/cell), so the headline 4.5 Gyr
@ 10 Myr @ N=128 history fits with room to spare. Only `boundaryStress`
(derivable), the crust-advected `sutureYears`/`sedimentM`, and now `windU`/`windV`
(recompute-at-render) stay out. Earlier Phase 3 bumps (#32/#33/#34) regenerated the sim
goldens but left the stored set untouched, so their byte goldens shifted only
because stored elevation/temperature values changed; #35 is the first to change
the stored-field set and layout itself (new byte goldens over the grown
container). Note `EncodedKeyframe.landFraction` (a decode-free UI convenience)
is still recomputed against the 0 m datum, so it lags `globals.landFraction` (now
emergent from `seaLevelM`); the rendered shoreline instead follows sea level
through `biome`'s ocean class, which is masked at `elevation < seaLevelM`.
Two versions gate reuse: `HISTORY_FORMAT_VERSION` (codec byte
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
sizes the retained history against `MAX_RETAINED_HISTORY_BYTES` (1 GB) using
`encodedKeyframeBytes(gridN)` — the exact byte size of one encoded keyframe,
derived from the same layout `encodeKeyframe` writes. If the request fits it is
passed through unchanged (`clamped: false`); if not, the interval is coarsened by
an integer factor (never below the requested one, so cadence stays a multiple of
the ask) until the whole span fits — the tail of history is never dropped, only
sampled more sparsely, and the app flags the coarser step. At N=128, 4.5 Gyr @
10 Myr is 451 keyframes of 9 stored fields (11 B/cell) ≈ 0.454 GB, well inside
the 1 GB ceiling. The ceiling was 0.5 GB through Phase 3 (which the headline
history filled to ~91%); it was raised to 1 GB so the stored field set can grow
(Phase 4's `vegetation`, #39) and the cadence can tighten without coarsening. It
is a device-memory safety cap, not an implementation limit — nothing is sized to
it — and the GPU texture budget (≤ 64 MB) is separate.

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
`sunDirection`); each samples its own field `DataTexture`s in a TSL node
material: radial vertex displacement
`position · (1 + elevation / radiusMeters · exaggeration)`, a colour ramp, and
Lambert-ish lighting from the sun uniform. The colour ramp was hypsometric
(blues below datum, green→brown→white above) through Phase 2; as of #35 it is
**biome-driven** (see "Biome colour ramp" below), with only the ocean keeping a
depth-shaded blue from elevation.

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

- **Continuous** (`elevation`, `iceFraction`): `mix(A, B, blend)`, filtered
  **linearly** — continents *morph* rather than pop, and because the (N+2)² seam
  border is blended with the *same* uniform (borders live in the same textures) no
  cracks open mid-blend. `elevation` drives the radial vertex displacement and the
  ocean depth tint; `iceFraction` (#33) whitens the surface toward ice so caps
  breathe smoothly across a boundary.
- **Categorical** (`plateId`, `crustType`, `biome`): picked hold/nearest with
  `blend < 0.5 ? A : B`, filtered **nearest**, and **never lerped** — a lerp
  between plate ids 3 and 7 (or biome classes 2 and 6, or crust types 0 and 1) is
  meaningless. Categorical borders take the neighbor code (not a mean) and
  categorical corners the own corner cell, so codes stay valid. `biome` (#35)
  drives the base colour; `plateId` drives a subtle per-plate tint gated by the
  `plateTint` uniform (0 = pure biome colour); `crustType` (0 = oceanic, 1 =
  continental) colours the plate-debug view. The codec's bit-exact categorical
  round-trip (#22) is what makes this crispness possible.

A **plate-debug toggle** (web app checkbox → `plateDebug` uniform, 0/1) swaps the
biome surface for a **tectonic map**: the surface is coloured by `crustType` (cool
teal-blue oceanic vs warm tan continental) and the **plate boundaries** are drawn
over it as dark lines. Boundaries are derived on the GPU from the same nearest
`plateId` sample — a fragment is on a boundary iff a ±1-texel 4-neighbour sample
carries a different id, exactly the kernel's boundary definition ("Boundary
classification" above); the (N+2) seam border already holds the cross-face
neighbour ids, so boundary lines stay continuous across cube seams. The overlay
costs a single uniform flip (no re-upload); radial displacement and Lambert
shading are kept, so the map reads on the 3D globe.

### Biome colour ramp (Phase 3, #35)

The from-orbit base colour comes from the categorical `biome` field, not raw
height: the nearest-picked class indexes a fixed Whittaker palette
(`material.ts`'s `BIOME_COLORS`, mirrored 0–255 in `sim-cli`'s
`BIOME_DUMP_COLORS`) — tundra, taiga, grassland, temperate forest, desert,
savanna, tropical forest — so land reads by ecosystem. The **ocean class** (`0`,
masked at `elevation < seaLevelM` in the kernel) is instead depth-shaded from
elevation, keeping the bathymetric gradient; because that mask moves with the
dynamic sea level, the rendered shoreline follows `seaLevelM` for free without
the render payload carrying the scalar. `iceFraction` then whitens the result
(land caps and sea ice alike), and the `plateTint`/`plateDebug` path is unchanged
— it now tints/​overlays the biome colour rather than the hypsometric one. The
`biome` and `iceFraction` textures ride the same `HISTORY_FORMAT_VERSION` 1→2
stored-set growth (codec §), decoded and uploaded by the existing keyframe path
with no new plumbing.

Residency ping-pongs between the two sets (`residency.ts`, `KeyframeBlender`): a
fractional scrub inside one bracket only moves the `blend` uniform (no upload, so
the scrub stays tactile), and crossing a keyframe boundary re-uploads **only the
one set that changed** — keeping the still-needed keyframe resident and flipping
the blend interpretation (`f` vs `1 − f`) rather than re-uploading both. One
upload per boundary crossing, either scrub direction. Prefetch into a third set
is intentionally omitted: with only two sets the incoming keyframe would evict a
still-displayed one, and Spike B (see `docs/spikes/PHASE_2_SPIKES.md`) showed the
single-set swap is cheap enough that the playhead never waits on it.
