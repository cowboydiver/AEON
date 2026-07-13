# TECTONICS_V2_PROPOSAL.md — force-driven plate kinematics

**Status: proposal, no code.** A design for rethinking the fundamental plate
model so the deep-time record is produced by mechanism instead of schedule.
Companion to `ARCHITECTURE.md` (read its Plates/#13–#18 sections first) and to
the findings ledger (`PHASE_2_STAGE0_FINDINGS.md`, `ISSUE_88_91_FINDINGS.md`,
`DEEP_TIME_TECTONICS_HANDOVER.md`).

**Provenance.** This document synthesizes a four-way competing design study
(force-balance kinematics; a kinematic mantle-proxy layer; emergent plates from
a per-cell lithosphere solve; a persistent boundary-segment grammar on
prescribed kinematics), judged through geophysical-realism and
architecture/determinism lenses plus a risk/incrementality review. All four
designs — including the two that were assigned non-force angles — converged on
the same root diagnosis, which is therefore worth stating as a finding, not an
opinion:

> Every scripted knob in the Wilson-cycle layer is a stand-in for the same
> missing physics: plate motion that responds to what the plate touches.

The winning design keeps AEON's plate substrate and spends its complexity
budget exactly there. The losing designs are summarized in §9; their best
ideas are grafted into §2/§5 and credited inline.

---

## 0. Summary

Replace the one thing in the kernel that is 100% random and immutable — each
plate's Euler vector, drawn uniformly at creation and never changed
(`plates.ts:192–209`) — with a per-step **rigid-plate torque balance**: slab
pull along subducting margins, ridge push along divergent margins,
continent–continent collision damping, closed by linear basal drag with a
continental-keel multiplier. Each plate's angular velocity relaxes toward the
balance's terminal velocity with a ~10 Myr time constant.

One mechanism change retires or demotes four scripted subsystems at once:

| Scripted today | Under force balance |
|---|---|
| 60 Myr suture countdown (`SUTURE_AFTER_YEARS`) | collisions *stall* in ~10–20 Myr because collision damping kills the closing speed; the merge event becomes bookkeeping on an already-dead boundary |
| flat rift hazard × hand-tuned size ramp (`RIFT_PROBABILITY_PER_MYR`, knee 0.3 / 16× at 0.55 — measured bimodal in #66) | rift hazard ∝ (boundary tension)², a physical scalar that grows continuously with opposed subducting perimeter — a supercontinent rifts *because it is being pulled apart* |
| ocean-seeking rift azimuth fan + perpendicular translating pole (`wilson.ts` `riftPlate`) | fragment inherits the parent's ω; ridge push at the new divergent boundary separates the halves because forces separate them |
| 120 Myr post-rift suture lock (`RIFT_SUTURE_COOLDOWN_YEARS`) | divergent halves have no convergent continental contact, so the stall-suture criterion cannot fire; the timer becomes measurable-then-retirable |

No new per-cell fields. No codec change. No new RNG draws — the new system is
a pure deterministic function of state. Estimated +1–3 ms/step at N=128
against the measured ~13–18 ms/step. Lands as three default-off mechanism
flags (`forceKinematics`, `emergentSuture`, `tensionRift`) in the standard
onset-year pattern, each `--ab`-measurable, each independently abandonable.

---

## 1. Why rethink: what is physical today, what is scripted

The Phase 1/2 tectonics stack is physically serious *downstream* of plate
motion and almost entirely scripted *upstream* of it.

**Physical (keep):** rigid Euler-pole rotation and quantized semi-Lagrangian
crust advection (`tectonics.ts`); half-space-cooling age-depth bathymetry
(`bathymetry.ts`); buoyancy/age subduction polarity (`boundaries.ts:137–148`);
stress-driven trench/arc/orogeny topography with accretionary arc maturation;
continental crust conservation via the bulldozer (`tectonics.ts:396–449`).

**Scripted (the redesign target):** everything that decides *why plates move
the way they do*:

- Euler pole: uniform random unit vector, drawn once, immutable forever
  (`plates.ts:194`).
- Speed: uniform draw in [1.5, 8]×10⁻⁹ rad/yr (≈1–5 cm/yr), immutable forever
  (`plates.ts:195–198`). Plates never accelerate, decelerate, or steer in
  response to anything. "Plate speeds do not slow in collisions" is a
  documented Phase 1 simplification (`ARCHITECTURE.md`).
- Suturing: a 60 Myr contact timer (`SUTURE_AFTER_YEARS`, `constants.ts:795`).
- Rifting: flat Bernoulli hazard 0.0015/Myr (`constants.ts:850`) × a size ramp
  whose response was measured *bimodal* (#66: 49%→93% dispersal between 12×
  and 16× the reference rate — the signature of a threshold scheduler, "no
  usable middle").
- Rift geometry: the ocean-seeking azimuth fan and the
  perpendicular-to-centroid translating pole (`wilson.ts` `riftPlate`) — both
  hand-built to fake what slab pull and ridge push would do to a real
  fragment.
- Post-rift dispersal: a 120 Myr suture lock (`constants.ts:963`), whose
  measured tradeoff table (cooldown vs land-bleed,
  `DEEP_TIME_TECTONICS_HANDOVER.md` §2) is the clearest statement of the wall:
  **you cannot buy dispersal with a longer timer, because while the timer
  runs, full-speed grind consumes continent.**

Every measured deep-time pathology traces to this gap. The whole-sphere
monopoly and re-suture loop existed because rifted halves *had no force
separating them*. Land starvation (#58, canary seed 1337) existed because
collisions grind at full random speed for the entire suture wait. The
herringbone/freckle artifact stratum is quantized-advection rounding — a
separate workstream — but its *exposure* is multiplied by margin flicker,
which is what randomly-pointed velocities do to boundary dwell times. The
#84–#91 mechanism campaign (crustFates, marinePlanation, compactArcs,
emergentArcTaper) is a repair layer for shapes the kinematics keep
manufacturing.

The current model is, in the prior-art taxonomy, a Cortial-class prescribed
simulator with an unusually good measurement harness. The literature says the
next tier up is cheap: **a rigid-plate torque balance with slab pull dominant
predicts ~90% of present-day plate motion** (Forsyth & Uyeda 1975; Becker &
O'Connell 2001; Conrad & Lithgow-Bertelloni 2002) — no Stokes solver, just
boundary integrals and a 3×3 solve per plate. That is the cheapest point on
the design spectrum that closes the feedback loop, and it is the move every
competing design in the study either made or conceded it was the substrate
for.

---

## 2. The proposed model

### 2.1 Thesis

Each plate's angular-velocity vector ω⃗ becomes *derived state*: every step it
relaxes toward the terminal velocity ω⃗\* of a boundary-integrated torque
balance, with linear basal drag as the closure. Motion then responds to the
crust map: slab-attached oceanic plates run fast (~8–10 cm/yr), cratonic
plates crawl (~1–3 cm/yr), collisions stall, and losing a subduction margin
(ocean fully consumed → contact turns continental) removes that slab-pull
term from the torque sum *the same step the crust map changes* — the plate
decelerates over ~τ and its pole swings. Reorganization-by-subduction-death,
India-style stall, and the speed–continentality anticorrelation all become
consequences instead of rules.

Deliberately **not** attempted: emergent plate *boundaries* (the
StagYY-class problem — a per-cell lithosphere solve was one of the four
studied designs and lost on cost and localization risk, §9), sub-cell
advection (separate workstream; the herringbone survives this redesign), and
a resolved mantle (a deterministic mantle-geography layer is specified as the
*successor* flag, §5 Stage 6).

### 2.2 State

Extends `PlateRecord` (`plates.ts`) — a JS record array, not a per-cell
field, so the typed-array rule and the codec are untouched. Flag-off runs
carry zeros.

```ts
export interface PlateRecord {
  // existing fields unchanged; eulerPole/angularVelRadPerYr become DERIVED:
  // pole = ω⃗/|ω⃗|, speed = |ω⃗| (|ω⃗| < 1e-18 keeps the previous pole, speed 0
  // — deterministic branch). Every existing consumer reads the derived pair
  // and does not change.
  omegaVec: Vec3;          // ω⃗, rad/yr — THE kinematic state under forceKinematics
  tensionN: number;        // diagnostic: gross − |net| boundary driving force, N
  stallSinceYears: number; // emergentSuture: start of the current stalled contact (0 = none)
  blanketYears: number;    // tensionRift: accumulated supercontinent thermal-blanket age
}
```

**Per-cell fields: none added.** All force inputs already exist: `plateId`,
`crustType`, `crustAge`, `boundaryStress` (previous step's kinematics — the
standard one-step-lag idiom), cell centers, neighbor table. An optional
non-stored `plateSpeed` diagnostic for `--dump` must not enter `QUANT_TABLE`
(no `HISTORY_FORMAT_VERSION` bump); if a velocity *vector* dump ships, store
basis-free Cartesian tangent components to dodge the polar degeneracies of an
east/north basis (graft from the litho design).

**Diagnostics routing (correction from the study's architecture review):**
keyframes carry `fields`/`globals`/`events` only — never `plates`
(`step.ts:124–141`). Per-plate `tensionN` reaches the harness through the
event log (rift/suture events already carry data payloads) and an aggregate
(`globals.maxPlateTensionN` or the `--plate-census` report), not through
keyframe plate records.

### 2.3 Constants (each lands in `constants.ts` with a source comment)

| Constant | Value | Physical meaning |
|---|---|---|
| `SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR` | 5e8 | Net transmitted slab pull per m of trench per √(age yr). 100 Myr crust ⇒ 5×10¹² N/m — Schellart 2004's net slab pull (4–6×10¹², ~10% of total slab buoyancy). ∝√age is half-space cooling — the same law as the bathymetry curve. |
| `SLAB_PULL_MIN_AGE_YEARS` | 2.5e7 | Lithosphere younger than ~25 Myr is not reliably negatively buoyant; pull ramps linearly 0→full over [1×, 2×] this age. Prevents fresh-ridge-flank self-subduction feedback. |
| `SLAB_SUCTION_FACTOR` | 0.4 | Fraction of cell slab pull applied to the *overriding* plate, trench-ward (Conrad & Lithgow-Bertelloni 2002). Makes subduction organize both plates. |
| `RIDGE_PUSH_N_PER_M` | 2.5e12 | GPE push per m of divergent boundary, each flank, away from the ridge (~½ net slab pull; Forsyth & Uyeda 1975). |
| `COLLISION_DAMP_N_YR_PER_M2` | 2e14 | Cont–cont contact resistance per m per (m/yr) closing. At 5 cm/yr ⇒ 1×10¹³ N/m (Gurnis & Hall 2004 subduction-initiation scale). Pure damping, capped — can stall, never reverse. |
| `BASAL_DRAG_N_YR_PER_M3` | 1.2e7 | Linear basal traction −c_d·v. The model's "mantle viscosity", the primary calibration lever. |
| `CONTINENTAL_DRAG_MULTIPLIER` | 4 | Per-cell drag multiplier on continental cells (cratonic keels). Mixed plates interpolate naturally; speed anticorrelates with continental fraction as a *consequence*. |
| `OMEGA_RELAX_YEARS` | 1e7 | e-folding of ω⃗ toward ω⃗\*. Anchors: India lost ~⅔ of its speed in ~15 Myr at collision; poles hold 10–100 Myr. Also the low-pass against advection-quantum torque noise. |
| `PLATE_SPEED_CAP_M_PER_YR` | 0.2 | Hard cap (India's ~18–20 cm/yr burst is the observed ceiling); rescales ω⃗; protects advection cadence and boundary-rate clamps from runaway calibration. |
| `DRAG_TENSOR_REGULARIZATION` | 1e-3 | Fraction of tr(K)/3 added to K's diagonal: a near-point plate has a singular drag tensor along its radial axis (spin-in-place is dragless); the regularizer pins that null space deterministically. |
| `SUTURE_STALL_SPEED_M_PER_YR` | 0.002 | A continental contact is "stalled" below 2 mm/yr mean closing (below the 5 mm/yr active-margin gate, an order below plate speeds). |
| `SUTURE_STALL_AFTER_YEARS` | 2e7 | Merge topologically after 20 Myr of continuous stall — bookkeeping on a dead boundary, not a countdown on a live one. |
| `SUTURE_TIMEOUT_YEARS` | 1.5e8 | Loud scripted backstop (graft from the margin-ledger design): if a continental contact persists 150 Myr without stalling, merge anyway and emit a distinct `sutureTimeout` event — the stall-never-fires failure mode surfaces in the event log instead of as silent grind. |
| `RIFT_TENSION_REF_N` | 3e19 | Tension scale: a supercontinent-scale plate with ~10⁷ m of opposed subducting perimeter at ~3×10¹² N/m carries gross−net ≈ 3×10¹⁹ N. |
| `RIFT_HAZARD_AT_REF_PER_MYR` | 0.01 | Hazard = this × min(4, (T/T_ref)²) × blanket factor. Replaces the flat hazard + size ramp. Pre-registered Plan B if tension² proves as bimodal as the ramp it replaces: soft-yield shape ∝ max(0, T−T_ref)² (graft from the mantle-proxy design). |
| `BLANKET_EFOLD_YEARS` / `BLANKET_MAX_FACTOR` | 3e8 / 3 | Supercontinent thermal blanket: accumulates while a plate holds ≥25% of the sphere as continent; hazard ×(1 + (MAX−1)(1−e^(−t/efold))). The one deliberately *pseudo-mantle* term, honestly labeled; superseded by `mantleAnchors` (§5 Stage 6). |

Closure sanity (not a derivation): drive F ≈ 5e12 N/m × 6e6 m trench =
3×10¹⁹ N; terminal v = F/(c_d·A) = 3e19/(1.2e7 × 3e13 m²) ≈ 8.3 cm/yr for a
slab-attached oceanic plate. A slab-free continental plate under ridge push
alone: ≈0.9 cm/yr. **Both ends of the Earth speed envelope fall out of two
constants before any tuning** — this is the design's cargo-cult test, and it
passes at the armchair stage.

### 2.4 Per-step algorithm

New pure system `plateDynamics`, inserted in `SYSTEMS` **between `tectonics`
and `wilson`** (`step.ts:67–99`): it must read the post-advection partition +
the stress tectonics just computed, and wilson must see the updated
kinematics. It recomputes `boundaryStress` after changing ω — the #55 rule
(never pair stale-kinematics stress with new state).

```
plateDynamics(state, dt):
  if (!params.forceKinematics || timeYears < onset) return state
  cellW = (π/2)·R/N                     // boundary length per boundary cell
  cellA = 4πR²/(6N²)                    // equal-area approximation

  // pass 1: one ascending-index O(cells) sweep — fixed FP summation order
  for i in 0..cells−1:
    p = plateId[i]; r̂ = cellCenter(i)
    K[p] += dragMult(crustType[i]) · cellA · (I − r̂r̂ᵀ)     // drag tensor
    other = dominantOtherPlate(i);  if none: continue        // interior: drag only
    û  = pairConsistentTangent(i, other)                     // computeBoundaryStress's construction
    uN = boundaryStress[i]                                   // PREVIOUS kinematics (one-step lag)
    F⃗ = 0
    if uN < −ACTIVE_MARGIN_STRESS:            F⃗ −= û · RIDGE_PUSH · cellW
    else if uN > ACTIVE_MARGIN_STRESS:
      if bothContinental:                     F⃗ −= û · min(COLLISION_DAMP·uN, cap) · cellW
      else if thisSideSubducts (overrides()): // velocity-independent polarity
        pull = SLAB_PULL · √age_i · ageRamp(age_i) · cellW
        F⃗ += û · pull                                        // slab pull on the subducter
        torque[other] += (R·r̂ₒ) × (−ûₒ · SLAB_SUCTION · pull) // suction on the overrider
    torque[p] += (R·r̂) × F⃗;  gross[p] += |F⃗|;  net[p] += F⃗

  // pass 2: per-plate closed-form solve + semi-implicit relaxation — no iteration
  for p in plates (ascending, alive):
    ω⃗* = adjugateSolve3x3(c_d·R²·(K[p] + REG·tr/3·I), torque[p])
    a  = dt / OMEGA_RELAX_YEARS
    ω⃗  = (ω⃗ + a·ω⃗*) / (1 + a)                // unconditionally stable, dt-correct
    cap |ω⃗|·R at SPEED_CAP;  tensionN[p] = gross[p] − |net[p]|
    derive eulerPole / angularVelRadPerYr

  recompute boundaryStress; return new state
```

**`emergentSuture`** rewrites only wilson's trigger: a continental contact
pair (same scan as today) whose mean |closing speed| stays below
`SUTURE_STALL_SPEED` for `SUTURE_STALL_AFTER_YEARS` merges; the
`SUTURE_TIMEOUT_YEARS` backstop merges loudly if stall never fires. A
shortening-*integral* variant of the stall criterion (accumulated cont–cont
convergence per contact, a margin-ledger graft) is the pre-registered
fallback if the instantaneous 2 mm/yr threshold proves jittery under
advection-quantum noise — an integral is far more robust to teleporting
boundaries than an instantaneous speed. Merged kinematics:
**ω⃗ = (K_a+K_b)⁻¹(K_a ω⃗_a + K_b ω⃗_b)** — the drag-tensor-weighted blend is
the exact fixed point the combined plate would relax to, degrading to today's
area-weighted mean for co-located plates. The winner's `accumulatedRadians`
is preserved (today's merge drops up to 2.5 cells of pending motion).

**`tensionRift`** rewrites only the rift *timing*: hazard λ =
`RIFT_HAZARD_AT_REF` × min(4, (tensionN/T_REF)²) × blanketFactor, drawn at
the **same hash site** `hash3(riftSeed, plate, timeQuantum, 0)`
(`wilson.ts:245`) against `1 − exp(−λ·dtMyr)`. The safety gates that protect
the plate-slot budget stay (continental ≥2% of sphere, area ≥8%,
`MAX_PLATES`); the age gate and size ramp are deleted under the flag. The
carve machinery — fragment seed, jittered Dijkstra, 0.2–0.4 size draw — is
**byte-identical**; §7 explains why the carve must not be touched. Fragment
kinematics: `omegaVec` inherits the parent's (no draw); the new divergent
boundary registers ridge push next step and the forces separate the halves —
replacing both the perpendicular-pole construction and the azimuth fan.

### 2.5 Emergent vs prescribed

**Becomes emergent:** plate speed regimes and the speed–continentality
anticorrelation; pole stability (10–100 Myr) and pole migration at
reorganizations; collision stall (suturing as detection, not schedule);
subduction-death reorganizations; rift *timing* (tension + blanket); rift
*separation* (ridge push); post-rift dispersal (no convergent contact to
re-suture).

**Stays prescribed, deliberately:** plate boundary *geometry* (partition,
carve, contiguity — the rejected-variant ledger proves carve-geometry
cleverness is a trap, §7); the topological event executor (≤1 suture + 1
rift per step, slot discipline, MIN/MAX_PLATES); rift *stochasticity itself*
(the hazard stays a hash draw; physics modulates the rate — prior-art lesson:
scripted trigger, emergent-looking consequence); subduction *initiation*
(implicit in overlap polarity via `overrides()` — matches the research: real
initiation is rare and induced; the initial random ω draws stay as the
symmetry-breaking transient, washed out in ~3τ ≈ 30 Myr); boundary
topography (unchanged; it now receives better-behaved inputs); the thermal
blanket (pseudo-mantle scalar, honestly labeled, successor specified).

---

## 3. The Earth-target scoreboard

New falsifiable claims this model is accountable to (measured by the Stage 0
census, §5):

- **Speed census:** median plate speed 2–6 cm/yr; oceanic/continental speed
  ratio 1.5–4; fastest plates are those with the most subducting perimeter
  and least continent (Forsyth & Uyeda's sign tests, now assertions about
  the sim).
- **Seafloor age:** mean 60–80 Myr, max ~180–200 Myr, age–area distribution
  roughly triangular (fast slab-attached plates preferentially consume old
  floor — today's fixed speeds have no such preference and no mechanism
  enforces the ceiling; if the triangle fails, trench rollback is the named
  follow-up, §5 grafts).
- **Tempo:** same-plate reorganization interval 100–300 Myr (the existing
  `--report` tempo line); supercontinent tenure ~100–200 Myr;
  assembly→breakup cycle in the 400–700 Myr band.
- **Pole behavior:** Euler-pole autocorrelation time 10–100 Myr during
  stable configurations; swings coincident with suture/rift/subduction-death
  events, not random walk (the Stage 0 pole-autocorrelation diagnostic).

**Must not regress (the hard-won floor):** dispersal ≥ 0.7 in every Gyr
bucket, dispersed-window fraction 93–94% band at N=64; land min ≥ 10% on all
three golden seeds over 4.5 Gyr; largest continental component in the #67
0.22–0.31 band; monopoly windows < 400 Myr; kernel tests < 30 s.

---

## 4. Mapping to current code

**Survives unchanged:** `plates.ts` partition + `applyInitialPlates` +
`plateVelocityAt` (reads the derived pole/ω pair); the entire `tectonics.ts`
advection pipeline (quantum dither, claims, bulldozer, gap repair,
consolidation, founder clamp, sediment sweep); `boundaries.ts`
(`computeBoundaryStress`, `dominantOtherPlate`, `overrides`,
`applyConvergentTopography` — `plateDynamics` imports the first three; the
pair-consistent û construction is factored into a shared helper, not
duplicated); `crustFates`, erosion, freeboard, blockIsostasy, datums, codec.
**No stored-field change, no `HISTORY_FORMAT_VERSION` bump.**

**Modified:** `state.ts` (+3 param flags with onset years, standard
mechanism pattern); `step.ts` (insert `plateDynamics` with an ordering
comment); `wilson.ts` (Stage 2 trigger swap reusing the contact-scan
machinery — `contactSince` generalizes to `stallSince`; Stage 3 hazard swap;
flag-off paths byte-preserved); `mechanisms.ts` (+3 entries — buys sidebar
toggles, history-cache keying, and `--ab` support automatically); `sim-cli`
(`--plate-census`).

**Downstream consumers audited:**
- `plateId` readers (wilson, crustFates, freeboard, codec/renderer):
  semantics identical.
- `boundaryStress` readers: sign and zero-interior semantics identical;
  **magnitude distribution shifts** (closing speeds can reach ~0.2 m/yr vs
  ~0.1 today). `OROGENY_STRESS_REF_M_PER_YR` (0.05) saturation and the
  trench norm still clamp at 1 — safe. The **carbon outgassing proxy**
  (mean |stress| over active boundary cells vs
  `CO2_OUTGAS_ACTIVITY_REF_M_PER_YR`) will read hotter on fast-plate worlds
  — a real recalibration risk, gated in Stage 1 on mean-temperature drift.
- `crustType`/`crustAge`/`sutureYears`/`sedimentM`: written by the same
  passes as today.
- Renderer: reads only codec fields; plate records never cross the codec
  (`step.ts:124–141`). Nothing changes.

**Perf honesty:** the added cost is one O(cells) sweep (interior cells ~20
flops, boundary cells ~80) plus a second `computeBoundaryStress` — estimated
**+1–3 ms/step at N=128 against the measured ~13–18 ms/step**
(`PHASE_2_STAGE0_FINDINGS.md`, machine-dependent), i.e. ~10–20%, dominated by
the stress recompute. If that margin matters, wilson's conditional stress
recomputes can be consolidated with this one. Per-plate solves (≤256 × ~60
flops) and scratch (~44 numbers/plate) are negligible. Invariant fixtures run
at N=16/N=32 inside the <30 s budget.

---

## 5. Staged landing plan

All default-off, `--ab`-measurable, each stage independently abandonable (a
gate failure leaves a documented default-off mechanism — the compactArcs
precedent — not a revert).

**Stage 0 — instrumentation (no behavior change, goldens byte-identical).**
`--plate-census` in sim-cli: per-keyframe speed distribution and per-plate
speed-vs-continental-fraction; seafloor age mean/max + age–area histogram;
pole-autocorrelation; per-plate `tensionN` (via events/globals, §2.2);
consolidation pair-flip-rate counter (the cheapest proxy for whether
persistent margins actually reduce boundary churn — margin-ledger graft);
plateness (dissipation concentration into top-decile stress cells) and
dissipation positivity Σ drive·v ≥ 0 (litho grafts).

**Stage 1 — `forceKinematics`.** Torque balance replaces ω evolution; wilson
triggers/cooldowns untouched (they now fire against physical speeds).
Isolated golden spine + an *engaged* spine (#102 pattern: N=32, 100 steps,
assert ≥1 plate's speed changed >20% from its initial draw — the balance
provably acted). Module-load stability assertion on dt/`OMEGA_RELAX_YEARS`
(mantle-proxy graft). Gates: `--ab forceKinematics --ab-branch 3000e6` at
N=64 — Δ net crust production ≥ −0.5 pts/bucket, land min ≥ baseline −1 pt,
dispersal ≥ baseline −0.05, mean-T drift < 3 K (carbon proxy); full 4.5 Gyr
histories on seeds {1, 42, 1337} against §3's floor; census: median speed
2–6 cm/yr, oceanic/continental ratio 1.5–4; dt-halving trajectory check;
flipbooks eyeballed.

**Stage 2 — `emergentSuture`** (requires Stage 1). Stall trigger +
`sutureTimeout` backstop + K-weighted blend + preserved `accumulatedRadians`.
Gates: tempo stays 100–300 Myr (the flicker-regression guard); suture count
per 100 Myr within 2× of baseline; land min ≥ 10%; Δ largest-component ≥
−0.02; monopoly < 400 Myr; `sutureTimeout` events rare (each one is a
documented stall-criterion miss).

**Stage 3 — `tensionRift`** (requires Stage 1). Tension² + blanket hazard;
age gate and size ramp deleted under the flag; safety gates retained. Gates:
dispersal ≥ 0.7 every Gyr bucket on all three seeds; monopoly < 400 Myr;
plate slots consumed < 200 over 4.5 Gyr; land min ≥ 10%; supercontinent
tenure distribution inspected against 100–200 Myr. Plan B pre-registered:
soft-yield hazard shape if tension² is bimodal.

**Stage 4 — cooldown/azimuth retirement** (parameter stage under
`tensionRift`). Shrink `RIFT_SUTURE_COOLDOWN_YEARS` 120→30→0 Myr in measured
steps, replaying the historic cooldown-vs-land-min table as the regression
fixture. Gates: no seed's land min falls below its Stage 3 value −1 pt;
re-suture interval of rift halves > 100 Myr; **fraction of new-rift boundary
cells still convergent at +50 Myr ≈ 0** (the direct measurement that ridge
push does the lock's job — mantle-proxy graft).

**Stage 5 — promotion.** Flip defaults (onset 0), regenerate main goldens
with the physical rationale in the commit, bump `KERNEL_BEHAVIOR_VERSION`,
keep the legacy spine verbatim, rewrite `ARCHITECTURE.md`'s plate-kinematics
section in the same commit.

**Stage 6 (successor flag, out of scope here) — `mantleAnchors`.** The
judges' unanimous top graft: replace the per-plate blanket scalar with the
mantle-geography package from the mantle-proxy design, adopted wholesale —
seed-fixed LLSVP anchor axis (init fork), plume-generation-zone rings with a
deterministic prefix-sum CDF placement, a spatially resolved insulation
field, and a slab-graveyard suction field. This upgrades rift *placement*
(seed cells become argmax of plume/blanket forcing instead of min-hash
random — the winner's one clearly un-Earth-like residue), sustains
post-breakup dispersal, and adds plume/LIP events and hotspot tracks. Also
in the deferred pool, from the margin-ledger design: persistent segment
identity with integrals (segment-keyed arc integrator attacking freckling at
the root; rollback + back-arc opening keyed to consumed-slab age — which
doubles as the named defense if the seafloor-age triangle or the
convergence-collapse attractor bites; subduction initiation at aged passive
margins; failed-rift events; craton bulldozer immunity).

---

## 6. Determinism & purity appendix

**Every stochastic draw site under the redesign:**

| Site | Status |
|---|---|
| `fork('plates')` partition; `hash2(jitterSeed, cell, 0)` jitter | unchanged |
| `fork('plateKinematics')` initial poles/ω | **unchanged, same draw count and order** — flag-on they become ~30 Myr transients (symmetry breaking for which margins first engage slab pull); flag-off they remain the permanent kinematics. No draw-site removal ⇒ no cross-system stream perturbation. |
| `hash2(seed,'advectionDither',…)` quantum dither | unchanged |
| `hash3(riftSeed, plate, timeQuantum, 0)` rift draw (`wilson.ts:245`) | same site, same quantum; `tensionRift` changes only the acceptance threshold (a deterministic function of state) |
| fragment seed/carve/size draws (`wilson.ts:422,439,462`) | unchanged |
| azimuth phase + fragment ω draws (`wilson.ts:510,544`) | dead under `tensionRift` (fragment inherits parent ω⃗). Hash draws are stateless — skipping them perturbs nothing; flag-off they evaluate identically. |
| `plateDynamics` | **zero draws** — satisfies the A/B contract ("no gated system consumes RNG") by construction for all three flags |

**Purity & fixed count:** one ascending-index sweep (fixed FP summation
order); per-plate loops by index; the 3×3 solve is a closed-form adjugate
inverse with deterministic regularization (an exactness test feeds it a
synthetic rigid-rotation torque/drag pair and requires recovery to 1e-12 —
litho graft); the relaxation is one algebraic semi-implicit update. No
`while (!converged)` anywhere. No I/O, no globals, no input mutation; scratch
allocated per call. Transcendentals: `sqrt` only. One-step-lag idiom: forces
read the previous kinematics' `boundaryStress`, then stress is recomputed
post-update — the same lag structure as energyBalance/erosion. dt-correct:
semi-implicit relaxation and hazard exponentiation both rescale correctly
(`--step-years` halving is a Stage 1 check).

**New invariant tests:** torque closure (‖τ − c_d R²K·ω⃗\*‖/‖τ‖ < 1e-6 at a
constructed steady state); free decay (no boundary forces ⇒ |ω⃗| decays
e^(−t/τ) — drag is purely dissipative, nothing is secretly propulsive);
collision damping non-propulsive (two-continent fixture: closing speed
strictly decreasing, never sign-flipping, stalls within 40 Myr); slab
attachment accelerates (≥2× the no-slab twin); craton drag (terminal-speed
ratio ≈ the multiplier's prediction); speed envelope (every live plate ∈
[0, 20] cm/yr, median ∈ [1, 8] over the 2 Gyr N=16 run); ridge-push
separation (post-rift halves' normal velocity negative within 3 steps,
staying negative ≥ 50 Myr — the cooldown-retirement enabler); suture-blend
fixed point; the **India test** (litho graft: delete an ocean between two
converging continents mid-run, assert the mover's speed halves within 3τ);
dissipation positivity. Existing conservation invariants re-asserted under
all three flags.

---

## 7. Rejected-variant cross-check

The findings ledger is a graveyard of plausible ideas; this design was
audited against it:

| Documented failure | This proposal |
|---|---|
| Seven #60 rift-carve weightings (age stiffness, weld walls, craton rim tolls) — all made continents less coherent or broke dispersal | `tensionRift` touches only the hazard *rate*; the carve is byte-identical machinery. The ledger's transferable lesson — raggedness is manufactured at boundaries, steering rift lines only creates more boundary length through continent — is respected: we change *when*, never *where*. (`mantleAnchors` will eventually revisit *where* via plume forcing — with the #60 metrics as its explicit gates.) |
| #67 attachment gate; #89 `compactArcs` + #91 `emergentArcTaper` at default-on (measured near-waterworld) | The creation budget's latent-arc pool is untouched; no maturation gating is proposed. |
| "Raise the cooldown" (the measured land-bleed wall, `DEEP_TIME_TECTONICS_HANDOVER.md`) | The opposite direction: make the cooldown redundant via ridge push, then *measure* its removal (Stage 4) with the historic table as the regression fixture. |
| Bisection rifts / antipodal-hemisphere geometry (#57/#59 root) | Untouched; the #61 fragment carve stays. |
| Euler-pole wander ("considered and not implemented", `ARCHITECTURE.md`) | Superseded by pole *dynamics*, not pole *noise* — a deferral revisited with a mechanism, not a re-proposal of the deferred idea. |
| Near-miss to flag: `emergentSuture` superficially resembles "lengthen the timer" | It is a criterion on *velocity*, which the same mechanism drives to zero; the pre-#59 16 Myr re-suture pathology cannot recur because ridge-push-separated halves never satisfy a *convergent* stall. The timeout backstop makes the residual failure mode loud, not silent. |

---

## 8. Risks, and how this fails

1. **Advection-quantum torque noise.** Boundaries teleport 1–2.5 cells per
   event, so drive torques are noisy at event cadence. τ = 10 Myr should
   low-pass Myr-scale events; the Stage 0 pole-autocorrelation diagnostic
   measures it, and the mitigations (raise τ; EMA the torque; persist
   subduction polarity per plate-pair contact instead of re-deriving per
   cell per step — an architecture-lens graft) are cheap.
2. **Calibration coupling.** Every boundary-process rate (arc growth,
   orogeny, outgassing ref) was tuned against a uniform 1–5 cm/yr world. A
   bimodal 1–10 cm/yr world shifts trench dwell times, stress norms, and the
   CO₂ proxy together. Likeliest source of gate failures; budget one
   deliberate companion retune (one knob, per the #66/#101 discipline).
3. **The convergence-collapse attractor.** Positive feedback (fast plate →
   more subduction → more pull) could funnel every plate into one superocean
   sink, closing basins faster than tension rifting opens them — *worse*
   land starvation than today. Defenses: √age ramp (young flanks pull
   weakly), speed cap, tension rising with opposed perimeter; the named
   escalation is trench-rollback resistance (deferred-pool graft), a known
   extension, not a redesign.
4. **Stall never fires.** A colliding plate driven by a remote slab may
   never drop below 2 mm/yr at the contact. The `sutureTimeout` event makes
   this loud; the shortening-integral trigger is the pre-registered fallback.
5. **Degenerate geometry.** Near-point plates have near-singular drag
   tensors; the regularizer pins them (fixture required).
6. **Wholesale failure shape.** The deep-time equilibrium is set by the
   boundary-process layer, and force-truthful kinematics may make the
   *numbers worse while the story gets better* — e.g. persistent fast
   margins over-mature arcs into coast-hugging ribbons (the #60 lace
   resurfacing through a different door), or emergent stalling lengthens
   supercontinent tenure past the monopoly gate because tension builds
   slower than the old scheduler fired. If Stage 1 cannot pass its gates
   without retuning more than one boundary-process constant, the honest
   conclusion is that force balance must land *together with* sub-cell
   advection, and the staging should be re-cut around that pairing. The
   flags make that a findings doc, not a rewrite.

---

## 9. Alternatives considered (the losing designs)

**Mantle-Forced Plates** (2nd, realism lens): a deterministic mantle-proxy
layer — insulation field, LLSVP-anchored plume-generation zones, slab
graveyards — driving a per-plate torque balance; the most complete causal
chain for the supercontinent cycle (plume-localized breakup, sustained
dispersal). Lost because its torque engine was *less* granular than the
winner's (per-plate `slabHealth` scalar vs per-cell attribution; forces
calibrated-to-outcome rather than anchored in N/m), its 4-iteration Jacobi
collision coupling is weakest exactly at supercontinent assembly, and ~20
constants across three coupled fields must land before the low-risk
kinematics win — coupling the safe change to the speculative one. Its
mantle-geography package survives intact as Stage 6 (`mantleAnchors`), and
its stability-assertion and soft-yield patterns are grafted into Stages 1/3.

**Margin Ledger Tectonics** (2nd, architecture lens): keep prescribed
kinematics; promote boundaries to persistent segment records carrying
integrated state (shortening, extension, slip, consumed-slab age), and drive
a rich lifecycle grammar (rollback, back-arc basins, subduction initiation,
failed rifts, polarity reversal, craton stabilization) from those integrals.
Best local process realism and the least noise-amplifying design — but its
kinematic core stays random and immutable: poles never respond to anything,
speed nudges are bounded multipliers on a random draw, reorganizations don't
exist. Its own concession is the verdict: the segment ledger "is exactly the
state a future torque-balance nudge would need to read." Its
shortening-integral suture, timeout backstop, pair-flip-rate census,
rollback mechanism, and segment-keyed arc integrator are grafted (§2.4, §5).

**Emergent Lithosphere Field** (4th/3rd): per-cell velocity field relaxed
toward force balance with pseudoplastic yielding; plates as fitted (later
segmented) objects. Highest ceiling, and the GPE-gradient formulation of
ridge push is the most elegant physics in the study — but +25–40 ms/step
from Stage 1 onward at N=128 (vs 13–18 today), symmetric slab wells with no
polarity, and Tackley-grade localization is unlikely at 70 km cells with 8
fixed Jacobi sweeps; if segmentation dies, the fallback is the winner's
outcome at 5–10× the cost. Its solver-contract tests, plateness/dissipation
diagnostics, India invariant, and Cartesian-tangent dump convention are
grafted.

The study's conclusion, compressed: **the torque balance is the engine; the
mantle layer is its second act; the segment ledger is its bookkeeping
upgrade; the per-cell field is its distant ceiling.** Stage 1 is where the
walking starts.
