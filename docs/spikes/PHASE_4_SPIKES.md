# PHASE_4_SPIKES.md — Milestone 0 biosphere de-risking

**Verdict: GO.** All three M0 questions resolve affirmatively. The gated-stochastic
onset + deterministic-reservoir model in `docs/PHASE_4_SPEC.md` §0/§7 produces an
emergent, seed-dependent, reliably-completing Great Oxidation; the coupled
biosphere↔carbon↔climate loop is stable over 4.5 Gyr; two seeds tell visibly
different life stories; and disabling the biosphere measurably changes
late-history climate. Recommended starting constants for #37/#39 are in the table
below, with the calibration cautions the production tuning must respect.

## Method

Throwaway prototype: `packages/sim-cli/src/spikes/phase4_biosphere.ts` (changes no
kernel bytes, produces no goldens). It composes a **custom step pipeline** from the
kernel's exported systems — the stock Phase 3 climate block with `carbon` replaced
by a biotic-weathering variant (`weatheringPotential` gains a per-land-cell
`1 + BIOTIC·vegetation` multiplier; identical to stock when vegetation = 0) — and
runs an external biosphere reservoir model alongside it:

- **Abiogenesis:** a per-step Bernoulli trial from a **dedicated forked RNG**
  (`createRng(seed).fork('phase4-bio')`), gated on the liquid-ocean habitable
  fraction. The dedicated stream is the key to a clean ablation: the physical sim
  RNG is untouched by the biosphere, so biosphere-OFF is bit-for-bit the stock
  kernel and the ON−OFF climate delta flows **only** through enhanced weathering,
  not through perturbed tectonics.
- **Marine productivity → O₂:** per-ocean-cell productivity `light · tempWindow ·
  nutrient` (nutrient = shallow-shelf proxy), gated on abiogenesis; the mean drives
  a global O₂ reservoir `dO₂ = source·Π·burial − volcanic reductant sink −
  oxidative sink·O₂`, with a **reductant buffer** that must be oxidized before O₂
  can rise (the physical origin of the anoxic latency between abiogenesis and the
  GOE).
- **Land vegetation:** a slow per-land-cell reservoir gated on O₂ past the ozone
  threshold, grown/died against this step's temperature/precipitation/ice, feeding
  the biotic weathering multiplier with a one-step lag.

Runs: seeds {1, 42, 1337}, both ON and OFF, at N=16/2 Gyr (fast, 13 s) and
N=32/4.5 Gyr (110 s). Deep-time numbers below are the N=32/4.5 Gyr run.

## Q1 — Does oxygenation emerge as a Great-Oxidation-like S-curve? **YES**

O₂ stays at the anoxic floor (~0) from t=0 through abiogenesis, then — once the
reductant buffer is oxidized — rises over a few hundred Myr to a bounded plateau
and holds. It is not instant (a latency separates abiogenesis from the GOE) and
not never (it completes on every seed within deep time). The GOE year is
**emergent**, not scripted: it varies with each seed's abiogenesis timing and
tectonic-activity trajectory.

| seed | abiogenesis | Great Oxidation | first forests | O₂ plateau (PAL) |
|------|-------------|-----------------|---------------|------------------|
| 1    | 0.22 Gyr    | 0.37 Gyr        | 0.39 Gyr      | ~2.1–2.3 |
| 42   | 0.08 Gyr    | 0.22 Gyr        | 0.24 Gyr      | ~2.0–2.3 |
| 1337 | 0.01 Gyr    | 0.15 Gyr        | 0.17 Gyr      | ~2.0–2.35 |

GOE spread across seeds: **220 Myr**. O₂ trajectory (seed 1, PAL): 0.5G=0.74 →
1.0G=1.57 → 1.5G=1.96 → plateau ~1.8–2.3 thereafter — the S-curve shape the
done-criterion wants.

## Q2 — Is the coupled loop stable? **YES**

Over the full 4.5 Gyr on all three seeds: no non-finite values; O₂ bounded well
under the runaway tripwire (max ~2.35 PAL, never approaching the 5 PAL guard);
and **no spurious permanent snowball** (max ice cover ~10–11%, final ice a few %).
This holds even though biotic weathering draws CO₂ down hard — late-history CO₂
reaches 50–113 ppm ON vs 163–278 ppm OFF — because the carbonate–silicate
thermostat and the CO₂ floor absorb the extra sink without tipping the
ice-albedo runaway. The explicit one-step lag that carried the Phase 3 feedback
carries the biosphere feedback unchanged; no sub-stepping was needed.

## Q3 — Two seeds differ, and the ablation bites? **YES**

**Different stories:** GOE timing spans 0.15–0.37 Gyr, final greened land fraction
18–31%, and the *magnitude* of the climate coupling is itself seed-dependent (ΔT
below). **Ablation (ON − OFF, late-1-Gyr mean):**

| seed | CO₂ on | CO₂ off | ΔCO₂ (ppm) | T on | T off | ΔT |
|------|--------|---------|------------|------|-------|-----|
| 1    | 50     | 163     | −113       | 279.8 K | 283.5 K | −3.7 K |
| 42   | 83     | 253     | −170       | 280.1 K | 284.5 K | −4.4 K |
| 1337 | 113    | 278     | −165       | 281.6 K | 282.7 K | −1.1 K |

Disabling the biosphere raises late-history CO₂ by 113–170 ppm and warms the
planet 1.1–4.4 K — the coupling is real and measurable. Note the ΔT is *not* a
fixed offset: it depends on where each seed's thermostat already sits, which is
exactly the "stories differ" signal, not noise. (The near-uniform ΔT at N=16 was
the thermostat shifting the CO₂ fixed point by a similar *ratio*, Δln CO₂ ≈ −1.1,
across seeds; deep time and the higher grid spread it out.)

## Recommended starting constants for #37/#39

Rates are per Myr (= per-step increment at the default 1 Myr step). These are the
prototype values that produced the results above; treat them as a starting point
for the production `constants.ts`, subject to the cautions below.

| Constant | Value | Role |
|----------|-------|------|
| `INITIAL_OXYGEN_PAL` | 1e-6 | anoxic start |
| `ABIOGENESIS_RATE_PER_YR` | 8e-9 | onset hazard (× ocean-habitable fraction) → onset within ~10²-Myr scale |
| `OXY_SOURCE_PAL_PER_MYR` | 0.1 | gross photosynthetic O₂ per unit productivity |
| `BURIAL_FRACTION` | 0.3 | organic-C burial fraction (net O₂ surviving respiration) |
| `OXY_VOLC_SINK_PAL_PER_MYR` | 0.002 | volcanic/mantle reductant draw at reference activity |
| `OXY_OX_SINK_PER_MYR` | 0.004 | oxidative-weathering O₂ removal ∝ O₂ (sets the plateau) |
| `REDUCTANT_BUFFER_PAL` | 1.0 | reduced crust to oxidize before O₂ rises (the GOE delay) |
| `GOE_THRESHOLD_PAL` | 0.01 | Great Oxidation event trigger |
| `OZONE_THRESHOLD_PAL` | 0.1 | land habitable → colonization can begin |
| `VEG_GROWTH_PER_MYR` / `VEG_DIEBACK_PER_MYR` | 0.03 / 0.01 | vegetation reservoir rates |
| `VEG_PRECIP_REF_KG_PER_M2_YR` | 500 | vegetation moisture reference |
| `BIOTIC_WEATHER_FACTOR` | 3 | full-cover weathering enhancement (the ablation lever) |

## Calibration cautions for production tuning

1. **The O₂ plateau is grid-sensitive and runs ~2× modern.** Mean marine
   productivity Π (hence the plateau) shifts with grid resolution — ~1.5 PAL at
   N=16, ~2.2 PAL at N=32 — because Π is a cell-count mean over ocean cells. The
   plateau ≈ `net_source / OXY_OX_SINK`; raise `OXY_OX_SINK_PER_MYR` (~0.008) at
   the production grid to centre it near 1 PAL if an Earth-like absolute O₂ level
   matters. It does **not** affect the qualitative S-curve or the events, which
   key off relative thresholds.
2. **Biotic weathering has a snowball margin to respect.** At `BIOTIC_WEATHER_FACTOR`
   = 3, ON-mode CO₂ bottoms at ~50 ppm without snowballing, but that is not a
   wide margin. A larger factor risks tipping a *spurious* permanent snowball
   (the Phase 3 named risk, now with a biological forcing) — #39 should add a
   standing invariant that default parameters do not snowball, exactly as Phase 3
   did, and treat the factor as the knob most likely to break it.
3. **Fold the missing snowball events in here (spec §1).** `carbon` still emits no
   `snowballOnset`/`snowballRecovery` despite the Phase 3 report; the biotic
   weathering path makes snowball reachability a live concern again, so wiring
   those events (spec §1 / #40) belongs with this work.
4. **Give the biosphere its own RNG substream.** The clean ablation depended on
   drawing abiogenesis from `fork('phase4-bio')`, not the shared sim stream. The
   production `marineLife` system must do the same, or biosphere-on/off runs will
   diverge through tectonics and the coupling test will measure noise.
5. **Revisit CO₂ outgassing smoothness (Phase 3 report / spec §7.8).** The
   prototype used the stock event-driven outgassing and the loop stayed stable, so
   the smooth-activity-proxy swap is **not** required for Phase 4 — but if #37's O₂
   budget wants a steadier reductant-sink term, the proxy is the fallback.

## Determinism note

The prototype is deterministic (fixed step schedule, dedicated forked RNG, no
`Math.random`/`Date.now` in the biosphere math — the one `Date.now` is wall-clock
timing in the CLI driver only). The production systems must carry O₂/abiogenesis
in `Globals` and vegetation/marineLife in `Fields` (spec §1) so the history is
bit-reproducible and codec-stored; the prototype holds them externally purely to
avoid touching `fields.ts` during M0.
