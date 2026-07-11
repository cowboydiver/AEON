# Issues #88–#91 — four #84 follow-up mechanisms, measured

The #84 verdict (`ISSUE_84_PROTOTYPE_FINDINGS.md`) said the block-isostasy
founder solves confetti *visibility* but not *consolidation*, and named the
follow-up levers. All four are now implemented as **default-off prototypes**
— flag-off runs are byte-identical to the pre-#88 kernel (main goldens
unchanged; each flag-on path has its own golden spine) — and measured with
the PR #87 branched A/B instrument, generalized to every mechanism:

```
pnpm sim -- --seed 42 --until 3.5e9 --grid-n 64 --ab <mechanism> --ab-branch 3e9
```

Mechanisms: `crust-fates` (#88), `compact-arcs` (#89), `marine-planation`
(#90), `emergent-arc-taper` (#91); single-arm flags `--crust-fates` etc.
compose for full-history runs and dumps. Every param pair follows the
`blockIsostasy`/`blockIsostasyOnsetYears` contract (no RNG, bit-identical
before onset — invariant-tested through the full pipeline in
`test/onsetGating.test.ts`, and verified by the harness tripwire on every
run below: 301 pre-branch keyframes bit-identical per pair).

Reproduce everything below:

```
pnpm sim -- --seed 42 --until 3.5e9 --grid-n 64 --ab <mechanism> --ab-branch 3e9
pnpm sim -- --seed 42 --until 4.5e9 --grid-n 64 --metrics --<mechanism-flag>
pnpm sim -- --seed 42 --until 4.5e9 --metrics --crust-fates \
  --dump elevation,crustType --dump-every 15 --out tmp/n128-crustfates
```

## Headline numbers

Paired window means (off → on, seed 42, N=64, branch 3000 Myr, 51 keyframes
to 3500 Myr — the same protocol as the #84 measurement, whose baseline arm
these runs share byte-for-byte):

| mechanism | Δ land comps | Δ largest land comp | Δ land (pts) | land min (on) | Δ cont comps | Δ largest cont comp | Δ cont crust (pts) |
|---|---|---|---|---|---|---|---|
| blockIsostasy (#84, for reference) | −0.2 | −0.017 | −0.96 | 14.0% | — | — | — |
| **crustFates (#88)** | **−3.5** | −0.008 | **−0.48** | **14.5%** | **−61.2** | −0.041 | −0.76 |
| compactArcs (#89) | +25.7 | −0.067 | −2.84 | 10.7% | +4.3 | −0.071 | **−3.07** |
| marinePlanation (#90) | +27.0 | −0.005 | **−0.37** | 15.0% | −3.9 | +0.006 | −0.18 |
| emergentArcTaper (#91) | +58.8 | −0.104 | −3.68 | 11.3% | +15.3 | −0.127 | **−3.42** |

## Reading, mechanism by mechanism

### #88 crustFates — the lace-killer works, on the ledger it targets

Continental components collapse **106 → ~20 within 40 Myr of the branch and
hold there** (Δ −61.2 over the window — the baseline arm oscillates around
80–100). This is the direct target the issue set: a mechanism that changes
the crustType map, which #84's founder deliberately did not. The docking
half does most of it (the lace is, definitionally, small components within a
cell or two of the main masses); the founder half retires what drifts alone.
Cost is about half the #84 founder's (Δ land −0.48 vs −0.96 pts; window land
min 14.5%), and Δ cont crust −0.76 pts says retirement debits are nearly
balanced by weld credits plus the consolidated masses' lower exposure to
collision consumption.

Seed robustness (same protocol, seeds 1 and 1337):

| seed | Δ land comps | Δ largest land comp | Δ land (pts) | land min (on) | Δ cont comps | Δ cont crust (pts) |
|---|---|---|---|---|---|---|
| 42 | −3.5 | −0.008 | −0.48 | 14.5% | **−61.2** | −0.76 |
| 1 | +11.8 | +0.008 | −0.08 | 17.2% | **−62.0** | −0.06 |
| 1337 | −1.3 | −0.079 | −1.14 | 16.8% | **−87.9** | −1.47 |

The crust-map consolidation is the stable signal on all three golden seeds
(the on-arm holds ~20–50 components where the off-arm holds ~80–140); the
land-mask deltas flip sign inside trajectory noise, exactly as #84 taught
to expect, and the land cost stays between ~0.1 and ~1.1 pts with window
minima ≥ 14.5% everywhere.

The land-mask improvement is real but much smaller (Δ land components −3.5,
largest-component share flat): most of the components the crust pass removes
were already submerged platform, and the #84-measured re-supply (fresh
splinters from the boundary processes) keeps minting new *emergent* islands.
Consolidating the crust map is necessary but not sufficient for the visible
mask — the from-orbit island count is dominated by the creation side.

### #89 compactArcs — the starvation trap fires even with the belt kept

Measured **negative**, decisively: Δ cont crust −3.07 pts of sphere over
500 Myr is creation starving in real time (the issue's own re-check
question, answered). The issue asked for arc-crust production totals per
100 Myr between arms; the paired net-production deltas (pts of sphere per
100 Myr bucket) are **−1.98 / −1.14 / −0.64 / −0.01 / −0.74** — negative in
every bucket, largest right at the branch where the arms are most
comparable: the gate *starves*, it does not reshape. In-window dispersal
drops 96% → 80%. Land bleeds to a 10.7% window minimum — grazing the #20
floor with a falling trend, so a full-history flag-on run would breach it.
Land components rise (+25.7): with less land, the mask fragments. The
≥2-continental-neighbor gate blocks too much of the maturation flux even
though gated cells can mature later — margins move (herringbone) faster
than concavities refill. Keep default-off; a viable retune would have to
give back creation elsewhere (e.g. a higher base arc rate paired with the
gate, or a raised-threshold "preferential" variant instead of a hard one),
which is a new measurement, not this issue's.

### #90 marinePlanation — conservative and cheap, kills peaks, not counts

The issue's key contrast **holds**: Δ land −0.37 pts is the cheapest
land-budget cost of any island-removal mechanism measured so far (founder:
−0.96), because the mass moves to shelves and partially returns through the
sea-level solver, and Δ cont crust −0.18 with the crustType golden hash
byte-identical to flag-off confirms it is pure transport (the erosion
conservation invariant extends over the planation flux — pinned in
`test/marinePlanation.test.ts`). Island *peaks* go: small-component relief
is graded to the −200 m shelf level on a ~Myr timescale, the same object as
a foundered platform downstream.

What it does not do — same verdict as the founder it was meant to replace —
is reduce the island *count* (Δ land components +27, largest-comp share
flat): removal-side mechanisms keep losing the count war to creation, and
the exported sediment nudges sea level up enough to fragment coastlines
elsewhere. As a cheaper, conservation-clean substitute for the #84
founder's visibility win it succeeds; as a consolidation lever it fails
like everything else on the removal side.

### #91 emergentArcTaper — suppressing standing arcs drains the creation pool

Measured **negative**, and instructively so: Δ land −3.68 pts tracks
Δ cont crust −3.42 almost one-for-one — the taper does not merely hide arc
chains, it starves continental creation (paired net-production deltas
−2.32 / −1.31 / −0.83 / +0.09 / +0.33 pts per 100 Myr — the drain is
front-loaded at the branch, then the compounding deltas decay into
trajectory comparison; in-window dispersal 96% → 86%). Mechanism: unmatured arcs standing
at +1 km are *latent continental crust* — when a margin flickers off a cell
(constantly, at quantized-advection cadence), a +1 km arc has ~7.5 Myr of
relief-decay headroom before it sinks past the −500 m maturation gate,
long enough for the accretionary belt to reach it later; a tapered arc
hovering near sea level has ~2.5 Myr and exits the pool. The flat +1 km
ceiling turns out to be load-bearing for the creation budget, not just
scenery. Land components +58.8 is the same low-land fragmentation as #89,
not extra arcs.

So the #84 claim that standing arc chains are "arguably correct physics"
gets a stronger form: they are *functionally necessary* at the current
creation rates. Any future visual accounting for arcs has to preserve the
latent pool — e.g. render-side treatment, or a taper paired with a slower
inactive-relief decay for arcs — both out of scope here.

## Full-history safety (seed 42, N=64, 4.5 Gyr, mechanism on from t=0)

| metric | baseline | crustFates | marinePlanation |
|---|---|---|---|
| land min / max | 14.0% / 31.2% | 13.0% / 31.1% | 14.3% / 31.2% |
| dispersed keyframes | 87.6% | 89.6% | 77.2% |
| last tectonic event | 4435 Myr | 4459 Myr | 4434 Myr |
| cont components past 1 Gyr | 103 | **23** | 96 |
| largest cont comp | 0.284 | 0.296 | 0.244 |
| land components past 1 Gyr | 224 | 214 | 298 |
| largest land comp | 0.345 | 0.368 | 0.346 |

(The baseline row reproduces the #84 findings table exactly — the
regenerated harness is measuring the same world.) crustFates sustains the
crust-map consolidation over the whole history — **cont components 103 → 23
past 1 Gyr**, a 4.5× reduction, with land min 13.0% (1 pt under baseline,
comfortably in the [10, 60] band), dispersal and liveness healthy, and the
land-mask shape numbers mildly better than baseline. marinePlanation is
land-band-safe (14.3%) and shape-neutral-to-worse on whole-history numbers;
its dispersal dip to 77.2% is whole-trajectory divergence (different worlds
after t=0), the same caveat as every full-history comparison here.
compactArcs and emergentArcTaper were not run full-history flag-on: their
paired windows already show monotonic land bleed toward the floor (10.7% /
11.3% and falling at window end), which is the disqualifying result.

## N=128 (the web app's grid): whole-history metrics + flipbooks

Seed 42, 4.5 Gyr, mechanism on from t=0, `--dump elevation,crustType
--dump-every 15`; curated frames in `docs/issue88-91-evidence/` (baseline
vs crust-fates at 2400 and 3900 Myr, arc-taper at 3900 Myr).

| metric (past 1 Gyr) | baseline | crustFates | emergentArcTaper |
|---|---|---|---|
| cont components | 275 | **27** | 176 |
| largest cont comp | 0.237 | 0.320 | 0.286 |
| edge/area | 0.673 | 0.612 | 0.760 |
| cont crust (of sphere) | 0.178 | 0.202 | **0.107** |
| land components | 517 | **371** | 631 |
| largest land comp | 0.344 | 0.429 | 0.279 |
| land min over 4.5 Gyr | 11.9% | **15.2%** | **3.6%** |
| dispersed keyframes | 89.6% | 80.5% (every Gyr ≥ 0.70) | 57.6% (late Gyr 0.27–0.31) |
| last tectonic event | 4483 Myr | 4497 Myr | 4258 Myr |

(The baseline row again reproduces the #84 findings' N=128 numbers.)

**crustFates at N=128 is a clean sweep**: a 10× crust-map consolidation
(275 → 27), 28% fewer visible islands (517 → 371), better coherence
(largest land comp 0.344 → 0.429), *more* continental crust (compact
masses expose less margin to collision consumption — the #67 effect,
compounding), and the land minimum RISING 3.3 points to 15.2%. Dispersal
dips to 80.5%, inside the seed-noise band the #84 tables document
(79.8–94.9%) with every Gyr bucket ≥ 0.70. The crustType flipbook is the
starkest evidence in the series: the baseline's shredded filament lace vs
a handful of bold connected masses with clean margins (see
`base-crustType-003900Myr.png` vs `crustfates-crustType-003900Myr.png`).

**emergentArcTaper at N=128 is disqualified outright**: the creation
starvation the paired window showed at N=64 compounds at the finer grid —
where the #59-retuned creation rates were already balanced against the 10%
floor — and land collapses to a 3.6% minimum with continental crust at
0.107 of the sphere and dispersal dying late (starved crust cannot pass
the rift gates). The 3900 Myr frame *looks* cleaner (submerged arc trails
where standing chains were), but chiefly because there is less of
everything — the #91 issue's own worry ("over-suppressing them would be a
loss") understated the coupling.

## Notes against the issue texts (review findings, kept honest)

- **#88's two halves are one rule here.** The static merge (≤2 ocean
  cells) and the transport half (docking on arrival) are implemented as a
  single gap test — a delivered fragment welds the moment plate motion
  brings it in range, and the whole-terrane plate transfer is what makes
  the weld durable under subsequent advection (the actual docking
  dynamics). There is deliberately no active-margin condition on the weld:
  the issue's static half has none, and requiring one would leave
  drifted-close fragments unmerged. The pre-retirement subsidence ramp and
  the plate transfer are additions beyond the issue text, both load-bearing
  (no land-mask popping; weld durability) and documented in the system
  header.
- **#89's gate is hard, not "preferential".** A strict ≥2-neighbor cutoff
  is the strongest reading of the issue's "matures preferentially" — and it
  starves. A genuinely preferential variant (e.g. chain cells mature at a
  raised elevation threshold rather than never) is the natural follow-up
  measurement if creation-side reshaping is retried; the harness takes it
  with one flag.
- **#91 is a growth taper, not a literal age cap.** No margin-age field
  exists; dwell time of active subduction is the age integrator (tapered
  growth vs relief decay). The flat +1 km ceiling remains as the maximum a
  long-lived margin can reach — which is the issue's stated goal. The
  failure is not the accounting but the coupling to creation: standing
  arcs are latent continental crust.

## Verdict

Ship all four default-off, as measurement substrate (same posture as #84):
- **crustFates** is the first mechanism that demonstrably consolidates the
  crust map, on all three golden seeds and at both grids, with the land
  minimum *rising* at N=128 — the candidate for a default-on promotion
  measurement (seed batches are the remaining gap, as in #84), possibly
  paired with blockIsostasy since they attack complementary ledgers and
  share the component substrate.
- **marinePlanation** is the conservation-clean replacement for the
  founder's peak-kill if the ~1 pt land cost of #84 ever matters.
- **compactArcs** and **emergentArcTaper** are measured-negative at their
  shipped constants: both starve creation (the taper catastrophically at
  N=128 — land min 3.6%). They stay in the tree as documented negative
  results with the harness wired, so any retune is a one-flag
  re-measurement.
