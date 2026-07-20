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
discrepancy. This draft additionally survived an adversarial review pass
(arithmetic recomputed independently; every kernel-fact claim re-verified
at source; one blocker and four majors found and folded in — the
branch-flip rule, the onset re-inversion, the shim-era validity domain,
the thickness-keyed retirement, and the margin stretch budget below are
its direct products). Two phase-0 findings shape the design and are worth
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
| `ARC_MATURATION_ELEVATION_M` (sea-keyed −500 m) | the thickness-equivalent **absolute** gate `e ≥ e(20 km) = −2306 m` (§2.4 — one condition, two readings: derived-equivalent elevation ⟺ inversion thickness ≥ `ARC_MATURATION_THICKNESS_M`) |
| `OROGENIC_ROOT_REFERENCE_M` elevation target | thickness relaxation toward `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` (τ 300 Myr survives) |
| passive-margin servo toward sea −150 m | rift-margin thinning at a mean rate with a **finite stretch budget** (β ≈ 1.3; §5 site 21), shelf shallowness owned by the existing sea-graded sediment machinery |

Not retired in v1, said plainly: the arc growth term and its island
ceiling (oceanic-branch elevation stays today's machinery — §2.1/§2.4);
trench flexure; the oceanic age-depth curve (deliberately, forever — T1).

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
crustal-volume statement, with the behavior step-change stated in §5 site
7); orogenic root decay's τ 300 Myr (the timescale is physical; its
*target* is the scripted part); the V2 force-balance trio;
`CONTINENTAL_CRUST_FRACTION` 0.4 (Cogley 1984).

**Scripted (the redesign target):** every constant in the §0 table's
left column, plus the rate hierarchy that orders them (blockIsostasy 1e-3
> craton 1e-4 > freeboard/margins 2e-5 m/yr — nothing physical enforces
it). The kernel has no crustal thickness, no density, no gravity
(grep-verified, handover §2). The measured consequences: water inventory
neutralized (sweep §10.2 — less water = *less* land), freeboard 2.5–3.1 km
with a 1:1 land/relief trade (sweep §13), and a servo world whose
knob-tuning has converged (r9-both is a measured local optimum).

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
risks T1). Orogeny, collision, erosion, margins and retirement become
thickness transactions in one mass ledger; arc crust enters the ledger at
maturation (§2.4).

**Deliberately not attempted (v1):** hydro-isostasy on the continental
branch (water-load feedback; §2.4 quantifies the error and the upgrade
path); **any thickness→elevation coupling over oceanic crust** — thickness
is ledger-only over crustType 0, so arc growth and its emergence ceiling
remain today's prescribed oceanic-elevation mechanism until an
oceanic-thickness successor (this is why the arc ceiling is *not* on the
§2.7 emergent list); flexure beyond the existing trench term; a per-cell
rift thermal clock (margins keep a mean-rate prototype with a finite
budget); gravity wiring (§2.6 — where it would enter, and that v1 does
not); isolated-seas desiccation (pre-existing gap, out of scope). Each is
a known extension, not a redesign.

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
  inversion, zero RNG), so both A/B arms carry comparable field bytes;
  **re-inverted at the onset step** so the onset snap is exactly zero
  (§2.5).
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
| `CRUST_DENSITY_OCEANIC_KG_M3` | 2900 | Mature oceanic crust bulk density; Carlson & Raskin 1984 (Nature 311): 2890 ± 40. v1 use: sediment/ledger accounting only (oceanic elevation is empirical) |
| `MANTLE_DENSITY_KG_M3` | 3300 | Uppermost lithospheric mantle; Turcotte & Schubert, *Geodynamics* (standard value) |
| `SEAWATER_DENSITY_KG_M3` | 1030 | Standard seawater; v1 use: the §2.4 hydro-isostasy error bound and the future water-load upgrade (no v1 consumer in the derivation itself) |
| `SEDIMENT_DENSITY_KG_M3` | 2400 | Compacted shelf sediment bulk density (2200–2500 typical; Hamilton 1976) — the sediment↔crust mass conversion |
| `OCEANIC_CRUST_THICKNESS_M` | 7100 | Normal oceanic crust 7.1 ± 0.8 km; White, McKenzie & O'Nions 1992 (JGR 97) |
| `CONTINENTAL_REFERENCE_THICKNESS_M` | 39000 | Global mean continental thickness 39.2 km; Christensen & Mooney 1995 |
| `CONTINENTAL_REFERENCE_ELEVATION_M` | 400 | The t=0 construction's mean continental elevation (measured 380–450 across the golden seeds — the same anchor `FREEBOARD_TARGET_M` used) |
| `CONTINENTAL_THICKNESS_MAX_M` | 70000 | Gravitational-collapse ceiling: Tibet ~70–75 km is Earth's sustained maximum (England & Houseman 1989; Rey, Teyssier & Whitney 2001) |
| `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` | 39000 | Root-decay target = the reference thickness (one anchor, two roles, deliberately) |
| `CONTINENTAL_THICKNESS_MIN_M` | 20000 | Process floor for thinning/foundering: below ~20 km, real crust is hyperextended-margin domain transitioning to oceanic (Reston 2009 measures <10 km at breakup; the floor is deliberately conservative — see §8 T2) |
| `ARC_MATURATION_THICKNESS_M` | 20000 | Island-arc → continental transition: arc crust 20–35 km with continental-type middle crust from ~20 km (Suyehiro et al. 1996, Izu-Bonin; Calvert 2011). **Deliberately equal to `CONTINENTAL_THICKNESS_MIN_M`** — the identity floor and the creation gate are one number, mirroring the shipped `OCEAN_RIDGE_MIN_SUBMERGENCE_M = |ARC_MATURATION_ELEVATION_M|` coupling |
| `MARGIN_STRETCH_FACTOR` | 1.3 | v1 rift-margin thinning budget β (McKenzie 1978 post-rift stretch factors, typical passive margins β ≈ 1.2–2); margins thin toward `CONTINENTAL_REFERENCE_THICKNESS_M / β` = 30 km, never toward the identity floor (§5 site 21) |

Derived (expressions in source, not literals, so the derivation is legible):

```
k_cont = 1 − ρ_cc/ρ_m = 1 − 2830/3300 = 0.14242   // continental buoyancy per m of thickness
C_cont = CONTINENTAL_REFERENCE_ELEVATION_M − k_cont·CONTINENTAL_REFERENCE_THICKNESS_M
       = 400 − 5554.5 = −5154.5 m                  // the continental isostasy datum
e(T)   = C_cont + k_cont·T                          // e(20 km) = −2306 m, e(39 km) = +400 m, e(70 km) = +4815 m
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
3. *Maturation-gate continuity.* The new gate is absolute: a cell matures
   when its elevation reaches `e(20 km) = −2306 m` (equivalently, when
   its elevation-inversion thickness reaches the cited 20 km — one
   condition, two readings; §2.4). Today's gate rides the sea at
   `seaLevelM − 500`: at the r9-both-class sea (−1.8..−2.2 km) that is
   −2300..−2700 m — the absolute gate lands within ~400 m of the shipped
   one without being fitted to it. Passes at the r9-both sea; **fails at
   the stock sea** (−3.5 km ⇒ today's gate at −4000 m, 1.7 km deeper
   than the new one) — the creation budget shifts with the mechanism
   stack, which is exactly why stage C4 reads crust fraction before
   anything else (T3).
4. *The freeboard equation of state.* Equilibrium column (39 km) tops at
   +400 m absolute; freeboard = 400 − sea. At the stock sea (−3.5 km):
   3.9 km. At the r9-both sea (−2.0 km): **2.4 km — which is the measured
   r9-both freeboard (2.5–3.1 km) to first order, with no servo
   involved.** The servo world's "too-high continents" were never a
   tuning failure; they are what a 39 km column *should* do over a
   water-poor planet's low sea. Passes — and it makes the win condition
   quantitative: freeboard < 1.5 km at water scale 1.0 requires erosion
   to thin platform columns toward base level (to ~25 km at sea −2.0 km),
   which is the planation-budget line below; at Earth-like endowments
   (scale 1.5–2, sea ≥ −1 km) the gate is met near the equilibrium
   thickness directly. The freeboard gap and the water deficit (T5) are
   one fact, not two.

*Planation budget:* dropping platform freeboard 2.4 → 0.4 km removes
2 km of surface = **14 km of thickness** (1/k = 7.02) ≈ 4.7 m/Myr
sustained over 3 Gyr — cratonic-order denudation (10Be outcrop median
~12 m/Myr; Portenga & Bierman 2011). Physically plausible on the source
side; the *sink* side (shelf-room capacity under the sea-keyed ceiling,
subduction throughput of `sedimentM`) can bottleneck independently, so
stage C2 measures and reports both sides (§9 risk 1).

### 2.4 The derivation

```
isostaticElevation(i):
  if crustType[i] == 1:                            // continental branch
      e = C_cont + k_cont · crustalThicknessM[i]   // dry Airy column
  else:                                            // oceanic branch — UNCHANGED
      today's machinery verbatim: rate-bounded relaxation toward
      seaKeyedOceanicDepthForAge(crustAge) + sedimentM, trench pinning,
      arc growth + ceiling, margin-active exemptions
```

- **Two branches, one seam.** Oceanic cells keep today's elevation
  machinery bit-for-bit — note it is a rate-bounded *relaxation toward* a
  target, not a pure function, so the derivation-coherence fixture (§7)
  applies to the continental branch only. `crustalThicknessM` over
  oceanic crust is ledger bookkeeping (created 7.1 km at ridges, consumed
  at subduction); no accrued-thickness bookkeeping exists for arcs in v1.
- **Branch-flip rule (oceanic → continental: maturation, weld bridges).**
  The gate is the absolute derived-equivalent elevation
  `e ≥ e(ARC_MATURATION_THICKNESS_M) = −2306 m`; at flip the cell's
  thickness is assigned by **inversion of its current elevation**,
  `T := (e − C_cont)/k_cont`. When the gate passes, the inversion is
  ≥ 20 km *by algebra* — there is no clamp to bind — so elevation is
  continuous through the flip by construction (no popping, the crustFates
  house semantics) and the assigned mass **is** the ledger's
  arc-accretion credit (§5 ledger). Weld bridges flip at their inherited
  elevation the same way.
- **Branch-flip rule (continental → oceanic: retirement).** The thickness
  ledger takes its debit; elevation is left in place for the bounded
  oceanic relaxation to take down — no cliff, exactly today's documented
  retirement semantics (crustFates.ts:206–208), preserved verbatim.
- **Incremental recompute.** Because e is linear in T at fixed type, a
  system that writes ΔT applies Δe = k_cont·ΔT to the cached elevation in
  the same pass — exact, cheap, no global sweep. An invariant fixture
  asserts cached == full recompute on the continental branch (float
  tolerance) in test.
- **Non-isostatic dynamic topography** stays an explicit, additive,
  recomputed-per-step layer: trench pinning on the subducting oceanic
  side (unchanged), and nothing else in v1 — in particular, no dynamic
  topography extends *continental* cells below `e(T_min)`. Honestly
  labeled: this is flexure standing in for a plate-bending model.
- **Hydro-isostasy is deliberately absent (v1).** The dry continental
  branch places a submerged shelf too shallow by ρ_w/ρ_m ≈ 0.31 of its
  true depth (≤ ~150 m at platform depths — the same order as the servo
  constants it replaces). Upgrade path, pre-registered: add the
  water-load term against the **lagged** sea level (the house
  one-step-lag idiom); the cross-step loop gain is −r/(1−r) ×
  (hypsometry sensitivity ≤ 1) ⇒ |gain| < 0.5, geometric damping, and
  the #33 bisection still sees a fixed hypsometry each step. Adopt only
  with its own measured pass; not in v1.

**Where it runs:** thickness writers live inside the systems that own the
physics today (tectonics, boundaries, erosion, crustFates, freeboard-shims)
and each applies its own incremental Δe — no new pipeline system, so every
mid-pipeline consumer (erosion reads post-tectonics elevation, climate
reads post-freeboard) keeps exactly today's view. `isostasy.ts` exports the
pure helpers; nothing else imports state.

### 2.5 Founding synthesis (t=0) and the onset re-inversion

Continental cells: invert the derivation over the existing t=0 terrain —
`T_i = (e_i − C_cont)/k_cont`. Oceanic cells: `OCEANIC_CRUST_THICKNESS_M`.
Slots into `createInitialState` after `applyInitialPlates` (state.ts:638),
writing only `crustalThicknessM`. Zero RNG. The t=0 thickness
*distribution* is realistic without any new noise design (closure check
2). (Deviation from the handover flagged: §5.2 row 1 sketched founding
*thickness noise*; the inversion is the deliberate replacement — it
satisfies the row's calibration clause exactly, since flag-on t=0
hypsometry ≡ today's by construction.)

**Onset re-inversion (the zero-snap rule).** The same inversion re-runs
at the onset step over the *current* elevation (continental cells;
oceanic reset to 7.1 km). The onset snap is therefore exactly zero —
elevation is continuous through onset, and post-onset divergence is
purely the mechanisms' direct effect, which is what makes the branched
A/B clean at *any* onset year, not just early ones. Cells whose legacy
elevation sits below `e(T_min)` (the pump-flooded lobe) invert to
unphysically thin — even negative — columns; this is retained as
Δ-space bookkeeping under the shim-era validity domain (§6 C1), not
clamped, so shim equivalence stays exact. The `initialLandFraction` /
`waterInventoryScale` knobs compose unchanged.

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
block foundering (thin/small fragments ride low); the microcontinent
"drowned platform" look (on seas above −2.3 km; on drier worlds foundered
fragments stand emergent — §5 site 19, a physical outcome); the
land/relief coupling (thickness budget, not a 1:1 knob trade); the
water-inventory response (higher sea ⇒ higher base level ⇒ thicker
equilibrium columns ⇒ less land — monotonic, T5).

**Stays prescribed, deliberately:** the oceanic age-depth curve
(empirical, volume-anchored — T1); trench flexure magnitude; **arc growth
and its island ceiling** (oceanic-branch elevation, unchanged in v1;
retires only with an oceanic-thickness successor); the arc maturation
flux itself (honest ex-nihilo crust production); τ 300 Myr root decay;
the erosion diffusion magnitude; plate kinematics (V2's territory).

## 3. Scoreboard (falsifiable, measured at 4.5 Gyr, N=64, seeds {1,42,1337})

Earth-target claims this model is accountable to:

- **Hypsometry:** land concentrated low — ≥ 40% of *land area* within
  (0, 800 m] freeboard (Earth: ~60–70% of land lies within 1 km of sea;
  ETOPO1 hypsometry, Eakins & Sharman 2010). r9-both fails this today —
  it is the discriminating gate.
- **Freeboard:** mean continental freeboard (crust-stats `meanFreeboardM`)
  **< 1.5 km at water scale 1.0**, with the pre-registered partial-win
  band 1.5–2.5 km (§9 risk 1); < 1.0 km somewhere in the water sweep.
- **Peaks:** 5–9 km above sea **at water scale 1.0**. Stated limit: with
  the 70 km cap and no continental dynamic topography, peak elevation is
  bounded by 4815 m absolute, so the peak band shrinks as the sea rises
  (at Earth-like endowments, sea ≈ 0, peaks cap near 4.8 km). That is
  the honest v1 envelope; richer high-water relief belongs to the
  collapse-rate successor (§9 risk 5), not to a taller cap.
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
**dynamic-sea land min ≥ 20%** (r9-both's measured dynamic-sea minima:
29.6 / 26.9 / 26.4% on seeds 1/42/1337, extracted from the phase-0 replay
logs — the old "land min ≥ 8%" floor belonged to the 0 m instrument and
retires with it; both instruments print during the transition); tempo
100–300 Myr/plate; no NaN (CLI tripwire); kernel suite within the v17
budget note (~60–75 s; new non-invariant tests sub-second).

## 4. Mapping to current code

**Survives unchanged:** the entire oceanic elevation path (bathymetry.ts,
#102 crest cap, trench pinning, arc growth + ceiling, sediment stacking);
the sea-level solve; the climate stack (reads cached elevation exactly as
today — T4's lapse convention untouched); the V2 kinematics trio;
codec/renderer (field is sim-only); crustFates area machinery.

**Modified (all behind the flag):** tectonics (advect + collision/
bulldozer/founder/consolidation in thickness), boundaries (maturation
gate re-key), erosion (thickness fluxes + ledger), freeboard (shims, then
retirement), crustFates (subsidence shim, thickness-keyed retirement,
welds), blockIsostasy (expected mostly-redundant; kept default-off as
today), state.ts (params + founding synthesis + onset re-inversion),
fields.ts (append), mechanisms.ts, sim-cli (flag + `--ab` arm +
instrumentation).

**Downstream consumers audited:** erosion reads elevation (derived —
same); energy balance/winds/moisture/ice/biome read elevation + sea
(same); seaLevel reads the hypsometry — post-C5 the continental branch is
confined to [−2306, +4815] m (no continental dynamic topo in v1) against
the absolutely-anchored oceanic hypsometry, so the bisection is *better*
conditioned (§8 T1); codec QUANT_TABLE untouched (derived values live
inside today's [−11000, 9500] envelope; oceanic trench floor −8500 m is
the range driver, as today); `EncodedKeyframe.landFraction` (0 m
convenience) unchanged — already documented as lagging.

**Perf honesty:** one extra Float32Array (≈0.4 MB at N=128); advection
copies one more field; incremental Δe is O(cells touched); the onset
re-inversion is one full O(cells) pass, once. No measurable step cost
expected; the kernel-suite budget gate stands.

## 5. Write-site resolution (all 21 sites + the 2 ledger exits)

Every elevation write site from handover §3, resolved: its C1 shim (§6 —
mechanical thickness-space equivalent, ΔT = Δe/k_cont, preserving today's
behavior through the flag-on path) and its physical endpoint (the stage
that replaces the shim with physics).

| # | Site | C1 shim (mechanical) | Physical endpoint (stage) | Ledger |
|---|---|---|---|---|
| 1 | initialTerrain founding noise | untouched (elevation noise stays) + thickness inversion at init/onset | same — the inversion *is* the founding budget (deviation from the handover's "thickness noise" sketch, flagged in §2.5) | defines the budget |
| 2 | plates.ts t=0 oceanic snap | untouched; oceanic T := 7.1 km | same | — |
| 3 | tectonics.ts:132 thermal-subsidence relax | untouched (oceanic branch) | same — the physical term survives as-is | — |
| 4 | tectonics.ts:166 microcontinent founder clamp | shim: clamp as today | fragment thickness := min(T, `CONTINENTAL_THICKNESS_MIN_M`) at detachment — Zealandia-class fragments are thinned crust; thin columns sit low without a clamp (C5) | declared non-conservative (1-cell events; today's posture) |
| 5 | tectonics.ts:239/242 consolidation pair flips | copy thickness with the other crust props | same (exact cell-count conservation as today); island→ocean side re-founds T := 7.1 km, hole→continent side flips by the §2.4 inversion rule | exact (area); flip adjustments counted |
| 6 | tectonics.ts:401 advection | `crustalThicknessM` joins `ADVECTED_FIELDS` | same | transport |
| 7 | tectonics.ts:549–552 collision ×0.5, 9 km cap | shim: Δe path kept, mirrored as ΔT | ΔT = 0.5·max(0, T_displaced), capped at `CONTINENTAL_THICKNESS_MAX_M` (C3). **Step change, stated:** today adds 0.5 × the displaced cell's *subaerial relief only* (tectonics.ts:551 — a +400 m cell contributes +200 m); the endpoint adds 0.5 × the displaced *column* (a 36 km column contributes ~2.6 km of surface), and submerged columns now contribute where today they add nothing. This is the India–Asia partition read as crustal volume — deliberate, ~10× stronger per overlap, and C3's peak/no-clamp gates are designed with it. The max(0,·) read guards the shim-era lobe (§6 C1) | source, partial by design (cited) |
| 8 | tectonics.ts:560 bulldozer re-root | transfer thickness with content | same (value + area exact) | exact |
| 9 | tectonics.ts:605 ridge gap fill | oceanic T := 7.1 km, age 0 | same — honest oceanic creation | source |
| 10 | boundaries.ts:289/291 arc growth + 1 km cap | untouched — oceanic-branch elevation as today; **no thickness accrual in v1** | unchanged in v1 (§2.1 scope fence); arc crust enters the continental ledger only at maturation, via the §2.4 inversion-at-flip. The growth term and ceiling retire with the oceanic-thickness successor, not here | — (until flip) |
| 11 | boundaries.ts:298 trench pinning | untouched | stays — explicit dynamic topography (flexure), honestly labeled, oceanic side only | — |
| 12 | boundaries.ts:386 orogenic uplift BFS | shim: ΔT = Δe/k_cont, cap → thickness | crustal shortening as thickness addition; cap 70 km (C3) | source (mantle-derived shortening budget — declared) |
| 13 | erosion.ts:149–150 interior diffusion | ΔT antisymmetric pairs | thickness diffusion — rebound emerges (C2) | conservative (mass) |
| 14 | erosion.ts:172 coastal export | ΔT export; sedimentM += ΔT·ρ_cc/ρ_sed | same, physical (C2) | conservative (mass ledger) |
| 15 | erosion.ts:193 marine planation | same conversion as #14 | same (C2) | conservative |
| 16 | erosion.ts:212 orogenic root decay | shim: Δe path mirrored | T relaxes toward `CONTINENTAL_THICKNESS_EQUILIBRIUM_M` from above, τ 300 Myr (C3) | declared non-conservative (root loss, today's posture) |
| 17 | blockIsostasy.ts:121 area caps | shim (flag is default-off anyway) | expected redundant — thin/small fragments are low by thickness; any residual area term returns as *declared flexure*, measured (C5) | — |
| 18 | crustFates.ts:183 weld bridge | copy elevation as today; flip by the §2.4 inversion rule | same + sediment accretion (#22) | area credit unchanged; flip adjustment counted |
| 19 | crustFates.ts:216 founder + retirement | subsidence shim; retirement trigger as today | founder via the thickness floor (#4's rule). **Retirement re-keys to thickness** (C5): retire when the whole component is submerged AND at the floor (T ≤ `CONTINENTAL_THICKNESS_MIN_M` + ε). Today's elevation trigger (max elev ≤ sea − 200) is unreachable once foundered columns rest at e(T_min) = −2306 m on any sea below −2106 m — including the dry half of the water sweep — which would silently remove the ledger's only debit. Consequence stated honestly: on low-sea worlds foundered fragments stand emergent and rarely retire (a dry planet hoards continental crust — physical; the sweep's crust-fraction watch carries it) | debit, declared; reachability audited (§8 T2) |
| 20 | freeboard.ts:166–167 epeirogenic + floor | shim: uniform ΔT = Δe/k_cont, floor kept | **RETIRED** (C5) — the pump (orogeny → uniform sink → nowhere to stop) is non-expressible in thickness space; C5 also regularizes the shim-era lobe (§6 C5) | — |
| 21 | freeboard.ts:170 passive margin | shim: ΔT toward the shelf | rift-margin thinning at 1.4e-4 m/yr thickness (today's 2e-5 m/yr surface-equivalent × 1/k) toward the **finite budget floor** `CONTINENTAL_REFERENCE_THICKNESS_M / MARGIN_STRETCH_FACTOR` = 30 km — never toward the 20 km identity floor (an unbounded grind to the identity floor is exactly the T2 shape; a constant rate needs a stop, and the handover's own row prescribed the stretch factor). Shelf *shallowness* (the 4–10% band) is owned by the existing sea-graded sediment/export machinery — base-level physics, self-limiting, T1-safe (C6) | declared (post-rift subsidence); budget bounded |
| 22 | sediment ledger exits (tectonics.ts:249–260, crustFates.ts:186) | keep zeroing (shim) | sediment accretes as ΔT = sedimentM·ρ_sed/ρ_cc at maturation/weld — the mass leak closed (C4) | conservative |

**The mass ledger** (replaces "Σ cont elevation + Σ sedimentM"):
`Σ(T·ρ_type·area) + Σ(sedimentM·ρ_sed·area)` changes only by: + arc
accretion at maturation (the §2.4 inversion-at-flip credit), + ridge
fill, + orogenic shortening influx (declared), + weld/consolidation flip
adjustments (counted), − oceanic subduction (incl. sediment), −
retirement debit, − founder trims (small, declared), ± the C5
regularization credit (one-time, reported). An invariant fixture closes
the ledger every step to float tolerance, per system.

## 6. Staged landing plan

Each stage independently abandonable; each exit gate is the next stage's
entry; **every stage lands its `ARCHITECTURE.md` delta in the same commit**
(house rule — not just C1/C7). All A/B runs: `--ab crustal-columns
--ab-branch <years>`, N=64, seeds {1, 42, 1337} unless stated. Baselines:
the promoted default (KBV 18) and, where hypsometry is scored, the
phase-0 r9-both numbers as the "beat-the-servo" reference.

- **C0 — instrumentation (no behavior change; goldens byte-identical).**
  Add to metrics/crust-stats: area-weighted dynamic-sea land%, the
  (0, 800 m] band-occupancy share, thickness stats (mean/min/max by crust
  type, raw and floor-clamped), and the mass-ledger closure printout.
  Both land instruments printed side by side. Exit: harness emits the §3
  scoreboard for existing worlds; baseline numbers recorded for r9-both
  and stock.
- **C1 — the field, flag-gated (phase 2 of the handover).** Field + init
  inversion + onset re-inversion + derivation + *all* shims (§5) +
  branch-flip rules. **Shim-era validity domain, declared:** during
  C1–C4, `crustalThicknessM` is Δ-space bookkeeping — cells the legacy
  pump holds below e(T_min) carry unphysically thin (even negative)
  inversion values, bounded below by inversion(sea − 2500) via the
  buoyancy-floor shim; physical-endpoint reads clamp to max(T, 0) with
  the discrepancy counted; nothing physical consumes raw shim-era T
  until C5 regularizes it.
  Tests: isolated golden arm under `ALL_MECHANISMS_OFF`; **engaged** arm
  (#102 pattern — assert post-onset elevation equals the continental
  derivation exactly on a thickness-perturbed world); onset-gating entry;
  derivation coherence fixture (continental branch); ledger fixture. KBV
  bump (bump-5 `sutureYears` precedent: a new advected field is a
  deliberate golden regen even with every pre-existing field
  bit-identical), pre-bump spine kept.
  Exit gate — **shim equivalence**: flag-on vs flag-off over 500 Myr,
  distributional stats (land%, freeboard, crust fraction, dispersal)
  within |Δ| ≤ 1 pt / 100 m; trajectories may diverge chaotically
  (float-level), distributions may not. With the onset re-inversion the
  onset snap is zero by construction, so any distributional drift is a
  shim bug — fix the shim, never widen the tolerance.
- **C2 — erosion in thickness space (the headline win).** Sites 13–15.
  A/B gates: band-occupancy share strictly increases vs C1 world; mean
  freeboard decreases ≥ 200 m by +1 Gyr post-branch; measured planation
  rate reported against the 4.7 m/Myr budget **on both the source and
  sink sides** (shelf-room saturation share and subducted-sediment flux
  printed — §9 risk 1 triggers here); conservation fixtures;
  non-regression floor (§3).
- **C3 — orogeny/collision/root decay.** Sites 7, 12, 16. Gates: peaks
  5–9 km above sea at scale 1.0; zero elevation-cap clamp events (the
  70 km thickness cap binds instead — both counted); belts still die in
  interiors (τ path); the site-7 step change's effect on belt widths/
  heights reported explicitly; floor holds.
- **C4 — maturation gate re-key + sediment accretion.** Sites 10 (gate
  only — growth untouched), 18, 22. **Crust fraction is the first metric
  read** (T3): 0.35–0.45 with the phase-0 38.7–39.3% reference band;
  maturation-depth distribution reported (closure check 3); creation/
  consumption budget printed. Pre-registered fallback:
  `ARC_MATURATION_THICKNESS_M` moves only inside the cited 20–25 km
  band, one measured step.
- **C5 — retire the freeboard servo; founder/caps/retirement to
  thickness.** Sites 4, 17, 19, 20. Includes the **one-time
  regularization** `T := max(T, CONTINENTAL_THICKNESS_MIN_M)` over
  continental cells (the shim-era lobe lifted to the physical floor — a
  declared ledger credit whose magnitude is a reported A/B statistic;
  if it is large enough to move the crust-fraction gate, that is a
  documented re-staging trigger, §9 risk 3). Gates: min continental
  elevation ≥ e(T_min) = −2306 m from here on (the T2 fixture activates
  at this stage — it cannot hold earlier and says so); no ratchet over
  4.5 Gyr (min-elev time series bounded); flooded share reported (watch
  band); retirement-reachability audit across the sweep seas.
- **C6 — margins last.** Site 21. Gates: shallow-ocean share stays in the
  Earth-like 4–10% band (the datum stack's restored property); margin
  thinning verifiably stops at the β budget (no cell below 30 km by
  margin action alone); shelf halos visible in dumps (eyeballed, per the
  house rule). Pre-registered knob: β within the cited 1.2–2.
- **C7 — calibration + promotion (phase 4 of the handover).** Full §3/§10
  grid across seeds × water scales; N=128 replication; scoreboard doc;
  **owner sign-off**; promotion commit = defaults on + KBV bump + golden
  regen + pre-promotion spine pinned verbatim + `ARCHITECTURE.md`
  rewrite.

## 7. Determinism & purity appendix

Every stochastic draw site under this design: **none.** No thickness
writer, the derivation, the founding/onset inversions, nor any shim
consumes RNG — the branched-A/B contract ("no gated system consumes RNG")
holds by construction for the single flag. No `while (!converged)`
anywhere: the derivation is closed-form; the onset re-inversion is one
fixed pass; ledger sums are one ascending-index sweep (fixed FP order).
No I/O, no globals, no input mutation; per-call scratch only.
Transcendentals: none beyond the existing `sqrt` in the untouched oceanic
curve. Flag-off byte-identity is structural (writers gated; the field
itself is written at init and by advection only — advecting an unread
field perturbs nothing). New named fixtures, staged: derivation-coherence
(continental branch, cached vs recomputed, ≤ 1e-6 m — from C1), ledger
closure (≤ 1e-6 relative/step — from C1), onset-gating arm (C1), engaged
golden (C1), shim-equivalence harness (C1), the T2 floor assertion
(**from C5** — the shim era legitimately violates it), retirement-
reachability audit (C5). Existing conservation invariants re-asserted
flag-on. All fixtures at N=16/32, sub-second each.

## 8. Trap answers (T1–T7) and the failure-ledger cross-check

- **T1 (age-depth re-key divergence).** The oceanic branch is untouched —
  the abyss stays the absolute volume anchor and the crest cap ships
  as-is. The continental datum `C_cont` is a fixed constant; **no
  relaxation target in the final model reads sea level** (site 21's
  budget floor is a fixed thickness; site 19's trigger is thickness +
  submergence). The one deliberate sea-keyed attractor that remains is
  erosion's base level — self-limiting (flux → 0 at the waterline, mass
  leaves through a capped shelf), which is precisely the T5 mechanism,
  not a runaway. Post-C5 continental elevation is confined to
  [−2306, +4815] m against the anchored abyssal hypsometry, so the
  bisection's volume slope is bounded away from zero; the conditioning
  test (slope > 0.2) extends to a flag-on arm. One honest nuance: the C1
  *shims* reproduce today's mechanisms, and under the v18 datum stack
  nearly all of them ride the dynamic sea (the epeirogenic servo, the
  buoyancy floor, margins, the collision/orogeny/arc ceilings, both
  founder levels, the root-decay reference, the planation/shelf
  ceilings) — the shim layer carries today's sea coupling, exactly as
  today, until C5/C6 retire it. T1 binds the *final* model; the shims
  are the measured bridge, not the destination. Hydro-isostasy — the one
  place water load could couple into the derivation — is excluded from
  v1 and pre-analyzed (loop gain < 0.5) for its own future pass.
- **T2 (nowhere-to-stop ratchets).** In thickness space the floor is
  physical and *structural*: post-C5, no process thins below
  `CONTINENTAL_THICKNESS_MIN_M`, therefore no continental cell sits
  below −2306 m — asserted as a fixture from C5 on, not policed by a
  clamp constant. The −17.8 km failure is non-expressible. Audited
  thinning processes: erosion (vanishing flux at base level), root decay
  (stops at T_eq), margins (**finite β budget at 30 km — a stop, not
  just a floor**; the reviewer-found unbounded-grind shape is closed),
  founder (floor), retirement (thickness-keyed, so the debit stays
  reachable wherever fragments actually drown; where they don't, crust
  is hoarded — visible in the sweep's crust-fraction watch, not silent).
  None is unbounded.
- **T3 (crest/maturation creation budget).** The maturation gate becomes
  absolute at −2306 m — within ~400 m of today's sea-keyed gate at the
  r9-both sea, but 1.7 km *shallower* than it at the stock sea (closure
  check 3), so the creation budget shifts with the mechanism stack.
  Therefore stage C4 reads crust fraction first, against the phase-0
  reference band 38.7–39.3%, before anything else is scored; the
  fallback knob and its cited range are pre-registered.
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
than silently keeping the servo. The margin design was audited against
the buoyancy-floor lesson specifically: a rate with only the *identity*
floor to stop at re-creates the "nowhere to stop until the floor" shape,
which is why site 21 carries a finite stretch budget instead.

## 9. Risks, and how this fails

1. **Planation too slow or sink-limited** — kernel erosion may not
   deliver ~4.7 m/Myr of thickness export from platform interiors, or
   the export may bottleneck on the sink side (the sea-keyed shelf-room
   cap, subduction throughput) where the source-side knob cannot help.
   Freeboard then stalls in the 1.5–2.5 km band at water scale 1.0.
   Defenses: the budget is cratonic-order (physically modest); C2
   measures source and sink rates separately. Pre-registered response:
   report the measured band honestly; the partial win (freeboard
   1.5–2.5 km + correct hypsometry *shape*) is accepted at scale 1.0
   **only if** the water sweep shows < 1.0 km at Earth-like endowments
   (the physics being right, the default planet being dry); the one
   permissible knob is the already-flagged "honest-about-tuning" subsea
   damping factor, one measured step. Never a new servo.
2. **T3 creation-budget shift** — §8; fallback pre-registered (20–25 km,
   one knob, crust fraction gates it).
3. **The shim-era lobe and its C5 regularization** — pump-flooded cells
   carry unphysical thickness until C5; the one-time `max(T, T_min)`
   credit could be large on worlds with a deep flooded lobe. Defenses:
   the validity domain is declared, physical reads clamp at max(T, 0)
   with discrepancies counted, and the credit's magnitude is a reported
   A/B statistic. Escalation: if the credit moves the crust-fraction
   gate, re-order the staging so the pump retirement (site 20) lands
   earlier — a documented re-staging, not a rewrite (the flags make it
   a findings doc).
4. **Shim-equivalence drift** — chaotic divergence is expected
   trajectory-wise; the gate is distributional. If distributions drift
   past the C1 tolerance, a shim is not the identity it claims to be —
   fix the shim, never widen the tolerance (the tolerance is the
   instrument). With the onset snap zero by construction, there is no
   competing explanation to hide behind.
5. **Belt/peak behavior under the 70 km cap and the site-7 step change**
   — collision stacking is ~10× stronger per overlap than today's
   subaerial-relief rule and could pile thickness to the cap, holding
   peaks at +4815 m absolute and flattening summit variety (and the
   peak band shrinks outright on high-water worlds — §3 scoping).
   Defenses: root decay + erosion act on thickness continuously; C3
   gates on the peak band at scale 1.0 and reports belt geometry
   explicitly. Escalation: a declared, cited collapse *rate* above
   ~60 km (viscous spreading) instead of a hard cap — a known extension
   that also owns the high-water relief story.
6. **Wholesale failure shape** — the column world may need more than one
   constant retuned per stage to stay alive (the sweep's cliff edges:
   hazard < 0.004 is death, dead worlds drown). If any stage cannot pass
   its gates without touching more than one pre-registered knob, stop,
   write the findings doc, leave the flag default-off (the compactArcs
   precedent) — the staging makes that a documented mechanism, not a
   revert. The phase-0 baseline remains the shipped world.

## 10. Acceptance grid (phase C7, supersedes handover §7 where they differ)

Health floors (re-anchored to the dynamic-sea instrument, phase-0
measured): §3 must-not-regress list, both instruments printed.
Earth-likeness: the §3 scoreboard. Alt-world: the §3 water sweep +
luminosity sweeps keep working + gravity explicitly not wired (§2.6).
Determinism: goldens {1,42,1337}; flag-off byte-identical; onset
contract; zero draws. Visual: PNG dumps at every gate — numbers passing
while maps look wrong is a failure (house rule); the r9-both frames are
the beat-this reference.

Instrumentation deltas (C0): area-weighted land%, band occupancy,
thickness stats (raw + clamped), ledger closure, both-instrument land
print. The N=128 replication and the r9-both-vs-columns scoreboard table
are C7 deliverables for the promotion decision.

## 11. Open questions for the owner (phase-1 gate)

1. **Hydro-isostasy exclusion (v1):** accept the dry continental branch
   with the ≤ ~150 m shelf-depth error and the pre-analyzed upgrade path
   (§2.4)? (Recommended: yes — T1-safest, smallest first cut.)
2. **Freeboard gate at water scale 1.0:** accept the pre-registered
   partial-win band (§9 risk 1) — i.e., the win condition is "the physics
   is right across the water sweep", not "the dry default planet must hit
   Earth's freeboard"? A separate later decision could make scale ~1.5
   the shipped default planet; that is a product choice, not physics.
3. **Arc scope (v1):** arc growth and the island ceiling stay today's
   oceanic-elevation mechanism; thickness enters the continental ledger
   only at maturation, via inversion-at-flip; the ceiling retires with a
   future oceanic-thickness successor, not here. (Recommended: yes —
   smallest cut, elevation-continuous by construction, T3-conservative;
   the alternative — accrued arc thickness driving oceanic elevation —
   is the successor issue, not v1.)
4. **KBV cadence:** C1 bumps (schema growth — the bump-5 `sutureYears`
   precedent); C2–C6 regenerate only the `crustalColumns` flag-arm spine
   (flag-off main goldens untouched) and follow the V2 stage precedent —
   stages 1–4 of the V2 program regenerated their arm spines without
   KBV bumps, and KBV 17 was the promotion; C7 bumps at promotion. Two
   bumps total under that reading of the "every deliberate regeneration"
   rule. Confirm the reading (or direct a bump per stage).

Sign-off on this document is the phase-1 → phase-2 gate (handover §8).
