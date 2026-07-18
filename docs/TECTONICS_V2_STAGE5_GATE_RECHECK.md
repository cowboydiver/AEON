# Tectonics V2 — Stage 5 pre-promotion gate re-check (#115)

Before flipping `forceKinematics` + `emergentSuture` + `tensionRift` to default-on
and regenerating the main golden spine, the #115 gating (and standing-authorization
§2) require re-verifying **every #111–#114 gate at the promotion defaults** — i.e.
the *full three-flag stack*, not each mechanism in isolation. This document records
that re-check.

- **Promotion config:** `--force-kinematics --emergent-suture --tension-rift`,
  `riftSutureCooldownYears = 120e6` (the owner-fixed stage-5 config, #109 decision
  2026-07-18).
- **Grid:** seed 42 @ N=128 (authoritative) + N=64; seeds 1 & 1337 @ N=64. 4.5 Gyr each.
- **Harness:** one combined `--plate-census --metrics --suture-analysis` run per
  cell. No NaN/Inf; all runs exited 0. Census statistics are means past 1 Gyr over
  351 keyframes (the same window stage 1 used).

## Scoreboard (promotion config)

| metric (gate) | s42 N=128 | s42 N=64 | s1 N=64 | s1337 N=64 | verdict |
|---|---|---|---|---|---|
| census speed median cm/yr (2–6) | **6.10** | **6.14** | **6.27** | **6.01** | ✗ marginal overshoot |
| speed–slab-attach corr (≥ +0.3) | **0.070** | **0.086** | **0.042** | **0.019** | ✗ HARD FAIL |
| pole stability, mean cos (< 1.0 ⇒ migrate) | 0.986 | 0.991 | 0.986 | 0.986 | ✓ |
| seafloor age median Myr (< 200) | 56 | 49 | 48 | 43 | ✓ |
| land min % (≥ 10) | 22.3 | 24.6 | 27.1 | 26.9 | ✓ |
| dispersal min Gyr-bucket (≥ 0.7) | 0.91 | 0.75 | 0.64* | 0.94 | ✓ (*owner-accepted) |
| >85% monopoly window Myr (< 400) | 0 | 0 | 0 | 0 | ✓ |
| re-suture min interval Myr (> 100) | 140 | 140 | 141 | 140 | ✓ |
| rift-convergence @ +50 Myr (≈0 intended) | 0.069 | 0.119 | 0.129 | 0.127 | not ≈0 — cooldown load-bearing (per #114) |
| boundary churn (pair-flips /100 Myr) | 8876 | 2110 | 2186 | 2304 | context |

\* seed-1's 0.64 dispersal bucket at cd=120 is the property the owner explicitly
accepted as owned by stage 5 (#109 decision §2), not a regression.

### Stage-1 solo-config reference (from `TECTONICS_V2_STAGE1_CENSUS.md`)
Measured with **forceKinematics alone** (stages 2/3 not yet built):

| metric | s42 N=128 | s42 N=64 | s1 N=64 | s1337 N=64 |
|---|---|---|---|---|
| speed median cm/yr | 4.55 | 4.67 | 4.89 | 4.54 |
| slab-attach corr | 0.499 | 0.393 | 0.304 | 0.477 |

## The two misses

Every world-shape gate (land, dispersal, monopoly, poles, seafloor age, re-suture)
passes at the promotion config on every seed and both grids. **Two #111 *census*
gates do not hold once all three flags are on:**

1. **speed–slab-attachment correlation collapses** from the stage-1 solo band
   (0.30–0.50) to **0.02–0.09** — a ~5–15× shortfall against the ≥ +0.3 gate, on
   every seed, worst at N=128 (0.499 → 0.070). This is the Forsyth & Uyeda signal
   the owner installed to replace the degenerate oc/cont ratio gate — the redesign's
   headline "slab-attached plates move faster" claim.
2. **census speed median runs hot:** 6.0–6.3 cm/yr vs the 2–6 band and the stage-1
   solo 4.5–4.9. Marginal (≈ at the ceiling for three of four cells, 4.5% over for
   seed 1), not a blowout.

### Root cause (physically coherent, not a bug)
Adding `tensionRift` + `emergentSuture` to `forceKinematics` makes the world
**far more tectonically active**: continuous tension-driven rifting mints young,
fast, slab-light oceanic plates, and stall-suturing churns the plate population.
Boundary churn rises to 2100–2300 /100 Myr at N=64 and **8876 at N=128** (vs the
quieter solo-forceKinematics world). Two consequences:

- The **median speed** rides higher because the ocean floor is younger on average
  (more ridges), so more plates sit in the fast slab-pull regime.
- The **slab-pull correlation washes out**: per-keyframe `slab` correlation swings
  hard both signs (e.g. N=128 tail: +0.53, +0.74, −0.36, −0.29 in adjacent frames);
  averaged over 351 deep-time keyframes it lands near zero. The signal is **real but
  transient** — the stage-1 doc already noted it is strongest at plate birth
  (t=10–60 Myr, corr −0.44..−0.75 for the sister continentality metric) and
  "washes to ≈0 deep-time." The extra churn from the full stack amplifies that wash.

The physics the gate intends (slab-attached plates faster) is present at plate
birth; it is not *statistically legible as a deep-time mean* in the busier
promotion world.

## Disposition: HALT stage 5 pending owner decision (do NOT auto-promote)

Standing-authorization §2 pre-authorizes stage-5 promotion **iff every #111–#114
gate is green at promotion defaults**, and instructs: "If any condition fails, do
NOT promote — post the miss on #115 and halt that stage instead." Two #111 gates
are not green at the promotion config.

The owner's 2026-07-18 stage-5 decision pre-accepted *specific* promotion-config
properties (land min 22.3%, seed-1 0.64 dispersal bucket) but **did not address the
slab-correlation collapse or the speed-median overshoot** — those were invisible in
the stage-4 grid, which measured via `--suture-analysis`, not `--plate-census`. So
this miss is not covered by any existing issue, the proposal, or the #109
authorization. Per the executor's hard rule, an uncovered decision is escalated, not
guessed.

**No defaults were flipped, no goldens regenerated, `main` untouched.** The
stage-5 branch carries only this measurement doc.

### Options put to the owner (see #115)
- **A — Accept & promote.** Treat both misses as owned, honestly-documented stage-5
  baseline properties (like land-min/dispersal), record them in the §3 Earth
  scoreboard as misses, and proceed. Rationale: the collapse is a consequence of a
  *healthier, more active* tectonic world; the transient Forsyth-Uyeda signal is
  intact; every world-shape gate passes.
- **B — Re-scope the slab-corr gate** to a solo-`forceKinematics` re-verification
  (still 0.30–0.50), reading it as "the mechanism works in isolation" rather than
  "the shipped deep-time mean shows it," then promote.
- **C — Investigate/mitigate** with the one permitted companion retune (e.g. a small
  basal-drag increase to pull median speed back under 6). Risk: perturbs the
  promotion config off the stage-3-end state; unlikely to fix the churn-driven
  correlation wash.
- **D — Halt the program at stage 4** as the terminal deliverable (no default flip).

Executor recommendation: **A or B.** The misses are real and must be reported
honestly, but they reflect a more active, more Earth-like tectonic engine rather
than a defect, and they do not touch the shipped world's habitability shape.
