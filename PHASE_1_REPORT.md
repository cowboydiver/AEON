# Phase 1 Report — Tectonics

Phase 1 is complete against the bar in `docs/PHASE_1_SPEC.md` and overview
issue #3: seed 42 over 2 Gyr shows recognizable continental cycles in the
dumped flipbooks (evidence: `docs/phase1-evidence/`, regenerable via
`pnpm sim -- --seed 42 --until 2e9 --report --dump
elevation,plateId,crustAge,boundaryStress --dump-every 10 --out tmp/phase1`);
all #20 invariants are green for seeds {1, 42, 1337}; goldens were
regenerated deliberately per issue; the kernel suite is 99 tests in ~7 s.

## What was built

One commit per issue, in dependency order (#9–#21):

- **Spikes** (`packages/sim-cli/spikes/`, findings in
  `docs/spikes/PHASE_1_SPIKES.md`): plate seeding = rejection-sampled sites +
  jittered Dijkstra flood fill (36/36 runs contiguous, deterministic, no seam
  artifacts); crust advection shootout won by **semi-Lagrangian gather** —
  scatter+repair was disqualified for interior hole-striping (rigid rotation
  is not cell-bijective on the tangent-warped grid).
- **PNG harness** (#11): categorical/sequential/diverging palettes keyed by
  field, `--dump-every` flipbook series; byte-identical across reruns.
- **Plate data model** (#12): `plateId` + `crustType` fields, fixed-order
  plate table with Euler-pole kinematics (1–5 cm/yr), `numPlates` (default
  10). Continental crust = top 40% of initial elevation (shelves submerged).
- **Event log** (#17): `SimEvent` on state, immutable append, deep-copied
  into keyframes, printed by `--report`. Structure alone perturbs no field
  bytes (tested).
- **Kinematics + advection** (#13): gather advection behind per-plate
  accumulated rotation applied in dithered quanta (1–2.5 cell widths).
- **Boundary physics** (#14–#16): signed `boundaryStress` from relative
  rigid velocities (interiors exactly 0); crustAge ticking + half-space
  cooling bathymetry (ridge −2500 m → abyssal −6000 m) with the t=0 ocean
  given a depth-consistent age; density-rule subduction (continental beats
  oceanic, younger oceanic beats older), trenches to −8500 m, accumulating
  island arcs, orogeny 3–4 cells inland capped at 9 km, symmetric collision.
- **Wilson cycles** (#18): suturing after 15 Myr of sustained cont-cont
  contact; rifting of old/large/continent-carrying plates by two-seed
  jittered Dijkstra with diverging poles; both emit events; live count in
  [4, 16].
- **Erosion + climate proxy** (#19): conservative slope-and-precipitation-
  scaled diffusion on continental crust with base-level damping; static
  latitude-band precipitation; per-step temperature refresh.
- **Invariant suite** (#20): crust-coverage-every-step (per-plate solid
  angles sum to 4π), hypsometric bimodality at checkpoints ×3 seeds, 2 Gyr
  coarse-grid stability (finite, −11…+9 km, land 10–60%, plates in bounds),
  plus mutation tests proving each detector catches a planted bug.

Acceptance numbers (2 Gyr, after the post-review fixes below): seed 42
(N=128) — 18 events (6 rifts, 12 sutures), land 30% → stable 21.8%; seed 1
(N=64) — land stable ~20%; seed 1337 (N=64) — land stable ~11%. All finite,
all in bounds, elevation max pinned at the 9 km cap only at active margins.

## Deviations from the spec, and why

- **`crustType` is an explicit field**, not derived (spec left the
  convention to #15). Deriving continental identity from age or elevation is
  unstable under advection; one flag field is honest and cheap. It joined the
  schema in #12 with `plateId`.
- **The advection quantum is dithered** (1–2.5 cell widths, hashed per
  plate/event) — not in the spike recommendation. Found by the #13
  blob-transport test: with a fixed quantum, crust rotating slower than the
  quantum (near the Euler pole) hits identical sub-cell rounding every event
  and **stalls** (6-cell lag over 500 Myr; ≤1 cell with dither). Spike
  findings amended in place.
- **Wilson's rift draw is `hash3(seed', plate, timeQuantum)`**, not
  `rng.fork('wilson')`: a fork taken inside a pure system restarts its
  stream every step, so the fork sketch cannot work as written; the hash is
  the deterministic equivalent. Pole wander (optional in the issue) was not
  implemented.
- **Arc maturation** (not in any issue): volcanic arcs that build above
  −200 m become continental crust. Added when the #20 stability invariant
  caught seed 1337 sinking below 10% land — collisions consume continental
  area and nothing created it. Arc magmatism is the physically-correct
  creation term.
- **Rift eligibility measures continental area against the sphere** (≥5%),
  not against the plate. The plate-relative fraction (first attempt, per the
  issue's "continental plates" phrasing) silently disabled rifting: post-
  suture mega-plates carry proportional ocean and never qualified — seed 42
  produced one rift in 2 Gyr and a static world.
- **Tuning at acceptance** (#21, all in `constants.ts` with reasons):
  suture wait 25 → 15 Myr, arc growth 2e-4 → 4e-4 m/yr, rift probability
  0.004 → 0.006/Myr, MIN_PLATES 6 → 4. Driver: the land budget. A suture
  *blocked* at the plate-count floor is a collision that grinds continent
  forever, so the floor must be low; faster suturing and arc creation close
  the budget. Seed 1337 was the stress case (6.5% land before tuning, ~11%
  stable after).
- **Two commits share the #14 title** (`354af6f`, `ad591bb`): a typecheck
  failure was masked by piping through `tail`, so the first commit landed
  before the fix. History is messy there but both states are green.

## Surprises / findings for later phases

- **Every balance problem was an area-budget problem.** Elevation invariants
  held from day one; what drifted was *land fraction* — first coastal
  erosion submerging shorelines (fixed by base-level damping), then
  collisions consuming continent (fixed by suturing), then rifting silently
  off (fixed by the eligibility change), then blocked sutures at the plate
  floor (fixed by MIN_PLATES=4). The #20 stability invariant caught all of
  them; land fraction is the single most diagnostic number this simulation
  has. Phase 3 (sea level!) should treat it as a first-class conserved-ish
  quantity.
- **Margin shredding artifact** (filed as a follow-up issue): in zones of
  slow oscillating convergence, quantized advection alternately opens
  young-ocean lines and re-mature arcs, producing parallel continental/ocean
  stripes ("herringbone"), most visible at high latitude where the
  equirectangular projection stretches them. Localized — not soup — but a
  candidate for smoothing in Phase 2's visual pass.
- **The land trend is stable at 2 Gyr but Phase 2 runs 4.5 Gyr.** Seeds 42/1
  are flat well before 2 Gyr; seed 1337 stabilizes lower (~11%). Re-verify
  the budget at 4.5 Gyr before building the timeline UX around it.
- **Keyframe memory for Phase 2** (its named risk): 9 fields × 98,304 cells
  × 4 B = 3.5 MB/keyframe raw; a 4.5 Gyr history at 10 Myr intervals is 451
  keyframes ≈ **1.6 GB raw** — quantization (#22) is not optional. Only 4
  fields matter visually so far (elevation, plateId, crustAge, temperature);
  precipitation is analytic; iceFraction/biome still zero; boundaryStress is
  derivable. A pruned + Uint16 set is ~0.35 GB, before compression.
- **Event log behavior**: ~20 events per 2 Gyr — sparse enough to render
  every marker in the Phase 2 timeline without clustering logic.
- **Runtime**: 2 Gyr at N=128 ≈ 4 min single-threaded (~120 ms/step, advection
  dominated). Fine for CLI acceptance; Phase 2's worker streaming should
  budget ~10 min for 4.5 Gyr or profile the claims loop (obvious headroom:
  restrict claim tests to a boundary band).
- **The early history is front-loaded**: initial random kinematics produce a
  burst of collisions and 4–6 sutures in the first ~30 Myr before the system
  settles into slow Wilson cycling. Acceptable (reads as late accretion),
  but Phase 4's narrated history may want the first 100 Myr to be its own
  "chaotic era" beat.

## Post-review amendments (PR #55)

Review on the PR surfaced six actionable findings, all fixed in one
follow-up commit: boundary stress û now uses only the dominant plate's
neighbors so triple junctions can't flip the convergent/divergent sign (the
one physics change — goldens regenerated, acceptance re-run, evidence
refreshed); wilson recomputes `boundaryStress` after any suture/rift so
keyframes never pair a post-merge partition with pre-merge stress; rift
eligibility on suture steps now sees the merged plate's true size; a
zero-cross guard skips degenerate antipodal rift splits instead of emitting
a NaN pole; the rift flood-fill references `PLATE_FILL_JITTER` instead of a
hardcoded 1.5; and the rift draw quantum is `min(10 kyr, stepYears)`
(named constant), decorrelating draws for sub-10-kyr steps. A seventh
finding (dead plate-table slots never reclaimed) was declined with
measurements: ~6 rifts per 2 Gyr means tens of records per 4.5 Gyr, and
compaction would break the plateId-stability contract that Phase 2's
keyframe scrubbing relies on.

## Verification

`pnpm test` (99 kernel tests, ~7 s), `pnpm lint`, `pnpm typecheck` all
green. Golden hashes regenerated deliberately at #12, #13, #14, #15, #16,
#19 and the #21 tuning, each with the physical reason in the commit
message; #17, #18, #20 changed no field bytes. Flipbooks inspected by eye
at every milestone; acceptance evidence committed under
`docs/phase1-evidence/`.
