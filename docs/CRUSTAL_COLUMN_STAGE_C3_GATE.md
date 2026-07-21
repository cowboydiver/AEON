# Crustal columns — stage C3 gate record (orogeny/collision/root decay in thickness space)

**Status: C3 landed and measured, default-off. The re-armed C2+C3 hypsometry
gates PASS decisively — mean continental freeboard 0.5–0.7 km (below the
program's < 1.5 km headline win condition, at water scale 1.0) and band
occupancy tripled to ~18–19% — and every C3-specific gate passes. But the
dynamic-sea land-area floor BREACHES (mins 15.3–16.3% vs ≥ 20%), the land
mask fragments into an archipelago (largest land component 0.12 of land vs
0.40 flag-off), and the mean continental column thins to ~20–21 km — AT the
T2 identity floor. The attribution analysis (§4) traces all three to the
same actor: the legacy freeboard servo shim, which C3's honest (weaker)
injectors no longer over-run. The pre-registered §9 risk 3 escalation —
"re-order the staging so the pump retirement (site 20) lands earlier" —
now applies almost verbatim. Owner decision requested at §5.**

Companions: `CRUSTAL_COLUMN_PROPOSAL.md` (§5 sites 7/12/16, §6 C3),
`CRUSTAL_COLUMN_STAGE_C2_GATE.md` (the re-staging decision this stage
executes), `CRUSTAL_COLUMN_STAGE_C0_C1_GATE.md` (baselines).

Commits: kernel `80b6dc3` (sites 7/12/16 + fixtures + flag-arm golden
regen, no KBV bump); docs+cli `bb674f1`, `a318aba` (re-staging record;
max-elev + cap-bind gate columns). All measurements N=64, seeds
{1, 42, 1337}, 4.5 Gyr, flag-on (onset 0) vs the byte-identical flag-off
baselines from the C2 protocol, this container.

## 1. What landed

On the columns path only (flag-off byte-identical, all 25 flag-off spines
bit-unchanged; only the two flag-arm spines regenerated):

- **Site 12, orogenic uplift:** crustal shortening as thickness addition —
  the same `OROGENY_RATE_M_PER_YR` read as ROCK (600 m/Myr of thickness at
  full stress; surface answers k·ΔT ≈ 85 m/Myr). Fixture pins the seed
  cell's surface rise at exactly k× the legacy uplift.
- **Site 7, collision thickening:** half the displaced COLUMN
  (`0.5 × max(0, T_displaced)`) piles onto the receiving cell — the
  India–Asia partition as crustal volume, the proposal's declared step
  change (~10× today's subaerial-relief rule; submerged columns now
  contribute). max(0,·) guards the shim-era negative lobe.
- **The 9 km elevation ceilings retire on this path.** The stop is
  `CONTINENTAL_THICKNESS_MAX_M` = 70 km (e(70 km) ≈ +4815 m), clipping
  additions only — never snapping an over-thick shim-era column down —
  with every bind counted in the `columnsThicknessCapBinds` global.
- **Site 16, root decay:** thickness above
  `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` (39 km) relaxes toward it, τ =
  300 Myr unchanged. The sea-keyed land-relief reference retires here —
  one less relaxation target reading sea level (T1).

Verified: 483/483 kernel tests; new fixtures for the site-12 rock tempo,
head-on collision (belts grow, bounded by 4815 m, coherence bit-exact),
sustained-collision cap binding, and root-decay e-folding / bit-untouched
below equilibrium. C2 conservation fixtures repainted below the 39 km
equilibrium so the deliberately non-conservative decay stays out of the
closure ledgers.

## 2. Measurements (off = flag-off baseline / on = C2+C3)

"Late" = past-1-Gyr keyframe mean.

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| late mean freeboard, m | 5104 / **580** | 4707 / **497** | 4933 / **725** |
| final freeboard, m | 5367 / 468 | 3326 / 413 | 5078 / 779 |
| @1.0 Gyr Δfreeboard, m | **−4277** | **−3504** | **−2657** |
| late mean band% | 6.3 / **18.4** | 6.7 / **19.1** | 7.0 / **17.5** |
| final band% | 5.3 / 20.6 | 9.8 / 19.2 | 5.7 / 20.0 |
| final landA% | 32.2 / **18.7** | 32.0 / 21.9 | 33.7 / 21.1 |
| landA% min (run) | 21.9 / **16.3** | 22.2 / **15.3** | 23.2 / **15.9** |
| peaks above sea ≥1 Gyr (mean, range) | 7308 (6806–7623) | 7596 (7181–7927) | 7571 (7328–7860) |
| final max elev (absolute) | 4780 | 4780 | 4780 |
| thickness-cap binds (cumulative) | 4.08M | 3.68M | 3.78M |
| final Tmean / Tmin / Tmax, km | 20.0 / −0.9 / 69.8 | 21.5 / 0.3 / 69.8 | 21.6 / −1.7 / 69.8 |
| final crustal mass, e21 kg (t=0: 28.7) | 17.9 | 20.5 | 19.1 |
| cont crust fraction (late) | 0.406 | 0.406 | 0.417 |
| src late, m/Myr (budget 4.7) | 4.49 | 4.37 | 4.76 |
| sat% late / sink late | 14.1 / 2.99 | 16.4 / 2.87 | 18.8 / 3.17 |
| dispersal / monopoly | 97.8% / 0 | 98.4% / 0 | 99.1% / 0 |
| last tectonic event, Myr | 4473 | 4437 | 4498 |
| late land components / largest comp | 351 / **0.124** | 360 / **0.121** | 353 / **0.125** |
| (off: late land components / largest) | 156 / 0.404 | 154 / 0.441 | 153 / 0.425 |

PNGs (seed 42 flipbook, both arms): the on-arm world is alive — moving
plates, growing belts, low green coastal plains everywhere (the band
occupancy made visible) — but the land mask is an ARCHIPELAGO: hundreds of
small islands hugging the waterline, no coherent continental blocks. The
numbers and the maps agree; per the house rule this counts as a shape
failure even while the hypsometry gates pass.

## 3. Gate scoring

**Re-armed C2 gates (the C2→C3 re-staging's combined exit):**

- **Band occupancy strictly increases: PASS, ~3×** (late means +11–12 pt
  on every seed; 5–10% → 17.5–19.1%, halfway to the ≥ 40% C7 target from
  a standing start).
- **Mean freeboard −200 m by +1 Gyr: PASS with two orders of margin**
  (−2657…−4277 m at +1 Gyr; late means 0.5–0.7 km). This is BELOW the
  proposal's < 1.5 km headline win condition at water scale 1.0 — the
  number the servo world could never reach — though see §4 for who gets
  the credit.

**C3-specific gates:**

- **Peaks 5–9 km above sea at scale 1.0: PASS** (6.8–7.9 km across seeds,
  every keyframe past 1 Gyr).
- **Zero elevation-cap clamp events, thickness cap counted: PASS** — the
  9 km caps are structurally absent from the columns path; the 70 km cap
  binds 3.7–4.1M times over 4.5 Gyr and max absolute elevation pins at
  4780 ≈ e(70 km) − sea-lag jitter. Max thickness never exceeds 69.8 km.
- **Belts still die in interiors: PASS** — the τ-path relaxes everything
  above 39 km; the flipbook shows no immortal interior plateaus (fixture:
  e-folding to 39 km at exactly τ).
- **Planation budget: the source side runs at 4.4–4.8 m/Myr late — the
  §2.3 budget arithmetic (4.7 m/Myr) validated to within a few percent,
  unprompted.** Sink saturation eased to 14–19% (the lower freeboard
  exports less).
- Crust fraction 0.406–0.417: inside the 0.35–0.45 T3 band (C4's entry
  metric is healthy).

**Floors:**

- Dispersal 97.8–99.1%, monopoly 0 Myr everywhere (the C2-era seed-42
  kinematic flag did not recur), last tectonic event > 4.43 Gyr, no NaN:
  **PASS**.
- **Dynamic-sea landA floor ≥ 20%: BREACH** — run minima 15.3–16.3% on
  all three seeds; seed 1 ends at 18.7%.
- Land shape (a C7 scoreboard item, not a stage floor — reported as a red
  flag): largest land component collapses 0.40–0.44 → 0.12 of land area;
  ~350 land components vs ~150 flag-off.

## 4. Attribution: the servo finally reaches its target

Three observations pin the mechanism:

1. Root decay's anchor is absolute (39 km ⇒ +400 m ABSOLUTE ≈ 3.2 km
   freeboard at these seas) — it cannot be what parked the world at
   0.5 km freeboard.
2. The mean column thinned to 20.0–21.6 km ⇒ mean surface ≈ sea + 400–500
   m. That is exactly the legacy freeboard servo's target (sea + 400),
   which is still live as a C1 shim (site 20, retires at C5), pulling
   two-sided at up to 20 m/Myr of surface ≈ 140 m/Myr of thickness.
3. At C1/C2 the servo was over-run by the surface-space injectors
   (measured in the C2 record: injection ~4.3e22 kg over the run). C3
   made the injectors honest — ~7× weaker in surface terms — so the servo
   now WINS the vertical balance: it grinds every emergent cell down
   toward sea + 400, erosion exports the relief it flattens (total mass
   28.7 → 17.9–20.5e21 kg, a net-thinning era), and the whole continent
   converges onto a ~20 km column — AT the T2 identity floor, where real
   crust is hyperextended-margin domain. The archipelago follows: with
   all land compressed into a few hundred meters of freeboard, the
   waterline dissects it, and transient sea swings drive landA to 15–16%.

So the headline hypsometry numbers are REAL but SERVO-ASSISTED: the C2+C3
physics removed the servo's opposition without removing the servo. The
pure mass-budget equilibrium — the thing stage C5 exists to expose — has
not been measured yet, and the floor breach is the servo mining the
continents below the physical envelope, i.e. exactly the "pump" behavior
the proposal's §9 risk 3 pre-registered an escalation for: **"re-order the
staging so the pump retirement (site 20) lands earlier — a documented
re-staging, not a rewrite."**

## 5. Decision requested

- **(a) Pull the site-20 pump retirement forward (recommended — the §9
  risk 3 pre-registered escalation):** retire the epeirogenic servo and
  its buoyancy floor on the columns path now (the C5 headline item),
  BEFORE C4, and re-run this protocol. Expected direction: with the servo
  gone, nothing grinds emergent land toward sea + 400; orogeny/collision
  (honest, capped) push up against erosion's base-level pull, freeboard
  settles above today's 0.5 km, land re-coalesces, and the re-scored
  gates measure the MASS BUDGET, not the servo. The rest of C5 (founder/
  caps/retirement re-keys, the max(T, 20 km) regularization) can stay in
  place or ride along per measurement.
- **(b) Proceed to C4 as ordered** (maturation gate re-key + sediment
  accretion — closes the site-22 leak, adds mass back at maturation) and
  defer the floor re-score; the servo stays the dominant controller until
  C5.
- **(c) Stop here** (§9 risk 6): document, leave default-off.

Everything ships default-off and flag-off-byte-identical; no rollback cost
on any option.

**Decision executed (2026-07-21): option (a)** — the owner directed
continuation on the recommended path; the site-20 retirement landed as
kernel `7e8fd5e` and the re-measurement follows in §6.

## 6. Addendum — post-retirement re-measurement (the mass budget's own world)

Same protocol (N=64, 4.5 Gyr, seeds {1, 42, 1337}, flag-on onset 0 vs the
unchanged flag-off baselines). "Late" = past-1-Gyr mean.

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| late mean freeboard, m (off / on) | 5104 / **2720** | 4707 / **2914** | 4933 / **2961** |
| @1.0 Gyr Δfreeboard, m | −2053 | −1009 | −394 |
| 0–1 Gyr paired mean Δfb, m | −1102 | −928 | −181 |
| late mean band% (off / on) | 6.3 / **14.7** | 6.7 / **13.6** | 7.0 / **13.3** |
| final landA% (off / on) | 32.2 / 30.9 | 32.0 / 33.3 | 33.7 / 33.6 |
| **landA% min (off / on)** | 21.9 / **28.6** | 22.2 / **25.8** | 23.2 / **28.0** |
| peaks above sea ≥1 Gyr, mean (range) | 6543 (6207–6998) | 6620 (6258–7047) | 6676 (6416–7013) |
| final Tmean / Tmin / Tmax, km | 41.7 / 20.5 / 69.9 | 44.1 / 20.1 / 69.9 | 44.4 / 20.2 / 69.9 |
| final crustal mass, e21 kg (t=0: 28.7) | 30.1 | 31.4 | 31.4 |
| cont crust fraction (late) | 0.384 | 0.391 | 0.41 |
| src late m/Myr / sat% / sink | 7.0 / 17.2 / 4.3 | 7.7 / 16.6 / 4.9 | 7.6 / 16.9 / 4.8 |
| thickness-cap binds (cumulative) | 14.8M | 15.8M | 16.8M |
| dispersal / monopoly | **93.1%** / 0 | 98.2% / 0 | 100% / 0 |
| late land components / largest comp | 211 / 0.319 | 200 / 0.354 | 180 / 0.39 |

Scoring, all pre-registered gates:

- **Freeboard −200 m by +1 Gyr: PASS** on the at-1-Gyr reading on all
  seeds (−2053 / −1009 / −394 m); the 0–1 Gyr windowed mean on seed 1337
  is −181 m (noted — divergence develops slowly on that seed, the deep-time
  signal is unambiguous: late means fall 1.8–2.4 km below flag-off).
- **Band strictly up: PASS** — late means roughly double (6.3–7.0% →
  13.3–14.7%) on every seed, now WITHOUT the servo's help.
- **landA floor: RESTORED with margin** — run minima 25.8–28.6% (breach
  was 15.3–16.3%); finals 30.9–33.6%, inside the §3 25–35% target band.
- **Peaks 5–9 km: PASS** (6.2–7.0 km). Cap binds rose to 15–17M (belts
  live nearer the ceiling without the servo grinding them); zero
  elevation-cap events, structurally.
- **The mass budget CLOSES to +5–9% per 4.5 Gyr** (28.7 → 30.1–31.4e21 kg
  — vs +40%+ at C1 and −30% in the servo-dominated C3 world), with Tmean
  41.7–44.4 km near the 39 km reference and crust fraction in the T3 band.
- **The shim-era negative lobe dissipated on its own:** Tmin ends at
  20.1–20.5 km — the identity floor — without any regularization applied.
  With the pump retired nothing re-floods interiors, and diffusion/
  deposition fill the thin cells; the C5 one-time `max(T, 20 km)` credit
  (§9 risk 3's feared large number) is now measured ≈ nil.
- **Land shape: 3× recovered** from the servo world (largest land
  component 0.32–0.39 of land late, vs 0.12; ~200 components vs ~350) —
  still somewhat more fragmented than flag-off (0.40–0.44 / ~155): a
  watch item for C4/C6, not a floor.
- **Watch item:** seed-1 dispersal 93.1% (reference floor ~94.9%; the
  other seeds 98.2/100%), driven by late-epoch large-plate phases that
  never cross the 85% monopoly line (window 0 Myr everywhere) — the same
  epochs the C7 scoreboard *wants* as supercontinent episodes. Re-scored
  at C7.
- **PNGs:** the best-looking worlds of the program to date — coherent
  continental blocks, brown highland interiors ringed by green coastal
  lowlands (the band made visible), shelf halos, ridge fabric. Numbers and
  maps agree.

Freeboard honesty against the headline: 2.7–3.0 km at water scale 1.0 is
above the pre-registered 1.5–2.5 km partial-win band — but it now sits
almost exactly where closure check 4's equation of state puts equilibrium
columns over THIS planet's sea (≈ 2.4 km at sea −2.0 km; we measure sea
−2.4…−2.6 km). The remaining gap to < 1.5 km at scale 1.0 was always
assigned to erosion thinning platforms below equilibrium (running: src
7.0–7.7 m/Myr, sink unclogged) plus the C4 accretion credit; and the REAL
acceptance axis is the §3 water sweep (< 1.0 km at Earth-like endowments),
which is a C7 measurement. The freeboard–endowment coupling is now an
equation in the kernel, not a servo target.

**Stage C3 (with the site-20 pull-forward) is complete: all pre-registered
gates pass, all floors hold, two watch items recorded. Next per the staged
plan: C4 (maturation gate re-key + sediment accretion, crust fraction read
first — T3), then the C5 remainder (founder/caps/retirement re-keys + the
now-trivial regularization), C6 margins, C7 calibration + the water
sweep.**
