# PHASE_1_SPEC.md — Phase 1: Tectonics

**Objective:** believable continents emerging, drifting, colliding, and rifting
over billions of years. N rigid plates partition the cube-sphere; Euler-pole
rotation advects crust; divergent boundaries create young ocean floor that
subsides with age, convergent boundaries subduct the denser side and build
mountains; Wilson cycles rift and suture plates so a 2 Gyr scrub tells a story;
erosion gives mountains a lifespan and pushes hypsometry toward the real-world
bimodal shape.

**This phase is the risk concentrator for the whole project.** If continents
look like soup, every later phase inherits blandness. The named technical risk
is crust advection on a discrete sphere grid (gaps/overlaps at plate
boundaries); it is bought down with spike work *before* any kernel
integration, judged with the PNG harness, by eye.

Read `CLAUDE.md` first (hard rules apply unchanged) and `docs/ARCHITECTURE.md`
(the Phase 0 contract this phase extends). Work is tracked as GitHub issues
#9–#21 under the [Phase 1 milestone](https://github.com/cowboydiver/AEON/milestone/1)
(overview issue #3); each issue carries its full motivation, approach sketch,
and acceptance criteria — this spec is the milestone-level map, the issues are
the ground truth for per-task detail.

**Status: awaiting human sign-off. No Phase 1 implementation before sign-off**
(HANDOVER §4.5). Spike prototypes are part of the signed-off plan, not
pre-approved exceptions — they too start only after sign-off.

---

## Contract changes (what this phase adds to ARCHITECTURE.md)

New per-cell fields in `sim-kernel/src/fields.ts` (all `Float32Array`, hard
rule #3; each addition regenerates goldens deliberately):

| Field            | Unit     | Range               | Meaning                                                        | Lands in |
| ---------------- | -------- | ------------------- | -------------------------------------------------------------- | -------- |
| `plateId`        | index    | 0 … numPlates−1     | Owning plate (small integers stored in float; convention documented) | #12 |
| `boundaryStress` | m/yr     | signed, ~±0.1       | Normal closing speed at boundary cells: + convergent, − divergent, ≈0 with high shear = transform; exactly 0 in plate interiors | #14 |

Existing fields that stop being placeholders:

| Field           | Phase 0        | Phase 1                                                            | Lands in |
| --------------- | -------------- | ------------------------------------------------------------------ | -------- |
| `crustAge`      | all zeros      | 0 at ridges, increments dt/step, drives age–depth bathymetry and subduction polarity | #15 |
| `precipitation` | all zeros      | latitude-band proxy (wet equator, dry ~30°, wetter mid-latitudes, dry poles) feeding erosion; **replaced** by Phase 3 moisture transport | #19 |
| `elevation`     | static noise   | advected with plates; ridge/trench/orogeny/erosion shape it        | #13–#19 |

New state and params:

- **Plate table** on `PlanetState` (plain data, fixed order by plate index —
  never object-key iteration): `{ eulerPoleUnitVec, angularVelRadPerYr,
  isOceanic/baseDensity, createdAtYears }` per plate. (#12)
- **`PlanetParams.numPlates`** (default set by the #9 spike; likely 8–12) plus
  tectonic rate constants in `constants.ts`, each with a source comment. (#12)
- **Event log**: `SimEvent = { timeYears, kind, data? }`, appended in
  simulation order, deterministic, emitted without breaking system purity
  (mechanism decided in #17 and documented). First producers: `plateRift`,
  `plateSuture` (#18). This is the structure Phase 2 timeline markers and
  Phase 4 narration build on. (#17)

Every field/state/param addition updates `docs/ARCHITECTURE.md` in the same
commit (hard rule #4 / CLAUDE.md conventions).

---

## Milestone 1 — Spikes & eyes (issues #9, #10, #11)

Buy down the phase risk before touching the kernel. Nothing from this
milestone lands in `sim-kernel/src` except what #11 adds to `sim-cli`.

- **#9 Plate seeding spike (S):** Voronoi-style multi-source flood fill over
  the real `grid.ts` adjacency (`neighbors`, `rng.fork` — no parallel grid
  math). Try numPlates ∈ {6, 8, 12, 20} × seeds {1, 42, 1337}; judge
  contiguity, size variety, seam/corner behavior by PNG.
- **#10 Crust advection shootout (L) — the risk concentrator.** At least two
  candidates prototyped side by side on the real grid: semi-Lagrangian gather
  (rotate cell center backward, look up source via `directionToIndex`) vs
  scatter + repair (rotate forward, deterministically resolve multi-claimed
  and unclaimed cells). Sub-cell motion accumulation is mandatory design
  input: at 1 Myr steps plate motion is ≪ one cell width, so accumulate
  per-plate rotation and advect only on whole-cell crossings (or fractionally)
  — quantized/integer accumulation preferred over float accumulation.
  Evaluate: coverage invariant, boundary crispness after 500 steps, run-to-run
  determinism, cost per step at N = 128.
- **#11 PNG harness upgrades (S):** categorical palette for `plateId`
  (deterministic golden-angle hues), sequential ramp for `crustAge`, diverging
  palette for `boundaryStress`, `--dump-every <n>` numbered PNG series
  (flipbooks), optional boundary overlay. CLI-only; no golden changes.

**Accept when:** flipbook PNG series and a metrics table for both advection
candidates are attached to #10, with a **written recommendation** (may be a
hybrid) and the losers' failure modes documented; #9 has PNGs for ≥ 3 seeds ×
2 plate counts with contiguous plates, full coverage, no seam artifacts, plus
a written seeding recommendation and default numPlates; `--dump plateId` of a
prototype partition is readable at a glance. **The #10 recommendation is a
hard gate: no kernel integration (Milestone 3+) before it is written.**

---

## Milestone 2 — Plates in the state (issues #12, #17)

Structure without motion, so the unavoidable golden regeneration is small and
reviewable.

- **#12 Plate data model (S):** `plateId` field, plate table, `numPlates`
  param; seeding via `rng.fork('plates')` + the #9 flood fill inside
  `createInitialState`. Phase 0 noise terrain is kept; plates are an overlay
  until #15/#16 make elevation follow them (stated explicitly in
  ARCHITECTURE.md).
- **#17 Kernel event log (S):** the `SimEvent` structure, exposure through
  `run()` and the CLI report, determinism asserted with a synthetic producer.
  Structure alone must not perturb field bytes (no golden change from #17).

**Accept when:** every cell has a valid plateId in `[0, numPlates)`, every
plate owns ≥ 1 cell, partitions are identical across runs of the same seed;
goldens regenerated deliberately for the new hashed field (commit message says
why); event lists are bit-stable for seeds {1, 42, 1337} and survive the
report path.

---

## Milestone 3 — Motion (issue #13)

- **#13 Plate kinematics + crust advection (M):** the #10 winner lands as a
  pure system `(state, dt, ctx) => state` in the step pipeline. Angular
  velocities in the few-cm/yr range (constants sourced), assigned from
  `rng.fork('plateKinematics')`. Gaps/overlaps produced by motion are
  *marked* and provisionally resolved (young-ocean fill for gaps,
  deterministic tie-break for overlaps); real boundary physics is Milestone 4.
  The chosen scheme (gather vs scatter, accumulation rule) is documented in
  ARCHITECTURE.md.

**Accept when:** after every step every cell has exactly one owner; plate
interiors transport crust rigidly (marked interior cell survives 100 steps
within tolerance; per-plate cell counts change only at boundaries); a plate
with a known Euler pole moves its centroid in the predicted direction; a
seed-42 `--dump plateId --dump-every 50` flipbook over 500 Myr shows rigid
drift with boundaries staying 1–2 cells crisp — inspected by eye; goldens
regenerated deliberately; kernel suite < 30 s.

---

## Milestone 4 — Boundary physics (issues #14, #15, #16)

Strictly ordered: classification → divergent → convergent.

- **#14 Boundary classification + stress (M):** boundary cell iff any
  4-neighbor has a different plateId; relative velocity (ω × r) projected on
  the local boundary normal → signed `boundaryStress`. Transform boundaries
  are classified and visualized; their topographic effect is deliberately
  minimal in Phase 1. Boundary *type* is derived from stress + a tangential
  threshold rather than stored as another field.
- **#15 Divergent boundaries (M):** gap cells become young ocean crust
  (`crustAge = 0`, deterministic ownership); `crustAge` ticks everywhere;
  oceanic elevation follows half-space cooling, ridge crest ≈ −2500 m
  deepening as k·√age toward ≈ −6000 m. Continental crust keeps advected
  elevation; the oceanic/continental distinction convention is decided here
  and documented.
- **#16 Convergent boundaries (L):** subduction polarity by density (oceanic
  under continental; older oceanic under younger; continent–continent = no
  subduction, symmetric thickening). Consumed crust is ownership transfer,
  never a hole. Trench on the subducting side; orogeny on the overriding side
  spread a few cells inland, scaled by `boundaryStress`, capped ~9 km
  pre-erosion. Fixed plate speeds during collision are an accepted Phase 1
  simplification, documented.

**Accept when:** hand-built two-plate tests classify head-on/opposite/
tangential motion as convergent/divergent/transform with interior stress
exactly zero; crustAge is minimal at ridges and increases monotonically along
a transect away from them; oceanic depth tracks the age–depth curve within
tolerance; converging plates raise boundary elevation monotonically over 50
steps (the CLAUDE.md directional invariant) and an ocean–continent transect
shows trench offshore of a rising coastal range; crust-coverage invariant
holds throughout; goldens regenerated deliberately per issue; seed-42 dumps
show ridge stripes in `crustAge` (~300 Myr) and mountain belts tracking
convergent boundaries in `elevation` vs `boundaryStress` (≥ 500 Myr) —
inspected by eye.

---

## Milestone 5 — Deep time (issues #18, #19)

- **#18 Wilson cycles (L):** suturing merges continent–continent pairs after
  sustained collision (deterministic rule, combined Euler pole); rifting
  splits large old continental plates along a deterministic flood-fill path
  (reusing #9 machinery) with diverging new poles, driven by
  `rng.fork('wilson')` + deterministic state measures. Plate count stays
  within `[minPlates, maxPlates]`. Emits `plateRift`/`plateSuture` events.
  Optional slow pole wander, documented if used.
- **#19 Erosion (M):** latitude-band precipitation proxy fills
  `precipitation` (real units, sourced constants); erosion as
  precipitation-and-slope-scaled diffusion of elevation over the 4-neighbor
  graph, land-only or damped below sea level, at ~real denudation rates
  (mm/kyr). **Conservative diffusion is the chosen Phase 1 form** (total land
  volume conserved within float tolerance); an explicit ocean sediment sink is
  out unless conservation proves visually wrong, in which case the sink is
  documented and budget-tested. Applied after tectonic uplift in pipeline
  order.

**Accept when:** plate count stays in bounds and the partition remains a full
cover across every rift/suture in a 2 Gyr run; the seed-42 event log contains
≥ 2 rifts and ≥ 1 suture at run-to-run-stable times; a `plateId` flipbook
shows at least one visible assembly → breakup sequence — inspected by eye;
with uplift disabled erosion conserves land volume and max elevation decays
monotonically; a wet-latitude test peak erodes faster than an identical dry
one; old belts visibly soften in the flipbook while active boundaries stay
sharp; goldens regenerated deliberately (`precipitation` joins the exercised
set).

---

## Milestone 6 — Acceptance (issues #20, #21)

- **#20 Phase-level invariant suite (S):** crust coverage exact after every
  step (per-plate solid angles sum to 4π); hypsometric bimodality (two
  persistent modes — abyssal and continental platform — via a robust
  two-local-maxima criterion) for seeds {1, 42, 1337}; 2 Gyr small-N stability
  run (no NaN/∞, elevation within ≈ −11 km … +9 km, land fraction 10–60%);
  suite-runtime guard. Each invariant verified to *fail* against a
  deliberately broken system once, during development.
- **#21 Acceptance pass + report (M):** run seed 42 to 2 Gyr, dump
  `elevation,plateId,crustAge,boundaryStress` flipbooks, and actually look at
  every frame; spot-check seeds 1 and 1337. Tune defaults only via
  `constants.ts`/params with reasons. Final deliberate golden regeneration if
  tuning changed behavior. Write `PHASE_1_REPORT.md` (what was built,
  deviations, surprises, implications for Phase 2 — especially keyframe
  sizes/memory with non-trivial fields, and event-log behavior). If the
  result looks like soup: reality wins — file fix-up issues and hold the
  phase open; do not bend the report to the spec.

**Accept when:** flipbook evidence on #21 shows ≥ 1 full assembly → breakup
cycle for seed 42 over 2 Gyr; all #20 invariants green; kernel suite < 30 s;
`pnpm lint` and `pnpm typecheck` clean; `PHASE_1_REPORT.md` committed;
milestone closes with #3.

---

## Ordering and dependency graph

```
#9 ──▶ #12 ──▶ #13 ──▶ #14 ──▶ #15 ──▶ #16 ──▶ #18 ──▶ #20 ──▶ #21
#10 ─────────▶ #13                        └───▶ #19 ──▶ #20
#11 (any time; needed by #9/#10 flipbooks in practice — do it first)
#17 (any time; needed by #18)
```

Spikes complete before kernel integration; the #10 written recommendation is
the gate into Milestone 3. #11 and #17 are unordered but #11 effectively
leads, since every later eyeball-check uses it.

## Determinism & goldens policy for this phase

- All new randomness flows through named forks (`rng.fork('plates')`,
  `'plateKinematics'`, `'wilson'`) so streams are independent of draw counts
  elsewhere. Position-dependent jitter uses `hash2`/`hash3`.
- Issues expected to regenerate goldens: #12, #13, #14, #15, #16, #18, #19,
  and possibly #21 (tuning). Each regeneration is its own deliberate act with
  the physical/algorithmic reason in the commit message — never batched
  blindly, never to silence a test (CLAUDE.md hard rule).
- Grid math (`grid.ts`) is expected to be **untouched** this phase. If a
  boundary scheme genuinely needs a grid change, that is a breaking change:
  update ARCHITECTURE.md, regenerate deliberately, and say so loudly.
- No `Math.random`/`Date.now`/`performance.now` (ESLint-enforced), no
  object-key iteration order anywhere in kernel data paths (plate table and
  event kinds are index-ordered arrays / const objects by construction).
- Long-run tests protect the < 30 s kernel budget by using small grid N;
  goldens stay at standard N. If a 2 Gyr test cannot fit the budget it moves
  behind a slower tag — decided and documented in #20.

## Verification workflow (unchanged, restated)

Every kernel change: `pnpm -F sim-kernel test`, then a sim-cli run with
`--report` and at least one `--dump`, and **look at the PNGs**. Numbers
passing while continents look like static noise is a failure. Flipbooks are
the phase's primary acceptance instrument.

## Out of scope for Phase 1 (do not build yet)

Timeline scrubbing, field quantization, IndexedDB caching, GPU keyframe
blending (Phase 2); real moisture transport, energy balance, ice, sea-level
change (Phase 3 — the latitude precipitation proxy is a stopgap and says so);
biosphere (Phase 4); any renderer work beyond what already exists — Phase 1
is judged in the CLI PNG harness, not the browser. Renderer visualization of
plates/age is Phase 2+ material. Transform-boundary topography beyond a
minimal stress contribution. Plate-speed feedback from collisions (documented
simplification).

## Definition of done (mirrors overview issue #3)

- Seed 42 over 2 Gyr shows recognizable continental cycles in dumped PNGs —
  inspected by eye, evidence linked on #21.
- Invariants hold: crust covers the sphere every step; hypsometry is
  bimodal; long runs are stable.
- Goldens updated deliberately, with reasons in commit messages.
- Kernel test suite still < 30 s; lint and typecheck clean.
- ARCHITECTURE.md describes every new field, state member, and system.
- `PHASE_1_REPORT.md` written; Phase 2 re-planned from its findings.

## Decisions folded into this spec (flag at sign-off if you disagree)

1. **Boundary type is derived, not stored** — one `boundaryStress` field, type
   from sign + tangential threshold (#14).
2. **Erosion is conservative diffusion** — no ocean sediment sink in Phase 1
   unless the flipbook proves it necessary (#19).
3. **Transforms are visual-only** this phase — minimal topographic effect (#14).
4. **Plate speeds ignore collision feedback** — continent–continent collisions
   don't slow plates in Phase 1; documented simplification (#16).
5. **Phase 0 noise terrain stays as initial elevation** — plates overlay it at
   t = 0; boundary physics reshapes it from there (#12).
6. **Renderer untouched** — Phase 1 acceptance is entirely CLI/PNG-based.
7. **Default numPlates and the advection scheme are spike outputs**, not
   spec-time choices (#9, #10).
