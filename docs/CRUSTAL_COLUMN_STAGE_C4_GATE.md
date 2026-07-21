# Crustal columns — stage C4 gate record (maturation gate re-key + sediment accretion)

**Status: C4 landed and measured, default-off. Every pre-registered gate
passes: crust fraction — this stage's FIRST-READ metric (trap T3) — holds
at 0.380–0.391 late on all three seeds, inside the 0.35–0.45 band and
within noise of the C3 world, so the absolute maturation gate did NOT
shift the creation budget at the shipped water endowment; the
maturation-depth distribution is measured (flips at −1083…−1951 m,
provably sea-independent); the creation/consumption budget is printed
both sides for the first time; all floors hold, including the C3 seed-1
dispersal watch item, which RESOLVED (93.1% → 97.8%). One new watch item:
seed-1 crustal mass +20 %/4.5 Gyr (the other seeds +8–9%). Next per the
staged plan: the C5 remainder (founder/caps/retirement re-keys + the
now-trivial regularization), then C6 margins, then C7 calibration + the
water sweep.**

Companions: `CRUSTAL_COLUMN_PROPOSAL.md` (§5 sites 10/18/22, §6 C4),
`CRUSTAL_COLUMN_STAGE_C3_GATE.md` (the post-servo-retirement world this
stage builds on and is scored against), `CRUSTAL_COLUMN_STAGE_C2_GATE.md`
/ `CRUSTAL_COLUMN_STAGE_C0_C1_GATE.md` (protocol + baselines).

Commits: kernel `72023cc` (sites 10/18/22 + fixtures + flag-arm golden
regen, no KBV bump per the owner's cadence decision, proposal §11 answer
4); sim-cli `976ac5f` (matF/matE/crea/accr gate columns). All
measurements N=64, seeds {1, 42, 1337}, 4.5 Gyr, flag-on (onset 0) vs the
byte-identical flag-off baselines recorded in the C2/C3 gate records,
this container.

## 1. What landed

On the columns path only (flag-off byte-identical; all 25 flag-off spines
bit-unchanged; only the two flag-arm spines regenerated):

- **Site 10, the maturation gate (gate only — growth untouched):** arc
  maturation re-keys from the sea-keyed `ARC_MATURATION_ELEVATION_M`
  (−500 m) to the ABSOLUTE derived-equivalent gate
  `e(ARC_MATURATION_THICKNESS_M) ≈ −2306 m` — one condition, two
  readings: the cell's elevation-inversion thickness reaches the cited
  20 km (Suyehiro et al. 1996, Izu-Bonin; Calvert 2011) exactly when its
  elevation reaches this level, so the §2.4 inversion-at-flip founds
  ≥ 20 km by algebra, no clamp. One less sea-keyed relaxation target
  (T1); the creation-budget shift is why crust fraction is this stage's
  first-read metric (T3).
- **Site 22, both ledger exits closed:** sediment consumed at
  continentalization (the tectonics sweep — maturation, bulldozer
  re-roots, consolidation hole fills — and the crustFates weld bridges)
  now ACCRETES into the column, `ΔT = sed·ρ_sed/ρ_cc`, the
  mass-conserving conversion, elevation re-derived from the stored
  thickness (bit-exact coherence held). The C1–C3 shims destroyed this
  flux (a declared leak, C2-counted); the counter
  (`columnsSedimentZeroedM3`) keeps its meaning — sediment leaving the
  ocean stock at continentalization — so the sink-side inference is
  unchanged.
- **The 70 km collapse ceiling clips the accretion** exactly as it clips
  orogeny/collision (C3 semantics): only the above-cap remainder is
  destroyed (the pre-C4 fate of the whole stack), counted in
  `columnsThicknessCapBinds`. Measured necessity: without the clip,
  sediment-loaded hole fills/welds pushed Tmax to 72.5 km and max
  elevation to 5165 m on the N=32 smoke world; with it both pin back at
  69.9 km / e(70 km), preserving the C3 gate property (confirmed at
  N=64: run-max Tmax 69.9 on all seeds).
- **C4 diagnostics** (plate-census contract, flag-off holds 0):
  `columnsMaturationFlips` / `columnsMaturationElevSumM` /
  `columnsMaturationCreditM3`; `--crust-stats` differences them into
  `matF` (flips/interval), `matE` (mean flip elevation — the
  maturation-depth distribution, closure check 3), `crea` (arc-accretion
  creation credit, rock m/Myr over continental area) and `accr`
  (sediment accreted, rock-equivalent m/Myr) — the creation side of the
  budget print, answering the C2 `src`/`sat%`/`sink` consumption side.

Verified: 491/491 kernel tests, incl. new fixtures — absolute-gate
directionality both ways (a −1950 m arc matures ONLY on the columns path;
a fallen-sea −4350 m arc matures ONLY on the legacy path — the columns
gate provably does not ride the sea), inversion ≥ 20 km at flip, sweep
accretion conservation (per-cell ΔT·ρ_cc = sed·ρ_sed, coherent, counted),
ceiling clip, weld accretion, flag-off arm untouched byte-for-byte.

## 2. Measurements

"off" = flag-off baseline (from the C2/C3 records — the off path is
byte-identical across C2→C4 by construction); "C3" = the C3-addendum
world (post-servo-retirement); "C4" = this stage. "Late" = past-1-Gyr
keyframe mean.

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| **late cont crust fraction** (T3 band 0.35–0.45) | **0.391** | **0.381** | **0.380** |
| late cont crust fraction, C3 reference | 0.384 | 0.391 | 0.410 |
| late mean freeboard, m (off / C3 / C4) | 5104 / 2720 / **2651** | 4707 / 2914 / **2870** | 4933 / 2961 / **3051** |
| late mean band% (off / C3 / C4) | 6.3 / 14.7 / **14.7** | 6.7 / 13.6 / **13.7** | 7.0 / 13.3 / **13.3** |
| late mean landA% / final | 32.1 / 35.5 | 32.3 / 33.3 | 33.3 / 32.7 |
| landA% min (off / C3 / C4) | 21.9 / 28.6 / **26.1** | 22.2 / 25.8 / **27.7** | 23.2 / 28.0 / **29.1** |
| peaks above sea ≥1 Gyr, mean (range) | 6535 (6117–7145) | 6686 (6208–7067) | 6723 (6326–7370) |
| final Tmean / Tmin / Tmax, km | 43.4 / 20.3 / 69.9 | 42.2 / 20.1 / 69.9 | 43.1 / 20.5 / 69.9 |
| run-max Tmax, km | 69.9 | 69.9 | 69.9 |
| final crustal mass, e21 kg (t=0: 28.7; C3: 30.1/31.4/31.4) | **34.4** | 31.2 | 31.1 |
| src late / sat% late / sink late, m/Myr | 6.9 / 16.9 / 4.3 | 7.4 / 17.2 / 4.6 | 7.7 / 15.9 / 4.8 |
| **crea** late (arc-accretion credit) / **accr** late, m/Myr | 107 / 2.6 | 114 / 2.8 | 123 / 2.9 |
| maturation flips (total) / late per 10 Myr | 174.5k / 405 | 180.3k / 422 | 192.2k / 451 |
| **matE** late mean / run range, m | −1523 / [−1776, −1265] | −1547 / [−1891, −1269] | −1563 / [−1951, −1083] |
| final sea, m | −1343 | −1844 | −1718 |
| thickness-cap binds (cumulative; C3: 14.8/15.8/16.8M) | 14.6M | 15.3M | 16.2M |
| dispersal / monopoly (C3: 93.1/98.2/100%) | **97.8%** / 0 | 96.7% / 0 | 97.8% / 0 |
| last tectonic event, Myr | 4494 | 4495 | 4455 |
| late land components / largest comp (C3: 211/0.319, 200/0.354, 180/0.39) | 213 / 0.342 | 200 / 0.375 | 196 / 0.371 |

PNGs (seed 42 flipbook, t=0 → 4.5 Gyr, inspected): coherent continental
blocks with brown highland interiors ringed by green coastal lowlands,
shelf halos, ridge fabric — the C3-addendum look, no archipelago
regression. The 3.6 Gyr frame shows a broad connected landmass band; the
final frame's single large mass matches the metrics largest-land-component
0.634. Numbers and maps agree.

## 3. Gate scoring (pre-registered, proposal §6 C4)

- **Crust fraction FIRST (T3): PASS.** Late means 0.391 / 0.381 / 0.380 —
  inside the 0.35–0.45 band on every seed, and within noise of the C3
  world (0.384–0.410). Closure check 3 predicted the absolute gate lands
  within ~400 m of the sea-keyed one at r9-both-class seas; at THIS
  stack's seas (−1.3…−1.8 km final, i.e. legacy gate −1.8…−2.3 km vs
  absolute −2306 m) the two nearly coincide — the re-key is a
  T1-decoupling with a small budget effect at scale 1.0, exactly the
  closure check's prediction. The pre-registered fallback knob
  (`ARC_MATURATION_THICKNESS_M` within 20–25 km) was NOT touched. The
  water sweep (C7) is where the gates genuinely diverge (at the stock sea
  the legacy gate sat 1.7 km deeper) — the sweep now measures a
  sea-independent creation budget, which is the point of the re-key.
- **Maturation-depth distribution reported (closure check 3): PASS.**
  Flips occur at −1083…−1951 m (late means −1523/−1547/−1563), every one
  above the −2306 m gate by construction. The distribution sits 0.4–1.2 km
  above the gate — cells swept into the accretionary belt already above
  it, plus per-step growth overshoot (arc growth at N=64 runs 2× the
  reference-grid rate per cell) — and does NOT move with the sea: over
  seas swinging 0 → −2.5 km (N=32 smoke) and −1.3…−1.8 km (N=64), matE
  stays in the same band. The legacy gate would have put these flips at
  `sea − 500` — 0.8–1.3 km shallower early, deeper late.
- **Creation/consumption budget printed: DELIVERED.** Creation: the
  arc-accretion founding credit runs 107–123 m/Myr over continental area
  (whole ~21 km columns founded at ~420 flips/10 Myr — the dominant crust
  source, now measured rather than inferred), plus 2.6–2.9 m/Myr of
  sediment accretion (the site-22 leak, now a conservative credit).
  Consumption: src 6.9–7.7 / sink 4.3–4.8 m/Myr (C2 instruments,
  unchanged regime). Net: the mass ledger ends +8–20% per 4.5 Gyr (§4).
- **Ceiling property preserved: PASS.** Run-max Tmax 69.9 km on all
  seeds; cap binds 14.6–16.2M (C3: 14.8–16.8M); zero elevation-cap
  events, structurally. The accretion clip closed the only overshoot
  path (measured at 72.5 km without it).
- **Re-armed C2+C3 gates, non-regression: PASS.** Band late means
  14.7/13.7/13.3 vs C3's 14.7/13.6/13.3 (identical); freeboard late
  2651/2870/3051 vs 2720/2914/2961 (±90 m — noise); peaks 6.1–7.4 km in
  the 5–9 km band; belts still die in interiors (Tmean 42–43 km near the
  39 km equilibrium).

**Floors:**

- **Dynamic-sea landA floor ≥ 20%: PASS** — run minima 26.1 / 27.7 /
  29.1% (flag-off baselines: 21.9–23.2; the servo-era breach 15.3–16.3%
  stays gone). Late means 32.1–33.3%, finals 32.7–35.5, at/inside the §3
  25–35% target band.
- Dispersal 96.7–97.8%, monopoly 0 Myr everywhere, last tectonic event
  ≥ 4455 Myr, no NaN: **PASS**. The C3 seed-1 dispersal watch item
  (93.1%, below the ~94.9% reference floor) **RESOLVED** at 97.8% — the
  C3 record read it as chaotic large-plate epochs, and the C4 re-key's
  trajectory shift confirms it was weather, not mechanism.
- Land shape (C7 scoreboard item, not a floor): largest land component
  0.342–0.375 of land late (C3: 0.319–0.390; flag-off 0.404–0.441;
  servo-era collapse 0.12). Holding the C3 recovery; still the C4→C7
  watch item.

## 4. Watch items

1. **Seed-1 crustal mass +20%/4.5 Gyr** (28.7 → 34.4e21 kg; the other
   seeds +8–9%, C3 measured +5–9%). Correlated with a late high-crust
   epoch (final-frame crust fraction 0.454, top of the T3 band; the LATE
   MEAN 0.391 stays inside). The C4 sediment credit adds only
   ~2.6 m/Myr — the driver is the (already-C3) maturation founding flux
   on this seed's late margin geometry. Nothing gates on total mass yet;
   re-read at C5 (whose founder/retirement re-keys are the consumption
   side) and score at C7.
2. **Land shape** — largest land component 0.34–0.38 vs flag-off
   0.40–0.44 (carried from C3, unchanged by C4).
3. `metrics` cell-count dynamic-sea land minima read 17.3–19.1% while the
   area-weighted instrument (landA, the §3 gate) reads 26.1–29.1 — the
   two instruments continue to be printed side by side (phase-0 rule);
   floors gate on landA only.

**Stage C4 is complete: all pre-registered gates pass, all floors hold,
the pre-registered fallback knob untouched, one new watch item recorded.
Next per the staged plan: C5 remainder (founder/caps/retirement re-keys +
the now-trivial `max(T, 20 km)` regularization — the T2 floor fixture
activates there), then C6 margins, then C7 calibration + the water sweep
(where the sea-independent creation budget this stage installed is the
load-bearing property).**
