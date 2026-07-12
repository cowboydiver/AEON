# Sea-level datum findings — why late-time worlds have no shallow seas

Diagnosis of two late-simulation observations (2026-07-12): continental
crust looks lace-ridden and jagged, and the oceans sit exclusively on
oceanic plates — no continental shelves, no epicontinental seas, while on
Earth ~25% of continental crust is flooded. The first observation is the
known boundary-process lace (#60/#67/#88 territory, measured in
PHASE_2_STAGE0_FINDINGS.md and ISSUE_88_91_FINDINGS.md). The second traces
to a datum inconsistency this document measures, plus the `seaLevelDatums`
mechanism prototype that re-keys the affected constants.

## The measurement: the sea-level plunge beaches every shelf

Seed 42, N=64, default mechanisms, 4.5 Gyr. Per checkpoint: the dynamic sea
level, continental crust share of the sphere, the share of continental
crust that is submerged (`elevation < seaLevelM`), and the share of ocean
area sitting on continental crust:

| t (Gyr) | seaLevelM | cont. crust | submerged share of cont. crust | ocean area on cont. crust |
|---|---|---|---|---|
| 0.0 | 0 m | 40.0% | **25.0%** | **14.3%** |
| 0.5 | −2830 m | 33.8% | 0.0% | 0.0% |
| 1.0 | −3025 m | 24.6% | 0.1% | 0.0% |
| 2.0 | −3011 m | 20.7% | 0.0% | 0.0% |
| 3.0 | −3287 m | 17.1% | 0.0% | 0.0% |
| 4.5 | −3501 m | 17.1% | 0.0% | 0.0% |

At t=0 the world is Earth-like **by construction**: `crustType` is the top
40% elevation quantile with the threshold below the 0 m datum, so a quarter
of continental crust starts as submerged shelf. Then the initial seafloor
ages onto the #15 age-depth curve and the basins mature toward the −6000 m
abyssal floor. The water inventory is conserved (#33, calibrated against
the shallow t=0 bathymetry), so the same water sits ~3 km lower in the
matured basins: sea level falls to −2830 m within 500 Myr and never
recovers. Every initial shelf is stranded kilometres above the waterline —
permanently, because **no process ever pushes continental crust below the
dynamic sea level**:

- coastal sediment export (#65) grades to `seaLevelM` and is explicitly
  clamped never to draw a cell below it;
- orogeny, arc growth and collision thickening only raise;
- rifting (#18, `wilson.ts`) changes plate kinematics only — it never
  writes elevation, so there is no rift-margin stretching or thermal
  subsidence (the process that builds Earth's wide passive-margin
  shelves);
- there is no isostatic coupling between continental elevation and sea
  level at all (no freeboard regulation).

The direction of the fall is documented and intended ("sea level also
falls over early deep time as ocean basins mature", ARCHITECTURE.md); the
consequence that was not appreciated is its **magnitude relative to the
datum-anchored constants**.

## The stranded constants

Every constant that means "submerged platform" or "near the surface" is
written as an absolute elevation against the 0 m datum, correct only while
sea level ≈ 0. With the sea at −3.0 to −3.5 km:

| constant | value | design intent | actual late-time meaning |
|---|---|---|---|
| `MICROCONTINENT_FOUNDER_ELEVATION_M` | −200 m | Zealandia-style drowned platform | a **dry island** ~3 km above the sea |
| `SEDIMENT_SHELF_CEILING_M` | −200 m | "a filled shelf is shallow platform, never land" | filled shelves stand ~3 km proud of the ocean as coastal plain |
| `ARC_MATURATION_ELEVATION_M` | −500 m | arcs mature "well before they emerge" | arcs emerge ~2.5 km before maturing |
| `ARC_MAX_ELEVATION_M` | +1000 m | "1 km island ceiling" | a 4.5 km emergent massif ceiling |
| `blockElevationCap` base (#84) | −200 m | founder as submerged platform | founder as standing island |
| ridge crest / abyss (`bathymetry.ts`) | −2500 / −6000 m | seafloor depths | the **ridge crest is emergent land** (−2500 > seaLevelM) — visible as dotted chains crossing late-time elevation dumps |

Two knock-on semantic breaks: `crustFates` retirement assumes a component
at the founder level is "already invisible in the land mask — no popping",
which is false once the sea is 3 km below it (retirement pops a visible
3 km plateau into ocean); and the sim-cli report's `land%` column counts
`elevation >= 0` while the kernel's actual coastline is `seaLevelM`, so the
CLI under-reports emergent area by the continental cells sitting between
the two levels.

## The `seaLevelDatums` mechanism (prototype, default off)

Re-keys the platform/arc datums to the dynamic sea level: the affected call
sites add `platformDatumOffsetM(state)` (= previous step's `seaLevelM` when
the mechanism is active, exactly 0 when off — `datums.ts`) to the constants
above. Affected: the tectonics founder clamp, the erosion shelf-ceiling
room (both export paths) and marine-planation target, the arc maturation
gate and island ceiling, the crustFates founder/retirement level, and the
whole `blockElevationCap` ramp. Same posture and plumbing as the #84/#88–#91
prototypes: `seaLevelDatums` + `seaLevelDatumsOnsetYears` params, no RNG
consumed, flag-off byte-identical (main goldens unchanged), its own golden
spine, onset-gating test, `--sea-level-datums` CLI flag and A/B mechanism,
web-sidebar toggle via the mechanism registry.

**Deliberately NOT re-keyed:**

- **The oceanic age-depth curve** (ridge −2500 m / abyss −6000 m). Sea
  level is solved by filling the hypsometry with a conserved water volume.
  If the seafloor relaxation target tracked sea level, every metre of floor
  subsidence would lower the sea by ~a metre (flooded depth per ocean cell
  stays constant), which lowers next step's target again — an unbounded
  downward drift at the relaxation rate, and in the limit a degenerate
  sea-level solve (ocean volume independent of the level). Anchoring the
  seafloor absolutely is what keeps the #33 bisection well-posed. The
  emergent-ridge artifact therefore **survives this prototype** and needs
  the freeboard follow-up below.
- **The land-relief constants** (`OROGENY_MAX_ELEVATION_M`,
  `OROGENIC_ROOT_REFERENCE_M`). Physically these are also
  sea-level-relative ("9 km peaks", "1 km residual root"), but re-keying
  them re-tunes orogeny and erosion budgets planet-wide — freeboard-fix
  territory, not a datum shift. (Exception: `blockElevationCap`'s top end
  moves with its ramp, since the cap is a freeboard by definition; the #84
  system is default-off.)

### Measured (seed 42, N=64, 4.5 Gyr, mechanism on from t=0)

Paired against the baseline table above (same seed/grid/duration; baseline
shallow-ocean share for comparison in the last column):

| t (Gyr) | seaLevelM | cont. crust | submerged share of cont. crust | shallow (<500 m) share of ocean | baseline shallow share |
|---|---|---|---|---|---|
| 0.5 | −2761 m | 34.8% | 0.0% | 6.8% | 3.1% |
| 1.5 | −2900 m | 25.8% | 0.5% | **13.3%** | 5.2% |
| 2.5 | −3226 m | 22.2% | 0.0% | 9.8% | 6.8% |
| 3.5 | −3216 m | 23.8% | 0.2% | **11.6%** | 2.9% |
| 4.5 | −3034 m | 24.6% | 0.0% | **12.3%** | 1.1% |

**What the re-key fixes.** The shallow-ocean share recovers from the
baseline's 1–7% decay to a sustained 7–13% (t=0 is 14.3%): the re-keyed
sediment ceiling builds genuine shelf fringes 200 m below the actual
waterline, visible as shallow margins around the continents in the
elevation dumps. Arc maturation happens submerged again, foundered
platforms sit underwater, and crustFates retirement is again invisible in
the land mask (no popping) — all four semantic breaks from the table above
are closed. The final-state world holds more continental crust (24.6% vs
17.1%) — the maturation gate at `seaLevelM − 500` is reachable from the
abyssal floor with ~2.5 km of arc growth instead of ~5.5 km, so creation
outpaces consumption at a higher equilibrium.

**What it deliberately does not fix (measured residuals).**

- **Submerged share of continental crust stays ≈0** (0.0–0.5% vs Earth's
  ~25%). Two reasons, both anticipated: drowned platforms are now real but
  *transient* — once a small component sits below the (re-keyed) founder
  level, `crustFates` retires its crust record to oceanic, so persistent
  submerged continental crust never accumulates; and large continents
  still never subside below sea level, because nothing regulates
  freeboard. The "oceans floating on continental crust" goal needs the
  follow-up below, not more datum work.
- **Continents stand very high**: final mean continental elevation is
  ~4.8 km (baseline ~3.2 km) because the land-relief constants are not
  re-keyed — orogenic root decay still stops at +1 km *absolute*, which is
  ~4 km above the fallen sea, and the extra continental area feeds more
  collision uplift. Freeboard territory again.
- The **emergent ridge chains** survive (age-depth curve stays absolute,
  see above).

## Freeboard regulation: the `freeboard` mechanism (the real fix, implemented)

The re-keying makes the platform constants correct in any sea-level regime;
it does not change the regime. Earth keeps ~25% of continental crust
flooded because isostasy regulates **freeboard**: continental surface
floats a few hundred metres above a sea level pinned near the shelf edge,
erosion planes land toward it, and epeirogeny/flexure let interiors dip
below it. The `freeboard` mechanism (default off, `systems/freeboard.ts`,
same posture and plumbing as the prototypes above) implements the three
scoped pieces:

1. **Epeirogenic relaxation** — the cell-count mean of continental
   elevation relaxes toward `seaLevelM + FREEBOARD_TARGET_M` (400 m — the
   t=0 construction measures 380–450 m across the golden seeds, and Earth's
   continental-crust mean is a few hundred metres) by a UNIFORM shift of
   every continental cell, rate-bounded at `FREEBOARD_RELAX_M_PER_YR`
   (20 m/Myr, the order of the early sea-level fall itself). Uniform =
   isostatic motion of the floating column: relief is preserved, orogeny
   and erosion keep ownership of shape. The downward shift stops at the
   **buoyancy floor** `seaLevelM + CONTINENTAL_BUOYANCY_FLOOR_M` (−2500 m —
   Zealandia/Kerguelen-order drowned-platform depths; see below for the
   measured failure that forced it).
2. **Passive-margin subsidence** — continental cells within
   `PASSIVE_MARGIN_WIDTH_CELLS` (2) of a SAME-PLATE oceanic 4-neighbor
   (same-plate adjacency IS the passive-margin definition; convergent
   cells excluded — orogeny owns them) subside toward `seaLevelM +
   PASSIVE_MARGIN_SHELF_M` (−150 m) at 20 m/Myr (~2 km/100 Myr, the
   McKenzie post-rift total as a mean rate — no per-cell rift clock, no
   new field). The band is measured from oceanic crust only, so flooded
   margin cells (still continental) never let the shelf creep inland.
3. **Land-relief datum re-key** — `OROGENIC_ROOT_REFERENCE_M` (erosion) and
   `OROGENY_MAX_ELEVATION_M` (boundaries orogeny cap, tectonics collision
   cap) become sea-level-relative via `landDatumOffsetM` (datums.ts),
   closing the "continents stand ~4.8 km" residual: mountains now cap 9 km
   above the SEA and roots decay toward 1 km above it. This re-key belongs
   to freeboard, not to `seaLevelDatums`, exactly as scoped above — it
   changes the orogeny/erosion regime, not just units.

Same contract as every mechanism prototype: no RNG, flag-off byte-identical
(main goldens unchanged), its own golden spine and onset-gating arm,
`--freeboard` CLI flag and `--ab freeboard`, web-sidebar toggle via the
registry. Also fixed alongside (unconditional, CLI-only): the report's
`land%` column and the `--dump` hypsometric ocean/land split now key off
`keyframe.globals.seaLevelM` instead of the stranded 0 m datum — both were
lying about late-time worlds by every cell between the two levels.

### The buoyancy floor (a measured failure, fixed)

The first cut had no floor. Measured (seed 42, N=64): the regulation held
mean freeboard at ~400 m, but minimum elevation ratcheted to **−17.8 km by
1.7 Gyr** and sea level drifted to −4.2 km. Mechanism: orogeny keeps
injecting elevation into active belts, the compensating uniform sink drags
everything else down, and flooded interiors — which no process ever
lifts — have nowhere to stop; their subsidence adds ocean capacity, so the
sea follows them down (a slow, rate-bounded cousin of the age-depth
runaway above). The floor ends it: continental crust is too buoyant to
visit abyssal depths, so the shift never pushes a cell below
`seaLevelM − 2500 m` (cells already below — trench-landed collision
debris — are left alone, never lifted). Post-floor, minimum elevation stays
at trench order (−6.7..−8.5 km) and sea level equilibrates at −3.3..−3.7 km.

### Measured (seed 42, N=64, 4.5 Gyr, freeboard + seaLevelDatums on from t=0)

| t (Gyr) | seaLevelM | cont. crust | mean freeboard | submerged share of cont. crust | ocean area on cont. crust |
|---|---|---|---|---|---|
| 0.0 | 0 m | 40.0% | 383 m | 25.0% | 14.3% |
| 0.5 | −3730 m | 35.9% | 428 m | **65.3%** | **27.3%** |
| 1.5 | −3503 m | 25.2% | 1902 m | 49.8% | 14.9% |
| 2.5 | −3646 m | 27.2% | 797 m | 57.6% | 18.4% |
| 3.5 | −3072 m | 29.8% | 3248 m | 34.8% | 13.1% |
| 4.5 | −3649 m | 30.0% | 593 m | **60.5%** | **21.8%** |

**The regime is changed.** Flooded continental crust — 0% forever in the
baseline, still ≈0% under `seaLevelDatums` alone — is now permanent and
first-order: 30–65% of continental crust submerged at every checkpoint
(Earth: ~25%), and 9–27% of ocean area sits ON continental crust (Earth:
~17%). These are epicontinental seas and shelves, not transient drowned
fragments. Land fraction runs 14–20% of the sphere; the shallow-ocean
(<500 m) share holds 4–10% (Earth's shelf seas: ~7–8%); peak elevation
rides at `seaLevelM + 9 km` by construction. Continental crust equilibrates
at 24–36% of the sphere (final 30.0%) — healthier than both the 17.1%
baseline and the 24.6% of `seaLevelDatums` alone.

Dynamics worth knowing when reading histories: the mean freeboard
**oscillates** (0.4–3.7 km) instead of pinning at the target. The swings
are real events, not noise — collisions inject elevation faster than the
20 m/Myr relaxation removes it, and when a drowned platform's crust record
retires (`crustFates`), removing deep cells RAISES the survivors' mean in
one step; relaxation then works it back down over ~100–200 Myr. The
retirement pathway also means drowning is now a real crust sink: flooding →
fragment isolation → retirement is how this world recycles continental
crust, at a rate the 24–36% equilibrium shows is sustainable.

**Pairing matters:** freeboard measured WITHOUT `seaLevelDatums` decays
continental crust to 13–16% of the sphere (the absolute −500 m arc
maturation gate sits ~3 km above the fallen sea, so creation starves while
drowning-retirement keeps consuming). The two mechanisms are designed to
run together; the web sidebar and CLI leave them independently togglable
for exactly this kind of isolation measurement.

**Scope item 3 (water inventory) — resolved without touching it.** The
follow-up scoped "revisit the water inventory / initial hypsometry so the
equilibrium coastline sits inside the continental-crust boundary". With
freeboard on, it does: a fifth to a quarter of the late-time ocean floor IS
continental crust. The conserved inventory and its invariant stay exactly
as #33 built them; `FREEBOARD_TARGET_M` was the presumed calibration knob
for the flooded share (it runs ~2× Earth's). The #101 sweep below measured
that presumption and found it false: the flooded share is insensitive to
the target across 400–800 m.

### Remaining residuals (all pre-existing, none introduced)

- **Emergent ridge chains** still cross the late-time oceans: the age-depth
  curve stays absolute (ridge −2500 m vs sea ~−3600 m ⇒ crests stand ~1 km
  proud). Freeboard provides the isostatic anchor this doc named as the
  prerequisite for re-keying it, so a sea-level-relative age-depth curve is
  now a *feasible* follow-on prototype — but it still needs its own care:
  the sea-level solve degenerates as the fraction of sea-tracking floor
  approaches 1, so the re-key must leave enough absolutely-anchored (or
  continental) hypsometry near the waterline to keep the bisection
  conditioned.
- The **flooded share (~45–60%) overshoots Earth's ~25%** — measured by
  the #101 sweep below to be structural, NOT a `FREEBOARD_TARGET_M`
  calibration question: the target stays at its cleanly-anchored 400 m.
- **Freeboard oscillation** (above): a faster relaxation rate would pin the
  target more tightly at the cost of more aggressive drowning after every
  orogenic pulse; 20 m/Myr was chosen to match the driver, not to
  critically damp the loop.

## The `FREEBOARD_TARGET_M` sweep (#101): the target is not the flooded-share knob

The residual above scoped raising the target toward 600–800 m to trade
flooded area for land. Measured (#66-style constants-only sweep:
`FREEBOARD_TARGET_M` ∈ {400, 600, 800} × seeds {1, 42, 1337}, N=64,
4.5 Gyr, freeboard + seaLevelDatums on from t=0 — the designed pairing;
per-keyframe stats from the `--crust-stats` harness this pass promoted
into sim-cli). Late-time aggregates (≥1.5 Gyr, 301 keyframes per run),
mean [min..max]:

| target | seed | submerged share of cont. crust | land % of sphere | cont. crust | ocean on cont. crust | shallow (<500 m) | mean freeboard | min elev (mean) |
|---|---|---|---|---|---|---|---|---|
| 400 m | 1 | 58.5% [48.0..67.7] | 14.6% | 29.0% | 19.8% | 6.6% | 975 m | −7438 m |
| 400 m | 42 | 43.7% [26.3..63.9] | 18.2% | 27.5% | 14.7% | 6.8% | 2346 m | −7854 m |
| 400 m | 1337 | 52.7% [36.8..63.2] | 14.9% | 24.7% | 15.4% | 6.5% | 1412 m | −8042 m |
| 600 m | 1 | 56.1% [43.9..62.9] | 14.2% | 26.7% | 17.5% | 6.2% | 1089 m | −7476 m |
| 600 m | 42 | 47.5% [25.3..64.1] | 15.2% | **22.6%** | 12.7% | 6.0% | 1945 m | −7933 m |
| 600 m | 1337 | 52.5% [27.1..63.8] | 15.2% | 25.5% | 15.9% | 7.2% | 1552 m | −7940 m |
| 800 m | 1 | 55.9% [40.2..64.9] | 14.3% | 27.1% | 17.7% | 6.6% | 1193 m | −7643 m |
| 800 m | 42 | 47.2% [29.4..61.8] | 15.4% | **23.3%** | 13.0% | 6.4% | 1877 m | −7956 m |
| 800 m | 1337 | 49.0% [26.1..61.7] | 17.1% | 28.1% | 16.8% | 6.8% | 1828 m | −7948 m |

**The knob is near-inert.** Submerged share averages 51.6% / 52.0% / 50.7%
across the three targets — flat within seed scatter, nowhere near the
20–40% acceptance band. Land does not move up (14.6/18.2/14.9% at 400 vs
14.3/15.4/17.1% at 800); ocean-on-continental-crust and the shallow-ocean
share are equally flat. The only systematic response is the wrong one:
seed 42's continental-crust equilibrium REGRESSES at the higher targets
(27.5% at 400 → 22.6/23.3%, below the 24.6% seaLevelDatums-alone floor) —
a higher target holds continents further above the arc-maturation gate's
reach for longer, so the creation side thins while drowning-retirement
keeps consuming.

**Why the target cannot matter, mechanically.** Two measurements:

1. **The relaxation is rate-bound, not target-bound.** Mean freeboard
   rides 1–2.3 km above ANY of these targets through most of deep time
   (the documented oscillation: collisions and retirement events inject
   mean elevation faster than 20 m/Myr removes it). While the mean is
   above the target the epeirogenic shift is downward at the full rate
   bound regardless of whether the stop is 400 or 800 m — the targets
   only choose where the descent would end, and it rarely gets there.
2. **The flooded lobe is deep.** Depth histogram of submerged continental
   cells (seed 42, target 400): only ~2–15% of flooded cells sit within
   500 m of the sea; 46–73% sit 2–2.5+ km down, piled against the
   buoyancy floor. A few hundred metres of extra target can emerge only
   the thin near-surface layer — ~2–3 points of submerged share, exactly
   the non-signal the table shows. Flooding is the structural product of
   the orogeny→uniform-sink→retirement pump and the floor it drains to,
   not of the datum the mean relaxes toward.

**Couplings verified across all 9 runs** (the issue's watch-list): minimum
elevation stays at trench order (−6.0..−8.5 km) at every target — the
−17.8 km ratchet stays dead and `CONTINENTAL_BUOYANCY_FLOOR_M` needed no
retuning; the shallow-ocean share holds its Earth-like 6–7% of the sphere
everywhere — the passive-margin shelf level is target-independent, as
designed; sea level equilibrates at −3.4..−3.7 km in all runs. Flipbooks
(all three seeds at 400 m, seed 42 at 800 m for the A/B): coherent
continents with emergent cores, shelf halos and permanent interior seas in
every run — and the 800 m maps read no more emergent than the 400 m maps,
corroborating the numbers.

**Decision: `FREEBOARD_TARGET_M` stays 400 m** — the cleanly-anchored
value (t=0 construction + Earth's continental mean). Raising it buys
nothing measurable, costs continental crust on one golden seed, and
abandons the anchor. No golden hashes change (main goldens were never
touchable — the constant is read only behind the flag — and the flag-on
freeboard spine is byte-identical because the shipped value is unchanged).
The flooded-share overshoot survives as a real residual, now with its
ownership corrected: the next knobs are the oscillation
(`FREEBOARD_RELAX_M_PER_YR` — though a faster rate pins the mean by
pumping DOWN harder after every event, which the depth histogram suggests
would deepen flooding, not relieve it) and the shape of the flooded lobe
itself (the buoyancy floor / drowning-retirement pathway). Each needs its
own measurement pass — one knob at a time, per the #66/#101 discipline.

Baseline note (the issue's pairing clause): these numbers were measured on
the current stack, WITHOUT the age-depth re-key follow-up. If that lands,
it reshapes late-time hypsometry and this table should be re-measured
against the combined stack.
