# Crustal-Column Model — Proposal (Option B, phase 1)

**Status: proposal, no code.** Replace elevation-as-primary-state with a
per-cell crustal column — thickness primary, surface elevation *derived* by
isostasy — so freeboard, cratonic emergence, block foundering and the
land/relief balance become consequences of a mass budget instead of servo
targets, and so water inventory, stellar luminosity and (where physical)
gravity become honest inputs.

Companions: `CRUSTAL_COLUMN_HANDOVER.md` (mission, write-site inventory,
traps — read first), `CRUSTAL_COLUMN_PHASE0_BASELINE.md` (the replicated
r9-both yardstick and the land-instrument correction this proposal builds
on), `SEA_LEVEL_DATUM_FINDINGS.md` (the datum stack and its measured
failures), `TECTONICS_V2_PROPOSAL.md` (the process template this document
follows), `ARCHITECTURE.md`.

Provenance: phase 0 replayed the campaign's best tuned world (r9-both)
bit-for-bit on all three golden seeds and resolved the land-instrument
discrepancy. Two findings from that pass shape this design and are worth
stating as findings, not opinions:

> The campaign's "land gap" (20–25% vs Earth 29%) was an instrument
> artifact — measured at the kernel's actual coastline, r9-both holds
> 33.8–34.4% dry land. What is structurally wrong with the servo world is
> not land *area* but its *elevation distribution*: mean continental
> freeboard 2.5–3.1 km vs Earth ~0.8 km, with no land in the 200–800 m
> band. The redesign's job is hypsometry, not acreage.

> The equilibrium sea is mechanism-dependent (−1.8..−2.2 km under
> r9-both, −3.4..−3.9 km stock). Nothing in the derivation may assume a
> particular sea; every "how high does a column ride" number below is
> quoted against an explicit sea level.

## 0. Summary

One new advected field (`crustalThicknessM`), one pure derivation
(`isostaticElevation`), one staged flag (`crustalColumns` +
`crustalColumnsOnsetYears`). The derivation retires the kernel's vertical
servo layer:

| Scripted today | Under crustal columns |
|---|---|
| `FREEBOARD_TARGET_M` epeirogenic servo (freeboard term 1) | retired — freeboard is the mass budget's output (§2.3 worked example) |
| `CONTINENTAL_BUOYANCY_FLOOR_M` clamp | retired — `e ≥ C + k·T_min` by construction; the −17.8 km ratchet is non-expressible (§8 T2) |
| craton-emergence prototype (r9-both term 3, never shipped) | never needed — erosion + isostatic rebound plane interiors toward base level |
| `OROGENY_MAX_ELEVATION_M` / collision 9 km elevation caps | `CONTINENTAL_THICKNESS_MAX_M` = 70 km (gravitational collapse, cited) |
| `MICROCONTINENT_FOUNDER_ELEVATION_M` clamp | stranded fragments get thin-crust thickness; thin columns stand low definitionally |
| `blockElevationCap` area ramp (#84) | mostly emergent (thin/small blocks are low); any residual is declared flexure |
| `ARC_MATURATION_ELEVATION_M` (sea-keyed −500 m) | `ARC_MATURATION_THICKNESS_M` = 20 km (island-arc → continental transition, cited) |
| `OROGENIC_ROOT_REFERENCE_M` elevation target | thickness relaxation toward `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` (τ 300 Myr survives) |
| passive-margin servo toward sea −150 m | rift-margin thinning with a thickness floor (last migration stage) |

Constraints: one new per-cell field, appended last (codec wire-id rule);
sim-only — no codec/`HISTORY_FORMAT_VERSION` change; **zero new RNG draws**
(the derivation and every thickness writer are pure arithmetic, so the
branched-A/B contract holds by construction); flag default-off,
byte-identical off, independently abandonable at every stage (a gate
failure leaves a documented default-off mechanism, not a revert).

## 1. Physical vs scripted today

**Physical (keep):** the Parsons & Sclater age-depth curve and its #102
crest-cap form (empirically bundles crust buoyancy + thermal subsidence +
water load — this proposal deliberately keeps it as the oceanic branch);
erosion diffusion and the coastal-export ledger (already conservative);
`COLLISION_THICKENING_FACTOR` 0.5 (India–Asia partition — becomes a real
thickness statement); orogenic root decay's τ 300 Myr (the timescale is
physical; its *target* is the scripted part); the V2 force-balance trio;
`CONTINENTAL_CRUST_FRACTION` 0.4 (Cogley 1984).

**Scripted (the redesign target):** every constant in the §0 right-hand
column's "today" side, plus the rate hierarchy that orders them
(blockIsostasy 1e-3 > craton 1e-4 > freeboard/margins 2e-5 m/yr — nothing
physical enforces it). The kernel has no crustal thickness, no density, no
gravity (grep-verified, handover §2). The measured consequences: water
inventory neutralized (sweep §10.2 — less water = *less* land), freeboard
2.5–3.1 km with a 1:1 land/relief trade (sweep §13), and a servo world
whose knob-tuning has converged (r9-both is a measured local optimum).

## 2. The model

### 2.1 Thesis

`crustalThicknessM` becomes the primary vertical state for continental
crust. Surface elevation is a cached, derived quantity: recomputed
incrementally whenever thickness changes, exactly as `elevation` is stored
today so the codec, renderer, climate stack, and sea-level solve are
untouched. Continental elevation is Airy isostasy over a fixed datum;
oceanic elevation keeps today's empirical age-depth machinery unchanged
(the curve already *is* the water-loaded, thermally-subsiding column
observed on Earth — re-deriving it from first principles buys nothing and
risks T1). Orogeny, collision, erosion, arcs, margins and retirement all
become thickness transactions in one mass ledger.

**Deliberately not attempted (v1):** hydro-isostasy on the continental
branch (water-load feedback; §2.4 quantifies the error and the upgrade
path); oceanic-plateau thickness driving oceanic elevation (thickness is
ledger-only over crustType 0); flexure beyond the existing trench term; a
per-cell rift thermal clock (margins keep a mean-rate prototype); gravity
wiring (§2.6 — where it would enter, and that v1 does not); isolated-seas
desiccation (pre-existing gap, out of scope). Each is a known extension,
not a redesign.

### 2.2 State

```ts
// fields.ts — appended LAST (codec wire fieldId is FIELD_NAMES.indexOf):
crustalThicknessM: {
  unit: 'm',
  description: 'Crustal column thickness. Continental ~20–70 km, oceanic ~7.1 km. ' +
    'Crust property: advects with plate motion (ADVECTED_FIELDS). Primary vertical ' +
    'state under crustalColumns; elevation is derived from it by isostaticElevation(). ' +
    'Sim-only (not in the codec stored set). Appended last (codec wire-id constraint).',
}
```

- Joins `ADVECTED_FIELDS` (tectonics.ts:65) unconditionally — transport of
  a field no one reads is byte-neutral to every other field.
- Populated at init unconditionally (founding synthesis §2.5 — pure
  inversion, zero RNG), so both A/B arms carry comparable field bytes.
- All *writers* and the derivation are gated on
  `crustalColumns && timeYears >= crustalColumnsOnsetYears`.
- Params: `crustalColumns: boolean` (default false) +
  `crustalColumnsOnsetYears: number` (default 0), the standard pair, with
  the standard `createPlanetParams` defaults and a `MECHANISMS` registry
  entry. No new globals; ledger diagnostics ride the existing
  crust-stats/metrics harness (§10 instrumentation).
- Per-cell fields added beyond this one: **none.**

### 2.3 Constants (all new to the kernel: the first densities)

| Constant | Value | Physical meaning / source |
|---|---|---|
| `CRUST_DENSITY_CONTINENTAL_KG_M3` | 2830 | Mean continental crustal density; Christensen & Mooney 1995 (JGR 100) velocity-derived global average (~2835 at mean thickness 39.2 km) |
| `CRUST_DENSITY_OCEANIC_KG_M3` | 2900 | Mature oceanic crust bulk density; Carlson & Raskin 1984 (Nature 311): 2890 ± 40 |
| `MANTLE_DENSITY_KG_M3` | 3300 | Uppermost lithospheric mantle; Turcotte & Schubert, *Geodynamics* (standard value) |
| `SEDIMENT_DENSITY_KG_M3` | 2400 | Compacted shelf sediment bulk density (2200–2500 typical; Hamilton 1976) — the sediment↔crust mass conversion |
| `OCEANIC_CRUST_THICKNESS_M` | 7100 | Normal oceanic crust 7.1 ± 0.8 km; White, McKenzie & O'Nions 1992 (JGR 97) |
| `CONTINENTAL_REFERENCE_THICKNESS_M` | 39000 | Global mean continental thickness 39.2 km; Christensen & Mooney 1995 |
| `CONTINENTAL_REFERENCE_ELEVATION_M` | 400 | The t=0 construction's mean continental elevation (measured 380–450 across the golden seeds — the same anchor `FREEBOARD_TARGET_M` used) |
| `CONTINENTAL_THICKNESS_MAX_M` | 70000 | Gravitational-collapse ceiling: Tibet ~70–75 km is Earth's sustained maximum (England & Houseman 1989; Rey, Teyssier & Whitney 2001) |
| `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` | 39000 | Root-decay target = the reference thickness (one anchor, two roles, deliberately) |
| `CONTINENTAL_THICKNESS_MIN_M` | 20000 | Process floor for thinning/foundering: below ~20 km, real crust is hyperextended-margin domain transitioning to oceanic (Reston 2009 measures <10 km at breakup; the floor is deliberately conservative — see §8 T2) |
| `ARC_MATURATION_THICKNESS_M` | 20000 | Island-arc → continental transition: arc crust 20–35 km with continental-type middle crust from ~20 km (Suyehiro et al. 1996, Izu-Bonin; Calvert 2011). **Deliberately equal to `CONTINENTAL_THICKNESS_MIN_M`** — the identity floor and the creation gate are one number, mirroring the shipped `OCEAN_RIDGE_MIN_SUBMERGENCE_M = |ARC_MATURATION_ELEVATION_M|` coupling |

Derived (expressions in source, not literals, so the derivation is legible):

```
k_cont = 1 − ρ_cc/ρ_m = 1 − 2830/3300 = 0.14242   // continental buoyancy per m of thickness
C_cont = CONTINENTAL_REFERENCE_ELEVATION_M − k_cont·CONTINENTAL_REFERENCE_THICKNESS_M
       = 400 − 5554.5 = −5154.5 m                  // the continental isostasy datum
```

`C_cont` is the model's one fitted constant — the free-mantle datum in
kernel coordinates, pinned by two cited anchors (Earth's mean column ↦ the
t=0 construction's mean elevation). It is a **fixed constant, never
dynamic** — it does not read sea level, which is what keeps the derivation
T1-safe by construction.

**Closure sanity (the armchair test — this design's cargo-cult check).**
Before any tuning, the two anchors and one density ratio must reproduce
independent numbers they were not fitted to:

1. *Erosion–rebound factor.* de/dT = k_cont: erode 1 km of rock, the
   surface drops **142 m**. The handover's independently-stated estimate
   (§5.2, from real-Earth intuition) was "~150 m". Passes.
2. *Realistic implied thicknesses from the founding inversion* (§2.5):
   t=0 shelf bottoms (−500 m) invert to **32.7 km** (real shelves:
   30–35 km); t=0 datum coastline (0 m) to 36.2 km; t=0 noise peaks
   (+4500 m) to **67.8 km** — just under the independently-cited 70 km
   collapse ceiling. None of these three was an input. Passes.
3. *Maturation-elevation continuity.* A cell maturing at the 20 km
   thickness gate derives to `−5154.5 + 0.14242·20000 = −2306 m`
   absolute. Against the r9-both-class sea (−1.8..−2.2 km) that is 100–500
   m *below* the waterline — the same "arcs mature submerged, just below
   the sea" geometry as today's sea-keyed −500 m gate. The thickness gate
   lands where the elevation gate already was, without being fitted to it.
   Passes at the r9-both sea; **fails at the stock-stack sea** (−3.5 km ⇒
   maturation 1.2 km *above* water) — which is exactly why T3 demands the
   crust-fraction re-measure on the real mechanism stack (§6 stage C4).
4. *The freeboard equation of state.* Equilibrium column (39 km) tops at
   +400 m absolute; freeboard = 400 − sea. At the stock sea (−3.5 km):
   3.9 km. At the r9-both sea (−2.0 km): **2.4 km — which is the measured
   r9-both freeboard (2.5–3.1 km) to first order, with no servo
   involved.** The servo world's "too-high continents" were never a
   tuning failure; they are what a 39 km column *should* do over a
   water-poor planet's low sea. Passes — and it makes the win condition
   quantitative: freeboard < 1.5 km at water scale 1.0 requires erosion
   to thin platform columns toward base level (to ~25 km at sea −2.0 km),
   which is §2.3's planation-budget line below; at Earth-like endowments
   (scale 1.5–2, sea ≥ −1 km) the gate is met near the equilibrium
   thickness directly. The freeboard gap and the water deficit (T5) are
   one fact, not two.

*Planation budget:* dropping platform freeboard 2.4 → 0.4 km removes
2 km of surface = **14 km of thickness** (1/k = 7.02) ≈ 4.7 m/Myr
sustained over 3 Gyr — cratonic-order denudation (10Be outcrop median
~12 m/Myr; Portenga & Bierman 2011). Physically plausible; whether the
*kernel's* erosion constants deliver it is stage C2's first measurement
(§9 risk 1 pre-registers the fallback).

### 2.4 The derivation

```
isostaticElevation(i):
  if crustType[i] == 1:                            // continental branch
      e = C_cont + k_cont · crustalThicknessM[i]   // dry Airy column
  else:                                            // oceanic branch — UNCHANGED
      e = seaKeyedOceanicDepthForAge(crustAge[i], bathymetryDatumOffsetM)
          + sedimentM[i] (+ active trench/arc terms exactly as today)
```

- **Two branches, one seam.** Oceanic cells keep today's elevation
  machinery bit-for-bit; `crustalThicknessM` over oceanic crust is ledger
  bookkeeping only (created 7.1 km at ridges, consumed at subduction).
  Cells that change `crustType` (maturation, retirement, consolidation
  flips, weld bridges) switch branches at the flip site, explicitly.
  **Branch-flip continuity rule:** at oceanic → continental flips
  (maturation, welds) the cell's thickness is set by *inversion of its
  current elevation*, clamped to ≥ the maturation gate — elevation is
  continuous through the flip (no popping, the crustFates house
  semantics) and the small ledger adjustment is declared. The maturation
  *gate* reads the accrued thickness; the *assigned* thickness at flip is
  the inversion. Continental → oceanic (retirement) snaps to the
  age-depth curve as today — underwater to underwater, no land-mask pop.
- **Incremental recompute.** Because e is linear in T at fixed type, a
  system that writes ΔT applies Δe = k_cont·ΔT to the cached elevation in
  the same pass — exact, cheap, no global sweep. A full recompute runs
  only at the onset step (the "onset snap": pre-onset legacy elevation is
  replaced by the column-derived surface; A/B arms use early onsets where
  the snap is small, and the snap magnitude is a reported A/B statistic).
  An invariant fixture asserts cached == full recompute (float tolerance)
  every N steps in test.
- **Non-isostatic dynamic topography** stays an explicit, additive,
  recomputed-per-step layer: trench pinning on the subducting oceanic
  side (unchanged), and nothing else in v1. Honestly labeled: this is
  flexure standing in for a plate-bending model.
- **Hydro-isostasy is deliberately absent (v1).** The dry continental
  branch places a shelf at true depth w too shallow by
  r/(1−r)·w ≈ 0.45·w (r = ρ_w/ρ_m = 0.312) — ≤ ~200 m at platform
  depths, the same order as the servo constants it replaces. Upgrade
  path, pre-registered: add the water-load term against the **lagged**
  sea level (the house one-step-lag idiom); the cross-step loop gain is
  −r/(1−r) × (hypsometry sensitivity ≤ 1) ⇒ |gain| < 0.5, geometric
  damping, and the #33 bisection still sees a fixed hypsometry each step.
  Adopt only with its own measured pass; not in v1.

**Where it runs:** thickness writers live inside the systems that own the
physics today (tectonics, boundaries, erosion, crustFates, freeboard-shims)
and each applies its own incremental Δe — no new pipeline system, so every
mid-pipeline consumer (erosion reads post-tectonics elevation, climate
reads post-freeboard) keeps exactly today's view. `isostasy.ts` exports the
pure helpers; nothing else imports state.

### 2.5 Founding synthesis (t=0)

Continental cells: invert the derivation over the existing t=0 terrain —
`T_i = (e_i − C_cont)/k_cont`. Oceanic cells: `OCEANIC_CRUST_THICKNESS_M`.
Slots into `createInitialState` after `applyInitialPlates` (state.ts:638),
writing only `crustalThicknessM`. Zero RNG. By construction, flag-on t=0
elevation equals today's **exactly** (elevation is not recomputed at init;
the field is bookkeeping until onset), and the t=0 thickness *distribution*
is realistic without any new noise design (closure check 2). The
`initialLandFraction` / `waterInventoryScale` knobs compose unchanged.

### 2.6 Gravity (say which, honestly)

Surface elevation in Airy balance is density-ratio-only — **a gravity knob
that scales elevation would be fake, and v1 wires no gravity anywhere.**
Where g legitimately enters, recorded for a successor issue: erosion
efficiency, viscous relaxation/collapse timescales (the 70 km ceiling and
τ 300 Myr are g-dependent in nature), the age-depth coefficient, and the
existing climate constants (lapse rate, scale height). Until that issue,
`radiusMeters` and `starLuminosity` remain the honest planet knobs, and the
water sweep (§10) is the alt-world acceptance axis this redesign must win.

### 2.7 Emergent vs prescribed

**Becomes emergent:** freeboard (mass budget × sea level); cratonic
platforms in the 200–800 m band (erosion + rebound toward base level);
island-arc emergence ceiling (thin columns); block foundering (thin/small
fragments ride low); the microcontinent "drowned platform" look; the
land/relief coupling (thickness budget, not a 1:1 knob trade); the
water-inventory response (higher sea ⇒ higher base level ⇒ thicker
equilibrium columns ⇒ less land — monotonic, T5).

**Stays prescribed, deliberately:** the oceanic age-depth curve (empirical,
volume-anchored — T1); trench flexure magnitude; the arc magmatic flux
(honest ex-nihilo crust production, rate cited to the V2-calibrated
budget); τ 300 Myr root decay; the erosion diffusion magnitude; plate
kinematics (V2's territory).

## 3. Scoreboard (falsifiable, measured at 4.5 Gyr, N=64, seeds {1,42,1337})

Earth-target claims this model is accountable to:

- **Hypsometry:** land concentrated low — ≥ 40% of *land area* within
  (0, 800 m] freeboard (Earth: ~60–70% of land lies within 1 km of sea;
  ETOPO1 hypsometry, Eakins & Sharman 2010). r9-both fails this today —
  it is the discriminating gate.
- **Freeboard:** mean continental freeboard (crust-stats `meanFreeboardM`)
  **< 1.5 km at water scale 1.0**, with the pre-registered partial-win
  band 1.5–2.5 km (§9 risk 1); < 1.0 km somewhere in the water sweep.
  Peaks 5–9 km above sea.
- **Land:** dynamic-sea land fraction 25–35%, **area-weighted**
  (solid-angle sum, not cell count — phase-0 recommendation). The 0 m
  instrument keeps printing for historical continuity; nothing gates on it.
- **Structure:** continental crust 0.35–0.45 of sphere (phase-0 reference:
  38.7–39.3%); submerged share of continental crust 10–35% (watch metric,
  not a gate; Earth ~25%, r9-both 12–16%); supercontinent epochs with
  largest land component ≥ 0.5 of land.
- **Alt-world honesty:** `--water-scale` 0.5/1.0/1.5/2.0 → monotonically
  decreasing land fraction, all four alive (the servo model measurably
  fails this; sweep §10.2).

**Must not regress (the hard-won floor, phase-0 measured references):**
monopoly window 0 Myr; dispersal ≥ 94.9%; last tectonic event > 4.4 Gyr;
land min ≥ 8% (dynamic-sea instrument; both instruments reported during
transition); tempo 100–300 Myr/plate; no NaN (CLI tripwire); kernel suite
within the v17 budget note (~60–75 s; new non-invariant tests sub-second).

## 4. Mapping to current code

**Survives unchanged:** the entire oceanic elevation path (bathymetry.ts,
#102 crest cap, trench pinning, sediment stacking); the sea-level solve;
the climate stack (reads cached elevation exactly as today — T4's lapse
convention untouched); the V2 kinematics trio; codec/renderer (field is
sim-only); crustFates area machinery.

**Modified (all behind the flag):** tectonics (advect + collision/bulldozer
/founder/consolidation in thickness), boundaries (arc thickness accrual,
maturation gate), erosion (thickness fluxes + ledger), freeboard (shims,
then retirement), crustFates (subsidence shim, thickness at welds),
blockIsostasy (expected mostly-redundant; kept default-off as today),
state.ts (params + founding synthesis), fields.ts (append), mechanisms.ts,
sim-cli (flag + `--ab` arm + instrumentation).

**Downstream consumers audited:** erosion reads elevation (derived —
same); energy balance/winds/moisture/ice/biome read elevation + sea (same);
seaLevel reads the hypsometry (bounded to [−3.7, +4.8] km continental band
+ anchored abyss — *better* conditioned, §8 T1); codec QUANT_TABLE
untouched (elevation range unchanged: derived values live inside today's
[−11000, 9500] envelope, cap 70 km ⇒ +4815 m + dynamic topo);
`EncodedKeyframe.landFraction` (0 m convenience) unchanged — already
documented as lagging.

**Perf honesty:** one extra Float32Array (≈0.4 MB at N=128); advection
copies one more field; incremental Δe is O(cells touched); the onset snap
is one full O(cells) pass, once. No measurable step cost expected; the
kernel-suite budget gate stands.

## 5. Write-site resolution (all 21 sites + the 2 ledger exits)

Every elevation write site from handover §3, resolved: its C1 shim (§6 —
mechanical thickness-space equivalent, ΔT = Δe/k_cont, preserving today's
behavior through the flag-on path) and its physical endpoint (the stage
that replaces the shim with physics).

| # | Site | C1 shim (mechanical) | Physical endpoint (stage) | Ledger |
|---|---|---|---|---|
| 1 | initialTerrain founding noise | untouched (elevation noise stays) + thickness inversion at init | same — the inversion *is* the founding budget | defines the budget |
| 2 | plates.ts t=0 oceanic snap | untouched; oceanic T := 7.1 km | same | — |
| 3 | tectonics.ts:132 thermal-subsidence relax | untouched (oceanic branch) | same — the physical term survives as-is | — |
| 4 | tectonics.ts:166 microcontinent founder clamp | shim: clamp as today | fragment thickness := min(T, `CONTINENTAL_THICKNESS_MIN_M`) at detachment — Zealandia-class fragments are thinned crust; thin columns sit low without a clamp (C5) | declared non-conservative (1-cell events; today's posture) |
| 5 | tectonics.ts:239/242 consolidation pair flips | copy thickness with the other crust props | same (exact cell-count conservation as today) | exact |
| 6 | tectonics.ts:401 advection | `crustalThicknessM` joins `ADVECTED_FIELDS` | same | transport |
| 7 | tectonics.ts:549–552 collision ×0.5, 9 km cap | shim: Δe path kept, mirrored as ΔT | ΔT = 0.5·T_displaced, capped at `CONTINENTAL_THICKNESS_MAX_M` (C3) | partial by design (cited) |
| 8 | tectonics.ts:560 bulldozer re-root | transfer thickness with content | same (value + area exact) | exact |
| 9 | tectonics.ts:605 ridge gap fill | oceanic T := 7.1 km, age 0 | same — honest oceanic creation | source |
| 10 | boundaries.ts:289/291 arc growth + 1 km cap | shim: elevation term as today + ΔT accrual = Δe/k_oc | magmatic thickness accrual; emergence ceiling emerges from the thin column; rate principle: preserve the V2-calibrated *surface-growth timing* (T3 guard) (C4) | honest ex-nihilo source |
| 11 | boundaries.ts:298 trench pinning | untouched | stays — explicit dynamic topography (flexure), honestly labeled | — |
| 12 | boundaries.ts:386 orogenic uplift BFS | shim: ΔT = Δe/k_cont, cap → thickness | crustal shortening as thickness addition; cap 70 km (C3) | source (mantle-derived shortening budget — declared) |
| 13 | erosion.ts:149–150 interior diffusion | ΔT antisymmetric pairs | thickness diffusion — rebound emerges (C2) | conservative (mass) |
| 14 | erosion.ts:172 coastal export | ΔT export; sedimentM += ΔT·ρ_cc/ρ_sed | same, physical (C2) | conservative (mass ledger) |
| 15 | erosion.ts:193 marine planation | same conversion as #14 | same (C2) | conservative |
| 16 | erosion.ts:212 orogenic root decay | shim: Δe path mirrored | T relaxes toward `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` from above, τ 300 Myr (C3) | declared non-conservative (root loss, today's posture) |
| 17 | blockIsostasy.ts:121 area caps | shim (flag is default-off anyway) | expected redundant — thin/small fragments are low by thickness; any residual area term returns as *declared flexure*, measured (C5) | — |
| 18 | crustFates.ts:183 weld bridge | copy thickness (lower endpoint, as elevation today) | same + sediment accretion (#22) | area credit unchanged |
| 19 | crustFates.ts:216 founder + retirement | subsidence shim; retirement unchanged | founder via thickness floor (#4's rule); retirement stays the ledger's one deliberate debit (area + now mass) (C5) | debit, declared |
| 20 | freeboard.ts:166–167 epeirogenic + floor | shim: uniform ΔT = Δe/k_cont, floor kept | **RETIRED** (C5) — the pump (orogeny → uniform sink → nowhere to stop) is non-expressible in thickness space | — |
| 21 | freeboard.ts:170 passive margin | shim: ΔT toward the shelf | rift-margin thinning at a mean rate with floor `CONTINENTAL_THICKNESS_MIN_M`; no sea-tracking thickness target (that would re-import the servo) (C6) | declared (post-rift subsidence) |
| 22 | sediment ledger exits (tectonics.ts:249–260, crustFates.ts:186) | keep zeroing (shim) | sediment accretes as ΔT = sedimentM·ρ_sed/ρ_cc at maturation/weld — the §3 mass leak closed (C4) | conservative |

**The mass ledger** (replaces "Σ cont elevation + Σ sedimentM"):
`Σ(T·ρ_type·area) + Σ(sedimentM·ρ_sed·area)` changes only by: + arc
magmatism, + ridge fill, + orogenic shortening influx (declared), − oceanic
subduction (incl. sediment), − retirement debit, − founder trims (small,
declared). An invariant fixture closes the ledger every step to float
tolerance, per system.

## 6. Staged landing plan

Each stage independently abandonable; each exit gate is the next stage's
entry. All A/B runs: `--ab crustal-columns --ab-branch <years>`, N=64,
seeds {1, 42, 1337} unless stated. Baselines: the promoted default (KBV 18)
and, where hypsometry is scored, the phase-0 r9-both numbers as the
"beat-the-servo" reference.

- **C0 — instrumentation (no behavior change; goldens byte-identical).**
  Add to metrics/crust-stats: area-weighted dynamic-sea land%, the
  (0, 800 m] band-occupancy share, thickness stats (mean/min/max by crust
  type), and the mass-ledger closure printout. Both land instruments
  printed side by side. Exit: harness emits the §3 scoreboard for existing
  worlds; baseline numbers recorded for r9-both and stock.
- **C1 — the field, flag-gated (phase 2 of the handover).** Field + init
  inversion + derivation + *all* shims (§5 column 3) + onset snap.
  Tests: isolated golden arm under `ALL_MECHANISMS_OFF`; **engaged** arm
  (#102 pattern — assert post-onset elevation equals the derivation
  exactly on a thickness-perturbed world); onset-gating entry; derivation
  coherence fixture (cached == recomputed); ledger fixture. KBV bump
  (bump-5 `sutureYears` precedent: a new advected field is a deliberate
  golden regen even with every pre-existing field bit-identical), pre-bump
  spine kept. `ARCHITECTURE.md` same commit.
  Exit gate — **shim equivalence**: flag-on vs flag-off over 500 Myr,
  distributional stats (land%, freeboard, crust fraction, dispersal)
  within |Δ| ≤ 1 pt / 100 m; trajectories may diverge chaotically
  (float-level), distributions may not.
- **C2 — erosion in thickness space (the headline win).** Sites 13–15.
  A/B gates: band-occupancy share strictly increases vs C1 world; mean
  freeboard decreases ≥ 200 m by +1 Gyr post-branch; measured planation
  rate reported against the 4.7 m/Myr budget (§9 risk 1 triggers here);
  conservation fixtures; non-regression floor (§3).
- **C3 — orogeny/collision/root decay.** Sites 7, 12, 16. Gates: peaks
  5–9 km above sea; no elevation-cap clamp events (the 70 km thickness cap
  binds instead — count both); belts still die in interiors (τ path);
  floor holds.
- **C4 — arc creation + maturation thickness gate + sediment accretion.**
  Sites 10, 22. **Crust fraction is the first metric read** (T3):
  0.35–0.45 with the phase-0 38.7–39.3% reference band; maturation-depth
  distribution reported (closure check 3); creation/consumption budget
  printed. Pre-registered fallback: `ARC_MATURATION_THICKNESS_M` moves
  only inside the cited 20–25 km band, one measured step.
- **C5 — retire the freeboard servo + founder/caps to thickness.** Sites
  4, 17, 19, 20. Gates: min continental elevation ≥ `C_cont +
  k·CONTINENTAL_THICKNESS_MIN_M` = −2306 m + dynamic topo (the T2
  by-construction floor — assert it); no ratchet over 4.5 Gyr (min-elev
  time series monotone-bounded); flooded share reported (watch band).
- **C6 — margins last.** Site 21. Gates: shallow-ocean share stays in the
  Earth-like 4–10% band (the datum stack's restored property); shelf
  halos visible in dumps (eyeballed, per the house rule).
- **C7 — calibration + promotion (phase 4 of the handover).** Full §3/§10
  grid across seeds × water scales; N=128 replication; scoreboard doc;
  **owner sign-off**; promotion commit = defaults on + KBV bump + golden
  regen + pre-promotion spine pinned verbatim + `ARCHITECTURE.md` rewrite.

## 7. Determinism & purity appendix

Every stochastic draw site under this design: **none.** No thickness
writer, the derivation, the founding inversion, nor any shim consumes RNG
— the branched-A/B contract ("no gated system consumes RNG") holds by
construction for the single flag. No `while (!converged)` anywhere: the
derivation is closed-form; the onset snap is one fixed pass; ledger sums
are one ascending-index sweep (fixed FP order). No I/O, no globals, no
input mutation; per-call scratch only. Transcendentals: none beyond the
existing `sqrt` in the untouched oceanic curve. Flag-off byte-identity is
structural (writers gated; the field itself is written at init and by
advection only — advecting an unread field perturbs nothing). New named
fixtures: derivation-coherence (cached vs recomputed, ≤ 1e-6 m), ledger
closure (≤ 1e-6 relative/step), T2 floor assertion, onset-gating arm,
engaged golden, shim-equivalence harness. Existing conservation invariants
re-asserted flag-on. All fixtures at N=16/32, sub-second each.

## 8. Trap answers (T1–T7) and the failure-ledger cross-check

- **T1 (age-depth re-key divergence).** The oceanic branch is untouched —
  the abyss stays the absolute volume anchor and the crest cap ships
  as-is. The continental datum `C_cont` is a fixed constant; no thickness
  target reads sea level (site 21's replacement explicitly refuses a
  sea-tracking target). Continental elevation is confined to
  [−2306, +4815] m + dynamic topo by the thickness clamps, so the
  bisection's volume slope is bounded away from zero by the anchored
  abyssal hypsometry; the existing conditioning test (slope > 0.2)
  extends to a flag-on arm. Hydro-isostasy — the one place water load
  could couple in — is excluded from v1 and pre-analyzed (loop gain
  < 0.5) for its own future pass. One honest nuance: the C1 *shims*
  reproduce today's mechanisms, several of which read the lagged sea
  (the epeirogenic servo, the buoyancy floor, margins) — the shim layer
  carries today's sea coupling, exactly as today, until C5/C6 retire it.
  T1's "no sea-tracking targets" binds the *final* model; the shims are
  the measured bridge, not the destination.
- **T2 (nowhere-to-stop ratchets).** In thickness space the floor is
  physical and *structural*: no process may thin below
  `CONTINENTAL_THICKNESS_MIN_M`, therefore no continental cell can sit
  below −2306 m (+ dynamic topo) — asserted as a fixture, not policed by
  a clamp constant. The −17.8 km failure is non-expressible. Audited
  thinning processes: erosion (vanishing flux at base level), root decay
  (stops at T_eq), margins (floor), founder (floor). None is unbounded.
- **T3 (crest/maturation creation budget).** The thickness gate lands at
  −2306 m absolute — within ~300 m of today's sea-keyed gate at the
  r9-both sea (closure check 3), but *not* at the stock sea. Therefore
  stage C4 reads crust fraction first, against the phase-0 reference band
  38.7–39.3%, before anything else is scored; the fallback knob and its
  cited range are pre-registered.
- **T4 (lapse keys off absolute altitude).** The climate stack reads the
  cached elevation field exactly as today; nothing re-keys the lapse.
  Preserved by not touching it.
- **T5 (water endowment).** Monotonic by mechanism: more water ⇒ higher
  sea ⇒ higher erosional base level ⇒ thicker equilibrium columns and
  less emergent area. The §3 water-sweep gate is the acceptance test the
  servo world measurably fails. The freeboard-vs-endowment coupling is
  now an *equation* (closure check 4), not a hoped-for outcome.
- **T6 (no fork inside a system).** Nothing here draws randomness at all.
- **T7 (solid-angle areas).** The mass ledger and every area-gated number
  in the new instrumentation use `cellSolidAngleTable`-derived areas; the
  phase-0 gate re-anchoring (area-weighted land) is part of C0.

**Failure-ledger cross-check (near-misses flagged):** the epeirogenic-servo
retirement superficially resembles "just delete the freeboard mechanism",
which `SEA_LEVEL_DATUM_FINDINGS` shows starves creation and decays crust to
13–16% — but that world had no other vertical physics; here the column
derivation *is* the vertical physics, and C5 runs only after C2–C4 have
replaced the load-bearing parts. The craton prototype's job (interiors a
few hundred m above sea) is reproduced by a mechanism (planation toward
base level) whose rate is measured at C2, not assumed. The blockIsostasy
redundancy claim is tested (C5), not asserted — if thin-column foundering
leaves tall small blocks, the residual returns as declared flexure rather
than silently keeping the servo.

## 9. Risks, and how this fails

1. **Planation too slow** — kernel erosion may not deliver ~4.7 m/Myr of
   thickness export from platform interiors; freeboard stalls in the
   1.5–2.5 km band at water scale 1.0. Defenses: the budget is
   cratonic-order (physically modest); C2 measures it directly.
   Pre-registered response: report the measured band honestly; the
   partial win (freeboard 1.5–2.5 km + correct hypsometry *shape*) is
   accepted at scale 1.0 **only if** the water sweep shows < 1.0 km at
   Earth-like endowments (the physics being right, the default planet
   being dry); the one permissible knob is the already-flagged
   "honest-about-tuning" subsea damping factor, one measured step. Never
   a new servo.
2. **T3 creation-budget shift** — §8; fallback pre-registered (20–25 km,
   one knob, crust fraction gates it).
3. **Onset snap too large for clean A/B** — early-onset arms; snap
   magnitude reported; if a 50 Myr onset still snaps > ~500 m RMS, the
   founding inversion and the shims disagree somewhere — that is a bug
   signal (shim-equivalence should have caught it), not a tuning problem.
4. **Shim-equivalence drift** — chaotic divergence is expected
   trajectory-wise; the gate is distributional. If distributions drift
   past the C1 tolerance, a shim is not the identity it claims to be —
   fix the shim, never widen the tolerance (the tolerance is the
   instrument).
5. **Belt/peak behavior under the 70 km cap** — collision stacking could
   pile thickness to the cap and hold peaks at +4815 m + dynamic topo,
   flattening summit variety vs today's 5–9 km-above-sea band. Defense:
   root decay + erosion act on thickness continuously; C3 gates on the
   peak band. Escalation: a declared, cited collapse *rate* above ~60 km
   (viscous spreading) instead of a hard cap — a known extension.
6. **Wholesale failure shape** — the column world may need more than one
   constant retuned per stage to stay alive (the sweep's cliff edges:
   hazard < 0.004 is death, dead worlds drown). If any stage cannot pass
   its gates without touching more than one pre-registered knob, stop,
   write the findings doc, leave the flag default-off (the compactArcs
   precedent) — the staging makes that a documented mechanism, not a
   revert. The phase-0 baseline remains the shipped world.

## 10. Acceptance grid (phase C7, supersedes handover §7 where they differ)

Health floors (unchanged in spirit, re-instrumented): §3 must-not-regress
list, on the dynamic-sea instrument, both instruments printed. Earth-
likeness: the §3 scoreboard. Alt-world: the §3 water sweep + luminosity
sweeps keep working + gravity explicitly not wired (§2.6). Determinism:
goldens {1,42,1337}; flag-off byte-identical; onset contract; zero draws.
Visual: PNG dumps at every gate — numbers passing while maps look wrong is
a failure (house rule); the r9-both frames are the beat-this reference.

Instrumentation deltas (C0): area-weighted land%, band occupancy,
thickness stats, ledger closure, both-instrument land print. The N=128
replication and the r9-both-vs-columns scoreboard table are C7
deliverables for the promotion decision.

## 11. Open questions for the owner (phase-1 gate)

1. **Hydro-isostasy exclusion (v1):** accept the dry continental branch
   with the ≤ ~200 m shelf error and the pre-analyzed upgrade path
   (§2.4)? (Recommended: yes — T1-safest, smallest first cut.)
2. **Freeboard gate at water scale 1.0:** accept the pre-registered
   partial-win band (§9 risk 1) — i.e., the win condition is "the physics
   is right across the water sweep", not "the dry default planet must hit
   Earth's freeboard"? A separate later decision could make scale ~1.5
   the shipped default planet; that is a product choice, not physics.
3. **Arc rate conversion (C4):** preserve the V2-calibrated surface-growth
   timing (thickness accrual = elevation-equivalent / k) as the starting
   point, with crust fraction as the sole gate? (Recommended: yes — it is
   the T3-conservative choice.)
4. **KBV cadence:** bump at C1 (new-field golden regen, bump-5 precedent)
   and again at C7 promotion — two bumps total. Confirm.

Sign-off on this document is the phase-1 → phase-2 gate (handover §8).
