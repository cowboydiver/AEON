# Phase 3 Report — Climate, hydrology, biomes

Phase 3 is complete against `docs/PHASE_3_SPEC.md` and overview issue #5: the
Phase 0/1 climate placeholder is gone, and the planet now solves a real, if
coarse, climate every step — a zonal energy balance, rotation-set wind bands,
moisture transport with **emergent** orographic rain shadows, a dynamic ice /
sea-level pair, a carbonate–silicate CO₂ thermostat with a reachable-and-
recoverable snowball, and a Whittaker biome classification that colours the
globe from orbit. The #36 acceptance evidence is the Vitest invariant suites
(per-system plus the phase-level `test/invariants/phase3.test.ts`), the committed
field dumps and render frames under `docs/phase3-evidence/`, and the measured
numbers below.

## What was built

In dependency order (spec §3), one PR per issue, each a deliberate golden
regeneration with a `KERNEL_BEHAVIOR_VERSION` bump and the physical reason in the
commit — the whole climate block sits behind the one-step explicit lag (this
step's energy balance reads the previous step's ice and CO₂), so it is a single
non-iterative forward pass:

- **#30 Zonal energy-balance model** (the hub). A Budyko–Sellers zonal EBM:
  annual-mean latitudinal insolation from `starLuminosity` + `obliquityDeg`,
  planetary albedo from ice/land/ocean, greenhouse from `co2`, meridional heat
  transport as a fixed-schedule deterministic diffusion. It solves a latitude
  temperature profile, then per-cell `temperature = zonal(lat) − lapse·elevation
  + bounded continentality`. Ice-albedo (#33) and CO₂-greenhouse (#34) went in as
  hooks reading constants so #30 was mergeable alone. Core invariant: **global
  net TOA flux closes to machine precision** at equilibrium (linear OLR +
  conservative transport ⇒ exact, not merely toleranced).
- **#31 Wind bands from rotation.** A deterministic band model (not a fluid
  solve): `dayLengthHours` sets the Hadley/Ferrel/polar band count/width,
  modulated by the #30 temperature gradient, emitting the stored `windU`/`windV`
  prevailing field that moisture consumes and Phase 5 cloud advection will want.
- **#32 Moisture transport + orographic precipitation.** Evaporate over ocean
  (rate from temperature), advect the moisture column along the winds by a
  conservative upwind donor scheme, precipitate on ascent and by saturation.
  **Rain shadows emerge from the transport** — windward wet, lee dry — rather
  than being painted. Fills `precipitation`, which erosion (#19) now reads for
  free. Invariant: **Σ precipitation = Σ evaporation** (water mass conserved
  across the solve).
- **#33 Sea level and ice sheets.** `iceFraction` from a slow mass-balance
  reservoir (accumulate where cold + wet, ablate where warm) with cross-step
  memory; grounded ice locks water out of the ocean; `seaLevelM` solved each step
  by inverting the hypsometric curve against `oceanInventoryM − iceVolume`;
  `landFraction` recomputed emergent from it. Ice albedo closes back into #30 —
  the feedback that makes snowballs possible. A review follow-up caps grounded
  ice at the water inventory so a fully glaciated world runs the ocean dry
  without breaking conservation.
- **#34 Carbonate–silicate CO₂ feedback.** The deep-time thermostat: silicate
  weathering (scales with temperature, precipitation, ice-free exposed
  continental area) draws `co2` down; volcanic outgassing (tied to tectonic
  activity — ridge length / rift+arc events) restores it, with a floor > 0 so a
  quiet world still degasses. Slow negative feedback with the snowball failure
  mode **as a feature**, rate-limited per Myr to keep the explicit lag stable.
  Emits `snowballOnset`/`snowballRecovery` events for Phase 4 narration.
- **#35 Whittaker biomes + colour ramp.** `biome` from a Whittaker lookup over
  (temperature, precipitation) — ocean, tundra, taiga, grassland, temperate
  forest, desert, savanna, tropical forest — driving the renderer's from-orbit
  colour instead of raw hypsometry. Categorical: bit-exact through the codec,
  nearest-picked (never lerped) at render, `iceFraction` whitening over it.
- **#36 acceptance + this report** (below).

Contract changes landed with the code (spec §1): `windU`/`windV` added to
`fields.ts` (appended last, codec wire-id constraint); `precipitation`,
`iceFraction`, `biome` joined the **stored** set and `temperature` became
physical; `Globals` grew `seaLevelM`, `co2`, `meanTemperatureK` (and the
conserved `waterInventoryM`); `PlanetParams` activated `starLuminosity` /
`dayLengthHours` / `obliquityDeg` and added `initialCo2Ppm` / `oceanInventoryM`.
The stored-field-set growth bumped **`HISTORY_FORMAT_VERSION` 1 → 2** (an
IndexedDB cache key) once; `ARCHITECTURE.md` carries the new fields, globals,
params, the climate pipeline, and the timescale/lag model.

## #36 acceptance measurements

All kernel numbers are the deterministic golden seeds {1, 42, 1337}; the
integrated multi-Gyr runs below are seed 42 at N=24, step 5 Myr, to 4.5 Gyr
unless noted (the standing-invariant Vitest runs at N=16 to keep the suite < 30 s
— same behavior, coarser grid).

- **Energy balance closes — standing.** The global net top-of-atmosphere flux is
  **≤ 1.8 × 10⁻¹¹ W/m²** at *every* checkpoint of the whole 4.5 Gyr run, on all
  three seeds — machine zero, not a tolerance. This is the §5 named-risk
  tripwire: a diverging feedback could not hold the balance closed over deep
  time. (`energyBalance.test.ts` closes it at a checkpoint; `phase3.test.ts`
  makes it a standing invariant; a planted +5 K band perturbation opens it by
  ~0.1 W/m², so the check is not vacuous.)
- **Water mass conserved — standing.** The total-water inventory global is
  **bit-constant** (drift exactly 0) across the run, and the independently
  reconstructed partition (liquid ocean at the solved sea level + grounded ice)
  recovers it to **< 0.12 %** worst (≈ 2.3 m on a ~1860 m inventory, seed 1;
  ≤ 0.8 m on seeds 42/1337). The residual is the documented one-step grounded-ice
  classification lag; it **peaks early and decays**, so it is a bounded slack,
  not a growing leak.
- **Ice caps breathe.** Mean ice cover oscillates over the timeline — it advances
  *and* retreats repeatedly, driven by the Wilson-cycle CO₂ thermostat and the
  ice-albedo feedback, never a monotonic drift and never a frozen planet. Over
  the full 4.5 Gyr (N=24, 5 Myr step, sampled every 50 Myr):

  | seed | mean-cover min | max | span | direction reversals | Σ advance | Σ retreat |
  |------|-----|-----|------|------|------|------|
  | 1    | 0.030 | 0.095 | 0.065 | 34 | 0.283 | 0.253 |
  | 42   | 0.017 | 0.084 | 0.067 | 38 | 0.277 | 0.249 |
  | 1337 | 0.019 | 0.104 | 0.085 | 42 | 0.296 | 0.265 |

  (The standing `phase3.test.ts` runs a shorter N=16 / 2 Gyr span sampled every
  40 Myr — spans 0.09–0.11, 15–25 reversals, Σ retreat 0.11–0.14 — so the check
  stays inside the suite budget.) Visible in `--dump iceFraction`: seed 42, N=96,
  ~ice-free at 200 Myr (mean 0.021) → advanced by 3.25 Gyr (0.045) → retreated by
  4 Gyr (0.039), `docs/phase3-evidence/iceFraction-*.png`, and in the live scrub.
- **Rain shadows visible — dumps and render.** Emergent from the transport, not
  painted: on a controlled ridge world the windward half of the range collects
  **> 5×** the lee half's rain and reversing the wind flips the shadow; on the
  real golden planets a mid-latitude ring shows a longitudinal precipitation
  coefficient of variation **> 0.5** (a latitude proxy would be flat).
  `moisture.test.ts` is the metric; `docs/phase3-evidence/{elevation,
  precipitation}-*.png` are the field eyeball (windward-wet coasts, dry tan
  interiors behind the belts). In the **live render** the shadow reads *through*
  the biome ramp — wet windward margins are green-vegetated, dry lees are tan
  desert/grassland — and `phase3-acceptance.spec.ts` asserts both the vegetated
  and arid families are present on the globe (the render is biome-driven, #35, so
  precipitation shows as biomes, not a raw channel).
- **A snowball is reachable and recovers.** Under a faint star (~0.55 L⊙; the
  measured tipping point is ~0.63–0.65 L⊙, in the faint-young-Sun neighbourhood)
  the ice-albedo runaway drives near-global ice (mean cover > 0.6, mean T
  < 240 K); with weathering ice-sealed off, outgassing accumulates **CO₂ > 5000
  ppm**; restoring luminosity deglaciates (ice < 0.15, mean T > 273 K) and the
  thermostat draws CO₂ back down. A control confirms the recovery **rides the
  accumulated CO₂**, not the luminosity alone. (`invariants/carbon.test.ts`.)
- **Default parameters do NOT snowball.** Over the full 4.5 Gyr, mean ice cover
  never exceeds ~0.10 and mean surface temperature holds an Earth-like band
  (final 281.7 / 284.1 / 282.9 K for seeds 1/42/1337; per-cell temperature stays
  in **196–305 K**, inside the widened codec window [180, 330] K). CO₂ stays
  regulated far inside its clamps (≈ **40–700 ppm** across the run) and never
  pegs a floor or ceiling; land fraction, emergent from the dynamic sea level,
  holds **0.27–0.47**.
- **The planet looks alive from orbit.** `phase3-acceptance.spec.ts` (headed
  Chromium under Xvfb, Vulkan-on-SwiftShader, N=128, seed 42, 500 Myr span) drives
  five timeline positions that differ pairwise, and the end-of-span frame reads
  **31 % lit, 19 % chromatic, 4.9 % ice, 3 biome hue families** (ocean blue,
  forest green, desert tan) — biome-driven, not hypsometric, with bold polar ice
  caps that are absent at formation and tan rain-shadow interiors behind the
  ranges. The committed frames
  (`docs/phase3-evidence/render/render-{000,250,500}Myr.png`) are the eyeball;
  the numbers are the tripwires (SwiftShader software raster — see
  `PHASE0_REPORT.md` / Spike B — is not the fps oracle).
- **Suite health.** The kernel suite is **253 tests in ~24 s** (was 243; #36 adds
  10, the acceptance file itself ~3.6 s) — inside the < 30 s budget. Lint and
  typecheck clean across all packages.

## Deviations from the spec

- **`precipitation` stayed Uint8**, not promoted to Uint16. The §1 table flagged
  it as the range "most likely to move" after Milestone 0; u8 over 0…8000
  kg/m²/yr (~31 kg/m²/yr precision) proved viz-lossless for the desert/coastline
  boundary bands, so the promotion was not spent. `temperature`'s max was widened
  320 → 330 K as planned (hot-CO₂ headroom); the 180 K floor already covers the
  ~196 K snowball minimum.
- **Milestone 0 did not leave a standalone `docs/spikes/PHASE_3_SPIKES.md`.** The
  three de-risking questions (do rain shadows emerge, is the explicit-lag feedback
  stable, is a snowball reachable) were answered inside the per-system PRs and are
  now pinned permanently as invariant tests rather than as a throwaway spike
  write-up — the harder discipline, since the answers stay green forever instead
  of aging out. The Phase 2 Stage-0 pattern was "measure before wiring"; here the
  measurements became the acceptance suite.
- **Temperature is zonal + per-cell corrections** (§7.4), not a full 2-D field,
  as chosen — longitudinal structure enters through elevation, precipitation, and
  albedo. No seasonal/diurnal cycle (§7.2): ice advances/retreats from deep-time
  climate-state change, which the breathing numbers above confirm is sufficient
  for the done-criteria.

## Surprises / findings

- **The explicit one-step lag never threatened to oscillate.** The headline §5
  risk — the coupled ice/CO₂/temperature feedback ringing or diverging — did not
  materialize on default parameters: energy closes to machine zero every step and
  CO₂ settles to a stable attractor that *forgets its initial value* (a 66×
  spread in starting CO₂ converges to the same tail climate within 3 K). The 1 Myr
  step really is the natural relaxation time for the feedback, exactly as the spec
  bet. The rate-limit on the slow reservoirs was the cheap insurance that made it
  so; no internal sub-stepping was needed.
- **The snowball hysteresis is genuinely load-bearing on CO₂, not luminosity.**
  The control that strips the accumulated CO₂ at restore-time and watches the same
  state stay frozen is the most convincing single result in the phase: it shows
  the recovery is the carbonate–silicate thermostat doing real work, not the
  forcing being removed. This is the mechanism issue #5 wanted made *reachable and
  recoverable*, and it is.
- **The water invariant has two honest halves.** The conserved quantity (the
  inventory global) is exactly constant; the *partition* into ocean and ice
  carries a sub-metre-to-~2 m slack from classifying grounded ice against the
  previous step's sea level. Reporting both — the exact conservation and the
  bounded, decaying lag — is more truthful than a single toleranced number, and it
  is why `phase3.test.ts` asserts them separately.
- **Coherent Phase 2 terrain paid off exactly as predicted.** Rain shadows read
  cleanly because the mountain belts are bold and continuous; had the Stage-0
  speckle survived, every freckle would have become a biome island and the
  precipitation maps would be noise. The climate hung on the terrain without
  recalibration.

## Input for Phase 4 re-planning

- **The biosphere plugs into three named hooks.** Albedo (#30) uses land/ice/
  ocean only, weathering (#34) uses ice-free exposed continental area only, and
  the biome palette (#35) is climate-only — Phase 4 vegetation is meant to modify
  all three (vegetation-albedo, biotic weathering enhancement, biome→ecoregion).
  The coupling seams are already where the spec left them; none of the three
  currently reads a `vegetation`/`life` field because none exists yet.
- **Winds and CO₂ outgassing are the noisiest inputs.** Outgassing ties to the
  discrete rift/arc event log; it works, but a Phase 4 biosphere that wants a
  smooth weathering–outgassing balance may prefer the smooth tectonic-activity
  proxy the spec held in reserve (§7.8). Worth revisiting if the O₂/carbon
  bookkeeping needs a steadier CO₂ source term.
- **No seasonal cycle is a real ceiling for surface exploration.** Deep-time ice
  breathing works from annual-mean insolation, but Phase 4/5 surface detail
  (snow lines, seasonal biomes) will want at least a two-season insolation split;
  `obliquityDeg` is already wired for it, so it is an additive change, not a
  rewrite.
- **Precipitation's u8 headroom is spent-but-fine; winds are stored and unused at
  render yet.** `windU`/`windV` are in the codec and keyframes purely for Phase 5
  cloud advection — they cost two Uint8 fields per keyframe today for zero render
  benefit. If the Phase 4 field set pressures the 0.5 GB history budget, winds are
  the first candidate to drop back to recompute-at-render (§7.3's alternative).
- **The from-orbit palette is a placeholder for the per-epoch design pass.** The
  eight Whittaker classes colour the globe correctly but were not art-directed;
  Phase 5's per-epoch design deliverables should revisit the ramp (and the ice /
  shoreline blend) against real reference, as the spec anticipated.
- **Only three of the climate signals reach the globe.** The render shows
  `biome`, `iceFraction`, and the sea-level shoreline; `temperature`,
  `precipitation`, and the winds drive those but have no on-globe view (only the
  CLI `--dump`). That the land colour is genuinely biome-driven — not an earthlike
  hypsometric ramp — is now pinned by a kernel discriminator (`phase3.test.ts`:
  land at the same elevation carries several biome classes; a height-only ramp
  gives one). A Phase 5 field-overlay debug view (`?view=temperature|
  precipitation|wind`) would make the working systems directly visible in the
  app — filed as #83 (draft in `docs/phase5-backlog/on-globe-climate-debug-views.md`).
