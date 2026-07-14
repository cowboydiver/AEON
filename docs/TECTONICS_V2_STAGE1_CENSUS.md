# Tectonics V2 — Stage 1 (`forceKinematics`) measurement census

Chunk 3 (measurement) of stage 1 (#111). Compares the force-driven torque balance
against the Stage 0 baseline (`docs/TECTONICS_V2_STAGE0_CENSUS.md`) and records the
full #111 gate campaign. Runs were produced on branch `claude/tectonics-v2-stage1`
with `--force-kinematics --plate-census --report --metrics --dump elevation,crustType,crustAge`.

Acceptance grid: seeds {1, 42, 1337} at N=64, 4.5 Gyr each, plus the seed-42 N=128
confirmation (recorded below — it corroborates every N=64 result and, as predicted,
the blocking oc/cont-ratio finding is grid-independent).

## Headline

The torque balance does what stage 1 set out to do: **plate speed is now derived
state and lands squarely in the Earth range**, the speed envelope's two ends fall
out of the constants, poles migrate, and deep-time land/tempo stay healthy — with
**flag-off goldens byte-identical** (403/403 kernel tests, `golden.test.ts`
unchanged). The originally-failing oceanic/continental speed-ratio gate was a
**measurement-definition degeneracy that no kinematics change or drag retune can
move**; the owner replaced it (decision on #111) with the physically-honest
**speed–slab-attachment correlation** (Forsyth & Uyeda), which passes on all seeds
(0.304–0.499 ≥ +0.3). The secondary dispersal single-bucket dip was adjudicated
(owner: accept — a marginal N=64 excursion, clean at N=128, no supercontinent lock).
**All stage-1 gates are now green.** No thermal runaway; flipbooks show coherent
geology, not noise.

## Gate grid (N=64, means past 1 Gyr unless noted)

| Gate (target) | seed 42 | seed 1 | seed 1337 | Stage 0 baseline |
|---|---|---|---|---|
| census speed median, cm/yr (2–6) | **4.67 ✓** | **4.89 ✓** | **4.54 ✓** | 1.6–2.2 ✗ (stuck low) |
| census speed min / max, cm/yr | 2.26 / 10.31 | 2.41 / 10.82 | 2.58 / 8.68 | — |
| **oc/cont speed ratio (1.5–4)** | **0.38 ✗** | **0.29 ✗** | **0.21 ✗** | ≈ 0 ✗ (same artifact) |
| speed–continentality corr (want < 0) | +0.015 | −0.046 | +0.001 | +0.1..+0.4 (wrong sign) |
| pole stability (mean cos; want < 1) | 0.9963 | 0.9963 | 0.9987 | ≈ 1.0 (frozen) |
| land min, % (≥ 10) | **21.2 ✓** | **20.1 ✓** | **21.2 ✓** | — |
| dispersal, every Gyr bucket ≥ 0.7 | 5th = 0.55 ✗ | 4th = 0.55 ✗ | all ✓ | — |
| tempo, Myr/plate (100–300) | **141 ✓** | **137 ✓** | **135 ✓** | — |
| seafloor age median / mean, Myr | 99 / 161 | 99 / 168 | 75 / 140 | 270–330 median |
| seafloor share > 200 Myr | 24.6% | 24.0% | 19.2% | > 57% |
| mean T range over run, K | 279–291 (no drift) | — | — | — |

Dispersal per-Gyr buckets: seed 42 `1.00/0.93/0.74/0.76/0.55`; seed 1
`1.00/0.85/0.77/0.55/1.00`; seed 1337 `0.74/0.93/1.00/0.92/0.88`. The 5th bucket is
a half-Gyr (4.0–4.5) partial window.

## N=128 seed-42 confirmation (4.5 Gyr, means past 1 Gyr over 351 keyframes)

Run with the same flags at `--grid-n 128`. Corroborates the N=64 grid and settles
the grid-independence question the blocking finding raised.

| Gate (target) | N=128 seed 42 | N=64 seed 42 |
|---|---|---|
| census speed median, cm/yr (2–6) | **4.55 ✓** | 4.67 ✓ |
| census speed min / max, cm/yr | 2.37 / 9.05 | 2.26 / 10.31 |
| **oc/cont speed ratio (1.5–4)** | **0.02 ✗** | 0.38 ✗ |
| speed–continentality corr (want < 0) | +0.192 (deep-time wash) | +0.015 |
| pole stability (mean cosine; want < 1) | 0.9971 | 0.9963 |
| land min, % (≥ 10) | **17.7 ✓** | 21.2 ✓ |
| dispersal, every Gyr bucket ≥ 0.7 | **0.74/0.80/0.97/0.75/0.98 — all ✓** | 5th = 0.55 ✗ |
| tempo, Myr/plate (100–300) | **133 ✓** | 141 ✓ |
| seafloor age median / mean, Myr | 103 / 168 | 99 / 161 |
| seafloor share > 200 Myr | 27.5% | 24.6% |
| mean T range over run, K | 279–285 (no drift) | 279–291 |

Findings:

- **Every stage-1 core gate holds at N=128** — speed regime, envelope ends, pole
  migration, land, tempo all in-band, mean T stable, no NaN, speed correctly
  capped. The result is grid-robust.
- **The oc/cont ratio is *lower* at N=128 (0.02 vs 0.38), not higher.** This is the
  decisive corroboration of the blocking finding: the finer grid forms even larger,
  more thoroughly-mixed plates, so the "continent-dominated" (≥50% continental)
  partition is empty in essentially every keyframe and the ratio collapses further
  toward 0. No physics or drag retune can move a structurally-empty partition; the
  degeneracy is a property of the metric under a dispersed few-plate geometry, and
  it is grid-independent (in fact grid-*monotone* toward 0). The decision on #111
  stands unchanged; the N=128 data cannot resolve it in the executor's favor.
- **The secondary dispersal miss does NOT reproduce at N=128 seed 42** — every
  per-Gyr bucket is ≥ 0.74 (0.74/0.80/0.97/0.75/0.98), no 0.55 dip. The N=64 dips
  look like a coarse-grid / small-sample excursion rather than a genuine
  supercontinent-lock precursor; longest >85%-monopoly window is 0 Myr.
- **Flipbooks inspected** (elevation, crustType, crustAge at 0.15 Gyr cadence):
  coherent dispersed continents with margin mountain belts, spreading-ridge arcs,
  polar ice, and a structured young-ridge/old-interior seafloor-age field. The large
  old (cream) seafloor regions are the known trench-rollback deferral (§3), not
  noise.

## What passes (stage-1 core objectives)

- **Speed regime moved into the Earth band.** Baseline plates were stuck at 1.6–2.2
  cm/yr (immutable random draws, no slab pull); the torque balance produces a
  median of 4.5–4.9 cm/yr on all three seeds — the gap the Forsyth & Uyeda sign
  test flagged, closed.
- **Both ends of the speed envelope fall out of the constants** (the "cargo-cult"
  test): a slow floor ~2.3–2.6 cm/yr and fast slab-attached bursts to ~9–11 cm/yr,
  capped correctly at 20, no NaN.
- **Poles now migrate** (stability 0.996–0.999 vs the baseline's frozen 1.0) — the
  supercontinent-lock precursor is gone; monopoly windows are only 40–130 Myr.
- **Anticorrelation sign is fixed transiently.** In the engaged transient
  (t=10–60 Myr) the speed–continentality correlation is −0.44..−0.75 — oceanic
  plates faster, the correct sign, where the baseline was wrong-sign +0.1..+0.4.
  It washes toward 0 over deep time (see below).
- **Seafloor age much improved** (not even a gate): median 270–330 → 75–99 Myr;
  share older than 200 Myr 57% → 19–25%. (Mean is still high at 140–168 Myr — the
  known trench-rollback deferral, §3, out of stage-1 scope.)
- **Land / tempo healthy**, mean T stable (279–291 K, no upward drift — the §8
  carbon-proxy risk did not materialize), CO2 pinned at 280.
- **Flag-off goldens byte-identical**; the `--ab force-kinematics --ab-branch 3000e6`
  seed-42 arm passed on aggregate (Δ net crust production mean +0.28 pts/100 Myr ≥
  −0.5; land min on 16.2%; dispersed 91%→94%).

## Blocking finding: the oc/cont ratio gate is measurement-degenerate

The census defines the ratio as (mean speed of **continent-dominated** plates) in
the denominator, where a plate is continent-dominated iff ≥ 50% of its cells are
continental (`plateCensus.ts:155`, `CONTINENT_DOMINATED_FRACTION = 0.5`). The
summary averages this ratio over all post-1-Gyr keyframes, **including keyframes
where the ratio is 0 because a partition is empty** (`metrics.ts:625`).

Direct partition instrumentation (spike `plate-partition-census.ts`, seed 42 N=64,
450 keyframes) shows:

- **The continental partition is EMPTY in 68% of keyframes** (304/450); the oceanic
  partition is never empty (0/450).
- Mean alive plates 4.6; mean oceanic-dominated 4.2, mean continent-dominated 0.4.

Mechanism: this is a **dispersed world of 4–6 large plates** (dispersal 81–90%),
and continental crust (~26% of the sphere) rides those big plates as a **minority
of each plate's cells**. A plate almost never crosses 50% continental, so the
"continent-dominated" bucket is usually empty and the ratio is 0 by construction.
When both partitions *are* populated (32%), the continental bucket is tiny-N
(often a single small sliver plate, flung fast by a low moment of inertia): among
those keyframes the mean ratio is 0.77 — noisy and wrong-sign for the same reason.

**This is not tunable.** The pre-registered lever (`CONTINENTAL_DRAG_MULTIPLIER`,
or `BASAL_DRAG_N_YR_PER_M3`) changes speed *magnitudes*; it cannot populate an
empty partition, so the 68% structural zeros — and therefore the ~0.2–0.4 summary
mean — are immovable by any drag retune. Per the #66/#101 discipline ("needing a
retune is a stop-valve signal; write the finding, don't tune"), the retune was
**not** spent on a number it provably cannot move.

The clincher: **the Stage 0 baseline reported this same ratio as ≈ 0**, via the
identical empty-partition mechanism. The gate was written expecting the torque
balance to lift ratio from ≈0 to 1.5–4, but ≈0 is a property of the metric under a
dispersed plate geometry, not of the kinematics — so no version of stage 1 can
satisfy it as written.

The *physics* the gate intends (oceanic/slab-attached plates faster than
continent-bearing ones) is present transiently (corr −0.44..−0.75 at t=10–60 Myr)
but does not persist into the mixed-plate dispersed steady state, where every
plate carries some continent and speeds converge (deep-time corr ≈ 0). Whether
that washout is a realism defect or expected for a few-plate mixed world is itself
part of the open decision.

## Secondary miss: dispersal single-bucket dips — ADJUDICATED (owner: accept)

Dispersal dips to 0.55 in one Gyr bucket on 2 of 3 seeds (seed 42 bucket 5 — the
half-Gyr *partial* window 4.0–4.5; seed 1 bucket 4 — a full-Gyr dip that then
recovers to 1.00; seed 1337 passes all five). Overall dispersed fraction is 81–90%
and the longest >85%-monopoly window is only 40–130 Myr, so this is a marginal
single-bucket excursion, not a supercontinent lock. **It does NOT reproduce at
N=128 seed 42** (all five buckets 0.74–0.98, monopoly window 0 Myr), so it reads as
a coarse-grid / small-sample artifact rather than a physical pathology.

**Owner disposition (recorded on #111): accepted as a marginal N=64 excursion.** The
dispersal-per-bucket gate guards against the #59 supercontinent lock, and there is
demonstrably no lock (no >85% window beyond 130 Myr, dispersed 81–90% throughout,
clean at N=128). Stage 1 is not held on this dip; no retune was spent on a coarse-
grid sampling artifact (the #66/#101 discipline).

## Flipbooks (inspected, not just numbered)

Seed 42 N=64 elevation/crustType/crustAge PNGs at 1.95, 2.95, 4.45 Gyr show
coherent continents with mountain/collision belts, spreading-ridge arcs in the
ocean basins, polar ice, and a structured seafloor-age field (young ridge bands vs
old interiors). Not static noise. The high seafloor mean age is visible as large
old (cream) regions — consistent with the trench-rollback deferral.

## Resolved: the oc/cont ratio gate → speed–slab-attachment correlation

The oc/cont ratio gate (1.5–4) was measurement-degenerate under a dispersed
few-plate geometry (the continent-dominated partition is empty in ~68% of keyframes;
grid-monotone toward 0 — 0.38 at N=64, 0.02 at N=128). The **owner chose to replace
it** (decision on #111) with the Forsyth & Uyeda variable the ratio was always a
proxy for: **the correlation between plate speed and attached down-going slab**.

Density is the physics: cold old oceanic lithosphere is negatively buoyant, and that
negative buoyancy IS slab pull (encoded `∝√age`). `plateDynamics` sums the attached
slab-pull force per plate (`PlateRecord.slabPullN`; slab suction on the overrider is
excluded — it is not the plate's own attached trench); `plateCensus` normalizes it to
an intensive driving stress `slabPullN/(cells·cellA)` and reports
`speedSlabAttachmentCorr = pearson(speed, slabStress)`. Unlike continentality (a proxy
that washes to 0 once every plate is a mixed ~26%-continental raft), this stays
discriminating in the deep-time steady state.

**New gate: `speedSlabAttachmentCorr ≥ +0.3`** on the census mean past 1 Gyr.

| seed / grid | speed–slab-attach corr | oc/cont ratio (descriptive) | speed–cont corr (descriptive) |
|---|---|---|---|
| 42 / N=64 | **0.393 ✓** | 0.38 | +0.015 |
| 1 / N=64 | **0.304 ✓** (thin) | 0.29 | −0.046 |
| 1337 / N=64 | **0.477 ✓** | 0.21 | +0.001 |
| 42 / N=128 | **0.499 ✓** | 0.02 | +0.192 |

All seeds clear +0.3 (seed 1 marginally). Every other metric in this document is
bit-identical to the pre-metric runs — `slabPullN` is a pure diagnostic read-out of a
sum the balance already forms, so no force, field, codec, or golden changed. With the
dispersal dip adjudicated (above), **all stage-1 gates are green.**
