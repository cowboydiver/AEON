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
  emergent-ridge artifact therefore **survives this prototype**; the #102
  `bathymetryDatum` mechanism (below) later measured full tracking
  divergent even WITH the freeboard anchor, and re-keys only the ridge
  crest against an absolutely-anchored abyss.
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
  proud). This doc originally named freeboard as the isostatic anchor that
  would make a sea-level-relative curve feasible — the #102 measurement
  below found that anchor volumetrically too small for full tracking
  (~0.3 km-equivalent against a ~2.2 km-equivalent basin deficit), and
  shipped the crest-cap shape instead: see "The age-depth re-key (#102)".
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
elevation stays at trench order at every target — the table column is the
late-time mean of the per-keyframe minima; the per-keyframe extremes
across all runs span −6.0..−8.5 km, so no single-keyframe excursion hides
in the average — the −17.8 km ratchet stays dead and
`CONTINENTAL_BUOYANCY_FLOOR_M` needed no retuning. The shelf band itself
persists: the depth histogram's 0–150 m (shelf-level) and 150–500 m
buckets hold 1–2% and 5–13% of submerged continental cells at every
checkpoint, and the shallow-ocean share holds its Earth-like 6–7% of the
sphere at every target — the passive-margin shelf level is
target-independent, as designed. Sea level equilibrates at −3.4..−3.7 km
in all runs. Flipbooks (all three seeds at both 400 m and 800 m):
coherent continents with emergent cores, shelf halos and permanent
interior seas in every run — and the 800 m maps read no more emergent
than the 400 m maps on any seed, corroborating the numbers.

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
the current stack, WITHOUT the age-depth re-key follow-up. That follow-up
landed as the `bathymetryDatum` mechanism below — see its paired table for
how the combined stack moves the freeboard-side metrics.

## The age-depth re-key (#102): the `bathymetryDatum` mechanism — crest rides the sea, abyss anchors the volume

The last first-order residual: emergent mid-ocean ridge chains. The design
curve puts ridge crests at −2500 m absolute while the equilibrium sea rides
−3.4..−3.7 km, so every spreading center stands ~0.9–1.2 km proud as a
dotted island chain (measured baseline, seed 42: 20–80% of <20 Myr crust
emergent at late-time checkpoints). #102 scoped re-keying the curve to the
sea level, with three candidate shapes to prototype and measure. Measured
verdict: **full tracking has no equilibrium and cannot be conditioned by
freeboard; the shippable shape is a sea-keyed CREST against an absolute
abyss.** The mechanism is `bathymetryDatum` (default off,
`bathymetry.ts`/`datums.ts`, `--bathymetry-datum`, designed as the third
layer of the datum stack).

### The water budget rules first (measured before any re-key ran)

Whether ANY floor-tracks-sea shape can equilibrate is a volume question,
so it was measured first (seed 42, N=64, 4.5 Gyr, seaLevelDatums +
freeboard, no re-key). The conserved inventory is **1737 m
global-equivalent**; a fully-relaxed sea-keyed floor demands
`Σ|curve+sediment|` over oceanic cells — **3.9–4.1 km-equivalent** at every
late-time checkpoint (the age distribution is mature: mean |curve+sed|
5.2–5.7 km over 70–75% of the sphere). The deficit, +1.9..+2.3
km-equivalent, dwarfs the only slack in the system — flooded continental
crust holds just 0.2–0.47 km-equivalent, and the freeboard relaxation
resupplies volume at 20 m/Myr against an ocean-relief relax of 200 m/Myr.
The sim's ocean is *underfilled* relative to Earth-proportioned basins
(the #33 inventory was calibrated against the shallow t=0 hypsometry, and
deep-time basin maturation is exactly the sea-level plunge this document
opened with): the water to submerge the ridges 2.5 km Earth-style does not
exist in the inventory.

### Option 1 (full 1:1 tracking): measured divergent, exactly as the budget predicts

The issue's cheapest shape — every consumer adds the lagged `seaLevelM` to
the whole curve — was implemented first and run 4.5 Gyr on seed 42 (full
stack). The (sea, floor) pair co-falls at the ocean-relief relax rate from
the first step and never decelerates:

| t (Myr) | seaLevelM | mean freeboard | submerged cont. share | crest below sea |
|---|---|---|---|---|
| 100 | −19.6 km | +13.5 km | 0.1% | 2.27 km |
| 500 | −98.9 km | +34.6 km | 0.1% | 2.27 km |
| 2000 | −398.7 km | +27.1 km | 0.1% | (no <5 Myr crust at this keyframe) |
| 4500 | **−899.7 km** | +28.8 km | 0.4% | 2.28 km |

~197 m/Myr, metronomic. Two things worth keeping from the wreck: (a) the
co-falling geometry does submerge the crests ~2.3 km — the "fix" works
visually while destroying the datum; (b) freeboard is outrun ~10:1 (mean
freeboard blows out to +21..+35 km, flooded share collapses to ~0), which
settles the issue's option 3: the continental anchor cannot condition full
tracking, with or without a per-step convergence check. The per-step solve
never degenerates (each bisection sees a fixed hypsometry); the failure is
the dynamics of the lagged pair, i.e. the drift the issue scoped as the
risk.

There is also a conservation argument for why no UNIFORM tracking factor
can work: at any equilibrium of a `floor = f·sea + curve` family, the
flooded oceanic geometry satisfies `V_oc((1−f)·sea) = W − V_c`, so the
effective sea-against-curve level `(1−f)·sea` — which is what sets
crest submergence — is pinned by the same inventory at (almost) the same
value as today, minus only the V_c slack (≤ ~0.6 km of the needed ~2 km).
Partial tracking would stabilize the datum and leave the chains standing.

### The shipped shape: sea-keyed crest, absolute abyss, rescaled slope

`seaKeyedOceanicDepthForAge(age, offset)` (bathymetry.ts): the crest caps
at `seaLevelM − OCEAN_RIDGE_MIN_SUBMERGENCE_M` (1000 m), never shallower
than the −2500 m design crest and never below the abyss; the abyssal end
stays at −6000 m absolute; the √age slope rescales so the curve still
reaches the abyss at 100 Myr. All five consumers of the age-depth
reference read through it (subsidence target, trench pinning, divergent
gap fill, consolidation island flips, sediment shelf room), so trench/arc
exemptions and `sedimentM` stacking ride with it. Offset 0 (flag off /
pre-onset) returns the design curve bit-exactly — the byte-identity path
the main goldens pin. A sea within 1.5 km of the 0 m datum leaves the
curve untouched, so the mechanism engages smoothly as the deep-time sea
falls past −1500 m, with no onset shock.

Why this shape survives the budget: only the young ridge flank (<100 Myr)
tracks the sea, with weight fading to zero at the abyssal age — a small,
bounded volume (~0.15 km-equivalent at the equilibrium sea), not a new
basin to fill. The bulk hypsometry stays absolutely anchored, so the
sea-level solve keeps its slope by construction — the conditioning the
issue demanded, delivered by construction instead of demonstration. The
cost is honest and stated: ridge-to-abyss relief compresses from 3.5 km
to `(crest − abyss) = seaLevelM + 5000` ≈ 1.1–1.6 km at the equilibrium
sea. The 1000 m submergence is the shallow end of the issue's
1–2.5 km acceptance band deliberately: Earth's 2.5 km would put the crest
AT the abyss (zero relief). Earth gets both full relief and full
submergence by having ~0.9
km-equivalent more ocean than this world; buying the deeper crest means
revisiting the #33 water inventory, which is its own issue.

### Measured (paired, full stack, 3 golden seeds, 4.5 Gyr, N=64)

Stack-on (`seaLevelDatums + freeboard + bathymetryDatum`) vs
stack-off-this-flag, late-time aggregates (≥ 1.5 Gyr, 31 checkpoints at
100 Myr cadence), mean [min..max]. "crest below sea" is the mean elevation
of <5 Myr oceanic crust relative to `seaLevelM` (positive = submerged);
"emergent young" is the share of <20 Myr oceanic crust above the sea — the
visible chains:

| seed | arm | sea (m) | crest below sea (m) | emergent young | cont. crust | submerged cont. share | land % |
|---|---|---|---|---|---|---|---|
| 1 | off | −3503 | **−560** (proud) | **43.3%** [0..99.6] | 28.9% | 58.5% | 14.5% |
| 1 | on | −3688 | **+1142** [941..1538] | **1.8%** [0.1..7.6] | 22.2% | 51.0% | 11.8% |
| 42 | off | −3419 | **−481** (proud) | **37.3%** [0..98.7] | 27.5% | 43.9% | 18.0% |
| 42 | on | −3820 | **+1129** [1003..1242] | **2.2%** [0.2..7.4] | 22.3% | 51.2% | 11.4% |
| 1337 | off | −3709 | **−785** (proud) | **64.5%** [0..99.8] | 24.5% | 52.5% | 14.9% |
| 1337 | on | −3868 | **+1105** [990..1218] | **2.3%** [0.0..7.0] | 24.4% | 54.9% | 11.7% |

**The chains are gone, and the datum is stationary.** Ridge crests hold
1.0–1.5 km below the surface at essentially every late-time checkpoint on
every seed (the acceptance band); emergent young crust collapses from
"most spreading centers poke out somewhere" (per-checkpoint peaks of
99%+) to a 0–7% residual — trench-adjacent and arc cells, #91's
territory, not spreading centers. `seaLevelM` equilibrates ~200–400 m
deeper than baseline (the young flank's added capacity) and holds a
stable ±300 m band over 4.5 Gyr on all seeds: the crest-cap shape has
none of option 1's drift, as the absolute-abyss anchor guarantees.

**dt-invariance (the lag check the issue asked for):** seed 42, full
stack, `--step-years 0.5e6` vs the 1 Myr default, ≥ 2.5 Gyr means: sea
−3743 vs −3794 (1.3%), crest submergence 1155 vs 1136 m (1.7%), flooded
share 51.8 vs 49.3%, land 12.6 vs 11.9% — the (sea, floor) equilibrium is
dt-robust to halving; the one-step lag is observable per-step (as with
every lagged read in the kernel) but not in the equilibrium. The existing
golden/onset suites needed no carve-out — they pin fixed step sizes.

**The honest cost: the continental-creation budget thins.** Two of three
seeds lose 5–7 points of continental crust (28.9→22.2%, 27.5→22.3%;
seed 1337 unchanged at 24.5→24.4%) and all three lose 3–6.6 points of
land. Mechanism: in the baseline the young oceanic flank (−2500 m
absolute) sat ~1.4 km ABOVE the re-keyed arc-maturation gate
(`seaLevelM − 500` ≈ −3900 m), so a belt arc igniting on young crust was
born above the gate and matured essentially instantly — the emergent
ridge chains were feeding continental creation. The sea-keyed flank
starts at `seaLevelM − 1000..−1500`, below the gate, so arcs must climb
500–1000 m before maturing. The re-key is the more physical regime (arc
maturation should be earned, not inherited from an artifact), but it
means the #102 stack re-tunes what #101 measured — reported here rather
than silently absorbed, per the issue's pairing clause. The flooded share
itself moves within seed scatter (mixed signs), and mean freeboard stays
in its documented oscillation regime on all seeds.
