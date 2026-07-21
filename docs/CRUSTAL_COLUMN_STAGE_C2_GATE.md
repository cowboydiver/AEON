# Crustal columns — stage C2 gate record (erosion in thickness space)

**Status: C2 landed and measured, default-off. The mechanics verified — mass
closure, emergent rebound, source/sink instrumentation all green — but the
pre-registered hypsometry exit gates (band up, freeboard down) DID NOT MOVE
on the shim stack, and the instruments say why: erosion is not the
bottleneck, the unmigrated C1-shim vertical injectors are. Owner decision
requested at §5: re-arm the hypsometry gates as a C2+C3 combined exit (the
documented re-staging path, proposal §9 risk 3 precedent), or stop here
(§9 risk 6).** Companions: `CRUSTAL_COLUMN_PROPOSAL.md` (§5 sites 13–15,
§6 C2), `CRUSTAL_COLUMN_STAGE_C0_C1_GATE.md` (baselines this record scores
against).

Commits: kernel `61db8be` (thickness transactions + fixtures + flag-arm
golden regen, no KBV bump per the owner's cadence decision, §11 answer 4);
sim-cli `8f1545b` (src/sat%/sink planation-throughput columns). All
measurements N=64, seeds {1, 42, 1337}, this container.

## 1. What landed

Sites 13–15 under an active `crustalColumns` (separate code path; flag-off
byte-identical — all 25 flag-off golden spines bit-unchanged):

- **The rate laws now output rock** (denudation — the mm/kyr scale
  `EROSION_RATE_PER_YR` was always calibrated to), and the surface answers
  through the derivation: Δe = k·ΔT ≈ 0.142·ΔT — the emergent rebound of
  closure check 1. Measured on a lone island fixture: eDrop/tDrop ≈ k to
  3 decimals, with the columns surface falling < 0.3× the legacy drop for
  the same denudation.
- **Site 13** interior diffusion moves volume `X·(Ω_i+Ω_j)/2` — continental
  mass conserved exactly on true areas (T7), retiring the
  meters-antisymmetric approximation.
- **Sites 14–15** export/planation deposit `Δsed = X·(ρ_cc/ρ_sed)·(Ω_i/Ω_j)`
  (the pre-registered conversion): Σ(T·ρ_cc·A) + Σ(sed·ρ_sed·A) invariant
  across the coast. Surface caps (never below sea / planation level) bind on
  the derived surface (÷k in rock space); the shelf-room cap converts
  through density + area ratio.
- **Site 16** root decay stays a mechanical Δe/k shim (C3 scope).
- **Instrumentation** (cumulative diagnostic globals, plate-census
  contract): rock exported, shelf-limited/total export visits, sediment
  swallowed at maturation flips + weld bridges (the site-22 exits) —
  `--crust-stats` differences them into `src` / `sat%` / `sink` columns.

Fixtures: per-step (≤1e-6 relative) and 50-step continental-mass closure;
cross-coast ledger closure; rebound factor; shelf ceiling + never-below-sea
re-asserted flag-on; flag-off counters pinned at zero. Kernel suite 478/478
(~77 s); coherence `e === fround(C + k·T)` still bit-exact through the full
default pipeline; golden regen audited — 20 hash lines, all inside the two
crustalColumns flag-arm spines, with `plateId`/`crustType`/`crustAge`/
`sutureYears` unchanged even flag-on at 10/30 steps.

## 2. Gate protocol

Paired single-arm runs (the C1-gate precedent): flag-off vs flag-on
(onset 0 ⇒ branch = t=0), 4.5 Gyr, N=64, `--metrics --crust-stats`,
elevation dumps on seed 42 both arms. Pre-branch identity is pinned by the
kernel onset-gating tests. Caveat that shapes the reading: post-onset
trajectories diverge chaotically, so single-keyframe deltas swing ±2 km in
freeboard (seed 42 reads −2306 m at 1.0 Gyr and +2338 m at 4.5 Gyr);
windowed means are the honest instrument, per-keyframe snapshots are
weather.

## 3. Measurements

Final = 4.5 Gyr; "late" = past-1-Gyr (3.5–4.5 Gyr) keyframe mean; Δ = on − off.

| | seed 1 off / on | seed 42 off / on | seed 1337 off / on |
|---|---|---|---|
| final landA% | 32.2 / 35.0 | 32.0 / 35.0 | 33.7 / 33.8 |
| landA% min (run) | 21.9 / **21.4** | 22.2 / **22.1** | 23.2 / **22.5** |
| final band% | 5.3 / 4.3 | 9.8 / 7.1 | 5.7 / 7.5 |
| late mean band% | 6.3 / 6.0 | 6.7 / 5.5 | 7.0 / 6.0 |
| final freeboard | 5367 / 5271 | 3326 / 5664 | 5078 / 4875 |
| late mean freeboard | 5104 / 5311 | 4707 / 5408 | 4933 / 5252 |
| @1.0 Gyr Δfreeboard | −154 | −2306 | +1055 |
| 0–1 Gyr paired mean Δfb | +26 | −108 | +824 |
| final cont crust % | 35.0 / 39.9 | 44.7 / 37.5 | 39.0 / 38.1 |
| dispersal | 98.7% / 95.6% | 96.5% / **93.6%** | 99.3% / 100% |
| monopoly window | 0 / 0 Myr | 0 / **40 Myr** | 0 / 0 Myr |
| last tectonic event | 4424 / 4496 | 4457 / 4497 | 4455 / 4458 Myr |
| on-arm mass, e21 kg (t=0: 28.7) | → 42.9 | → 40.9 | → 38.4 |
| on-arm Tmean / Tmax, km | 62.8 / 88.7 | 62.4 / 85.6 | 57.1 / 85.9 |

Planation throughput (on-arm, the §6 C2 required report — budget 4.7 m/Myr):

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| src, run mean / late, m/Myr | 12.1 / 14.1 | 11.8 / 13.9 | 11.6 / 12.9 |
| sat%, run mean / max | 33.3 / 51.1 | 33.5 / 51.6 | 34.0 / 45.5 |
| sink (net subducted), run mean / late | 7.7 / 9.0 | 7.5 / 9.0 | 7.3 / 8.2 |

PNGs inspected on both seed-42 arms (t=0 → 4.5 Gyr flipbook): both worlds
look like continents — coherent blocks, relief gradients, ridge fabric; the
on-arm shows more low-elevation coastal fringing. No static noise, no
degenerate frames. (Flag-off `Tmean/mass` columns show the stale unmatched
field decaying to ~0 — documented instrument behavior, not data.)

## 4. Gate scoring (pre-registered, proposal §6 C2)

- **Band occupancy strictly increases vs the C1 world: NOT MET.** Late
  means move −0.3 / −1.2 / −1.0 pt; finals mixed (−1.0 / −2.7 / +1.8).
- **Mean freeboard −200 m by +1 Gyr post-branch: NOT MET.** The 0–1 Gyr
  paired-mean deltas are +26 / −108 / +824 m (noise-dominated, no seed
  clears −200 sustained); the late means all move UP (+207 / +701 / +319).
- **Planation rate reported both sides: DELIVERED, and it exonerates
  erosion.** The source side runs 12–14 m/Myr of thickness export — 2.5–3×
  the 4.7 m/Myr budget, squarely cratonic-order (10Be median ~12 m/Myr), so
  §9 risk 1's "source may not deliver" did NOT materialize. The sink chokes
  a third of export visits (sat% ~33%, max ~51%) yet still carries
  7–9 m/Myr net into subduction. Erosion moves more than enough mass.
- **Conservation fixtures: PASS** (kernel, §1).
- **Non-regression floor: landA ≥ 20% HOLDS** (mins 21.4 / 22.1 / 22.5%);
  no NaN; last tectonic event > 4.4 Gyr. **Flag:** the seed-42 on-arm reads
  dispersal 93.6% (floor ~94.9%) with one 40-Myr >85% monopoly keyframe —
  the only kinematic-floor breach across six runs, on a chaotic metric
  (erosion timing shifts arc maturation, hence plate composition), with the
  other two on-arms at 95.6% and 100%. Reported, not excused; it re-scores
  at the next gate.

## 5. Diagnosis, and the decision this forces

The mass ledger tells the story in one line: **the on-arm exports ~53 km of
column-equivalent thickness over 4.5 Gyr (≈2.9e22 kg — real-Earth-scale
denudation) and the world still thickens from 28.7 to ~41e21 kg with Tmean
62 km, because the unmigrated C1-shim writers inject ~4.3e22 kg.** Orogeny
and collision still run in surface space and their shims mirror every
surface meter as 1/k ≈ 7 m of thickness; arc maturation founds ≥20 km
columns by inversion. Meanwhile rebound — the very physics C2 adds — cuts
erosion's surface-flattening power by the same factor 7. On the C1 bridge,
migrating the remover without the injectors shifts the surface balance
injector-ward: freeboard parks at ~5.3 km and the band stays empty. The one
permissible knob (`EROSION_SUBSEA_FACTOR`) is irrelevant to this imbalance
— it damps submerged-pair diffusion, not the injector budget — so per the
one-knob rule it was not touched.

This is a **bridge interaction, not a physics failure**: the proposal's own
trap analysis said "the shims are the measured bridge, not the destination"
(§8 T1), and every C2-specific mechanism verified independently — mass
closes, rebound emerges at exactly k, the source delivers the budget ~3×
over, the sink instrumentation works. The hypsometry gates simply cannot
move until the vertical injectors (sites 7 / 12 / 16 — stage C3) live in
the same mass space as the remover.

**Pre-registered options:**

- **(a) Documented re-staging (recommended):** land C3
  (orogeny/collision/root decay in thickness space) with the flag still
  default-off, and re-arm the C2 hypsometry gates — band strictly up,
  freeboard −200 m — as the C2+C3 combined exit, alongside C3's own gates
  (peaks 5–9 km, zero elevation-cap clamps, belts die in interiors). This
  is the §9 risk 3 shape: "re-order the staging — a documented re-staging,
  not a rewrite." C3 was next in the risk order regardless.
- **(b) Stop (§9 risk 6):** leave C2 as a documented default-off mechanism
  and end the program here. The staging makes this a findings doc, not a
  revert; the shipped world is untouched either way.

Everything above ships default-off and flag-off-byte-identical, so neither
option carries rollback cost. Awaiting the owner's call before entering C3.
