# Crustal-Column Redesign — Handover (Option B)

**Audience:** a fresh session picking this up with zero context. Read this
top to bottom before touching anything.

**Owner directive (verbatim):** "We should work towards a fundamental
physically correct model instead of endlessly tuning for a preferred
outcome. That would also allow for alternative-to-earth scenarios later
with different water amounts, gravity, solar radiation etc."

**Mission:** replace elevation-as-primary-state in `sim-kernel` with a
crustal-column model (per-cell crustal thickness; surface elevation
*derived* by isostasy), so that freeboard, cratonic emergence, block
foundering, and the land/relief balance become **emergent consequences of a
mass budget** instead of servo targets — and so that water inventory,
stellar luminosity, and (where physical) gravity become honest inputs that
flow through the physics instead of being neutralized by controllers.

This is promotion-scope kernel work: new field, new derivation, KBV bump,
golden regeneration, `ARCHITECTURE.md` update, staged flags, owner
sign-off at the promotion gate. Do not shortcut the process (§8).

---

## 1. Why — the measured case against more tuning

The default-settings sweep campaign (`DEFAULT_SETTINGS_SWEEP_FINDINGS.md`
§§1–13, ten rounds, ~40 deep-time runs) ended with these findings:

1. **The vertical axis is servos and clamps.** Every "isostasy" mechanism
   in the kernel (freeboard, blockIsostasy, orogenic root decay, founder
   clamps, passive margin, marine planation) is a prescribed target
   elevation plus a rate-bounded relaxation toward it. The constants audit
   (§4 below) counts ~19 servo-target constants, ~12 clamps, and ~11
   genuinely physical quantities. There is **no crustal thickness, no
   density, and no gravity anywhere in the kernel** (grep-verified).
2. **The rate race.** World character depends on a hand-ordered hierarchy
   of controller speeds: blockIsostasy 1e-3 m/yr > craton-prototype 1e-4 >
   freeboard regulator / margin subsidence 2e-5. Nothing physical enforces
   the ordering; flip any two and the world changes qualitatively.
3. **Water inventory is neutralized** (§10 of the sweep doc, measured):
   `--water-scale` 0.5–0.85 and `--initial-land-fraction` 0.38 converge to
   the same deep-time land fraction because the freeboard servo makes the
   continents track the sea down. Less water = *less* land. This is the
   direct blocker for alt-world scenarios.
4. **Knob-tuning has converged** (§13, round 10): the best tuned package
   ("r9-both", §6 below) is a measured local optimum. Doubling the craton
   uplift rate adds no land; raising the platform target degrades health;
   the land gap (21–25% vs Earth 29%) and freeboard gap (~2.5 km vs Earth
   ~0.8 km) trade 1:1 and are structural. Closing both requires land in
   the 200–800 m band — a hypsometry no elevation-target servo can produce
   without being told the answer.

The prior-art docs reach the same wall independently:
`SEA_LEVEL_DATUM_FINDINGS.md` documents that without a buoyancy-floor
*clamp* the freeboard servo ratcheted flooded interiors to **−17.8 km**
("flooded interiors — which no process ever lifts — have nowhere to
stop"), and its #101 sweep found `FREEBOARD_TARGET_M` "near-inert":
flooding "is the structural product of the orogeny→uniform-sink→retirement
pump and the floor it drains to, not of the datum the mean relaxes toward."

## 2. What exists today — state shape (surveyed 2026-07, KBV 18)

Verified facts, all with file:line. `KERNEL_BEHAVIOR_VERSION = 18`
(`constants.ts:297`; v18 promoted the datum trio `seaLevelDatums` /
`freeboard` / `bathymetryDatum` default-ON).

- **14 per-cell fields** (`fields.ts`), all `Float32Array` in flat
  cube-sphere order: elevation, crustAge, temperature, precipitation,
  iceFraction, biome, plateId, crustType, boundaryStress, sutureYears,
  sedimentM, windU, windV, marineLife. `ADVECTED_FIELDS` = elevation,
  crustAge, crustType, sutureYears, sedimentM (copied, never
  interpolated).
- **`elevation` is the sole primary vertical state.** Its `fields.ts:10`
  doc ("relative to the 0 m datum (sea level)") is stale — sea level is
  dynamic (`globals.seaLevelM`, solved per step by bisection against the
  hypsometry from the conserved `globals.waterInventoryM`).
- **Crustal thickness: does not exist.** Closest proxies: binary
  `crustType`; `sedimentM` (ocean-floor sediment thickness only);
  `COLLISION_THICKENING_FACTOR = 0.5` ("thickens", but expressed as
  elevation); block-area thresholds standing in for cratonic root strength.
- **Density: does not exist numerically.** Encoded categorically
  (`crustType` 0 subducts / 1 never) plus `CONTINENTAL_DRAG_MULTIPLIER`;
  slab pull is a force coefficient (`SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR =
  5e8`, Schellart 2004), not a density contrast.
- **Gravity: does not exist.** No g anywhere.
- **Already-honest physical inputs** (the alt-world hooks that exist):
  - `params.radiusMeters` (state.ts:29, default `EARTH_RADIUS_M`; no CLI
    flag) — used for cell area, plate velocities, torque balance, render
    displacement.
  - `params.starLuminosity` (state.ts:36) + `ORBITAL_DISTANCE_M`
    (constants.ts:1406) → `solarConstant()` (energyBalance.ts:66–69);
    no CLI flag; faint-star tests already scale it.
  - `globals.waterInventoryM` (state.ts:388) × `params.waterInventoryScale`
    (CLI `--water-scale`) — conserved, but currently neutralized (§1.3).
- **Pipeline order** (`step.ts:69–115`): tectonics → plateDynamics →
  wilson → crustFates → erosion → blockIsostasy → freeboard →
  energyBalance → winds → moisture → ice → **seaLevel** → carbon →
  marineLife → oxygen → biome → plateCensus. All elevation writers run
  before the seaLevel solve; every servo target keys on the *previous*
  step's sea level (the #33 explicit lag). Beware: step.ts:80–95 comments
  still call crustFates/freeboard "default-off prototype" — both are
  default-ON since v15/v18.

## 3. The complete elevation write-site inventory (21 sites)

Exhaustively verified (independent re-grep found no site beyond these).
This is the migration checklist: every row must have a thickness-space
answer (§5) before promotion.

| Site | Mechanism | Type today | Conserves? |
|---|---|---|---|
| initialTerrain.ts:62–79 | founding terrain (noise → power-law hypsometry) | prescribed founding | defines the budget |
| plates.ts:211/246 | t=0 oceanic snap onto age-depth curve | prescribed → curve | no |
| tectonics.ts:132 | oceanic thermal-subsidence relaxation (#15/#59) | servo, 2-sided, toward curve+sediment | no |
| tectonics.ts:166 | microcontinent founder clamp (−200 m) | hard clamp | area yes / elev no |
| tectonics.ts:239/242 | margin-consolidation pair flips (#67) | prescribed | continental cell count exactly |
| tectonics.ts:401 | plate advection (semi-Lagrangian gather) | transport | continental area; ocean consumed at subduction |
| tectonics.ts:549–552 | collision thickening (×0.5, cap 9 km) | derived + hard cap | partial by design |
| tectonics.ts:560 | bulldozer re-root onto ocean | prescribed transfer | value + area exactly |
| tectonics.ts:605 | ridge gap fill (new crust at crest) | prescribed founding | no (crust ex nihilo) |
| boundaries.ts:289/291 | volcanic-arc growth (1.25e-3 m/yr, cap 1 km) | rate + hard cap | no (magmatic) |
| boundaries.ts:298 | trench pinning (curve − 2500·norm) | hard-set while active | no |
| boundaries.ts:386 | orogenic uplift BFS spread (6e-4 m/yr, cap 9 km) | rate + hard cap | no |
| erosion.ts:149–150 | interior slope diffusion (#19) | physical diffusion | **yes** (antisymmetric) |
| erosion.ts:172 | coastal sediment export (#65) | physical, capped | **yes** (Σ cont elev + Σ sedimentM) |
| erosion.ts:193 | marine planation (#90) | servo (down) | yes (same ledger) |
| erosion.ts:212 | orogenic root decay (τ 300 Myr → +1 km ref) | servo (exp) | no (deliberate) |
| blockIsostasy.ts:121 | area-dependent elevation cap (#84, default-off) | servo (down) + clamp | no |
| crustFates.ts:183 | terrane-dock weld bridge (#88) | prescribed | area credit |
| crustFates.ts:216 | small-component founder + retirement | servo (down) | area debit at retirement |
| freeboard.ts:166–167 | epeirogenic uniform shift toward sea+400 | servo (2-sided) + floor clamp | no (deliberate) |
| freeboard.ts:170 | passive-margin subsidence toward sea−150 | servo (down) | no |

Non-writers worth knowing: `wilson.ts` and `plateDynamics.ts` never touch
elevation (the V2 trio is purely kinematic); erosion never writes oceanic
elevation (owned by the #15 relaxation); `codec.ts:86` quantizes elevation
u16 over [−11000, 9500] (~0.31 m step) on the render path only.

**Sediment-ledger exits** (critical for a mass budget): tectonics.ts:249–260
zeroes `sedimentM` on crust that just became continental — destroyed, not
folded into elevation; crustFates.ts:186 does the same at weld bridges.
A thickness model that makes sediment a column component must decide where
that mass goes instead.

**Arc maturation is the dominant continental-crust source** under the V2
defaults. Its geometry: arcs grow only under convergent stress, mature to
continental where elevation crosses `ARC_MATURATION_ELEVATION_M` (−500 m,
sea-keyed) *and* within `beltRadius = max(1, round(N/32))` cells of
pre-existing continental crust (boundaries.ts:216, 302–369;
`ARC_CREATION_REFERENCE_GRID_N = 32` scales both the growth rate and the
belt). Starving this source kills worlds: `compactArcs` / `emergentArcTaper`
each alone collapse crust to 4–9% of the sphere (measured; both are
documented INCOMPATIBLE with V2 defaults).

## 4. Constants triage (what survives, what retires)

From the full constants.ts audit:

- **Genuinely physical, keep as-is:** the Parsons & Sclater age-depth
  curve (`OCEAN_RIDGE_DEPTH_M` −2500, `OCEAN_SUBSIDENCE_K_M_PER_SQRT_YR`
  0.35, `OCEAN_ABYSSAL_DEPTH_M` −6000); `CONTINENTAL_CRUST_FRACTION` 0.4
  (Cogley 1984); `OROGENY_STRESS_REF_M_PER_YR` 0.05; slab-pull
  coefficients; `LAPSE_RATE_K_PER_M`; erosion diffusion magnitude;
  `COLLISION_THICKENING_FACTOR` 0.5 (India–Asia partition — becomes a real
  thickness statement).
- **Servo targets that should become *founding thicknesses* or vanish:**
  `FREEBOARD_TARGET_M` 400, `CONTINENTAL_BUOYANCY_FLOOR_M` −2500,
  `ARC_MATURATION_ELEVATION_M` −500, `MICROCONTINENT_FOUNDER_ELEVATION_M`
  −200, `PASSIVE_MARGIN_SHELF_M` −150, `SEDIMENT_SHELF_CEILING_M` −200,
  `OROGENIC_ROOT_REFERENCE_M` 1000, `OROGENY_MAX_ELEVATION_M` 9000,
  `ARC_MAX_ELEVATION_M` 1000, block-cap machinery.
- **Honest-about-tuning flags in the source comments** (respect the
  candor; these encode outcome constraints the new model must meet
  emergently): `EROSION_SUBSEA_FACTOR` ("land fraction fell to 7% in 800
  Myr" without it), `ARC_GROWTH_RATE_M_PER_YR` (twice retuned to protect
  the land budget), `OCEAN_RIDGE_MIN_SUBMERGENCE_M` (1000 m crest starves
  arc creation), `ICE_SHEET_WATER_EQUIV_M` (600 m picked for LGM-scale
  sea-level swing; real sheets ~2 km).

## 5. The design target and migration map

### 5.1 Core

- New advected field `crustalThicknessM` (append LAST in `fields.ts` —
  wire fieldId is `FIELD_NAMES.indexOf`; inserting earlier breaks codec
  goldens). Continental ~25–70 km, oceanic ~7 km. Sim-only at first (like
  `sedimentM`); joining the stored set needs a `QUANT_TABLE` entry +
  `HISTORY_FORMAT_VERSION` bump.
- **Elevation becomes derived**: one function
  `isostaticElevation(thickness, crustType, crustAge, sedimentM, …)`
  computes the surface from the column. Keep the `elevation` field as the
  cached result (recomputed after every thickness change) so the codec,
  renderer, climate stack, and sea-level solve are untouched. Airy balance
  with crust/mantle/water densities as **new, cited constants** (first
  densities in the kernel). Oceanic depth = thin-crust isostatic base +
  the existing P&S thermal-age term (half-space cooling is mantle-lid
  thermics, not crust thickness — the curve survives as the thermal
  component). Non-isostatic dynamic topography (active trench flexure)
  stays as an additive term while the margin is active.
- **Note on gravity:** surface elevation in pure Airy balance is
  gravity-independent (density ratios only). Do NOT add a fake gravity
  knob that scales elevation. Gravity legitimately enters: viscous
  relaxation/collapse timescales, erosion efficiency, atmosphere (lapse,
  scale height), and the age-depth coefficient. Wire it there or leave it
  out of v1 — say which, honestly.
- **Mass budget:** orogeny/collision move thickness; erosion thins and
  credits `sedimentM`; sediment accretes back as thickness at maturation
  (fixing the §3 ledger exits) or subducts; arc magmatism adds thickness
  (the one honest ex-nihilo source — real crust production); oceanic
  thickness is consumed at subduction; continental thickness never is.

### 5.2 What each write-site becomes

| Today | Thickness-space replacement |
|---|---|
| founding terrain noise (elevation) | founding **thickness** noise; hypsometry emerges via the derivation. Calibrate so t=0 land ≈ initialLandFraction still holds |
| t=0 oceanic snap | oceanic thickness 7 km + age inversion (unchanged concept) |
| thermal-subsidence servo | survives as the thermal term of the derivation (it was the physical one) |
| microcontinent founder clamp | founding thickness for stranded fragments; residual area-dependence, if needed, is parameterized flexural strength — keep it explicit and small |
| consolidation flips | copy thickness instead of elevation |
| advection | advect `crustalThicknessM` (swap into `ADVECTED_FIELDS`) |
| collision thickening ×0.5 + 9 km cap | true thickening: displaced column's thickness adds ×0.5; the cap becomes a **max-thickness** limit (~70 km, gravitational collapse — cited) |
| ridge gap fill | new crust: thickness 7 km, age 0 |
| arc growth + 1 km cap | magmatic thickness addition; the island-arc ceiling emerges from thin-column isostasy |
| arc maturation gate (−500 m) | a **thickness** gate (arc crust ≳ ~20 km is continental). THE most dangerous retune — see trap T3 |
| trench pinning | keep, as explicit dynamic-topography term (flexure, not isostasy) |
| erosion diffusion / coastal export | operate on thickness; isostatic rebound emerges (erode 1 km of rock, surface drops only ~150 m) — **this is what makes cratons emerge for free** and puts land in the 200–800 m band |
| marine planation | thickness export, same conservation ledger |
| orogenic root decay | thickness relaxation toward equilibrium continental thickness (τ 300 Myr survives; the target becomes physical) |
| blockIsostasy caps | mostly emergent (thin/small blocks stand low); any residual area term is declared flexure |
| crustFates founder/weld | thickness-space equivalents; retirement debit unchanged |
| freeboard epeirogenic servo | **RETIRED** — freeboard emerges from the density ratio and the mass budget |
| freeboard buoyancy floor | **RETIRED** — thick crust cannot sit deep, definitionally |
| passive-margin subsidence | rift-margin **thinning** (stretch factor at rift time) + thermal age; prototype may keep a constant rate first |
| craton emergence prototype (sweep §10) | **never needed** — its job is done by erosion+rebound |

### 5.3 Traps — prior art that must not be relearned the hard way

- **T1, age-depth re-key divergence** (`SEA_LEVEL_DATUM_FINDINGS.md`): a
  seafloor target that tracks sea level is unconditionally divergent
  (measured: sea at −899.7 km by 4.5 Gyr) and degenerates the sea-level
  solve. The derivation must keep ocean-floor elevation anchored so the
  #33 bisection stays well-posed (the conditioning test asserts volume
  slope > 0.2). If the isostatic derivation couples water load to
  elevation, use a fixed-count iteration and prove convergence.
- **T2, the buoyancy-floor lesson**: any scheme where a class of cells has
  "nowhere to stop" ratchets. In thickness space the floor is physical
  (min continental thickness), but check the equivalent: can any process
  thin crust without bound?
- **T3, the crest/maturation coupling**: `OCEAN_RIDGE_MIN_SUBMERGENCE_M`
  (500) deliberately equals |ARC_MATURATION_ELEVATION_M| (−500); a 1000 m
  crest measurably starves continental creation by 5–7 points of sphere.
  Converting the maturation gate to thickness changes the creation budget
  — re-measure crust fraction (target ~40%) before anything else.
- **T4, lapse keys off absolute altitude** (ARCHITECTURE.md): temperature
  lapse uses elevation above the fixed 0 datum, NOT seaLevelM. Preserve.
- **T5, water endowment**: conserved inventory is 1737 m global-equiv at
  scale 1; Earth-style 2.5 km ridge submergence needs ≈ scale 1.5–2
  (measured, `SEA_LEVEL_DATUM_FINDINGS.md`). The redesign should make
  `--water-scale` sweeps produce monotonic, believable land fractions —
  that is the alt-world acceptance test (§7).
- **T6, no fork inside a system**: per-step stochastic decisions use
  position/time hashes, never `rng.fork` inside a pure system.
- **T7, solid-angle areas**: per-cell area distortion is ±35%; use
  `cellSolidAngleTable`-based `areasM2`, never cells × mean area, anywhere
  area gates behavior.

## 6. Behavioral reference: the tuned "r9-both" package

The campaign's best world is the yardstick the physical model must match
or beat *emergently*. Package (measurement-only; lives in sweep worktrees
+ findings doc, NOT in the shipped kernel): hazard
`RIFT_HAZARD_AT_REF_PER_MYR` 0.0075→0.005, `CRUST_FATE_MERGE_GAP_CELLS`
2→4, `OROGENY_RATE_M_PER_YR` 6e-4→4e-4, `OROGENY_MAX_ELEVATION_M`
9000→6000, `PASSIVE_MARGIN_WIDTH_CELLS` 2→1, blockIsostasy ON, plus the
craton-emergence prototype (freeboard.ts term (3): flooded continental
interiors outside the margin band and under no convergent stress relax up
toward `seaLevel+400` at 1e-4 m/yr — exact patch in sweep doc §10/§12).

Measured at 4.5 Gyr, N=64, seeds {1, 42, 1337}: land 20.8/24.9/20.1%;
land-min 10.7/10.7/8.3%; monopoly 0 everywhere; dispersal 94.9–99.1%;
final largest land component up to 0.806 of land (s42; 95% of continental
crust in one block); peaks ~6 km above sea; mean freeboard 2.5–3.1 km.
Evidence frames: `docs/default-settings-sweep-evidence/r9-*.png`,
`r10-*.png` (the s42 3.6 Gyr frame is the campaign's best Pangea).

## 7. Acceptance gates for the redesign (all emergent, none tuned-in)

Health floors (4.5 Gyr, N=64, seeds {1, 42, 1337}, same instrumentation):
- Monopoly (>85% plate) window = 0 Myr; dispersal ≥ ~95%; last tectonic
  event > 4.4 Gyr; land min ≥ ~8%; no NaN (CLI tripwire enforces).
- Continental crust fraction ~0.35–0.45 of sphere (T3 guard).

Earth-likeness (match or beat r9-both):
- Land 20–29%, with supercontinent epochs where the largest land component
  ≥ 0.5 of land area; few ocean specks.
- Mean continental freeboard **< 1.5 km** (this is the number the servo
  model could not reach without land collapse — the redesign's headline
  win condition), peaks 5–9 km, land concentrated in the 200–800 m band.
- Hypsometry visibly bimodal; PNGs must look like continents (always
  inspect dumps — numbers pass while maps look wrong).

Alt-world honesty (the point of the exercise):
- `--water-scale` 0.5 / 1.0 / 1.5 / 2.0 → monotonically decreasing land
  fraction, all four worlds tectonically alive. (Currently falsified by
  the servo model — measured in sweep §10.)
- `starLuminosity` sweeps already work through the climate stack; keep it.
- Any gravity parameter must change only what gravity physically changes
  (§5.1); document what it deliberately does not touch.

Determinism: bit-identical goldens for {1, 42, 1337}; flag-off
byte-identical; onset A/B contract honored (no RNG in the new systems).

## 8. Process requirements (non-negotiable)

- **Staged mechanism posture** (the house pattern, used by every promotion
  to date): `crustalColumns: boolean` + `crustalColumnsOnsetYears` params;
  flag-off byte-identical; own golden spine; onset-gating test; CLI flag +
  `--ab` arm; entry in `mechanisms.ts`. `blockIsostasy` (#84) is the
  canonical template; the V2 pipeline (`TECTONICS_V2_PROPOSAL.md` →
  staged flags → scoreboard → stage-5 promotion) is the process template.
- Golden regen ONLY deliberately (`pnpm -F sim-kernel test -- -u`) with
  the physical reason in the commit and a `KERNEL_BEHAVIOR_VERSION` bump
  (→19+) in the same commit. Keep a pre-promotion default spine pinned
  verbatim (v17/v18 precedent).
- `docs/ARCHITECTURE.md` updated in the same commit as any field/system
  change. New field appended last (§5.1).
- Verification loop after every kernel change: `pnpm -F sim-kernel test`
  (~60–75 s; new non-invariant tests sub-second), then
  `pnpm sim -- --seed 42 --until 500e6 --report --dump elevation` and
  LOOK at the PNGs. Deep-time validation before any promotion claim:
  the §7 grid.
- **Owner sign-off is required at the promotion gate.** Design doc + A/B
  evidence first; nothing flips default without it.
- Commit style: small single-purpose commits; imperative subject; body
  states the physical behavior change and how it was verified.

## 9. Practical setup (the sweep harness, reproducible)

Scratch worktrees are ephemeral (container-local); rebuild the harness:

```
git worktree add --detach <dir> <commit>   # patch constants/system files
(cd <dir> && pnpm install --prefer-offline)
pnpm sim -- --seed <s> --until 4.5e9 --grid-n 64 --report --metrics \
  --crust-stats --suture-analysis [--block-isostasy] \
  --dump elevation --dump-every 15 --out <outdir>
# ~15–25 min per run at N=64; max 4 concurrent on a 4-core box.
```

Extraction: `metrics:` summary lines (dispersal, land min/max, monopoly,
land shape, final frame); checkpoint report row = `grep "^\s+4500\.0 Myr"
log | grep K` (col 3 land%, col 6 max elevation); crust-stats row = same
`| grep -v K` (col 3 seaLevel, col 4 crust fraction, col 5 freeboard,
col 6 submerged share). Peak above sea = report col 6 − crust-stats col 3.
**Open item:** report land% and metrics land% disagree (34.3% vs 24.9% on
the same final frame; definitions live at sim-cli `main.ts:464–514` vs
`metrics.ts`) — the campaign consistently used the metrics number; pin
down the discrepancy before defining gates on either.

Rendering notes: `LAND_VIZ_REF_M` 6000 in sim-cli `render.ts` saturates
dark brown at 6 km; N=64 renders belts 1–2 cells (~300–600 km) wide —
chunky but measurable; replicate any final calibration at N=128 (the
shipped default grid) before promotion.

Adjacent known gaps (not blockers; don't accidentally "fix" them here):
single global sea level → isolated seas impossible (issue not yet filed);
endorheic basins out of scope; freeboard oscillation (0.4–3.7 km swings)
documented in `SEA_LEVEL_DATUM_FINDINGS.md`.

## 10. Suggested phasing

1. **Phase 0 — ground truth.** Read `ARCHITECTURE.md`,
   `SEA_LEVEL_DATUM_FINDINGS.md` (mandatory), sweep findings §§10–13.
   Replay the r9-both baseline (§6/§9) to own the yardstick numbers.
2. **Phase 1 — design doc.** `CRUSTAL_COLUMN_PROPOSAL.md` in the V2
   proposal format: the derivation (with densities and citations), the
   §5.2 migration table resolved line by line, the T1–T7 trap answers,
   the acceptance grid. Owner reviews HERE, before code.
3. **Phase 2 — the field, flag-gated.** `crustalThicknessM` + derived
   elevation behind `crustalColumns` (default-off, byte-identical off).
   Founding synthesis such that flag-on t=0 hypsometry ≈ today's. Golden
   spine + onset test.
4. **Phase 3 — migrate mechanisms one at a time**, each with its own
   A/B measurement (the #66/#101 one-knob discipline). Order by risk:
   erosion/rebound first (the emergent-craton win), then orogeny/
   collision, then arc creation (T3 re-measure), then retire freeboard's
   servo, margins last.
5. **Phase 4 — calibration + promotion.** §7 acceptance grid across
   seeds and water scales, N=128 replication, scoreboard doc, owner
   sign-off, KBV bump + golden regen + pre-promotion spine.

---

*Provenance: kernel facts in §§2–5 were surveyed from the working tree at
sweep-branch head (KBV 18) by five parallel read-only survey passes plus
an adversarial completeness check (independent re-grep of all elevation
write forms; spot-checks of every constants table row); campaign numbers
in §§1, 6–7 are from `DEFAULT_SETTINGS_SWEEP_FINDINGS.md` §§10–13 and the
round-10 logs.*
