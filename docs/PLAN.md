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
(any issue expected to change golden hashes), plus `phase-1` … `phase-6`.

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

The risk concentrator for the whole project. Spikes come first; nothing
integrates into the kernel until the crust-advection shootout has a written
winner. Ready-to-work issues (each has motivation, approach sketch, files
touched, acceptance criteria, and size on the issue itself):

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

Placeholders, to be re-planned after PHASE_1_REPORT.md:
[#22](https://github.com/cowboydiver/AEON/issues/22) field quantization codec ·
[#23](https://github.com/cowboydiver/AEON/issues/23) progressive worker streaming ·
[#24](https://github.com/cowboydiver/AEON/issues/24) IndexedDB keyframe cache ·
[#25](https://github.com/cowboydiver/AEON/issues/25) GPU blending (fieldsB + blend uniform) ·
[#26](https://github.com/cowboydiver/AEON/issues/26) timeline UI with event markers ·
[#27](https://github.com/cowboydiver/AEON/issues/27) memory budget (the named risk) ·
[#28](https://github.com/cowboydiver/AEON/issues/28) adaptive keyframe density (stretch) ·
[#29](https://github.com/cowboydiver/AEON/issues/29) acceptance + PHASE_2_REPORT.md

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
[#47](https://github.com/cowboydiver/AEON/issues/47) acceptance + PHASE_5_REPORT.md

## Phase 6 — Surface exploration · [milestone](https://github.com/cowboydiver/AEON/milestone/6) · overview [#8](https://github.com/cowboydiver/AEON/issues/8)

Coarsest placeholders by design; the phase is its own multi-milestone arc and
does not start until Phases 1–5 are stable. Its first task is planning itself
([#48](https://github.com/cowboydiver/AEON/issues/48)):
[#49](https://github.com/cowboydiver/AEON/issues/49) quadtree LOD spike ·
[#50](https://github.com/cowboydiver/AEON/issues/50) floating origin + log depth ·
[#51](https://github.com/cowboydiver/AEON/issues/51) procedural amplification from sim data ·
[#52](https://github.com/cowboydiver/AEON/issues/52) biome ground materials + epoch sky
