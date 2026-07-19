# Tectonics V2 — independent review findings (branch `tectonics-v2` vs `main`)

An independent review of `tectonics-v2` at `c637284` against `main` at `e8cb857`,
performed 2026-07-19. Everything below was re-measured from scratch in this
review's own runs (seed-42 4.5 Gyr N=64 head-to-head on both branches, seven
mechanism-toggle experiments, seeds 1/1337 robustness runs for the recommended
config) plus a line-by-line code review of `plateDynamics.ts` and `wilson.ts`.
Final-frame evidence PNGs are in `tectonics-v2-review-evidence/`.

**Verdict: merge.** The branch is a genuine upgrade with honest measurement
docs — every stage-5 census number re-measured here reproduced digit-for-digit
(speed median 6.14, slab-corr 0.086, seafloor median 49 Myr, land min 24.6 % at
seed 42 N=64). The defects found are semantic/hygiene, not showstoppers, and
are listed below as follow-up material.

## 1. Head-to-head: what V2 fixes and what it costs

Seed 42, 4.5 Gyr, N=64, branch defaults on both sides:

| metric | `main` | `tectonics-v2` | Earth |
|---|---|---|---|
| continental crust, fraction of sphere (past 1 Gyr) | 0.194 | **0.291** | ~0.29 |
| final land % | 15.8 | 31.5 | 29 |
| land min–max % over 4.5 Gyr | 15.8–31.1 | 24.6–33.1 | — |
| mean continental elevation @ 1.5/3.0/4.5 Gyr (m, vs 0 datum) | 5261/4010/3222 | 6463/6808/6415 | — |
| reorganizations / 100 Myr | 1.91 | 4.71 (see §4 tempo bug) | — |
| dispersal (% keyframes max plate < 0.6) | 92.2 | 89.1 | — |
| land components past 1 Gyr (largest, frac of land) | 216 (0.360) | 217 (0.412) | — |

- **`main` bleeds continental crust over deep time.** Land thins to 15.8 % with
  flattening continents, and the late-time frame shows the known emergent
  mid-ocean-ridge island chain crossing an ocean
  (`main-defaults-4500Myr.png`). V2 sustains an Earth-like crust inventory and
  does not show the ridge-chain artifact at 4.5 Gyr.
- **V2 defaults are alpine.** Mean continental elevation holds ~6.4–6.8 km vs
  the 0 m datum with peaks pinned at the 9 km `OROGENY_MAX_ELEVATION_M` cap
  (`v2-defaults-4500Myr.png`) — a consequence of ~2× the collision influx with
  unchanged erosion. §5's recommended config resolves this via `freeboard`.
- **The two documented stage-5 misses are real and correctly characterized**
  (speed median at ~6.1 cm/yr; speed–slab-attachment correlation 0.02–0.09
  full-stack vs 0.30–0.50 solo). Both reproduced exactly. The owner's option-B
  re-scope (#115) is a fair reading: the Forsyth–Uyeda signal is demonstrable
  in isolation and washes out of the deep-time mean in the busier world.
- **Engineering discipline held.** Zero PRNG draws in all three mechanisms,
  sorted-key iteration, fixed summation order, exact flag-off byte-identity
  pinned by a carried-over legacy golden spine, deliberate default-spine regen
  under `KERNEL_BEHAVIOR_VERSION` 17. Determinism cross-check: the same run in
  two separate worktrees reproduced final-frame metrics digit-for-digit.

## 2. Confirmed code findings (re-verified in code by this review)

1. **`tensionN` cannot distinguish tension from compression**
   (`plateDynamics.ts` ~431). `gross − |net|` accumulates *all* forces
   sign-blind, so opposed collision damping (the largest per-meter force in the
   balance) and opposed ridge push register as "being pulled apart." An
   actively colliding plate accrues rift hazard during its closing window —
   opposite to the stated physics in `constants.ts` / ARCHITECTURE. Bounded by
   the ×4 hazard cap and the shipped worlds measure fine, but the scalar does
   not measure what the docs say; the stage-5 rift calibration rests on it.
   Follow-up: either re-document as an opposed-load scalar or restrict the
   gross sum to pull-class forces and re-tune `RIFT_TENSION_REF_N`.
2. **The stall detector only sees net normal closing** (`wilson.ts` ~288).
   A shearing continental transform contact, or a mixed convergent/divergent
   contact whose signed segments cancel, reads net ≈ 0 and welds as "stalled"
   after 20 Myr — a merge class impossible on `main` (60 Myr of sustained
   convergence required). The 120 Myr cooldown, not the detector, is what
   prevents rift→re-suture flicker.
3. **Partial-flag worlds silently degenerate.** `tensionRift` without
   `forceKinematics` is a rift-dead planet (hazard exactly 0 forever);
   `emergentSuture` without `forceKinematics` makes real collisions grind
   150 Myr to the timeout. Documented in help text but unguarded — a UI toggle
   can produce a dead world with no warning. Follow-up: a params-level guard or
   loud event.
4. **`--report` tempo undercounts sutures** (`sim-cli/src/main.ts`
   `reportTempo`): filters `plateRift || plateSuture` only, dropping
   `sutureTimeout` merges (14 of 78 sutures in this review's seed-42 run).
   `--suture-analysis` and the census count them correctly.
5. **Stale post-promotion docs.** CLI help and `state.ts` param comments still
   say the three V2 flags are "default off"; `PlateRecord.stallSinceYears` is a
   dead field (stage 2 shipped pair-keyed stall state instead).
6. **No kernel-side guard before the codec's `plateId < 256` ceiling.** Slot
   growth is monotonic; measured peak 176 across seeds/grids (≥31 % headroom),
   so the codec assertion remains the only — loud — backstop.
7. **Suite runtime sensitivity.** The 4.5 Gyr phase-1 invariant test blows the
   default 30 s vitest timeout on slow hardware **on both branches** (verified
   here on `main` too — not a V2 regression), but V2's ~2× slower kernel widens
   the exposure and only the hypsometry test received an explicit 90 s timeout.
   Follow-up: give the 4.5 Gyr test an explicit timeout as well.

Reviewer observations not independently re-verified here (plausible, lower
stakes): no old-age saturation on √age slab pull (~4× the calibrated ceiling at
2 Gyr crust age); ~√2 boundary-force anisotropy on diagonal staircase margins;
~0.1 mm/yr damping overshoot past stall; triple-junction stress misattribution
in the shortening integral; stale `tensionN`/`omegaVec` on retired plates;
`omegaVec` is write-only redundant state.

## 3. Mechanism-toggle matrix (seed 42, 4.5 Gyr, N=64, on `tectonics-v2`)

"comps" = land components past 1 Gyr (largest, as fraction of land area);
lower comps + higher largest = more coherent, less confetti.

| config | dispersal | final land % | cont crust /sphere | comps (largest) | edge/area |
|---|---|---|---|---|---|
| `main` defaults (reference) | 92 % | 15.8 | 0.19 | 216 (0.36) | 0.81 |
| V2 defaults | 89 % | 31.5 | 0.29 | 217 (0.41) | 0.81 |
| **V2 + datum trio (recommended)** | **95 %** | **29.4** | 0.39 | **154 (0.41)** | **0.68** |
| V2 + compactArcs + emergentArcTaper | 21 % | 2.4 | 0.04 | 327 (0.21) | 1.27 |
| V2 + compactArcs only | 44 % | 9.5 | 0.09 | 566 (0.18) | 1.10 |
| V2 + emergentArcTaper only | 33 % | 4.1 | 0.06 | 386 (0.21) | 1.24 |
| solo forceKinematics + arc + datum stacks | 55 % | 6.1 | 0.10 | 312 (0.18) | 0.99 |

**The arc mechanisms (#89/#91) are incompatible with the V2 engine.** Each
alone starves continental crust to 5–9 % of the sphere; arc maturation is the
busy V2 world's dominant crust source and both flags choke it. `compactArcs`
produces the worst confetti of any measured config
(`antipattern-v2-compactarcs-4500Myr.png`: 596 final land fragments, largest
11 % of land). They were designed against `main`'s quieter engine and should be
marked incompatible with the promoted defaults rather than retuned.

## 4. Recommended config for an Earth-like, coherent-continent world

```
pnpm sim -- --seed <s> --until 4.5e9 --sea-level-datums --freeboard --bathymetry-datum
```

i.e. **V2 defaults (forceKinematics + emergentSuture + tensionRift + crustFates
+ marinePlanation) plus the sea-level datum trio; compactArcs,
emergentArcTaper, blockIsostasy off; `riftSutureCooldownYears` at the 120 Myr
default.** Robust across the golden seeds:

| seed | dispersal | land min–max (final) % | comps past 1 Gyr (largest) | edge/area | monopoly |
|---|---|---|---|---|---|
| 42 | 94.7 % | 11.2–33.6 (29.4) | 154 (0.41) | 0.68 | 0 Myr |
| 1 | 94.9 % | 13.2–32.7 (25.1) | 180 (0.38) | 0.71 | 0 Myr |
| 1337 | 97.1 % | 9.9–32.1 (31.5) | 152 (0.41) | 0.60 | 0 Myr |

Seed 1337 ends in a plausible Pangea (one mass holding 64 % of land); seed 1
ends dispersed. Final frame: `recommended-v2-datums-4500Myr.png`.

Do not ablate `forceKinematics` while leaving the other two flags on (finding
§2.3 — degenerate worlds).

## 5. Elevation lever: freeboard governs, erosion is subdominant

Mean continental elevation @ 1.5/3.0/4.5 Gyr (m vs 0 datum), seed 42 N=64:

| config | contElev | max elev |
|---|---|---|
| V2 defaults | 6463 / 6808 / 6415 | 8973 (pinned at cap) |
| recommended, stock erosion | 2865 / 2127 / 3202 | ~6700–7200 |
| recommended, 2× `EROSION_RATE_PER_YR` | 2989 / 3248 / 3192 | ~7000–7500 |

The V2-defaults alpine look is a no-`freeboard` artifact: the datum trio's
freeboard regulator halves the continental mean on its own and pulls peaks off
the 9 km cap. Doubling erosion under the recommended config changes essentially
nothing (shape metrics within noise; dispersal actually rose to 98.2 %) — a
safe knob, but not the binding one. If less high-standing terrain is wanted
beyond this, the binding knobs are on the influx side:
`OROGENY_RATE_M_PER_YR` and `OROGENY_MAX_ELEVATION_M` (freeboard sets the
continental mean; uplift-vs-cap sets how much orogen stands above it).

## 6. Evidence index

| file | config |
|---|---|
| `tectonics-v2-review-evidence/main-defaults-4500Myr.png` | `main` defaults — thin land, ridge-chain artifact |
| `tectonics-v2-review-evidence/v2-defaults-4500Myr.png` | V2 defaults — Earth-like land, alpine |
| `tectonics-v2-review-evidence/recommended-v2-datums-4500Myr.png` | recommended config |
| `tectonics-v2-review-evidence/antipattern-v2-compactarcs-4500Myr.png` | V2 + compactArcs — crust starvation |
| `tectonics-v2-review-evidence/recommended-2x-erosion-4500Myr.png` | recommended + 2× erosion — near-identical to stock |
