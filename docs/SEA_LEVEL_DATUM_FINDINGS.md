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

## Follow-up: freeboard regulation (the real fix)

The re-keying makes the platform constants correct in any sea-level regime;
it does not change the regime. Earth keeps ~25% of continental crust
flooded because isostasy regulates **freeboard**: continental surface
floats a few hundred metres above a sea level pinned near the shelf edge,
erosion planes land toward it, and epeirogeny/flexure let interiors dip
below it. The equivalent kernel mechanism (a future prototype, measurable
with the same A/B harness) would:

1. relax mean continental elevation toward a target freeboard **relative
   to `seaLevelM`** (slow, rate-bounded — the isostatic anchor that stops
   the sea falling away from the continents, and the prerequisite for
   re-keying the age-depth curve);
2. stamp rift margins (`wilson.ts` has the rift event and the carve
   geometry) with post-rift thermal subsidence toward shelf depth over
   ~100 Myr — passive-margin shelves;
3. revisit the water inventory / initial hypsometry so the equilibrium
   coastline sits inside the continental-crust boundary rather than
   exactly on it.

They are complementary, not exclusive: this prototype is the groundwork
(correct units), freeboard regulation is the physics (correct regime).
Also worth fixing independently: the sim-cli `land%` column should count
`elevation >= seaLevelM`.
