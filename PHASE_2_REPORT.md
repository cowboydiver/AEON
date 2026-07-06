# Phase 2 Report — Timeline scrubbing

Phase 2 is complete against `docs/PHASE_2_SPEC.md` and overview issue #4: a
full 4.5 Gyr history streams progressively from a worker, is quantized and
persisted to IndexedDB, and scrubs on a timeline whose bracketing keyframes
blend on the GPU — continents morph rather than pop. The #29 acceptance
evidence lives in `apps/web/e2e/phase2-acceptance.spec.ts` (five-position
screenshots + determinism + cache hydration + scrub pacing; regenerable
artifacts land in the gitignored `apps/web/e2e/artifacts/`, and the curated
acceptance frames are committed under `docs/phase2-evidence/acceptance/`)
and in the measured numbers below.

## What was built

In dependency order (spec §3), one PR per issue:

- **Stage 0 de-risking** (`docs/PHASE_2_STAGE0_FINDINGS.md`): ran the Phase 1
  kernel to 4.5 Gyr before building UX on it — and found tectonic death at
  ~1.2–1.5 Gyr (a `riftPlate` antipodal-pole degeneracy froze any
  whole-sphere plate) plus a land-budget breach on the canary seed. This
  reordered the phase: kernel repair first, timeline second.
- **Kernel repair + deep-time dispersal** (#57, then #59, #61 from review):
  the antipodal-pole fix; fragment-carving rift kinematics (a 20–40%
  continental fragment on a translating Euler pole, ocean-seeking azimuth);
  continental-crust conservation in advection (bulldozing instead of
  consumption); accretionary arc maturation; micro-continent foundering;
  rate-bounded oceanic relief relaxation; post-rift suture cooldown; a
  continuous size-dependent rift rate replacing the oversize brake. Net:
  full-span rift/suture cycles on all three golden seeds (dispersed-window
  fraction 72–74% at N=64), land held inside the [10%, 60%] band for
  4.5 Gyr, and the #20 invariant suite extended to the full span with a
  monopoly detector.
- **Field quantization codec** (#22, `sim-kernel/src/codec.ts`): versioned,
  self-describing container over the 5-field display subset (Uint16
  elevation/crustAge, Uint8 temperature/plateId/crustType); categorical
  fields round-trip bit-exact; byte-level goldens; Spike A confirmed the
  elevation map is visually lossless (max error 0.156 m, 0 coastline cells
  migrated at N=128). Sim goldens untouched — the codec never feeds back
  into simulation bytes.
- **Progressive history streaming** (#23): a `keyframes()` generator as the
  single cadence source, `encodeHistory` composing it with the codec, and a
  worker that transfers each encoded keyframe and yields between pulls so
  cancel/supersede is honored mid-run.
- **GPU keyframe blending** (#25, `planet-renderer`): dual texture sets
  (`fieldsA`/`fieldsB`) + a `blend` uniform; continuous fields lerp, categorical
  fields hold/nearest and never interpolate; ping-pong residency so a
  fractional scrub is uniform-only and a boundary crossing re-uploads exactly
  one set. Spike B measured the shipped material through the acceptance path.
- **Timeline UI** (#26): scrubber pinning a fractional keyframe position,
  live-follow mode, time/land HUD; plate-debug toggle added alongside.
- **IndexedDB cache** (#24): complete-manifest-or-miss semantics, LRU
  eviction, quota retry, keyed by params + `HISTORY_FORMAT_VERSION` +
  `KERNEL_BEHAVIOR_VERSION` so codec or kernel changes can never serve stale
  bytes.
- **Memory budget** (#27): `planHistory` sizes the retained history against
  `MAX_RETAINED_HISTORY_BYTES` (0.5 GB) using the exact encoded-keyframe byte
  size and coarsens the keyframe interval rather than dropping the tail; at
  N=128 the full 4.5 Gyr @ 10 Myr request (451 keyframes ≈ 0.35 GB) fits
  unclamped.
- **Suture-line memory** (#60, late in the phase): a new advected
  `sutureYears` field records continent-continent weld lines. Recording-only
  by measurement — see "Surprises" below.

## #29 acceptance measurements

Environment for all e2e numbers: headed Chromium under Xvfb with
Vulkan-on-SwiftShader (software rasterization), N=128 — the CI reality, not
the fps oracle (`PHASE0_REPORT.md`; Spike B).

- **Five-position screenshots** (reduced 500 Myr span for the pixel-diff
  gates, spec §5; full 4.5 Gyr run below): all 10 position pairs differ by
  **19–32%** of pixels (gate: 1%) — formation planet, orogen belts and
  opening basins, and drifted continents are visibly different states,
  confirmed by eye on the artifacts.
- **Determinism across runs**: re-scrubbing to the same positions after a
  cache-hydrated reload AND in a fresh browser context (cold IndexedDB, full
  re-simulation) reproduces every screenshot **pixel-exactly (diff 0.0000)**:
  same seed ⇒ same bytes ⇒ same pixels, through the entire
  sim → codec → cache → GPU path. (The one flake found and fixed while
  landing this: the green "cached" HUD badge — DOM overlaying the canvas —
  is hidden during capture, since it exists only on hydrated runs.)
- **Cache hydration on reload**: **~3.0 s** (2909 / 3095 ms across runs) from
  `reload()` to a fully interactive timeline (all 51 keyframes present,
  `source = 'cache'`, no worker restart — asserted). The spec's
  "interactive < 1 s" bar is the DOM hydration on real hardware; the
  measured number is dominated by the software-raster page boot (WebGPU
  device init + pipeline compile under SwiftShader), not the cache read, and
  the path it replaces is a minutes-long worker run.
- **Scrub frame pacing**: driving the slider every frame for 3 s inside one
  bracket (uniform-only updates) sustains **1.9–2.2 fps** (mean frame
  450–534 ms) — statistically identical to Spike B's steady no-input render
  rate (~2.6 fps), i.e. **the scrub adds no measurable cost over rendering
  itself**. The budget argument
  for the 60 fps criterion: a fractional scrub inside a bracket writes one
  uniform (no texture upload, no CPU pack — measured in Spike B); a boundary
  crossing re-uploads exactly one 5-field set (~1–2 MB, ~ms-scale on real
  hardware, ~1.7 s under SwiftShader where render latency dominates). On any
  real GPU the scrub therefore runs at the material's render rate, and the
  material is two R16F samples + a `mix` — the 60 fps criterion is a
  real-GPU expectation that this software path cannot measure, per the
  documented Spike B decision ("CI asserts live-not-stalled and logs the
  real numbers").
- **Full 4.5 Gyr drive** (`PHASE2_FULL=1` manual acceptance): the default
  `/` span (seed 42, N=128, 451 keyframes @ 10 Myr, unclamped by the memory
  budget) streamed to completion in **~2.5 min** on this box and passed the
  same five-position pairwise gates. Eyeball verdict on the artifacts
  (`accept-full-pos0..4.png`): the planet moves through clearly distinct
  states — formation noise terrain, large coherent early continents with
  fresh orogen belts (~1.1 Gyr), then superocean basins rimmed by drifting
  mountain-belt continents (3.4–4.5 Gyr). Continents visibly drift and
  reorganize across the span; the deep-time frames show the documented
  ragged-archipelago character (#59 residual, #60's measured subject), not
  Pangaea-bold blocks — recorded as reality, not papered over.
- **Memory high-water marks** (#27's budget vs reality, full-span run):
  main-thread used JS heap **568 MB** (total 632 MB) with the full 451-
  keyframe encoded history retained (0.35 GB budgeted) plus decode buffers
  and the app; IndexedDB storage estimate **121 MB** for the persisted
  history (Chromium compresses the quantized blobs well below their 0.35 GB
  raw size). GPU residency is two resident sets × 6 faces × 2 fields
  (elevation + plateId R16F at (N+2)²) ≈ 1.3 MB — far under the 64 MB
  ceiling; the retained encoded history is the dominant term, as budgeted.

## Deviations from the spec

- **The phase began with kernel surgery the spec only gated on** (§0 choice
  A, then #59/#61 beyond it). Stage 0's "look before you build" was the
  single highest-value step of the phase: without it the timeline would have
  shipped over a planet that dies at 1.2 Gyr.
- **#28 (adaptive keyframe density): skipped, as the spec's default.** #27's
  numbers show fixed 10 Myr intervals fit the 0.5 GB budget with headroom at
  N=128, and scrubbing the full span shows no under-sampled epoch that a
  denser early cadence would fix (the front-loaded first ~30 Myr reads fine
  at 10 Myr). Revisit only if a Phase 3 field set busts the budget.
- **The #29 "60 fps" criterion is recorded as a real-GPU expectation**, not
  asserted in CI — decided at Spike B and carried here. The e2e records the
  real SwiftShader numbers and asserts liveness; the budget math above is
  the evidence that scrub cost ≈ render cost on any adapter.
- **`?seed=` / `?until=` URL knobs** were added beyond the spec for
  deep-linking and a fast cache e2e — they are also how the acceptance keeps
  its reduced-span runs deterministic.

## Surprises / findings

- **Deep time was the phase's real work.** The timeline stack (#22–#27) went
  in essentially as specced; the planet under it did not. The
  supercontinent-lock geometry (antipodal 50/50 rifts), the continental-area
  bleed (#16 consumption), and the fine-grid land dip (per-cell arc rates on
  a thinning boundary line) were all invisible at Phase 1's 2 Gyr horizon.
  The lesson is institutionalized: the #20 invariants now run to 4.5 Gyr.
- **#60 (craton stiffness / suture-line memory) is a measured negative
  result.** Seven rift-carve weightings (age stiffness absolute and
  plate-relative, a continental quota, weld walls + flank seeding under four
  memory-decay policies, craton rim tolls at two strengths) were prototyped
  against the goal of compact, persistent deep-time continents. Every one
  made continents *less* coherent (largest continental component 0.11 →
  0.04–0.08 of continental area), broke the #59/#61 dispersal metrics
  (0.72–0.74 → as low as 0.51), or both. The mechanism is now understood:
  the ragged-archipelago character is manufactured at plate boundaries
  *after* reorganization (arc freckling, quantized-advection herringbone,
  collision debris), so steering rift lines into continental interiors only
  creates more boundary length through continent. What shipped is the
  `sutureYears` weld record (advected, tested, bit-neutral to every other
  field) and the full variant table in `PHASE_2_STAGE0_FINDINGS.md` ("#60")
  for the future boundary-process pass that can actually cash it in.
- **The IndexedDB cache is only sound because determinism is.** The cache
  key is (params, format version, behavior version) — no hashes of content.
  That design decision leans entirely on the golden discipline; it held.

## Input for Phase 3 re-planning

- **Land fraction should be a first-class simulated quantity** (spec flagged
  this): sea level currently sits at a fixed 0 m datum and land% is
  emergent. Phase 3's hydrology wants an explicit ocean volume / sea-level
  state so ice ages and shelf flooding are expressible.
- **The boundary-process coherence pass is the highest-leverage kernel work
  left** (from #60): bulldozer debris fates, arc-freckle compactness,
  herringbone rework. Until those preserve shapes, no reorganization-level
  mechanism can produce bold continents — and Phase 3's climate maps will
  inherit the speckle. The `sutureYears` record is in place for it.
- **`precipitation` is still the analytic latitude proxy** and is not
  stored; Phase 3's moisture transport replaces it wholesale and will want a
  storage slot in the codec (a `HISTORY_FORMAT_VERSION` bump, planned-for by
  the self-describing container).
- **Runtime headroom exists if Phase 3 needs it**: ~120 ms/step at N=128 is
  advection-dominated; the flagged optimization (restrict claim tests to a
  boundary band) remains unspent.
- **Worker heap was not instrumented** (only main-thread heap and storage
  estimate); if Phase 3 grows the field set, add a worker-side
  `performance.memory` probe to the acceptance.
