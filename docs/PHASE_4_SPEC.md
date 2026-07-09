# PHASE_4_SPEC.md — Phase 4: Biosphere & planetary story

**Objective:** life becomes a *system with feedback*, and the event log becomes a
narrated history. Oceanic abiogenesis seeds marine photosynthesizers whose output
oxygenates the atmosphere over deep time (the **Great Oxidation** as an *emergent*
event, not a scripted one); rising O₂ opens the land to vegetation; vegetation
darkens the surface (albedo) and accelerates silicate weathering (the carbon
thermostat), measurably altering late-history climate. The discrete-event log
(#17) grows from bare plate markers into a narrated planetary timeline —
"Abiogenesis", "Great Oxidation", "First forests", snowball onset/recovery —
surfaced on the scrubber. Done means: **two different seeds tell visibly
different life stories, and disabling the biosphere measurably changes
late-history climate** (proving the coupling is real).

Read `CLAUDE.md` (hard rules — determinism is sacred; kernel purity; fields are
typed arrays), `docs/ARCHITECTURE.md` (the Phase 0–3 contract this phase
extends), and `PHASE_3_REPORT.md` — the main input, whose **"Input for Phase 4
re-planning"** section is folded in below. Work is tracked as GitHub issues
#37–#41 under the
[Phase 4 milestone](https://github.com/cowboydiver/AEON/milestone/4) (overview
issue #6); each issue carries its full motivation, approach sketch, and
acceptance criteria — this spec is the milestone-level map, the issues are the
ground truth for per-task detail.

**Status: SIGNED OFF (2026-07-09). Implementation proceeds in the §2 milestone
order, starting with Milestone 0** (HANDOVER §4.5). The §7 folded decisions are
accepted as written. Milestone 0 changes no kernel bytes; the first golden regen
is in #37.

---

## 0. The shape Phase 4 inherits — and the design tension

Three things from Phase 3 set the terms for this one:

- **The three coupling seams are already where Phase 4 plugs in.** Per
  `PHASE_3_REPORT.md` §"Input for Phase 4 re-planning", the biosphere modifies
  three named hooks that today read *no* life field because none exists yet:
  1. **Albedo** — `energyBalance` (#30) computes planetary albedo from
     ice/land/ocean only. Phase 4 adds a **vegetation-albedo** term (forests are
     darker than bare rock/desert).
  2. **Weathering** — `carbon` (#34) scales silicate weathering by temperature,
     precipitation, and ice-free exposed continental area. Phase 4 adds **biotic
     weathering enhancement** (roots/organic acids accelerate drawdown). This is
     the *primary* lever behind the "disable biosphere → climate changes"
     done-criterion.
  3. **Appearance** — `biome` (#35) is a climate-only Whittaker classification
     driving the from-orbit colour. Phase 4 leaves that classification intact and
     adds a **vegetation greening overlay** plus an **O₂-driven sky/atmosphere
     tint** at render.

- **The fast/slow discipline is established and must be reused.** Phase 3 split
  every climate quantity into *fast* quasi-static diagnostics recomputed each
  step (temperature, winds, precipitation, biome) and *slow* integrated
  reservoirs with memory (CO₂, ice, sea level), with feedbacks closed by a
  **one-step explicit lag** — this step's `energyBalance` reads the previous
  step's ice and CO₂. Phase 4's life quantities slot into the same two classes
  (§1) and close their feedbacks through the same lag. No implicit joint solve.

- **Two Phase 3 debts land here, by necessity.** (a) The Phase 3 report states
  #34 "emits `snowballOnset`/`snowballRecovery` events for Phase 4 narration" —
  **these event kinds do not exist in `events.ts`** (`EVENT_KINDS` currently holds
  only `plateRift`/`plateSuture`/`plateConsumed`) and `carbon` emits nothing.
  (b) Phase 2's #26 shipped the scrubber **without** event markers; the web app
  renders no events today, and the worker `blend` payload carries only
  `timeYears`/`landFraction`, not the event log. The narration milestone (#40)
  pays both debts: it adds the biosphere + climate event kinds (including the
  promised snowball pair, wired into `carbon`) and builds the timeline-annotation
  UI and the worker event channel from the ground up.

**The design tension that reshapes the phase — emergence without a scripted
clock.** The done-criteria demand that oxygenation and land colonization be
*emergent* (different per seed, in the right physical order) yet *reliable* (they
actually happen on default parameters within a 4.5 Gyr history, and stay bounded).
A pure stochastic model risks "life never oxygenates" or "oxygenates instantly";
a scripted timeline violates the whole point. The resolution (§2/§7): **a
gated-stochastic onset** (abiogenesis is a seeded Bernoulli trial per step,
conditional on a liquid-ocean temperature window) feeding **deterministic
reservoir dynamics** (O₂ accumulates only as fast as productivity outpaces
oxidative sinks — an anoxic latency then an S-curve), tuned in Milestone 0 so the
S-curve reliably completes but its *timing and shape vary with the seed's climate
and tectonic history*.

---

## 1. Contract changes (what this phase adds to ARCHITECTURE.md)

Every addition below updates `docs/ARCHITECTURE.md` **in the same commit** as the
code (hard rule). Phase 4 deliberately regenerates sim goldens (life bytes join
the history) — each regeneration bumps `KERNEL_BEHAVIOR_VERSION` (currently **14**)
with the physical reason in the commit; the stored-field-set growth bumps
`HISTORY_FORMAT_VERSION` (currently **2**) once.

### New per-cell fields (appended last — codec wire-id constraint)

The codec's on-wire `fieldId` is `FIELD_NAMES.indexOf(name)`, so **new fields
must be appended after `windV` in `fields.ts`**, never inserted earlier. Two
genuinely new fields:

| Field        | Unit | Kind                    | Notes |
|--------------|------|-------------------------|-------|
| `marineLife` | 1    | fast diagnostic (gated) | Marine photosynthetic productivity, 0–1, over ocean cells. Zero everywhere until abiogenesis; then a deterministic function of local conditions (liquid ocean, temperature window, insolation, a shelf/upwelling nutrient proxy). Carries no memory — the O₂ *reservoir* holds the history. Drives the O₂ source term and a subtle render tint. #37. |
| `vegetation` | 1    | slow reservoir          | Land plant cover, 0–1. A slow reservoir with memory: a colonization front that establishes only after O₂ crosses the ozone/land-habitability threshold, spreads over climate-habitable land, and grows/dies back with climate. Feeds the albedo (#30) and weathering (#34) hooks with a one-step lag, and greens the land at render. #39. |

`marineLife` is stored (not just an in-kernel intermediate) so the "life story"
is directly visible in `--dump marineLife` and the ocean tint; `vegetation` is
stored because the renderer greens the land by it and two systems read it back.
Both are Uint8 (§codec). **Field-budget note** (from the Phase 3 report): these
are the first stored fields added since `windU`/`windV`, which cost two Uint8
fields per keyframe *purely* for Phase 5 cloud advection and are unused at render
today. If the Phase 4 field set pressures the ~0.5 GB history budget (checked in
M0 against #27's `planHistory`), **winds are the first candidate to drop back to
recompute-at-render** (Phase 3 spec §7.3's alternative), freeing the two slots.

### New globals (`Globals` grows)

| Global            | Unit | Notes |
|-------------------|------|-------|
| `oxygen`          | PAL  | Atmospheric O₂ as a fraction of the present atmospheric level; the slow biosphere reservoir. Integrated each step from net photosynthetic O₂ flux (productivity × organic-burial fraction) minus oxidative sinks (reduced volcanic gases, oxidative crustal weathering). Seeded near-zero (anoxic). The **Great Oxidation** is the emergent crossing of an oxidation threshold. #37/#38. |
| `abiogenesisYear` | yr   | Sim time at which life originated, or `-1` until it has. Set once by the gated-stochastic onset (seeded PRNG), which also emits the `abiogenesis` event. A read-only marker for the report/HUD/narration and the gate that switches `marineLife` on. #37. |

`oxygen` is a conserved-budget reservoir: O₂ produced must be balanced by organic
carbon buried (photosynthesis: CO₂ + H₂O → CH₂O + O₂), tying it to the carbon
cycle (§5 redox invariant). Both globals are shallow-copied into `Keyframe.globals`
(the pattern `co2`/`meanTemperatureK`/`seaLevelM` already follow) so the HUD and
narration can read them without re-deriving.

### New params (add biosphere seeds + the ablation switch)

Add to `PlanetParams` (Earth-like defaults in `createPlanetParams`, each
documented per API; constants sourced in `constants.ts`):

- `biosphereEnabled` (boolean, **default `true`**) — the ablation switch. When
  `false`, the life systems are inert: `marineLife`/`vegetation` stay 0,
  `oxygen` holds its seed, `abiogenesisYear` stays `-1`, and the albedo/weathering
  hooks fall back to their Phase 3 life-free form. Goldens run with the default;
  the ablation is a *separate parameterized run* (mirroring Phase 3's faint-star
  snowball test), so it does not perturb the golden hash space.
- `abiogenesisRatePerYear` — the per-year onset hazard for the gated Bernoulli
  trial (converted to a per-step probability via `dt`), so onset timing is
  seed-dependent but reliably occurs within deep time.
- `initialOxygenPAL` — the anoxic starting O₂ (default ≈ 0).
- Reservoir-shape constants (organic burial fraction, oxidative-sink strength,
  vegetation growth/spread/dieback rates, biotic-weathering enhancement factor,
  land-habitability O₂/ozone threshold) live in `constants.ts` with source
  comments; M0 fixes their starting values.

### New event kinds (`EVENT_KINDS` grows; the missing snowball pair lands here)

Extend `EVENT_KINDS` (single source of truth, numeric-payload-only, appended in
simulation order per the `events.ts` purity rule):

| Kind              | Emitted by | Meaning |
|-------------------|------------|---------|
| `abiogenesis`     | marineLife/oxygen block | Life originates (sets `abiogenesisYear`). |
| `greatOxidation`  | oxygen (#38) | `oxygen` first crosses the oxidation threshold. |
| `firstForests`    | vegetation (#39) | Land vegetation first establishes at scale (colonization). |
| `snowballOnset`   | carbon (#34) | **Debt from Phase 3** — the report promised these; wire them into the existing snowball detector (`meanTemperatureK`/ice thresholds). |
| `snowballRecovery`| carbon (#34) | Deglaciation after a snowball, as the CO₂ thermostat recovers. |

Discrete impacts / mass extinctions are **not** simulated (no impactor system
exists); they are out of scope as physical events (§6). Narration draws only on
events the sim actually produces (tectonic + climate + biosphere).

### Systems: the pipeline gains a biosphere block

The Phase 3 pipeline is
`tectonics → wilson → erosion → energyBalance → winds → moisture → ice → seaLevel → carbon → biome`.
Phase 4 inserts three systems after `carbon` (so life reads this step's fully
solved climate and land mask) and before `biome` (which stays terminal and
climate-only):

```
… → carbon → marineLife → oxygen → vegetation → biome
```

- `marineLife` — gated-stochastic abiogenesis onset (once, via `ctx.rng`); then
  the per-cell marine productivity diagnostic. *Fast.*
- `oxygen` — integrate the O₂ reservoir from productivity × burial − sinks; emit
  `greatOxidation` on threshold crossing. *Slow (dt).*
- `vegetation` — the slow land-cover reservoir: colonization gated on `oxygen`,
  spread/growth/dieback against this step's temperature/precipitation. *Slow (dt).*

Each is a pure `System` (`(state, dt, ctx) => state`), no buffer pooling inside a
system (hard rule #2), no `Math.random`/`Date.now`/`performance.now`, no key-order
iteration. The abiogenesis Bernoulli draw uses `ctx.rng` in a fixed order.

**Feedback closes through the one-step lag, exactly as Phase 3.** Next step's
`energyBalance` reads the previous step's `vegetation` (albedo darkening), and
`carbon` reads the previous step's `vegetation` (biotic weathering) — both slow
reservoirs feeding back with a one-step lag, so the whole pass stays a single
non-iterative forward solve.

**Init handling mirrors the slow reservoirs.** Like `ice`/`seaLevel`/`carbon`,
the biosphere systems are **not run at init**: `oxygen` starts at
`initialOxygenPAL`, `vegetation` at 0, `abiogenesisYear` at `-1`, `marineLife`
at 0 (abiogenesis has not fired). So every pre-existing field stays byte-identical
to the pre-Phase-4 kernel at t=0, and life advances only from step 1.

### Codec + cache invalidation

Adding `marineLife` and `vegetation` to `STORED_FIELDS` is a stored-field-set
change → **bump `HISTORY_FORMAT_VERSION` 2 → 3** (an IndexedDB cache key; old
histories miss and re-simulate). The container is self-describing (the range table
travels in the header), so the bump is purely cache-busting. New codec goldens
over the quantized bytes for seeds {1, 42, 1337}.

#### Quantization table additions (ranges to verify in Milestone 0)

| Field        | Format | Range          | Precision | Notes |
|--------------|--------|----------------|-----------|-------|
| `marineLife` | Uint8  | 0 … 1 (linear) | ~1/255    | continuous productivity 0–1. |
| `vegetation` | Uint8  | 0 … 1 (linear) | ~1/255    | continuous cover 0–1. |

`oxygen` and `abiogenesisYear` are **globals**, not per-cell fields — they ride in
`Keyframe.globals` (untouched by the codec, as `co2` already does), so they add no
per-keyframe byte cost.

### Renderer (modest — full polish is Phase 5)

Phase 4's renderer work is the **composition→appearance coupling**, not the
Phase 5 scattering/cloud/ocean polish:

- **Vegetation greening** over the land: `vegetation` modulates the `biome`-driven
  land colour so an early planet reads barren rock/tan regardless of climate biome,
  and greens as life colonizes. Categorical `biome` stays nearest-picked (never
  lerped, per the Phase 2/3 rule); `vegetation` is a continuous multiplier over it.
- **O₂-driven sky/atmosphere tint**: a background/atmosphere colour keyed to the
  `oxygen` global (anoxic hazy → oxygenated blue). Minimal — the scattering rim,
  cloud layer, and specular ocean remain Phase 5.

Validated by the existing `pnpm -F web e2e` Xvfb screenshot path (WebGPU under
Vulkan-on-SwiftShader; SwiftShader is not the fps oracle — see `PHASE0_REPORT.md`).

### Web app / worker (narration channel — #40)

- **Worker protocol**: extend the streamed payload so the main thread receives the
  event log (today `blend` carries only `timeYears`/`landFraction`; events live in
  the keyframe but never cross the worker boundary). Events are numeric-payload,
  trivially structured-cloneable.
- **Timeline UI**: render event markers on the scrubber (absent since Phase 2) and
  an annotation label/panel that names the current epoch's events ("Great
  Oxidation", "First forests", "Supercontinent assembled", snowball onset/recovery).

---

## 2. Milestones

### Milestone 0 — De-risk the biosphere loop (before integration)

Mirror the Phase 2 Stage-0 / Phase 3 M0 discipline: **measure before wiring the
biosphere into the kernel.** A throwaway prototype (a script under `sim-cli` or
`spikes/`, using the real `grid.ts`/`rng.ts`/fields and real seed-42 late-history
climate — no parallel math) that answers, on the golden seeds:

1. **Does oxygenation emerge as a Great-Oxidation-like S-curve?** Drive the O₂
   reservoir from a plausible productivity/burial/sink model over 4.5 Gyr and
   confirm a long anoxic latency then a rise to an oxygenated plateau —
   *reliably completing on default params* yet with *seed-dependent timing/shape*.
   Not instant, not never.
2. **Is the coupled biosphere–carbon–climate loop stable?** Confirm biotic
   weathering enhancement does **not** drive a spurious permanent snowball on
   default params, and that O₂ stays bounded (no runaway). Record the relaxation
   behaviour under the existing one-step lag.
3. **Two seeds differ, and the ablation bites.** Confirm two seeds produce visibly
   different life timelines (abiogenesis year, oxidation year, greened land
   fraction), and that `biosphereEnabled=false` yields a **measurable** late-history
   climate delta (CO₂/temperature) versus the default. Find the parameter window.

Also re-check the Phase 3 report's caution that **CO₂ outgassing ties to the noisy
rift/arc event log**: if the biosphere's weathering–outgassing balance wants a
steadier source term, evaluate the smooth tectonic-activity proxy Phase 3 held in
reserve (§7.8) here.

Output: a go-ahead (or a model change) plus starting constants for #37/#38/#39.
No kernel bytes change in M0. Per the Phase 3 precedent, prefer **pinning the M0
answers as standing invariant tests** over a throwaway `docs/spikes/` write-up —
the measurements become the acceptance suite and stay green forever.

### Milestone 1 — Ocean life and oxygenation (#37)

**#37 Ocean life: abiogenesis → photosynthesis → oxygenation (L, kernel,
goldens).** The `marineLife` + `oxygen` systems. Gated-stochastic abiogenesis
(seeded, conditional on a liquid-ocean temperature window) sets `abiogenesisYear`
and emits `abiogenesis`. Marine productivity fills `marineLife` (fast diagnostic
of temperature/insolation/shelf-nutrient proxy). The O₂ reservoir integrates
productivity × organic-burial − oxidative sinks; the **Great Oxidation emerges**
as `oxygen` crossing the oxidation threshold, emitting `greatOxidation` — not a
scripted date. Core invariant: the **redox/O₂ budget closes** (O₂ accumulated ties
to organic carbon buried; §5). Deliberate golden regen + `KERNEL_BEHAVIOR_VERSION`
bump; `HISTORY_FORMAT_VERSION` 2 → 3 when `marineLife` joins the stored set.

### Milestone 2 — Atmosphere composition drives appearance (#38)

**#38 Atmosphere composition → appearance (M, renderer + small kernel).** The
`oxygen` global drives the sky/atmosphere tint (anoxic → oxygenated) and gates the
ozone/land-habitability threshold that #39 reads. This is the renderer coupling
(O₂ → visible colour shift), plus wiring `oxygen` into the HUD/keyframe globals if
not already carried by #37. Validated by the Xvfb e2e screenshots showing the
tint shift across the timeline. Full scattering rim stays Phase 5.

### Milestone 3 — Land colonization and vegetation feedback (#39)

**#39 Land colonization: vegetation feedback (L, kernel, goldens).** The
`vegetation` slow reservoir: colonization gated on `oxygen` past the ozone
threshold, spreading over climate-habitable land (temperature/precipitation
window), growing and dying back with climate, emitting `firstForests` at
establishment. Vegetation then **closes two feedbacks** through the one-step lag:
lowers land albedo in `energyBalance` (#30) and enhances silicate weathering in
`carbon` (#34). Done-criterion driver: **disabling the biosphere measurably
changes late-history climate** — the ablation run (#41) leans on this. Deliberate
golden regen + `KERNEL_BEHAVIOR_VERSION` bump; `HISTORY_FORMAT_VERSION` 2 → 3 when
`vegetation` joins the stored set (land it with #37's bump if the two ship close,
else bump once and note it).

### Milestone 4 — Narrated planetary history (#40)

**#40 Narrated history: timeline annotations (M, kernel + ui + infra).** Extend
`EVENT_KINDS` with the biosphere events (#37/#39) and the **Phase 3 snowball
debt** — add `snowballOnset`/`snowballRecovery` and wire them into `carbon`'s
existing snowball detector. Stream the event log across the worker boundary
(new/extended message; today only `timeYears`/`landFraction` cross). Build the
timeline-annotation UI: event markers on the scrubber (absent since Phase 2) and
an epoch label/panel. This milestone is UI + protocol + a small kernel/event
change, **not** a golden regen on its own — except the snowball events, which
append to the log and therefore touch history bytes (own commit, `KERNEL_BEHAVIOR_VERSION`
bump, reason recorded).

### Milestone 5 — Acceptance (#41)

**#41 Phase 4 acceptance + `PHASE_4_REPORT.md` (M, kernel + infra).** Standing
invariants (redox budget closes; carbon conservation still holds with organic
burial; multi-Gyr stability with `oxygen`/`vegetation` bounded and no runaway).
The two headline done-criteria as tests: **two seeds tell visibly different life
stories** (different abiogenesis/oxidation timing and greened-land extent, in
dumps + events + render) and **`biosphereEnabled=false` measurably changes
late-history climate** (a two-run diff beyond tolerance). The Great Oxidation
reproduced as an *emergent* event. Under the Xvfb e2e harness, screenshots show
the greening land + O₂ sky tint + timeline annotations. Ends with the report:
built, deviations, surprises, measured numbers, and Phase 5 re-planning input.

---

## 3. Ordering, the per-step pipeline, and the lag

```
Milestone 0 (measure) ──▶ SIGN-OFF (resolve §7 decisions)
  #37 ocean life + oxygenation (marineLife, oxygen) ─┐
  #37 ─▶ #38 atmosphere → appearance (O₂ tint, ozone gate)
  #37 ─▶ #39 land colonization (vegetation) ──(albedo #30, weathering #34)──▶ back into climate
  #37, #39 ─▶ #40 narration (events + timeline UI; + snowball-event debt in #34)
  {#37…#40} ─▶ #41 acceptance
```

Suggested build order: **M0 → #37 → #38 → #39 → #40 → #41.** #37 ships the
reservoir and the emergent Great Oxidation; #38 makes O₂ visible; #39 closes the
climate feedbacks (the ablation lever); #40 narrates; #41 accepts.

**The per-step forward pass** extends Phase 3's tail (fast diagnostics recomputed;
slow reservoirs integrated with `dt`; feedbacks read at the *top* of the next
step):

1–9. (Phase 3) `tectonics → wilson → erosion → energyBalance → winds → moisture →
   ice → seaLevel → carbon`.
10. `marineLife` — abiogenesis onset (once) + marine productivity diagnostic. *Fast.*
11. `oxygen` — integrate O₂ reservoir; emit `greatOxidation`. *Slow (dt).*
12. `vegetation` — colonization/spread/dieback reservoir; emit `firstForests`. *Slow (dt).*
13. `biome` — (unchanged) Whittaker(T, precip) → `biome`. *Fast.*

Because `energyBalance` (albedo) and `carbon` (weathering) read `vegetation` at
step *N* as its step *N−1* value, the whole block stays a single non-iterative
forward pass — deterministic and cheap.

## 4. Determinism & goldens policy for this phase

- **Every biosphere system is a pure function** of `(state, dt, ctx)`. The
  abiogenesis Bernoulli trial draws from `ctx.rng` in a fixed order; reservoir
  integration runs a fixed, deterministic schedule with a fixed cell traversal —
  never `Math.random`/`Date.now`, never key-order iteration. Same seed + params ⇒
  bit-identical history on every machine.
- **Deliberate golden regeneration is expected and gated.** #37, #39 (and the #40
  snowball events) change sim bytes; each is its own commit with the physical
  reason and a `KERNEL_BEHAVIOR_VERSION` bump (never regenerate to silence a test
  you don't understand). `HISTORY_FORMAT_VERSION` bumps once when the stored field
  set grows (§1).
- **Slow reservoirs must be dt-correct.** `oxygen` and `vegetation` integration
  uses `dt` explicitly so a change in `stepYears` rescales rates, not
  outcomes-per-step; the golden seeds pin the default `stepYears`, and a
  coarser-step invariant run checks trajectories stay in-band (not bit-identical —
  documented, as Phase 3 did for ice/CO₂).
- **`biosphereEnabled` defaults true**; goldens are the default-param history. The
  ablation run is a separate parameterized test, not a golden.
- **Do not bump `three` (0.184.0) or `@playwright/test` (1.56.1).**

## 5. The named risk: life feedbacks destabilizing climate (or failing to be real)

Phase 4's headline risk is two-sided — the biosphere loop could **destabilize**
the Phase 3 climate (biotic weathering drawing CO₂ into a spurious permanent
snowball; O₂ runaway) **or fail to be a real coupling** (oxygenation that never
happens, or a biosphere whose removal changes nothing — a dead done-criterion).
Mitigations, all testable:

- **Invariant — redox/O₂ budget closes:** accumulated atmospheric O₂ ties to
  organic carbon buried minus oxidative sinks, within float tolerance, for seeds
  {1, 42, 1337}. A directional test: raise productivity ⇒ O₂ plateau rises.
- **Invariant — carbon conservation holds with the new organic burial term:** the
  Phase 3 carbon budget still closes once biotic weathering and organic burial are
  added (no CO₂ created or destroyed off-book).
- **Long-run stability:** a multi-Gyr coarse-grid run stays finite (no NaN/∞) with
  `oxygen`, `vegetation`, and the Phase 3 climate quantities inside physical bounds
  and *not* oscillating with growing amplitude. Extends the #20/#36 invariant
  suites with biosphere bounds.
- **The coupling is provably real:** the ablation test (`biosphereEnabled=false`)
  produces a late-history climate delta **beyond a stated tolerance** — the
  done-criterion, asserted as a test, not just reported.
- **Emergence is reliable, not accidental:** one test confirms the Great Oxidation
  occurs on default params within the 4.5 Gyr span on all golden seeds; another
  confirms its *timing differs* across seeds (emergent, not scripted). Rate-limit
  the slow reservoirs (cap per-step O₂/vegetation change) and, if M0 shows
  stiffness at 1 Myr, sub-step internally — documented in `ARCHITECTURE.md`.

## 6. Out of scope for Phase 4 (do not build yet)

- **Detailed ecology** — no organisms, species, food webs, or extinction dynamics.
  The biosphere is aggregate marine productivity + land vegetation cover, not a
  population ecology. Mass extinctions are not simulated.
- **Scripted impacts / bolides** — no impactor system exists; impacts are not
  simulated as physical events, and narration draws only on tectonic/climate/
  biosphere events the sim produces. (A minimal deterministic bolide-event
  generator for narration flavour is a possible Phase 5 stretch, not Phase 4.)
- **Ozone as a transported radiative species** — ozone is a threshold function of
  `oxygen` gating UV/land habitability, not a separate transported field.
- **Full nutrient/phosphorus cycle** — marine productivity uses a simplified
  shelf/upwelling nutrient proxy, not a closed nutrient cycle.
- **Seasonal / diurnal cycle** — still deferred (Phase 3 §7.2). `obliquityDeg` is
  wired for a future two-season split; Phase 4 stays annual-mean. A real ceiling
  for Phase 6 surface detail, but additive when it comes, not a rewrite.
- **Renderer polish** — scattering rim, cloud layer, specular ocean, night side,
  moon/rings (Phase 5). Phase 4's renderer work is only vegetation greening + the
  O₂ sky tint + timeline annotations.

## 7. Decisions folded into this spec (flag at sign-off if you disagree)

1. **Fast/slow split reused (§0)** — `marineLife` is a fast productivity
   diagnostic; `oxygen` and `vegetation` are slow integrated reservoirs; feedbacks
   close via the Phase 3 one-step explicit lag, no joint fixed-point solve.
   Recommended; it is what makes oxygenation hysteresis and colonization fronts
   real while keeping the step cheap and deterministic.
2. **Gated-stochastic abiogenesis, deterministic reservoirs** — onset is a seeded
   Bernoulli trial conditional on a liquid-ocean temperature window (so *when*
   life starts is seed/climate-dependent); everything after is deterministic
   reservoir dynamics. This gives emergence without a scripted clock. Recommended.
3. **O₂ is a redox-budgeted global, not a per-cell field** — atmospheric O₂ is
   well-mixed; storing it as a global (like `co2`) costs no per-keyframe bytes and
   makes the redox invariant clean. Recommend.
4. **`biosphereEnabled` param drives the ablation** — a default-true boolean;
   goldens use the default, the "disable biosphere" done-criterion is a separate
   parameterized run. Mirrors Phase 3's faint-star snowball test. Recommend.
5. **Vegetation greening is a render overlay; `biome` stays climate-only** — the
   Whittaker classification is unchanged; `vegetation` multiplies the land colour
   at render (barren early planet → green after colonization). Keeps the biome
   goldens stable and the "life story" visually legible. Flag if you'd rather fold
   life into the biome classification itself.
6. **Two new stored Uint8 fields (`marineLife`, `vegetation`); `HISTORY_FORMAT_VERSION`
   2 → 3** — M0 confirms the ~0.5 GB history budget still holds; if not, drop
   `windU`/`windV` to recompute-at-render (Phase 3 §7.3) to reclaim the slots.
7. **Milestone 0 de-risking runs before any kernel bytes change** — oxygenation
   S-curve, loop stability, and two-seeds-differ/ablation measured first,
   mirroring the Phase 2/3 discipline that paid off; M0 answers pinned as standing
   invariants.
8. **Pay the two Phase 3 debts in #40** — add the promised-but-missing
   `snowballOnset`/`snowballRecovery` event kinds and wire them into `carbon`, and
   build the timeline event-marker UI + worker event channel that Phase 2's #26
   left unbuilt. Both are prerequisites for a *narrated* history, so they belong
   in this phase, not deferred again.

## 8. Definition of done (mirrors overview issue #6)

- **Two seeds tell visibly different life stories** — different abiogenesis and
  Great-Oxidation timing and different greened-land extent, evident in `--dump
  {marineLife,vegetation}` PNGs, the event log, and the live render (inspected by
  eye, not just a passing metric).
- **Disabling the biosphere measurably changes late-history climate** — a
  `biosphereEnabled=false` run diverges from the default in CO₂/temperature beyond
  a stated tolerance, asserted as a test (proving the coupling is real).
- **The Great Oxidation is emergent** — reproduced as a `greatOxidation` event
  whose timing arises from productivity vs. sinks, not a scripted date; it occurs
  on default params within 4.5 Gyr on all golden seeds and its timing varies by
  seed.
- Standing invariants green on seeds {1, 42, 1337}: redox/O₂ budget closes; carbon
  conservation holds with organic burial; multi-Gyr stability with `oxygen`/
  `vegetation` in physical bounds and no growing oscillation.
- The planet **tells its story from orbit**: barren early land greening after
  colonization, an O₂-driven sky tint shift, and a **narrated timeline** —
  event markers and epoch annotations on the scrubber; `pnpm -F web e2e`
  screenshots updated and inspected.
- Sim goldens regenerated deliberately (each with a physical reason +
  `KERNEL_BEHAVIOR_VERSION` bump from 14); new codec goldens green;
  `HISTORY_FORMAT_VERSION` bumped once 2 → 3; lint + typecheck clean; **kernel
  suite still < 30 s.**
- `ARCHITECTURE.md` describes the new fields, globals, params, event kinds, the
  biosphere pipeline block, and the redox budget; `PHASE_4_REPORT.md` written;
  Phase 5 re-planned from its findings.
