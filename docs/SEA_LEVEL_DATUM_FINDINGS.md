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
at `seaLevelM − OCEAN_RIDGE_MIN_SUBMERGENCE_M` (500 m — set AT the arc
maturation gate depth; the calibration story is under "Measured" below),
never shallower than the −2500 m design crest and never below the abyss;
the abyssal end stays at −6000 m absolute; the √age slope rescales so the
curve still reaches the abyss at 100 Myr. All five consumers of the
age-depth reference read through it (subsidence target, trench pinning,
divergent gap fill, consolidation island flips, sediment shelf room), so
trench/arc exemptions and `sedimentM` stacking ride with it. Offset 0
(flag off / pre-onset) returns the design curve bit-exactly — the
byte-identity path the main goldens pin. A sea above
`OCEAN_RIDGE_DEPTH_M − OCEAN_RIDGE_MIN_SUBMERGENCE_M` (−2000 m) leaves
the curve untouched, so the mechanism engages smoothly as the deep-time
sea falls past that level, with no onset shock.

Why this shape survives the budget: only the young ridge flank (<100 Myr)
tracks the sea, with weight fading to zero at the abyssal age — a small,
bounded volume (~0.1 km-equivalent at the equilibrium sea), not a new
basin to fill. The bulk hypsometry stays absolutely anchored, so the
sea-level solve keeps its slope by construction — the conditioning the
issue demanded, delivered by construction instead of demonstration. The
cost is honest and stated: ridge-to-abyss relief compresses from 3.5 km
to `(crest − abyss) = seaLevelM + 5500` ≈ 1.7–2 km at the equilibrium
sea, and crests sit shallower than Earth's 2.5 km — Earth gets both full
relief and full submergence by having ~0.9 km-equivalent more ocean than
this world; buying a deeper crest means revisiting the #33 water
inventory, which is its own issue.

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
| 1 | on | −3567 | **+738** [534..896] | **1.7%** [0.0..6.0] | 26.7% | 54.0% | 13.3% |
| 42 | off | −3419 | **−481** (proud) | **37.3%** [0..98.7] | 27.5% | 43.9% | 18.0% |
| 42 | on | −3579 | **+723** [499..831] | **1.9%** [0.0..4.2] | 27.5% | 46.8% | 15.5% |
| 1337 | off | −3709 | **−785** (proud) | **64.5%** [0..99.8] | 24.5% | 52.5% | 14.9% |
| 1337 | on | −3785 | **+686** [472..891] | **2.5%** [0.4..6.7] | 22.8% | 47.4% | 12.5% |

**The chains are gone, and the datum is stationary.** Ridge crests hold
~0.5–0.9 km below the surface at essentially every late-time checkpoint
on every seed; emergent young crust collapses from "most spreading
centers poke out somewhere" (per-checkpoint peaks of 99%+) to a 0–7%
residual — trench-adjacent and arc cells, #91's territory, not spreading
centers. `seaLevelM` equilibrates ~100–160 m deeper than baseline (the
young flank's added capacity) and holds a stable band over 4.5 Gyr on
all seeds: the crest-cap shape has none of option 1's drift, as the
absolute-abyss anchor guarantees. Freeboard-side metrics hold within
seed scatter: continental crust −2.2/0.0/−1.7 points, flooded share
mixed signs, land −1.2..−2.5 points (the emergent chains WERE land —
retiring them accounts for most of the land delta).

**Shallow-ocean share and the deep floor** (paired `--crust-stats`
arms, ≥ 1.5 Gyr means): the <500 m shallow share moves 6.6→5.5% /
6.8→5.0% / 6.5→5.3% (seeds 1/42/1337) — the baseline's near-surface
young-flank band thins as the compressed relief drops flanks away from
the waterline faster, while the sediment-shelf halos (ceiling at
`seaLevelM − 200`) are untouched; the share stays in the Earth-like
5–7% band the datum stack restored, far above the pre-stack 1–7% decay.
Per-keyframe minimum elevation stays at trench order on every arm
(−6.5..−8.5 km) — the re-key wakes no deep ratchet.

**Calibrating the crest depth: 1000 m was measured first, and lost.**
The issue guessed an acceptance band of "crests ~1–2.5 km below the
surface", so the first paired campaign ran
`OCEAN_RIDGE_MIN_SUBMERGENCE_M = 1000` (all three seeds, 4.5 Gyr). It
retires the chains just as completely (emergent young 1.8–2.3%, crests
1.10–1.14 km down, sea stable at −3.7..−3.9 km) — and costs 5–7 points
of continental crust on seeds 1/42 (28.9→22.2%, 27.5→22.3%, means below
the 24.6% #101 floor) plus 3–6.6 points of land on every seed.
Mechanism: in the baseline, the young oceanic flank (−2500 m absolute)
sat ~1.4 km ABOVE the re-keyed arc-maturation gate (`seaLevelM − 500` ≈
−3900 m), so a belt arc igniting on young crust was born above the gate
and matured essentially instantly — the emergent ridge chains had been
feeding continental creation. A 1000 m crest starts arcs 500 m below the
gate, and the creation budget starves. Shipping the crest AT the gate —
`OCEAN_RIDGE_MIN_SUBMERGENCE_M = 500 = |ARC_MATURATION_ELEVATION_M|` —
keeps arc ignition sites at the maturation threshold the #101 world was
calibrated with, restores the continental budget (the headline table),
and retires the chains identically (probe table: seed 42 cont-crust
27.5→27.5%, emergent young 1.9%). The equality of the two constants is a
design coupling, not a coincidence: if the maturation gate ever moves,
the crest should move with it. The stated residual: mean crest
submergence ~0.7 km sits below the issue's speculative band — that band
was written against Earth's 2.5 km, which this world's water inventory
cannot buy (the budget above); the binding acceptance ("emergent ridge
chains gone; emergent only where arcs justify it") is met.

**#101 re-measured on the combined stack** (the issue's pairing clause):
`FREEBOARD_TARGET_M = 800` × all three seeds on the full stack. Flooded
share moves with mixed signs inside the per-checkpoint scatter, land
holds within ±1.8 points, and the cont-crust regression #101 saw at high
targets on seed 42 does not reappear. The #101 conclusion transfers
unchanged to the re-keyed world: the freeboard target is not the
flooded-share knob, and it stays at its cleanly-anchored 400 m.

**dt-invariance (the lag check the issue asked for):** seed 42, full
stack at the shipped 500 m crest, `--step-years 0.5e6` vs the 1 Myr
default, ≥ 2.5 Gyr means: sea −3719 vs −3529 m (Δ190 m ≈ 5%, inside the
single-run late-time range of −3766..−3134 m), crest submergence 711 vs
729 m (2.5%); the continental/land means differ at chaotic
trajectory-scatter level (cont 23.1 vs 26.7%, against a per-checkpoint
range of 22.1..34.2), as any dt change reshuffles the tectonic
trajectory. No tolerance was pre-declared by the issue; the operative
one applied here is "inside the equilibrium's own late-time
min..max band", which both datum quantities meet with margin. The same
check during the 1000 m calibration campaign matched to 1.3–1.7% on
every column. The (sea, floor) equilibrium —
what the lag could plausibly poison — is dt-robust; the one-step lag is
observable per-step (as with every lagged read in the kernel) but not
in the equilibrium. The existing golden/onset suites needed no
carve-out — they pin fixed step sizes.

**Solver convergence (the issue's per-step ask, translated):** the #33
solve is a FIXED-count bisection (`SEA_LEVEL_SOLVE_ITERATIONS = 40`,
deterministic by design — never a convergence loop), so "iteration count
per step" is constant and the meaningful margin is bracket precision:
`(maxElev − minElev) / 2^40` ≈ 2×10⁻⁸ m at the observed ~20 km elevation
range, identical on- and off-stack — degradation would require the
elevation range to grow by orders of magnitude, which is exactly the
option-1 drift mode. The conditioning regression test
(`bathymetryDatum.test.ts`) runs the full stack through the
fastest-moving first 100 Myr asserting the volume-function slope at every
solved level stays above 0.2 (it is the flooded fraction, ~0.85 in
practice) and every per-step sea move stays inside the physical rate
envelope — the two quantities that would actually degenerate if the
sea-tracking fraction of the hypsometry approached 1.

**Flipbooks at the shipped 500 m crest** (elevation, all three seeds,
frames every 250 Myr, re-dumped after the calibration and inspected
against the #101 baseline set): the baseline's dotted green chains
crossing every open ocean are gone at mid- and late-time on all seeds —
spreading centers read as soft submerged ribbons a shade lighter than
the abyss (seed 1's late-time mid-ocean triple junction is entirely
underwater). The emergent linear features that remain hug continental
margins (arcs and shelf-edge peaks, #91's residual, present in both
arms); trenches, arc belts, and shelf halos stay put, and continents
stay coherent with emergent cores. Numbers passing AND the chains
visibly gone — the failure mode the issue warned about did not occur.

**Shipped state:** `bathymetryDatum` default OFF (measurement prototype,
same posture as the rest of the datum stack), `--bathymetry-datum` CLI
flag and `--ab bathymetry-datum` arm, web-sidebar toggle via the
mechanism registry, own golden-spine entry and onset-gating arm, main
goldens byte-identical. Follow-ups this pass surfaced, each its own
measurement: the #33 water-inventory revisit (the only route to Earth's
2.5 km crest submergence AND full ridge relief), and the flooded-share
overshoot (#101's residual, unchanged by this mechanism).

## The water-inventory parameter (#105): endowment as a chosen property

The #102 budget above diagnosed the emergent-ridge-chain artifact as, at
root, a **water-deficit** artifact: the derived inventory (~1.74 km-equiv at
seed 42, N=64) fills only ~45% of the mature basins' Earth-proportioned
capacity, so the deep-time sea falls ~3.5 km and the design ridge crests
(−2500 m absolute) poke out. #102 fixed the *symptom* with the crest cap; #105
addresses the *cause* by making the endowment a planet parameter instead of an
artifact of the terrain noise.

`waterInventoryScale` (default **1.0**) is a dimensionless multiplier on the
derived base — the ocean volume below the t=0 coastline, still derived so the
scale composes with a companion `initialLandFraction` (#106) and grid
resolution as base × scale. The default multiplies by exactly 1.0, so the
inventory and every field are byte-identical to the pre-#105 kernel (the main
goldens pin it). It is init-time only, consumes no RNG, and carries no
mechanism flag/onset — a `PlanetParams` number like `numPlates`.

### The early-flooding ("waterworld") regime

At scale > 1 the t=0 sea is still pinned to 0 by construction (the calibration
forces `seaLevelM = 0` at init), but the very first `seaLevel` solve lifts the
sea far above the initial coastline: the extra water has nowhere to go until the
basins deepen and freeboard floats the continents out. Seed 42, N=64, full
datum stack, first-Gyr trajectory (10 Myr cadence, `--crust-stats`):

| t (Myr) | seaLevelM | land % | submerged cont. | shallow % |
|---|---|---|---|---|
| 0 | 0 (pinned) | 30.0% | 25.0% | 10.0% |
| 10 | **+1477** | 8.4% | 80.3% | 2.9% |
| 30 | +1025 | 12.3% | 69.7% | 7.7% |
| 50 | +585 | 13.1% | 66.8% | 8.3% |
| 80 | +66 | 13.6% | 65.4% | 6.9% |
| 90 | −93 | 13.6% | 65.5% | 6.6% |
| 150 | −535 | 11.8% | 69.9% | 3.4% |
| 300 | −451 | 12.6% | 67.7% | 5.7% |

The sea jumps ~1.5 km above the initial coastline at the first solve (10 Myr:
land collapses 30→8%, 80% of continental crust drowned), then freeboard floats
the continents out and the sea returns below the t=0 datum at **~85 Myr** —
matching the issue's "~85 Myr per km of gap at 20 m/Myr" estimate almost
exactly. After that the planet rejoins the ordinary deep-time fall, ~1 km
higher than the default-scale sea at every late checkpoint. The phase length
scales with the endowment (the sweep's "waterworld end" column below: 0 → 20 →
70–80 Myr → a permanent ocean at scale 2.7). It is a genuine transient, not a
pathology: land fraction and continental crust recover as freeboard does its
work, and the water-mass invariant is exact at every scale — ocean +
grounded-ice-equivalent equals the scaled inventory every step.

### The scale/seed sweep (full datum stack on, 4.5 Gyr, N=64)

Late-time aggregates (≥ 1.5 Gyr means, 100 Myr cadence). "emergent young" is the
#102 instrument — the share of <20 Myr oceanic crust standing above the sea (the
visible chains), mean [min..max]; "crest below sea" is the mean elevation of
<5 Myr oceanic crust relative to `seaLevelM` (positive = submerged); "waterworld
end" is the last time the sea stands above the t=0 coastline datum.

| seed | scale | late sea (m) | crest below sea | emergent young | land % | cont. crust | flooded cont. | shallow % | waterworld end |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.0 | −3566 | +726 | 1.8% [0..11.4] | 13.1% | 26.6% | 54.7% | 4.4% | 0 |
| 1 | 1.5 | −2418 | +826 | 2.7% [0..11.4] | 10.1% | 20.3% | 54.3% | 2.7% | 20 Myr |
| 1 | 2.0 | −1252 | +1606 | 3.2% [0..15.0] | 9.2% | 19.0% | 55.1% | 2.0% | 70 Myr |
| 1 | 2.7 | +273 | +3055 | 2.3% [0..12.4] | 7.6% | 17.7% | 60.7% | 1.6% | 4500 Myr |
| 42 | 1.0 | −3583 | +729 | 2.0% [0..11.2] | 15.6% | 27.5% | 46.5% | 4.1% | 0 |
| 42 | 1.5 | −2513 | +818 | 3.5% [0..17.0] | 10.4% | 23.1% | 57.9% | 2.8% | 20 Myr |
| 42 | 2.0 | −1425 | +1428 | 2.1% [0..8.4] | 10.3% | 18.1% | 47.0% | 2.2% | 80 Myr |
| 42 | 2.7 | +196 | +3008 | 2.0% [0..7.3] | 10.0% | 18.9% | 50.9% | 1.6% | 4500 Myr |
| 1337 | 1.0 | −3788 | +691 | 2.5% [0..10.0] | 12.4% | 22.7% | 47.9% | 4.6% | 0 |
| 1337 | 1.5 | −2535 | +828 | 2.5% [0..15.1] | 11.7% | 23.8% | 55.0% | 2.8% | 20 Myr |
| 1337 | 2.0 | −1169 | +1709 | 1.9% [0..6.6] | 12.7% | 25.0% | 52.9% | 2.4% | 70 Myr |
| 1337 | 2.7 | −32 | +2761 | 2.4% [0..10.2] | 8.4% | 18.4% | 58.7% | 1.5% | 3910 Myr |

Reading the sweep:

- **Late-time sea rises ~1.9 km per +1.0 scale**, monotonically on every seed
  (seed 42: −3583 → −2513 → −1425 → +196). The derived base is ~1.74 km-equiv
  (seed 42); Earth's ~2.6 km-equiv is ≈ scale 1.5, which raises the late sea
  ~1.07 km over the default — the issue's "~2.6 km-equiv raises the late-time
  sea by ~1 km" prediction, confirmed.
- **Crest submergence tracks the sea, as designed.** With the cap on, "crest
  below sea" holds ~0.7–0.8 km at scales 1.0–1.5 (the cap is doing the work);
  once the sea clears the −2000 m engagement level (scale ≥ 2.0) the cap
  disengages and the crests ride at their absolute −2500 m, now **1.4–3.1 km
  below the risen sea** — native submergence. Scale 2.0 lands crests 1.4–1.7 km
  down (the issue's "1–2.5 km" band); scale 2.7 reaches ~2.8–3.1 km, past
  Earth's 2.5 km.
- **Emergent young stays retired at every scale** (1.8–3.5%) — the chains never
  come back, whether the cap retires them (low water) or the risen sea drowns
  them (high water).
- **The losers, stated:** continental crust falls with water (seed 42:
  27.5 → 18–19%; seed 1: 26.6 → 17.7%) — more flooding and marine planation
  retire continental crust — and **land fraction drops** (seed 42: 15.6 → 10%;
  seed 1: 13.1 → 7.6%). The shallow-ocean band also thins (4–5% → 1.5–2.2%) as
  the compressed relief drops flanks past the waterline faster. Scale 2.7 is a
  **permanent waterworld** on two of three seeds (sea stays above the t=0 datum
  for ~4 Gyr; 7.6–10% land). More water is a real planet-diversity knob, not a
  free upgrade: it buys native crest submergence at the cost of continental
  crust, land, and shelf. (Seed 1337 is the mildest — its continental budget
  even rises slightly through scale 2.0 before falling — so the cost is
  seed-dependent, not uniform.)

### Native submergence: does more water retire the chains without the crest cap?

The #102 crest cap is a shape-fix: it holds ridge crests submerged when the sea
is too low for them to drown on their own. If a larger endowment raises the sea
above the crest, the crests should submerge natively and the cap becomes
redundant. Measured directly — the same scale-2.0/2.7 cells run with
`bathymetryDatum` **off** (`seaLevelDatums + freeboard` still on):

| seed | scale | late sea (m) | crest below sea | emergent young | cont. crust | land % |
|---|---|---|---|---|---|---|
| 1 | 2.0 | −1252 | +1606 | 3.2% [0..15.0] | 19.0% | 9.2% |
| 1 | 2.7 | +273 | +3055 | 2.3% [0..12.4] | 17.7% | 7.6% |
| 42 | 2.0 | −1425 | +1428 | 2.1% [0..8.4] | 18.1% | 10.3% |
| 42 | 2.7 | +196 | +3008 | 2.0% [0..7.3] | 18.9% | 10.0% |
| 1337 | 2.0 | −1169 | +1709 | 1.9% [0..6.6] | 25.0% | 12.7% |
| 1337 | 2.7 | −32 | +2761 | 2.4% [0..10.2] | 18.4% | 8.4% |

**These rows are byte-identical to the cap-ON sweep above.** At scale ≥ 2.0 the
late sea rides above −2000 m, so the cap self-disengages and `bathymetryDatum`
on/off produce the same history to the last bit — direct confirmation of the
compose-safely-by-construction claim. And emergent young is still 1.9–3.2%: the
chains are retired **natively** by the higher water, with the cap contributing
nothing. Contrast the #102 baseline (scale 1.0, cap off, the "off" rows of the
mechanism table above): emergent young 37–65%, the full chain artifact. Raising
the endowment from 1.0 to 2.0 collapses it to ~2–3% with no datum re-key at all.

**Where the crest cap earns its keep vs where it is redundant:** the cap engages
only when the late sea sits below −2000 m — the low-water regime (scale ≲ 1.7,
including the default 1.0, where the sea equilibrates ~−3.5 km). There it is
essential: without it the ridge crests (−2500 m absolute) stand ~1 km proud and
the chains return (37–65% emergent young). On high-water worlds (scale ≳ 2.0)
the risen sea drowns the crests on its own and the cap is redundant — inert by
construction. So the two mechanisms are complementary, not competing: the crest
cap is the low-water world's fix, a larger inventory is the high-water world's,
and neither perturbs the other. The endowment at which the chains retire without
the cap is **≈ scale 2.0** (late sea ≈ −1.2 to −1.4 km), and the price is the
loser column above: ~8 points of continental crust and a thinner, more flooded
world.

### Shipped state

`waterInventoryScale` default 1.0 (byte-identical goldens), `--water-scale`
CLI flag (validated > 0), a non-default golden arm (scale 2.0, seed 42, 10
steps, with a `seaLevelM > 0` engagement assertion so it pins the flooded
path). The scale/seed sweep and native-submergence campaign above were run at
N=64, 4.5 Gyr, full datum stack, on all three golden seeds; the early-flooding
trajectory at 10 Myr cadence. Follow-up surfaced: at the endowments that
submerge the crests natively (scale ≳ 2.0) the #102 crest cap is redundant — a
candidate for simplifying the datum stack on high-water worlds — and the
continental-crust cost of high water (the loser column) is worth its own
tectonic-budget study.

## The initial-land-fraction parameter (#106): the t=0 coastline as a chosen property

`INITIAL_LAND_FRACTION = 0.3` fixed every planet's t=0 coastline — the initial
terrain placed its sea quantile so ~30% of cells stood above the 0 m datum. That
was a scaffold-spec number, not a physical constraint. `initialLandFraction`
(default **0.3**) makes it a `PlanetParams` knob: `applyInitialTerrain` places
the sea quantile at `1 − initialLandFraction`, so a planet can start
ocean-dominated or land-dominated. The default is the same `0.3` literal, so a
default planet's t=0 fields — and the main goldens — are byte-identical to the
pre-#106 kernel.

It is the companion to `waterInventoryScale` (#105) and composes with it by
construction. The conserved water inventory is *derived* from the shaped
coastline (the ocean volume below the datum, `createInitialState`), so a lower
land fraction re-derives a larger, self-consistent inventory automatically —
t=0 sea level stays exactly 0 at any value. Land fraction shapes the initial
world (the derived base); water scale sets the endowment relative to it (base ×
scale). This is why #105 factored its knob as a scale rather than an absolute.

**The crust-fraction hard edge (issue decision (2), option (a)).**
`CONTINENTAL_CRUST_FRACTION` stays pinned at the Cogley-anchored 40% while the
land fraction varies — one literature-anchored value, no second knob. The gap
between the two is the initial submerged continental shelf, so holding crust
fraction fixed makes the initial flooded share *vary* with the land parameter
(less land ⇒ more shelf — physical). At land fraction ≥ crust fraction the sea
quantile falls below the crust quantile: every continental cell is emergent, the
oceanic highs between the two quantiles snap down onto the age-depth curve in the
plates pass, and the shelf starves. So `initialLandFraction` is validated to
`0 < f < 0.4` at the CLI (the kernel trusts the value, like `numPlates`).

### The t=0 construction across the range (seed 42, N=64, sea level 0 by construction)

| start land | measured land | cont. crust | flooded cont. | shallow % | flooded = (0.4−f)/0.4 |
|---|---|---|---|---|---|
| 0.10 | 10.0% | 40.0% | 75.0% | 9.1% | 75.0% ✓ |
| 0.30 | 30.0% | 40.0% | 25.0% | 10.0% | 25.0% ✓ |
| 0.39 | 39.0% | 40.0% | 2.5% | 1.0% | 2.5% ✓ |

The measured coastline lands exactly on the requested fraction, and the flooded
shelf share tracks `(0.4 − f)/0.4` to the grid quantum — the shelf is 75% of the
continental crust at an ocean-dominated 0.1 start, the Earth-like 25% at the
default, and a thin 2.5% at the land-dominated edge. The t=0 elevation dumps at
{0.1, 0.3, 0.39} are the *same* seed-42 terrain with the waterline riding up or
down the identical noise: coherent coastlines, Earth-like hypsometry (green
lowland fringes, sparse brown interior peaks, shelf halos), no static-noise
speckle — the land-height/ocean-depth/exponent constants calibrated against the
30% split stay coherent across the range. **The over-edge case, measured:** at
`f = 0.5` (> the 0.4 crust fraction) the real emergent land caps at ~40% (the
oceanic highs snap down) and *no* continental crust is submerged — the shelf is
gone. `globals.landFraction` still reads ~0.5 (terrain sets it before the plates
snap), the tell that the regime is inconsistent, and exactly why the knob is
clamped below the crust fraction.

### The deep-time convergence sweep: does the planet forget its coastline?

The interesting question: after 4.5 Gyr, does the *initial* land fraction still
matter, or does the tectonic continental-crust equilibrium erase it? Sweep:
initial land {0.1, 0.3, 0.39} × the golden seeds, 4.5 Gyr, full datum stack
(`seaLevelDatums + freeboard + bathymetryDatum`, `crustFates + marinePlanation`
default-on), N=64. Late-time aggregates are ≥ 1.5 Gyr means (100 Myr cadence),
against the dynamic sea level. (Cross-check: the seed-42 / 0.3 row below —
the shipped default — reproduces the #105 scale-1.0 baseline to under a percent:
sea −3579 vs −3583, land 15.5 vs 15.6%, crust 27.5%, flooded 46.8 vs 46.5%. The
harness agrees with the prior campaign.)

| seed | start land | late sea (m) | late land % | late cont. crust | late flooded cont. | late land min |
|---|---|---|---|---|---|---|
| 1 | 10% | −3143 | 9.7% | 21.5% | 58.0% | 6.9% |
| 1 | 30% | −3567 | 13.3% | 26.7% | 54.0% | 9.5% |
| 1 | 39% | −3762 | 11.0% | 23.0% | 54.2% | 8.5% |
| 42 | 10% | −3315 | 10.9% | 21.9% | 53.6% | 7.7% |
| 42 | 30% | −3579 | 15.5% | 27.5% | 46.8% | 10.6% |
| 42 | 39% | −3690 | 15.1% | 26.8% | 48.8% | 9.7% |
| 1337 | 10% | −3245 | 11.9% | 23.3% | 51.8% | 9.9% |
| 1337 | 30% | −3785 | 12.5% | 22.8% | 47.4% | 8.9% |
| 1337 | 39% | −3904 | 12.0% | 25.8% | 56.4% | 9.4% |

**The answer is partial convergence, and it splits by variable:**

- **Continental crust strongly converges to the tectonic attractor.** A 29-point
  starting spread (10% → 39% land, a 4× range) collapses to a late-time crust
  band of 21.5–27.5% across all nine runs (per-seed spread 3.0–5.6 points). The
  start ordering is largely erased — on seed 1337 it even inverts (the 0.1 start
  ends with *more* crust than the 0.3 start, 23.3 vs 22.8%). The continental
  budget is set by tectonic creation/destruction equilibrium, and it forgets the
  coastline it started from. For late-time continental crust the parameter is
  **mostly cosmetic** — an honest finding.
- **Late sea level does NOT converge — it stays monotonic in the start on every
  seed.** −3143/−3567/−3762 (seed 1), −3315/−3579/−3690 (seed 42),
  −3245/−3785/−3904 (seed 1337): ~600 m of surviving spread, always higher sea
  for the lower land fraction. This is the *water-endowment* signature, not the
  coastline geometry — the low-land start derived a larger inventory and the
  extra water is still on the planet 4.5 Gyr later. It is the same lever #105
  pulls directly, reached here through the geometry.
- **Late land fraction: the low-land (high-water) start ends lowest on all three
  seeds** (9.7 / 10.9 / 11.9% vs 11–15.5% for the 0.3/0.39 starts). The endowment
  coupling — more water ⇒ more flooding ⇒ less emergent land, retiring crust
  through marine planation — survives deep time. The 0.3 and 0.39 starts, by
  contrast, land within seed-scatter of each other (seed 42: 15.5 vs 15.1%): they
  begin at the same 40% crust with only a thin-shelf difference and near-equal
  inventories, so that difference IS forgotten. Only the ocean-dominated start,
  which is genuinely a high-water world, stays distinguishable.

**The reconciliation:** `initialLandFraction` is a water-endowment knob in
disguise, because the inventory is derived from the coastline. Late worlds
remember the *endowment* (a monotonic sea-level offset and a persistent low-land
tilt on ocean-dominated starts), not the *shape* (continental crust is pulled to
the tectonic attractor regardless). So it is neither purely cosmetic nor a strong
late-time land-diversity knob: it is a modest, physically-grounded diversity knob
for late-time sea level and emergent land, and it does its work through the water
inventory rather than through the initial continental geometry.

**The loser, stated:** the 0.1 start pushes the late-time land *minimum* to
6.9–9.9% — below the informal 10% land floor on seeds 1 and 42 — the same
near-waterworld cost #105 documents for high `waterInventoryScale`, reached here
from the other side. An ocean-dominated start is a real, if not free, planet
choice.

### Shipped state

`initialLandFraction` default 0.3 (byte-identical goldens — the sea quantile uses
the same `0.3` literal, so the main goldens pin it unregenerated),
`--initial-land-fraction` CLI flag (validated `0 < f < CONTINENTAL_CRUST_FRACTION`),
a non-default golden arm (0.15, seed 42, 10 steps, with a `landFraction ≈ 0.15`
engagement assertion pinning the ocean-dominated path). Unit tests pin the
default byte-identity, the measured coastline and pinned t=0 sea level across the
range, the derived-inventory monotonicity, the `base(f) × scale` composition with
#105, and the quantile edge cases (f → 0 and the degenerate f ≥ crust fraction).
The t=0 dumps and the convergence sweep above were run at N=64, 4.5 Gyr, full
datum stack, on all three golden seeds. Follow-up surfaced: the parameter's
deep-time reach is the derived water inventory it sets, so on the continental
budget it and `waterInventoryScale` are two handles on one lever — a candidate
for documenting them jointly as "the endowment" rather than as independent knobs.
