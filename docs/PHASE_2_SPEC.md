# PHASE_2_SPEC.md — Phase 2: Timeline scrubbing

**Objective:** the signature interaction. Run a full 4.5 Gyr history (streamed
progressively from the worker), quantize fields for storage and texture upload,
cache keyframes in IndexedDB, blend bracketing keyframes on the GPU
(`fieldsA`/`fieldsB` + a `blend` uniform — the hook was left ready in Phase 0),
and drive it all from a tactile timeline UI with the event log rendered as
markers. Done means: **scrub 4.5 Gyr at 60 fps with continents visibly
drifting; reload instant from cache; Playwright screenshots at 5 timeline
positions differ meaningfully and deterministically.**

Read `CLAUDE.md` (hard rules — determinism is sacred), `docs/ARCHITECTURE.md`
(the Phase 0/1 contract this phase extends), `PHASE_1_REPORT.md` (the main
input), and `docs/PHASE_2_STAGE0_FINDINGS.md` (the de-risking measurements —
they change the shape of this phase; see below). Work is tracked as GitHub
issues #22–#29 under the [Phase 2 milestone](https://github.com/cowboydiver/AEON/milestone/2)
(overview issue #4), plus new spike and kernel issues added in Stage 1; each
issue carries its full motivation, approach sketch, and acceptance criteria —
this spec is the milestone-level map, the issues are the ground truth for
per-task detail.

**Status: awaiting human sign-off. No Phase 2 implementation before sign-off**
(HANDOVER §4.5). Spike prototypes are part of the signed-off plan, not
pre-approved exceptions. **There is an open go/no-go decision below that must be
resolved at sign-off — it changes this phase's acceptance criteria and issue
order.**

---

## 0. The Stage 0 finding that reshapes this phase (decide at sign-off)

Stage 0 ran the existing sim to 4.5 Gyr for the Phase 1 acceptance seeds. Full
numbers and evidence: `docs/PHASE_2_STAGE0_FINDINGS.md` +
`docs/phase2-evidence/stage0/`. The headline:

- **Land budget:** seed 42 (24.4%) and seed 1 (20.4%) stay in the 10–60% band;
  seed 1337 slides to **7.5%**, below the 10% stability-invariant floor.
- **Tectonic death:** seeds 42 and 1 emit **no plate events for the last ~3 Gyr**
  and `plateId` is bit-constant — seed 42 collapses to a **single plate covering
  the whole sphere** by ~1.5 Gyr. Continents remain (bimodal, ~24% land) but
  **stop drifting for the back two-thirds of the timeline**; only erosion acts.
  Seed 1337 stays active to ~4 Gyr but with ~2 plates and sub-10% land.
- **Root cause (confirmed in `wilson.ts`):** a *specific bug*, not broad tuning.
  `riftPlate` builds the rift pole as `cross3(centroidA, centroidB)` of the two
  split halves and **skips the rift when that cross product vanishes**
  (`poleMag < 1e-9`, a PR #55 anti-NaN guard). For a whole-sphere plate every
  bisection is two antipodal hemispheres, so the guard trips *every time* — the
  supercontinent can never break up. A second, independent issue is a tuning
  imbalance (arc creation lagging collision consumption) that sinks 1337's land.

**Why this matters:** Phase 2's definition of done is "continents *visibly
drifting* across 4.5 Gyr." As the kernel stands, that fails for the back
two-thirds on 2 of 3 seeds. This is exactly the plan's "world degenerates late
→ stop and tell the human" gate; it is not silently absorbed here.

**Decision required at sign-off (pick a sequencing):**

- **(A) Fix the rift bug first, then build Phase 2 — recommended.** A small,
  localized, golden-changing change to `riftPlate` (deterministic fallback pole
  when centroids are antipodal, instead of skipping) revives deep-time drift for
  every seed. Filed as new kernel issue **#57 (kernel, goldens)**, a Phase 2
  prerequisite that lands before the timeline UI. Cheap, high-leverage, and
  makes the 4.5 Gyr scrub actually deliver its headline. Treat the separate
  1337 land-bleed tuning (**#58**) as a lower-priority follow-up unless a pristine
  full-length canary is required.
- **(B) Build Phase 2 now; scope the default timeline to the lively era.** Ship
  all the machinery on the current sim, default the history window to where
  drift happens (and/or use seed 1337 for the drift demo), defer #57/#58. Unblocks
  the interaction immediately; the back-half stasis is documented, not fixed.
- **(C) Full 4.5 Gyr as-is, accept the frozen back-half.** Cheapest, weakest
  product — the back half of the scrubber shows a static planet.

The recommendation is **(A)**: the fix is genuinely small (the diagnosis is
precise), it is the one change that makes the signature interaction land, and
everything else in this spec is unchanged by it. The rest of the document is
written to be correct under any choice; only §"Definition of done" and the
default `untilYears`/demo-seed depend on the decision.

---

## 1. Contract changes (what this phase adds to ARCHITECTURE.md)

No new **simulation** fields and **no change to simulation bytes** (except the
approved #57 rift fix under choice A, which is a deliberate golden regeneration
with the physical reason in its commit). Phase 2 is storage + renderer + web.
New contracts:

- **Field quantization codec** — new module `sim-kernel/src/codec.ts` (kernel is
  the right home: zero-dep, pure, shared by worker and renderer through the
  existing dependency direction). A versioned, self-describing container:
  `HISTORY_FORMAT_VERSION` + a field→format/range table in the header, so Phase 3
  fields flow in without a format break. Encode/decode are pure functions of the
  float field and **never touch simulation bytes**.
- **`KERNEL_BEHAVIOR_VERSION`** — a new manually-bumped integer in `sim-kernel`.
  **Any deliberate golden regeneration bumps it in the same commit** (this rule
  joins CLAUDE.md's golden-regeneration workflow). It is the cache-invalidation
  key so a kernel behavior change can never serve stale keyframes.
- **Worker history protocol** — `apps/web/src/worker/messages.ts` gains
  `RunHistoryRequest` / `HistoryKeyframe` / `HistoryProgress` / `HistoryDone`
  (quantized ArrayBuffers transferred, not copied); `simWorker.ts` steps the
  kernel and emits keyframes at the interval; supersession + cancellation by
  `requestId`.
- **IndexedDB keyframe store** — quantized keyframes + event log + manifest,
  keyed by `(seed, gridN, untilYears, keyframeIntervalYears, paramsHash,
  HISTORY_FORMAT_VERSION, KERNEL_BEHAVIOR_VERSION)`.
- **Renderer keyframe blending** — `planet-renderer` gains a second texture set
  `fieldsB` and a `blend` uniform; `mix(A,B,blend)` for continuous fields,
  hold/nearest for categorical `plateId`/`crustType`. Quantized bytes decode to
  Float16 on the CPU upload path (Spike B confirms); the bordered `(N+2)²`
  seam-fill keeps working unchanged.

Every contract addition updates `docs/ARCHITECTURE.md` in the same commit.

### Quantization table (verified against Phase 1 reality)

Ranges checked against the Stage 0 runs (seed 42 min elevation −8284 m at active
trenches, max pinned at the 9 km orogeny cap; crustAge max = 4.5 Gyr sim +
2 Gyr continental shield offset = 6.5 Gyr):

| Field       | Format | Range               | Precision  | Notes |
|-------------|--------|---------------------|------------|-------|
| elevation   | Uint16 | −11,000 … +9,500 m  | ~0.31 m    | Spike A checks banding at the 0 m land/ocean crossing |
| crustAge    | Uint16 | 0 … 7.0 Gyr         | ~107 kyr   | covers 6.5 Gyr observed + headroom |
| temperature | Uint8  | 180 … 320 K         | ~0.55 K    | placeholder climate; revisit range in Phase 3 |
| plateId     | Uint8  | 0 … 255 (exact)     | exact      | append-only table; Stage 0 saw ≤ ~23 records/4.5 Gyr — **assert < 256** (a lively post-#57 sim makes more, still tens) |
| crustType   | Uint8  | {0, 1} (exact)      | exact      | categorical; candidate to pack with plateId later, keep separate first |

**Stored field set (prune first, then quantize):** `elevation`, `plateId`,
`crustAge`, `temperature`, `crustType`. `precipitation` is analytic from
latitude (recompute at decode/render); `boundaryStress` is derivable and
visually unused; `iceFraction`/`biome` are still zero. **Categorical fields
(`plateId`, `crustType`) must round-trip exactly and never lerp** — the codec is
bit-exact for them and the GPU path holds/nearest-picks, never interpolates.

**Per-keyframe payload at N=128:** 98,304 × (2+2+1+1+1) B ≈ **688 KB**; 451
keyframes (4.5 Gyr @ 10 Myr) ≈ **0.31 GB** quantized — in line with the handover
estimate and ~5× smaller than the 1.6 GB raw.

### Memory budget targets (the named risk, #27)

- **Main-thread retained history:** hard ceiling **≤ 0.5 GB** (0.31 GB quantized
  at 10 Myr fits with headroom). If a requested history would bust it, warn and
  clamp (coarser interval or shorter `untilYears`).
- **GPU texture residency:** hard ceiling **≤ 64 MB**. Realistic footprint is
  tiny — 2–3 resident sets × 6 faces × the display fields at (N+2)² R16F/R8 is
  ~1–2 MB — so the ceiling is comfortable; it exists to catch regressions
  (e.g. accidentally residing the whole history on the GPU).
- Both numbers are named constants with the budget math in comments (#27), and
  #29's acceptance measures the real high-water marks and records them in
  `PHASE_2_REPORT.md` + `ARCHITECTURE.md`.

### Upload-format decision (Spike B resolves; default recorded here)

Keep face textures **R16F** and decode quantized bytes to Float16 on the CPU
upload path (half-float filters on every WebGPU adapter; `r16unorm` is optional,
`r8unorm` is core+filterable). Use `r8unorm` only for genuinely 8-bit fields if
Spike B shows it profitable. The `neighbors()`-based seam-border fill in
`textures.ts` extends to the decode path — **do not fork `textures.ts`.**

---

## 2. Milestones

### Milestone 0 — De-risk (this document's Stage 0, done) + kernel decision

Stage 0 measurements complete (`PHASE_2_STAGE0_FINDINGS.md`). If choice **(A)**:
**#57 — rift antipodal-pole fix (S, kernel, goldens)** lands first: give
`riftPlate` a deterministic fallback pole when `poleMag < 1e-9` (any axis ⟂ the
`seedA`/`seedB` separation opens the rift); re-run the 4.5 Gyr flipbooks and
confirm 42/1 keep rifting past 1.5 Gyr. Deliberate golden regeneration, physical
reason in the commit, `KERNEL_BEHAVIOR_VERSION` bumped. **#58 — deep-time land
balance (M, kernel, goldens)** optional follow-up for 1337 < 10%.

### Milestone 1 — Spikes (after sign-off, before integration)

Findings go in `docs/spikes/PHASE_2_SPIKES.md` (create it, format per
`PHASE_1_SPIKES.md`).

- **Spike A — Quantization fidelity (S, spike, infra). ✅ RESOLVED (folded into
  #22).** Round-tripped a real seed-42 keyframe (N=128, 2.5 Gyr) through the
  shipped codec: **max elevation error 0.156 m = exactly half a Uint16 step, and
  0 of 98,304 cells migrated across the 0 m land/ocean datum.** Original vs
  round-tripped PNGs were visually identical (no banding at the coastline). The
  plain linear Uint16-over-full-range mapping is visually lossless; **the
  piecewise-near-0 fallback is not needed.** Locked by fidelity + coastline-
  integrity tests and byte-level goldens in `codec.test.ts` (no separate
  `PHASE_2_SPIKES.md` entry needed for A; Spike B still pending).
- **Spike B — Blend-path frame rate (M, spike, renderer).** Minimal harness
  (dev-only route/flag in `apps/web`): two texture sets uploaded, `blend`
  animated, set-swap every second; measure fps + upload stalls **on the actual
  Xvfb e2e path**, not just a desktop browser. Answers: (a) dual-sample + lerp
  holds 60 fps at N=128 across six faces; (b) cost of a set-swap (the
  scrub-crossing-keyframe cost); (c) whether quantized uploads need staging.

### Milestone 2 — Storage + streaming (issues #22, #23, #24)

- **#22 Field quantization codec (M, kernel, goldens for new codec goldens
  only).** `codec.ts`; the table above; versioned self-describing container;
  bit-exact categorical round-trip. New golden tests over the **quantized bytes**
  for seeds {1, 42, 1337}; **sim goldens byte-identical before/after.**
- **#23 Worker progressive full-history streaming (M, ui, infra).** History
  protocol; keyframes carry `timeYears`, `landFraction`, quantized payload, and
  events since the last keyframe; `HistoryProgress`/`HistoryDone`; supersession +
  cheap between-step cancellation; iterate `FIELD_NAMES`/codec-table generically.
  Rename/extend `usePlanetWorker.ts` to a history hook with unit coverage for
  message ordering and supersession.
- **#24 IndexedDB keyframe cache (M, ui, infra).** Persist quantized keyframes +
  events + manifest under the full key incl. both version integers; manifest hit
  → hydrate without a worker run; miss → run #23 and write through as keyframes
  arrive (resumable prefix); LRU eviction + `QuotaExceededError` handling
  (evict-oldest, retry once); either version mismatch → miss.

### Milestone 3 — GPU blending + timeline (issues #25, #26)

- **#25 GPU keyframe blending: fieldsB + blend uniform (L, renderer).** Second
  texture set + `blend`; `mix` for continuous fields, hold/nearest for
  categorical; ping-pong residency (re-upload only the set that changed on a
  boundary crossing, swap A/B roles), prefetch next set in scrub direction;
  decode-to-Float16 on upload; seam-border fill blended with the same uniform so
  no cracks; vertex displacement uses blended elevation so continents *morph*,
  not pop.
- **#26 Timeline UI: scrubber with event markers (M, ui).** `Timeline.tsx` +
  state through `App.tsx`/`PlanetScene.tsx`: scrubber over 0…`untilYears`
  driving the blend; play/pause with variable speed; event markers with hover
  labels from the log (~18 events/2 Gyr, render every marker, no clustering);
  progressive availability while #23 streams (unreached time visually distinct,
  playhead clamped to the streamed prefix, progress indicator). **Time mapping
  starts linear** (a single pure function so log-warping is a trivial swap —
  taste call, ask at the demo). Scrub is tactile: no debounce on the `blend`
  uniform, only on texture-set swaps (already boundary-crossing-only).

### Milestone 4 — Memory + acceptance (issues #27, #28, #29)

- **#27 Memory budget: measure and enforce (S, infra).** Measure worker heap
  high-water, main-thread retained size, IndexedDB footprint, GPU residency on a
  real 4.5 Gyr history; write numbers into `PHASE_2_REPORT.md` + `ARCHITECTURE.md`;
  derive and enforce defaults (keyframe interval, stored-field set, resident
  count) as named constants with budget math; warn/clamp path when a history
  would bust the budget.
- **#28 Adaptive keyframe density (stretch — skip by default).** Only if #27's
  numbers show fixed 10 Myr either wastes memory in quiet eons or under-samples
  the front-loaded first ~30 Myr when scrubbed. **Skip without guilt** if fixed
  intervals hit the done-criteria; record the decision in the report.
- **#29 Phase 2 acceptance + `PHASE_2_REPORT.md` (M, ui, infra).** Under the Xvfb
  e2e harness: (1) drive the timeline to 5 positions across the history,
  screenshot each; pairwise meaningfully different (pixel-diff threshold) and
  deterministic across two runs; (2) scrub fps ≥ ~60 at N=128 (rAF timing),
  recorded; (3) same-context reload hydrates from IndexedDB with the timeline
  interactive < 1 s and no worker restart; (4) continents visibly drift across
  the 5 screenshots — **look at them.** Ends with the report: built, deviations,
  surprises, measured numbers, Phase 3 re-planning input (sea level will want
  land fraction as a first-class quantity).

---

## 3. Ordering and dependency graph

```
Stage 0 (measure) ── done ──▶ SIGN-OFF (resolve §0 decision A/B/C)
  choice A: #57 rift fix (kernel, goldens) ─┐  #58 land balance (optional)
  Spike A (quant fidelity) ─▶ #22           │
  Spike B (blend fps)      ─▶ #25           │
  #22 ─▶ {#23, #24, #25, #27}               │
  #23 ─▶ #26 ;  #25 ─▶ #26                  │
  #24 needs #22, #23                        │
  #27 refines after #25/#26 land            │
  #28 gated on #27 (default: skip)          │
  {#23, #24, #25, #26, #27} ─▶ #29          │
```

Suggested build order: **[#57] → #22 → #23 → #25 → #24 → #26 → #27 → #28
decision → #29.** (#24 after #25 so the cache stores what the blender consumes;
swap if streaming lands first — both only depend on #22.)

## 4. Determinism & goldens policy for this phase

- **Storage quantization must not change sim goldens.** The codec is a pure
  function of the float field; #22 adds *new* goldens over quantized bytes and
  proves sim goldens byte-identical before/after.
- The **only** deliberate sim-golden regeneration Phase 2 permits is the
  approved #57 rift fix (choice A) and the optional #58 tuning — each its own
  commit with the physical reason and a `KERNEL_BEHAVIOR_VERSION` bump. Nothing
  in #22–#29 touches sim bytes.
- Codec/history determinism: same seed + params + versions ⇒ bit-identical
  quantized history everywhere. `codec.ts` obeys kernel purity (`"types": []`,
  no `Math.random`/`Date.now`/`performance.now`, no key-order iteration).
- **Do not "optimize away" dead plate-table slots** — plateId stability across
  all of history is the contract scrubbing stands on (declined finding, PR #55).
- **Do not bump `three` (0.184.0) or `@playwright/test` (1.56.1).**

## 5. E2e budget note (decide here, don't discover in CI)

A fresh 4.5 Gyr history is ~1 min on a fast box but ~10 min on a mid-range
laptop. The determinism/screenshot acceptance (#29) uses a **reduced
`untilYears`** run for the pixel-diff + reload checks (fast, deterministic),
plus **one full-length manual acceptance** for the "visibly drifting across
4.5 Gyr" eyeball. IndexedDB in Playwright profiles is ephemeral per run, so the
reload test reloads **within one browser context**, never a relaunch.

## 6. Out of scope for Phase 2 (do not build yet)

Real climate/hydrology/ice/sea-level (Phase 3); biosphere (Phase 4); renderer
polish — scattering, clouds, specular ocean, night side, moon/rings (Phase 5);
surface exploration (Phase 6). Adaptive keyframe density (#28) is out **unless
#27's data demands it.** Log-warped time mapping is out for now (linear ships;
revisit at the demo). The herringbone kernel fix is **out** (see §7). Broad
Wilson-cycle retuning beyond the specific #57 rift fix is out unless the human
chooses a wider deep-time pass.

## 7. Decisions folded into this spec (flag at sign-off if you disagree)

1. **§0 sequencing (A/B/C)** — the one blocking decision. Recommendation: **A**
   (fix the rift bug first; it's small and it's what makes the phase's headline
   real).
2. **Stored field set is pruned to 5** (elevation, plateId, crustAge,
   temperature, crustType); precipitation recomputed analytically; boundaryStress
   dropped. Revisit only when a view needs a dropped field.
3. **Quantization formats per the table** — Uint16 elevation/crustAge, Uint8
   temperature/plateId/crustType; Spike A may promote elevation to a piecewise
   mapping near 0 m if it bands.
4. **Textures stay R16F, decode-to-Float16 on upload** — `r8unorm` only where
   Spike B shows a win.
5. **Categorical fields never lerp** — bit-exact codec + GPU hold/nearest.
6. **Time mapping is linear** for Phase 2; kept as one pure function for a cheap
   later swap.
7. **Herringbone deferred** — visible on the equirectangular dump but localized;
   golden-changing with tuning risk, and Phase 2's value doesn't hinge on it.
   Revisit only if prominent on the 3D globe. (Note: the deep-time *speckle*
   artifact is entangled with #57/#58 and may resolve alongside them.)
8. **Cache invalidation via two version integers** — `HISTORY_FORMAT_VERSION`
   (codec) and `KERNEL_BEHAVIOR_VERSION` (kernel, bumped on any golden regen).

## 8. Definition of done (mirrors overview issue #4; depends on §0)

- Scrub the full history at ≥ ~60 fps at N=128 with **continents visibly
  drifting** — under choice A this holds across the whole 4.5 Gyr; under B/C the
  criterion is scoped to the lively window and the limitation is documented.
- Reload within one browser context hydrates from IndexedDB with the timeline
  interactive < 1 s, no worker restart.
- Playwright screenshots at 5 positions differ meaningfully pairwise and are
  deterministic across two runs; continents drift across them — inspected by eye.
- Memory within budget (≤ 0.5 GB retained, ≤ 64 MB GPU), measured and recorded.
- Sim goldens unchanged except the approved #57/#58 regenerations; new codec
  goldens green; lint + typecheck clean; kernel suite still < 30 s.
- `ARCHITECTURE.md` describes the codec, versions, history protocol, cache, and
  blend path; `PHASE_2_REPORT.md` written; Phase 3 re-planned from its findings.
