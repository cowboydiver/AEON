# PHASE_3_SPEC.md — Phase 3: Climate, hydrology, biomes

**Objective:** the planet becomes colorful and reactive. Replace the Phase 0/1
climate *placeholder* (`systems/climateProxy.ts` — latitude-band temperature and
a static latitude precipitation proxy) with real, if coarse, physics: a zonal
energy-balance model (insolation × albedo × greenhouse), wind bands derived from
rotation rate, moisture transport with orographic precipitation (**rain shadows
must _emerge_, not be painted**), dynamic sea level and ice sheets, a
carbonate–silicate CO₂ feedback (slow self-regulation with reachable snowball
states), and a Whittaker biome classification that drives the renderer's color
ramp. Done means: **rain shadows visible behind Phase 1 mountain ranges in the
PNG dumps and the live render; ice caps advance and retreat over the timeline; a
snowball episode is reachable with plausible parameters and recovers.**

Read `CLAUDE.md` (hard rules — determinism is sacred; kernel purity; fields are
typed arrays), `docs/ARCHITECTURE.md` (the Phase 0/1/2 contract this phase
extends), `PHASE_2_REPORT.md` (the main input — its "Input for Phase 3
re-planning" section is folded in below), and `docs/PHASE_2_STAGE0_FINDINGS.md`
(why deep-time terrain is now coherent enough to hang climate on). Work is
tracked as GitHub issues #30–#36 under the
[Phase 3 milestone](https://github.com/cowboydiver/AEON/milestone/3) (overview
issue #5); each issue carries its full motivation, approach sketch, and
acceptance criteria — this spec is the milestone-level map, the issues are the
ground truth for per-task detail.

**Status: awaiting human sign-off. No Phase 3 implementation before sign-off**
(HANDOVER §4.5). The Milestone 0 de-risking prototype below is part of the
signed-off plan, not a pre-approved exception. Several **design decisions are
folded into this spec (§7)** — they change the field set, the pipeline shape,
and the acceptance criteria; flag any you disagree with at sign-off.

---

## 0. The shape Phase 3 inherits — and the one problem that reshapes it

Two things from the earlier phases set the terms for this one:

- **The terrain is finally coherent.** The Phase 2 Stage-0 tectonics work
  (#59/#61/#65/#66/#67) fixed whole-sphere monopoly, the deep-time land budget,
  the immortal-mountain erosion sink, and the boundary-process speckle. Per
  `PHASE_2_REPORT.md`, coherent continents were **the prerequisite for climate**:
  every freckle would have become a biome-colored island chain, and calibration
  done against speckled terrain would have been redone. That work is landed, so
  Phase 3 climate maps hang on bold continents with real mountain belts — exactly
  what orographic rain shadows need.

- **Land fraction is still emergent, not simulated.** Sea level sits at a fixed
  0 m datum; `Globals.landFraction` is a diagnostic read off elevation. Phase 3's
  hydrology *requires* the inverse: an explicit water inventory whose partition
  between ocean and ice moves the coastline. This is the Phase 2 report's #1
  re-planning ask, and it is promoted to a first-class state variable here (§1).

**The problem that reshapes the phase — timescale separation.** The sim macro
step is `DEFAULT_STEP_YEARS = 1e6` (1 Myr); keyframes are 10 Myr apart. Climate
equilibrates in years to millennia — *far* below one step. So the climate
systems must **not** be written as dt-integrated ODEs the way tectonics is. The
phase splits every climate quantity into one of two classes, and this split is
the core design decision:

- **Fast — quasi-static equilibrium, recomputed every step, no memory:**
  temperature, winds, precipitation, biome. Each is a deterministic function of
  the *current* boundary conditions (elevation, land/ocean mask, the slow
  variables below). They do not accumulate; a step just re-solves them.
- **Slow — genuine state variables integrated across steps, dt matters:**
  atmospheric **CO₂**, **ice** mass/volume (hence `iceFraction`), and the derived
  **sea level**. These carry history; they are what make ice ages and snowball
  *hysteresis* possible. A snowball is only reachable because ice and CO₂
  remember.

**Feedback coupling is resolved by explicit lag, in one forward pass.** The
circular dependency (albedo ← ice ← temperature ← albedo; greenhouse ← CO₂ ←
weathering ← temperature) is closed by feeding this step's energy balance the
ice and CO₂ **from the end of the previous step**, then updating ice and CO₂
with this step's temperature. No implicit solve, no per-step iteration to a
joint fixed point — the 1 Myr step is the natural relaxation time for the
feedback, and the lag is physically the point. **The named risk is that this
explicit coupling oscillates or diverges** (see §5); it is mitigated by
rate-limiting the slow reservoirs and by the invariant/stability suite, and
measured before full integration in Milestone 0.

---

## 1. Contract changes (what this phase adds to ARCHITECTURE.md)

Every addition below updates `docs/ARCHITECTURE.md` **in the same commit** as the
code (hard rule). Phase 3 deliberately regenerates sim goldens (real climate
replaces placeholder bytes) — each regeneration bumps `KERNEL_BEHAVIOR_VERSION`
with the physical reason in the commit, and the codec changes bump
`HISTORY_FORMAT_VERSION` (see below).

### New per-cell fields (appended last — codec wire-id constraint)

The codec's on-wire `fieldId` is `FIELD_NAMES.indexOf(name)`, so **new fields
must be appended after `sedimentM` in `fields.ts`**, never inserted earlier.
`precipitation`, `iceFraction`, and `biome` already exist (declared zero in
Phase 0) — they are *populated*, not added. Genuinely new fields:

| Field   | Unit  | Kind        | Notes |
|---------|-------|-------------|-------|
| `windU` | m/s   | continuous  | Prevailing zonal (east–west) wind component, signed. #31. |
| `windV` | m/s   | continuous  | Prevailing meridional (north–south) wind component, signed. #31. |

Winds are stored (not just an in-kernel intermediate) because moisture transport
consumes them every step **and** Phase 5's cloud advection wants them at render
time; a debug `--dump wind` also needs them. (Decision §7.3 — recompute-at-render
is the alternative.) No `insolation`/`albedo` fields: those are diagnostics of
the energy-balance solve, recomputed on demand, never stored.

### Fields that start being simulated and stored

`precipitation` (now dynamic, from moisture transport — replaces the analytic
latitude proxy), `iceFraction` (from the ice mass balance), and `biome` (from the
Whittaker lookup) join the **stored** field set. `temperature` was already stored
as a placeholder; its values become physical.

### New globals (`Globals` grows from just `landFraction`)

| Global          | Unit | Notes |
|-----------------|------|-------|
| `seaLevelM`     | m    | Global sea-level datum, solved each step from the ocean water inventory minus ice-locked volume against the hypsometric curve. `landFraction` becomes *emergent from this* (elevation > `seaLevelM`). #33. |
| `co2`           | ppm  | Atmospheric CO₂; the slow carbonate–silicate reservoir. #34. |
| `meanTemperatureK` | K | Global area-weighted mean surface temperature — a diagnostic for the report/HUD and the snowball detector. #30. |

`landFraction` stays but is recomputed against `seaLevelM`, not the 0 m datum.
Total water inventory (ocean liquid + ice) is a **conserved** quantity, seeded at
init from an Earth-like ocean volume; the water-mass invariant (§5) checks it.

### New params (activate the Phase 0 placeholders; add reservoir seeds)

`starLuminosity`, `dayLengthHours`, and `obliquityDeg` already exist on
`PlanetParams`, explicitly reserved "for later phases" — Phase 3 **activates**
them (insolation, wind-band count, annual-mean latitudinal insolation
respectively). Add:

- `initialCo2Ppm` (default Earth-like preindustrial-ish, sourced in
  `constants.ts`) — the CO₂ reservoir's starting value.
- `oceanInventoryM` (default Earth-like, expressed as a global-equivalent water
  layer thickness) — sets sea level and, with ice, the hydrologic budget.

Both get Earth defaults in `createPlanetParams`; both are documented per API.

### Systems: `climateProxy` is removed; the pipeline gains a climate block

`systems/climateProxy.ts` is deleted (its module header already announces this).
The step pipeline (currently `tectonics → wilson → erosion → climateProxy`)
becomes:

```
tectonics → wilson → erosion → energyBalance → winds → moisture → ice → seaLevel → carbon → biome
```

Ordering rationale and the lag are in §3. Each is a pure `System`
(`(state, dt, ctx) => state`), no buffer pooling inside a system (hard rule #2),
no `Math.random`/`Date.now`/`performance.now`, no key-order iteration.

### Codec + cache invalidation

Adding `precipitation`, `iceFraction`, `biome`, `windU`, `windV` to
`STORED_FIELDS` and widening any range is a stored-field-set change → **bump
`HISTORY_FORMAT_VERSION` 1 → 2** (it is an IndexedDB cache key, so old histories
miss and re-simulate). The container is self-describing (the range table travels
in the header), so the bump is purely for cache-busting, not a format rewrite.
New codec goldens over the quantized bytes for seeds {1, 42, 1337}.

#### Quantization table additions (ranges to verify in Milestone 0)

| Field         | Format | Range              | Precision   | Notes |
|---------------|--------|--------------------|-------------|-------|
| `temperature` | Uint8  | **180 … 330 K**    | ~0.59 K     | widen max 320→330 for hot-CO₂ states; 180 floor already covers snowball (~200–210 K). Confirm bounds in M0. |
| `precipitation` | Uint8 | 0 … ~8000 kg/m²/yr | ~31 kg/m²/yr | u8 is likely viz-lossless; promote to u16 only if the coastline/desert boundary bands (mirror Spike A's test). |
| `iceFraction` | Uint8  | 0 … 1 (linear)     | ~1/255      | continuous 0–1, not categorical. |
| `biome`       | Uint8  | 0 … 255 (exact)    | exact       | **categorical — bit-exact round-trip, never lerps** (reuse the Phase 2 `plateId`/`crustType` hold/nearest path). |
| `windU`,`windV` | Uint8 | −60 … +60 m/s    | ~0.47 m/s   | signed; jet-stream-scale bound. |

### Renderer

The from-orbit color ramp switches from raw hypsometry to **biome-driven**
(#35): `planet-renderer` gains a biome→color lookup (categorical, no
interpolation across keyframes — same rule as `plateId`), consumed by
`apps/web`. `iceFraction` whitens cells over the biome color. Sea level shifts
the land/ocean shoreline in the render via `seaLevelM`. This is a modest renderer
touch validated by the existing `pnpm -F web e2e` Xvfb screenshot path; full
scattering/cloud/ocean polish stays in Phase 5.

---

## 2. Milestones

### Milestone 0 — De-risk the coupled system (before integration)

Mirror Phase 2's Stage-0 discipline: **measure before wiring six feedback
systems into the kernel.** A throwaway prototype (a script under `sim-cli` or
`spikes/`, using the real `grid.ts`/`rng.ts`/fields — no parallel math) that
answers three questions, written up in `docs/spikes/PHASE_3_SPIKES.md`:

1. **Do rain shadows emerge?** Advect moisture along a prescribed wind field over
   a real seed-42 late-history elevation; dump `precipitation`; confirm windward
   wet / lee dry across the Phase 1 mountain belts by eye and by a windward−lee
   transect metric. If they don't emerge, the transport scheme is wrong before it
   costs golden churn.
2. **Is the explicit-lag feedback stable?** Run the zonal energy balance + a
   toy ice-albedo + CO₂ reservoir forward a few Gyr at coarse N; confirm it
   settles to equilibrium (net TOA flux → 0) rather than oscillating, and record
   the relaxation behavior.
3. **Is a snowball reachable and recoverable?** Perturb insolation/CO₂ and
   confirm the ice-albedo runaway can be entered and exited (weathering shuts off
   under ice → CO₂ builds → deglaciation), and find the rough parameter window.

Output: a go-ahead (or a scheme change) plus starting constants for #30/#33/#34.
No kernel bytes change in M0.

### Milestone 1 — The climate hub (#30)

**#30 Zonal energy-balance model (L, kernel, goldens) — the hub every other
Phase 3 system couples through.** Insolation from `starLuminosity` and
`obliquityDeg` (annual-mean latitudinal profile — see §7.2, no seasonal cycle);
planetary albedo from ice/land/ocean (vegetation later, Phase 4); greenhouse a
function of `co2`; meridional heat transport as deterministic diffusion
(fixed-iteration or fixed-tolerance relaxation, deterministic sweep order). The
model solves a **zonal** (latitude) temperature profile, then per-cell
`temperature = zonal(lat) − lapse·max(0, elevation)` plus a bounded land/ocean
continentality correction (§7.4). Build with **hooks** for ice-albedo (#33) and
CO₂-greenhouse (#34) that read constant defaults until those land, so #30 is
mergeable alone. Core invariant: **global net top-of-atmosphere flux ≈ 0 at
equilibrium** (energy balance closes within tolerance). Replaces the
`climateProxy` temperature. Deliberate golden regen + `KERNEL_BEHAVIOR_VERSION`
bump.

### Milestone 2 — Winds and water (#31, #32)

- **#31 Wind bands from rotation rate (M, kernel).** Zonal wind bands
  (Hadley/Ferrel/polar analogues) whose count/width come from `dayLengthHours`
  (fast rotators → more, narrower bands; slow → single-cell) modulated by the
  #30 temperature gradient. Output is the per-cell `windU`/`windV` prevailing
  field. Deterministic function of params + temperature; **no per-step fluid
  solve.**
- **#32 Moisture transport + orographic precipitation (L, kernel, goldens).**
  Evaporate moisture over ocean (rate from temperature), advect along the #31
  wind field, precipitate on ascent (windward slopes wring out; lee dry) and by
  saturation. **Rain shadows must emerge from the transport, not be painted**
  (the M0 bar, re-checked here on the golden seeds). Fills `precipitation`,
  retiring the analytic latitude proxy that erosion (#19) reads — erosion now
  consumes real precipitation for free. Invariant: **water mass conserved across
  evaporate/transport/precipitate.**

### Milestone 3 — The slow reservoirs (#33, #34)

- **#33 Sea level and ice sheets (L, kernel, goldens).** `iceFraction` from a
  mass-balance model (accumulation where cold + wet, ablation where warm); ice
  volume locks water out of the ocean; `seaLevelM` solved each step from
  `oceanInventoryM − iceVolume` against the hypsometric curve; `landFraction`
  recomputed against it. Ice albedo feeds back into #30 (closing the loop that
  makes snowballs possible). Done-criterion: **ice caps visibly advance and
  retreat over the timeline.**
- **#34 Carbonate–silicate CO₂ feedback (L, kernel, goldens).** The deep-time
  thermostat: silicate weathering draws `co2` down (scales with temperature,
  precipitation, and exposed continental area from tectonics); volcanic
  outgassing restores it (tie to tectonic activity — ridge length / rift+arc
  events from the event log). Slow negative feedback with the snowball failure
  mode **as a feature**: reachable ice-albedo runaway that recovers as CO₂
  accumulates under ice. Done-criterion: **a snowball episode is reachable with
  plausible parameters and recovers**, plus long-run stability (no
  oscillation/divergence — §5). Emits `snowballOnset`/`snowballRecovery` events
  to the log (#17) for Phase 4 narration.

### Milestone 4 — Biomes + acceptance (#35, #36)

- **#35 Whittaker biome classification + color ramp (M, kernel + renderer,
  goldens).** Fill `biome` from a Whittaker-style lookup over (temperature,
  precipitation) — tundra/taiga/temperate forest/grassland/desert/tropical forest
  etc. Drive the renderer color ramp from biome class instead of raw hypsometry.
  Categorical: **no lerp across keyframes** (codec bit-exact, GPU hold/nearest);
  palette revisited against per-epoch design deliverables in Phase 5.
- **#36 Phase 3 acceptance + `PHASE_3_REPORT.md` (M, kernel + infra).** Standing
  invariants (energy closes, water conserved); multi-Gyr stability without
  oscillation/divergence; **rain shadows visible in PNG dumps and the live
  render**; ice caps breathing over the timeline; one parameterized
  snowball-and-recovery episode reproduced in a test. Under the Xvfb e2e harness,
  screenshots show the biome-colored, ice-capped planet. Ends with the report:
  built, deviations, surprises, measured numbers, and Phase 4 re-planning input
  (the biosphere couples into albedo #30, weathering #34, and biome color #35).

---

## 3. Ordering, the per-step pipeline, and the lag

```
Milestone 0 (measure) ──▶ SIGN-OFF (resolve §7 decisions)
  #30 energy balance (hub; ice/CO₂ hooks default-constant) ─┐
  #30 ─▶ #31 winds ─▶ #32 moisture/precip                   │
  #30 ─▶ #33 ice + sea level ──(ice albedo)──▶ back into #30 │
  #30, #32 ─▶ #34 CO₂ ──(greenhouse)──▶ back into #30        │
  #30, #32 ─▶ #35 biomes                                     │
  {#30…#35} ─▶ #36 acceptance                                │
```

Suggested build order: **M0 → #30 → #31 → #32 → #33 → #34 → #35 → #36.** #33 and
#34 both close a feedback into #30 through the previous-step lag, so #30 ships
first with those inputs stubbed at constants and they light up as they land.

**The per-step forward pass** (fast diagnostics recomputed; slow reservoirs
integrated with `dt`):

1. `energyBalance` — reads previous-step `iceFraction` (albedo) and `co2`
   (greenhouse); solves temperature. *Fast.*
2. `winds` — from `dayLengthHours` + this step's temperature gradient. *Fast.*
3. `moisture` — evaporate/advect/precipitate along winds → `precipitation`. *Fast.*
4. `ice` — mass balance from this step's temperature + precipitation → updates
   `iceFraction` and ice volume. *Slow (dt).*
5. `seaLevel` — `oceanInventoryM − iceVolume` → `seaLevelM`, `landFraction`.
   *Derived.*
6. `carbon` — weathering(T, precip, land) − outgassing(tectonics) → `co2`.
   *Slow (dt).*
7. `biome` — Whittaker(T, precip) → `biome`. *Fast.*

Because ice and CO₂ are read at step *N* as their step *N−1* values, the whole
block is a single non-iterative forward pass — deterministic and cheap.

## 4. Determinism & goldens policy for this phase

- **Every climate system is a pure function** of `(state, dt, ctx)`. Any
  iterative solver (energy-balance diffusion relaxation, moisture sweep) runs a
  **fixed, deterministic** iteration schedule with a fixed cell traversal order —
  never a `while (!converged)` whose count can drift by float, never key-order
  iteration. Same seed + params ⇒ bit-identical history on every machine.
- **Deliberate golden regeneration is expected and gated.** #30, #32, #33, #34,
  #35 each change sim bytes; each is its own commit with the physical reason and
  a `KERNEL_BEHAVIOR_VERSION` bump (never regenerate to silence a test you don't
  understand). `HISTORY_FORMAT_VERSION` bumps once when the stored field set
  grows (§1).
- **Slow reservoirs must be dt-correct.** Ice and CO₂ integration uses `dt`
  explicitly so a change in `stepYears` rescales rates, not outcomes-per-step;
  the golden seeds pin the default `stepYears`, and a coarser-step invariant run
  checks trajectories stay in-band (not bit-identical — documented).
- **Do not bump `three` (0.184.0) or `@playwright/test` (1.56.1).**

## 5. The named risk: coupled feedbacks oscillating or diverging

This is Phase 3's headline risk (issue #5). Mitigations, all testable:

- **Invariant — energy balance closes:** at equilibrium, global net TOA flux is
  ~0 within tolerance (per-latitude too, after transport). A directional test:
  raise `co2` ⇒ mean temperature rises monotonically.
- **Invariant — water mass conserved:** ocean + ice + atmospheric moisture is
  constant across evaporate/transport/precipitate/freeze/melt within float
  tolerance, for seeds {1, 42, 1337}.
- **Long-run stability:** a multi-Gyr coarse-grid run stays finite (no NaN/∞),
  with `temperature`, `co2`, `iceFraction`, and `seaLevelM` inside physical
  bounds and *not* oscillating with growing amplitude. This extends the #20
  invariant suite (which already runs to 4.5 Gyr) with climate bounds.
- **Snowball is a controlled feature, not an accident:** one parameterized test
  enters a snowball and recovers; a second confirms the *default* parameters do
  **not** spuriously snowball every run. Rate-limit the slow reservoirs (cap
  per-step ice/CO₂ change) and, if M0 shows stiffness at 1 Myr, sub-step ice/CO₂
  internally — documented in `ARCHITECTURE.md`.

## 6. Out of scope for Phase 3 (do not build yet)

- **Biosphere** (life, oxygenation, vegetation-albedo/weathering feedback) —
  Phase 4. Phase 3's albedo and weathering use land/ice/ocean only; the coupling
  hooks are left where Phase 4 plugs vegetation in.
- **Seasonal cycle / diurnal cycle** — annual-mean insolation only (§7.2);
  `dayLengthHours` sets wind-band structure, not a day/night solve.
- **Full 2-D atmospheric dynamics** — winds are a diagnostic band model, not a
  fluid solve; temperature is zonal + per-cell corrections, not a full 2-D GCM.
- **Renderer polish** — scattering rim, cloud layer, specular ocean, night side,
  moon/rings (Phase 5). Phase 3's renderer work is only the biome color ramp +
  ice whitening + shoreline at `seaLevelM`.
- **Ocean currents / lakes / river routing** — hydrology is evaporation →
  transport → precipitation → (existing) erosion diffusion; no explicit rivers.

## 7. Decisions folded into this spec (flag at sign-off if you disagree)

1. **Timescale split (§0)** — climate quantities are fast quasi-static
   diagnostics *or* slow integrated reservoirs (ice, CO₂, sea level); feedbacks
   close via a one-step explicit lag, no per-step joint fixed-point solve.
   Recommended; it is what makes snowball hysteresis real and keeps the step
   cheap and deterministic.
2. **Annual-mean insolation, no seasonal cycle** — `obliquityDeg` shapes the
   annual-mean latitudinal insolation profile; there is no summer/winter solve.
   Ice caps advance/retreat over deep time from climate-state change, not
   seasons. Simpler, deterministic, matches the zonal EBM. (Reconsider only if
   seasonal ice is judged essential — it isn't for the done-criteria.)
3. **Winds are stored fields (`windU`/`windV`)** rather than recomputed at
   render. They're consumed in-kernel every step and wanted by Phase 5 cloud
   advection; storing costs two Uint8 fields per keyframe. Alternative:
   recompute from params + temperature at render (saves storage, couples the
   renderer to kernel wind internals). Recommend storing.
4. **Temperature is zonal + per-cell corrections**, not a full 2-D field: EBM
   solves a latitude profile, then per-cell `= zonal − lapse·elevation +` a
   bounded land/ocean continentality term. Keeps #30 cheap and robust;
   longitudinal structure enters through elevation, precipitation, and albedo.
   Flag if you want fuller 2-D temperature.
5. **Sea level from a conserved water inventory** (`oceanInventoryM`), with
   `landFraction` emergent from `seaLevelM` — the Phase 2 report's first-class
   land/sea ask. Ice locks water; total water is conserved and invariant-checked.
6. **Quantization per the §1 table** — new stored fields `precipitation`,
   `iceFraction`, `biome`, `windU`, `windV`; `temperature` max widened to 330 K;
   `HISTORY_FORMAT_VERSION` 1→2. M0 confirms ranges (precip u8-vs-u16 is the one
   likely to move).
7. **Milestone 0 de-risking prototype runs before any kernel bytes change** —
   rain-shadow emergence, feedback stability, snowball reachability measured
   first, mirroring the Phase 2 Stage-0 discipline that paid off.
8. **CO₂ outgassing ties to tectonic activity** already in the sim (ridge length
   / rift+arc event rate) rather than a constant — so the thermostat responds to
   the Wilson cycle. If M0 shows the event signal too noisy, fall back to a
   smooth activity proxy (documented).

## 8. Definition of done (mirrors overview issue #5)

- **Rain shadows visible** behind the Phase 1 mountain ranges in `--dump
  precipitation` PNGs **and** in the live render — emergent from moisture
  transport, inspected by eye (not just a passing metric).
- **Ice caps advance and retreat** over the 4.5 Gyr timeline — visible in the
  scrub and in `--dump iceFraction`.
- **A snowball episode is reachable** with plausible parameters and **recovers**
  — reproduced in a parameterized test; default parameters do not spuriously
  snowball.
- Standing invariants green on seeds {1, 42, 1337}: energy balance closes, water
  mass conserved, multi-Gyr stability with climate quantities in physical bounds
  and no growing oscillation; land fraction stays in band against dynamic sea
  level.
- The planet **looks alive from orbit**: biome-driven color ramp with ice caps
  and a sea-level shoreline; `pnpm -F web e2e` screenshots updated and inspected.
- Sim goldens regenerated deliberately (each with a physical reason +
  `KERNEL_BEHAVIOR_VERSION` bump); new codec goldens green; `HISTORY_FORMAT_VERSION`
  bumped once; lint + typecheck clean; **kernel suite still < 30 s.**
- `ARCHITECTURE.md` describes the new fields, globals, params, the climate
  pipeline, and the timescale/lag model; `PHASE_3_REPORT.md` written; Phase 4
  re-planned from its findings.
