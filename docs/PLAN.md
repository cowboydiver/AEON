# PLAN.md — Roadmap, milestones, and issue index

Planning output of HANDOVER.md §4, executed 2026-07-02. The work is tracked as
GitHub issues on `cowboydiver/AEON`; this file mirrors that structure and is the
single source of truth for the roadmap shape. Keep it updated when phases are
re-planned.

**Tracker conventions.** Each phase is a native GitHub milestone
([milestones 1–6](https://github.com/cowboydiver/AEON/milestones)) containing
all of its issues. Each phase also has an **overview issue** (#3–#8) carrying
the phase's goal, risk, done-criteria, sign-off gate, and a task list; closing
it closes out the milestone. Ordering is encoded as **native blocked-by
dependencies**: the full dependency graph within Phase 1, coarse ordering
within Phases 2–6, and the fixed phase order chained across the overview
issues (#4 blocked by #3, … #8 blocked by #7). Every issue additionally
carries a `phase-N` label. Milestones and dependencies are applied by
`.github/workflows/tracker-sync.yml` (idempotent, manually dispatched) —
edit its tables and re-run it whenever the plan is restructured.

**Standing labels:** `spike`, `kernel`, `renderer`, `ui`, `infra`, `goldens`
(any issue expected to change golden hashes), plus `phase-1` … `phase-6`. Each
label's meaning is documented in [`LABELS.md`](LABELS.md); the descriptions
themselves are reconciled onto GitHub by `tracker-sync.yml`.

**Phase gate (HANDOVER §4.5).** Before implementation of each phase begins:
write `docs/PHASE_N_SPEC.md` (milestones + acceptance criteria, in the spirit
of `SCAFFOLD_SPEC.md`), present the plan, and pause for human sign-off. Every
phase ends with `PHASE_N_REPORT.md` (what was built, deviations, surprises,
implications for the next phase).

**Planning philosophy.** Phase 1 is broken into full, ready-to-work issues.
Phases 2–6 are deliberate placeholders (a title and a paragraph) — enough to
see the shape, cheap to revise. Each phase is re-planned when its turn comes,
informed by the previous phase's report. Reality over plans.

---

## Phase 1 — Tectonics · [milestone](https://github.com/cowboydiver/AEON/milestone/1) · overview [#3](https://github.com/cowboydiver/AEON/issues/3)

**Status: COMPLETE** — spec `docs/PHASE_1_SPEC.md` (signed off), outcome and
deviations in `PHASE_1_REPORT.md`, spike findings in
`docs/spikes/PHASE_1_SPIKES.md`, acceptance flipbook evidence in
`docs/phase1-evidence/`. Phase 2 must be re-planned from the report's
findings (keyframe memory estimate, 4.5 Gyr land-budget re-verification,
margin-shredding follow-up).

The risk concentrator for the whole project. Spikes came first; nothing
integrated into the kernel until the crust-advection shootout had a written
winner. Issues (each has motivation, approach sketch, files touched,
acceptance criteria, and size on the issue itself):

| # | Issue | Labels | Size |
|---|-------|--------|------|
| [#9](https://github.com/cowboydiver/AEON/issues/9) | Spike: plate seeding & Voronoi flood-fill partition | spike, kernel | S |
| [#10](https://github.com/cowboydiver/AEON/issues/10) | Spike: crust advection candidate shootout (gaps/overlaps) | spike, kernel | L |
| [#11](https://github.com/cowboydiver/AEON/issues/11) | PNG harness upgrades: plateId palette, boundary overlay, series dump | infra | S |
| [#12](https://github.com/cowboydiver/AEON/issues/12) | Plate data model: plateId field, plate table, params | kernel, goldens | S |
| [#13](https://github.com/cowboydiver/AEON/issues/13) | Plate kinematics: Euler poles + crust advection system | kernel, goldens | M |
| [#14](https://github.com/cowboydiver/AEON/issues/14) | Boundary classification: div/conv/transform + stress field | kernel, goldens | M |
| [#15](https://github.com/cowboydiver/AEON/issues/15) | Divergent boundaries: spreading, crust age, ridge bathymetry | kernel, goldens | M |
| [#16](https://github.com/cowboydiver/AEON/issues/16) | Convergent boundaries: subduction + mountain building | kernel, goldens | L |
| [#17](https://github.com/cowboydiver/AEON/issues/17) | Kernel event log: discrete events alongside keyframes | kernel | S |
| [#18](https://github.com/cowboydiver/AEON/issues/18) | Wilson cycles: periodic plate reorganization | kernel, goldens | L |
| [#19](https://github.com/cowboydiver/AEON/issues/19) | Erosion: precipitation-weighted diffusion + latitude proxy | kernel, goldens | M |
| [#20](https://github.com/cowboydiver/AEON/issues/20) | Phase 1 invariant suite: coverage, bimodality, stability | kernel | S |
| [#21](https://github.com/cowboydiver/AEON/issues/21) | Phase 1 acceptance: 2 Gyr flipbook, goldens, PHASE_1_REPORT.md | kernel, infra, goldens | M |

Dependency sketch: #9 → #12; #10 → #13; #11 and #17 anytime; #13 → #14 → #15 →
#16 → {#18, #19} → #20 → #21. #18 also needs #17.

## Phase 2 — Timeline scrubbing · [milestone](https://github.com/cowboydiver/AEON/milestone/2) · overview [#4](https://github.com/cowboydiver/AEON/issues/4)

**Status: implemented and accepted** — spec `docs/PHASE_2_SPEC.md`, Stage 0
de-risking measurements in `docs/PHASE_2_STAGE0_FINDINGS.md` (evidence under
`docs/phase2-evidence/stage0/`), acceptance report **`PHASE_2_REPORT.md`**
(#29; e2e evidence `apps/web/e2e/phase2-acceptance.spec.ts`, artifacts under
`apps/web/e2e/artifacts/`). The §0 go/no-go resolved as **choice A**: the #57
rift fix landed first, then the #59/#61 deep-time dispersal pass, then the
timeline stack #22–#27. **#28 (adaptive keyframe density) skipped per the
spec's default** — #27's numbers show fixed 10 Myr intervals fit the 0.5 GB
budget with headroom at N=128 (decision recorded in the report). **#60**
shipped as recording-only suture memory (`sutureYears`) with a measured
negative result on every carve-weighting variant — see the note below and
`PHASE_2_STAGE0_FINDINGS.md` "#60".

Issues (each gets full motivation, approach, files, acceptance, and size on the
issue itself in the Stage 1 tracker sync — deferred until the §0 decision fixes
the dependency graph):

| # | Issue | Labels | Size |
|---|-------|--------|------|
| Spike A | Quantization fidelity round-trip (PNG harness) | spike, infra | S |
| Spike B | Blend-path frame rate on the Xvfb e2e path | spike, renderer | M |
| [#22](https://github.com/cowboydiver/AEON/issues/22) | Field quantization codec (`codec.ts`, versioned container) | kernel, goldens | M |
| [#23](https://github.com/cowboydiver/AEON/issues/23) | Worker protocol: progressive full-history streaming | ui, infra | M |
| [#24](https://github.com/cowboydiver/AEON/issues/24) | IndexedDB keyframe cache + version invalidation | ui, infra | M |
| [#25](https://github.com/cowboydiver/AEON/issues/25) | GPU keyframe blending: fieldsB + blend uniform | renderer | L |
| [#26](https://github.com/cowboydiver/AEON/issues/26) | Timeline UI: scrubber with event markers | ui | M |
| [#27](https://github.com/cowboydiver/AEON/issues/27) | Memory budget: measure and enforce (the named risk) | infra | S |
| [#28](https://github.com/cowboydiver/AEON/issues/28) | Adaptive keyframe density (stretch — skip by default) | ui, infra | S |
| [#29](https://github.com/cowboydiver/AEON/issues/29) | Phase 2 acceptance + PHASE_2_REPORT.md | ui, infra | M |

New issues to file at sign-off (labels depend on the §0 choice):
**#54 pt 2** land-budget-4.5Gyr (measured, this doc) ·
**#57** rift antipodal-pole fix (kernel, goldens; Phase 2 prerequisite under
choice A) · **#58** deep-time land balance for the 1337 canary (kernel, goldens;
optional follow-up) ·
[**#60**](https://github.com/cowboydiver/AEON/issues/60) craton stiffness /
suture-line memory (kernel, goldens; **filed** 2026-07-04 — deep-time continents
should keep coherent shapes; the residual left by the PR #59 dispersal pass;
also scoped to absorb the foundering connected-component threshold from the
PR #59 review; **resolved** 2026-07-06 as recording-only: the advected
`sutureYears` weld record shipped with `KERNEL_BEHAVIOR_VERSION` 4→5 and all
pre-existing field bytes bit-identical, while seven measured carve-weighting
variants each degraded continental coherence (largest continental component
0.11 → 0.04–0.08 of continental area) and/or the #59/#61 dispersal metrics
(0.72–0.74 → as low as 0.51) — the raggedness driver is the per-boundary
process layer, not carve geometry; variant table and follow-up direction in
`PHASE_2_STAGE0_FINDINGS.md` "#60") ·
[**#61**](https://github.com/cowboydiver/AEON/issues/61) continuous
size-dependent rift rate to replace the oversize-plate brake (kernel, goldens;
**filed** 2026-07-04 from the PR #59 review — same monopoly-breaking pressure
without the 55%-area cliff or the MIN_PLATES coupling; **implemented**
2026-07-05 as a single `riftSizeRamp` in `wilson.ts` — probability capped at the
old 8× brake, maturity gate = `RIFT_MIN_AGE_YEARS / ramp`. The 10-step goldens
are byte-identical, so `KERNEL_BEHAVIOR_VERSION` bumped 3→4 only for deep-time
cache invalidation. Measured against a re-run #59 baseline: beats the
dispersed-window fraction at N=64 for all three golden seeds (72–74% vs 66–72%)
and matches or beats at 5 of 6 seed×grid points, the exception being seed 1337
at N=128 (80.3% → ~72%). The deep-time dispersal metric is chaotically sensitive
to any sub-0.55 rifting — inherent to removing the discontinuity — so #59 is not
reproduced number-for-number; the world stays fully dispersed everywhere
(≥ ~63% dispersed keyframes, every Gyr bucket alive, monopoly windows ≤ ~100 Myr,
land in [12%, 33%]). The #20 invariant (monopoly < 400 Myr, land [10%, 60%] at
N=16) passes).

Dependency sketch: [#57] → #22; Spike A → #22; Spike B → #25;
#22 → {#23, #24, #25, #27}; #23 → #26; #25 → #26; #24 needs #22, #23;
#27 refines after #25/#26; #28 gated on #27 (default skip);
{#23, #24, #25, #26, #27} → #29.

## Phase 3 — Climate, hydrology, biomes · [milestone](https://github.com/cowboydiver/AEON/milestone/3) · overview [#5](https://github.com/cowboydiver/AEON/issues/5)

Placeholders:
[#30](https://github.com/cowboydiver/AEON/issues/30) zonal energy-balance model ·
[#31](https://github.com/cowboydiver/AEON/issues/31) wind bands from rotation ·
[#32](https://github.com/cowboydiver/AEON/issues/32) moisture transport / orographic rain shadows ·
[#33](https://github.com/cowboydiver/AEON/issues/33) sea level + ice sheets ·
[#34](https://github.com/cowboydiver/AEON/issues/34) carbonate–silicate CO₂ feedback / snowballs ·
[#35](https://github.com/cowboydiver/AEON/issues/35) Whittaker biomes + color ramp ·
[#36](https://github.com/cowboydiver/AEON/issues/36) acceptance + PHASE_3_REPORT.md

## Phase 4 — Biosphere & planetary story · [milestone](https://github.com/cowboydiver/AEON/milestone/4) · overview [#6](https://github.com/cowboydiver/AEON/issues/6)

Placeholders:
[#37](https://github.com/cowboydiver/AEON/issues/37) ocean life → oxygenation ·
[#38](https://github.com/cowboydiver/AEON/issues/38) atmosphere composition → appearance ·
[#39](https://github.com/cowboydiver/AEON/issues/39) land colonization + vegetation feedback ·
[#40](https://github.com/cowboydiver/AEON/issues/40) narrated history / timeline annotations ·
[#41](https://github.com/cowboydiver/AEON/issues/41) acceptance + PHASE_4_REPORT.md

## Phase 5 — Presentation polish · [milestone](https://github.com/cowboydiver/AEON/milestone/5) · overview [#7](https://github.com/cowboydiver/AEON/issues/7)

Placeholders (visual direction comes from Claude Design deliverables; taste-bound
decisions go to the human):
[#42](https://github.com/cowboydiver/AEON/issues/42) atmospheric scattering rim ·
[#43](https://github.com/cowboydiver/AEON/issues/43) cloud layer ·
[#44](https://github.com/cowboydiver/AEON/issues/44) specular ocean + night side ·
[#45](https://github.com/cowboydiver/AEON/issues/45) moon, rings, star color ·
[#46](https://github.com/cowboydiver/AEON/issues/46) HUD + camera to design deliverables ·
[#47](https://github.com/cowboydiver/AEON/issues/47) acceptance + PHASE_5_REPORT.md ·
[#83](https://github.com/cowboydiver/AEON/issues/83) on-globe climate debug views (`?view=temperature|precipitation|wind`, raised in #36; draft in `docs/phase5-backlog/on-globe-climate-debug-views.md`)

## Phase 6 — Surface exploration · [milestone](https://github.com/cowboydiver/AEON/milestone/6) · overview [#8](https://github.com/cowboydiver/AEON/issues/8)

Coarsest placeholders by design; the phase is its own multi-milestone arc and
does not start until Phases 1–5 are stable. Its first task is planning itself
([#48](https://github.com/cowboydiver/AEON/issues/48)):
[#49](https://github.com/cowboydiver/AEON/issues/49) quadtree LOD spike ·
[#50](https://github.com/cowboydiver/AEON/issues/50) floating origin + log depth ·
[#51](https://github.com/cowboydiver/AEON/issues/51) procedural amplification from sim data ·
[#52](https://github.com/cowboydiver/AEON/issues/52) biome ground materials + epoch sky
