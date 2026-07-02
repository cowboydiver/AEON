# PHASE_2_OPUS_PLAN.md — Execution plan for the Phase 2 agent

**Audience:** the Opus agent implementing Phase 2 (timeline scrubbing), with no
memory of prior sessions. This plan operationalizes `docs/PHASE_2_HANDOVER.md`
into a staged, dependency-ordered work program. It is a *plan*, not a spec:
Stage 1 below produces `docs/PHASE_2_SPEC.md`, which supersedes this file's
recommendations wherever the two diverge after sign-off.

**Non-negotiable gate (HANDOVER §4.5):** Stages 0–1 are planning and
de-risking. **No Phase 2 feature implementation before the human signs off on
`docs/PHASE_2_SPEC.md`.** Spike prototypes are part of the signed-off plan,
not pre-approved exceptions — but the Stage 0 *measurement* runs (existing
CLI, no new code paths) are fine to run immediately.

---

## 0. Required reading, in order

1. `CLAUDE.md` — hard rules. Determinism is sacred; kernel purity is
   typecheck- and lint-enforced.
2. `docs/PHASE_2_HANDOVER.md` — the brief this plan executes.
3. `PHASE_1_REPORT.md` — especially "Surprises / findings for later phases"
   and "Post-review amendments".
4. `HANDOVER.md` §3 "Phase 2 — Timeline scrubbing" — goal, risk, done-shape.
5. `docs/ARCHITECTURE.md` — field schema (ranges feed quantization), grid
   indexing, texture/border contract.
6. `PHASE0_REPORT.md` — environment traps; Phase 2 is renderer/web-heavy so
   they all bite now.
7. Issues #4 (overview), #22–#29 (placeholders you will expand), #54
   (deep-time follow-ups), and `docs/PLAN.md`.

## 1. The shape of the phase

Deliver the signature interaction: a full 4.5 Gyr history streamed
progressively from the worker, quantized keyframes cached in IndexedDB, GPU
blending between bracketing keyframes (`fieldsA`/`fieldsB` + blend uniform —
the hook exists in `packages/planet-renderer/src/material.ts`), and a tactile
timeline with event markers.

**Done means (issue #4):** scrub 4.5 Gyr at 60 fps with continents visibly
drifting; reload instant from cache; Playwright screenshots at 5 timeline
positions differ meaningfully and deterministically. Stage 1 adds derived
acceptance criteria: an explicit memory budget number (#27), 4.5 Gyr
land-budget verification (#54), and streaming-progress UX.

**The named risk is memory.** The math that makes quantization mandatory:
9 fields × 98,304 cells (N=128) × 4 B ≈ 3.5 MB per raw keyframe; 451
keyframes (4.5 Gyr @ 10 Myr) ≈ 1.6 GB raw. A pruned Uint16 set is ~0.35 GB
before compression.

## 2. Stage 0 — De-risk before planning (measurement only, no new features)

These runs use existing tooling and directly shape the spec. Do them first;
their numbers go into `PHASE_2_SPEC.md`.

### 0a. Land budget at 4.5 Gyr (#54 part 2) — the go/no-go input

Phase 1 proved land-fraction stability only to 2 Gyr. Run:

```
pnpm sim -- --seed 42   --until 4.5e9 --report --dump elevation,plateId --dump-every 250 --out tmp/p2-s42
pnpm sim -- --seed 1    --until 4.5e9 --report --out tmp/p2-s1        # N per Phase 1 acceptance (64)
pnpm sim -- --seed 1337 --until 4.5e9 --report --out tmp/p2-s1337     # the canary — stabilizes lowest (~11%)
```

(Check `packages/sim-cli/src/main.ts` for the grid-size flag; match Phase 1
acceptance grids: seed 42 at N=128, seeds 1/1337 at N=64.) Expect ~10 min for
the N=128 run (~120 ms/step). **Look at the dumps**, not just numbers.

- Land fraction stays in a sane band (~10–60%) and continents still look like
  continents at 4.5 Gyr → record numbers in the spec, proceed.
- Land collapses or the world degenerates late → **stop and tell the human
  immediately.** That is kernel re-tuning work (knobs in
  `packages/sim-kernel/src/constants.ts`, listed in #54) that reshapes the
  phase; do not silently absorb it into the plan.

Also record wall-clock time per seed — it calibrates the streaming UX and
whether the profiling headroom flagged in `docs/spikes/PHASE_1_SPIKES.md`
(restrict advection claim tests to a boundary band) needs to be spent.

### 0b. Margin herringbone decision input (#54 part 1)

While inspecting the 0a flipbooks, judge how visible the herringbone
shredding is at scrub-relevant zoom (remember the equirectangular dump
exaggerates it at high latitude; the 3D globe shows it less).
**Recommendation to carry into the spec: defer the kernel fix to a follow-up
unless the artifact is prominent on the globe** — it is golden-changing
kernel work with tuning risk, and Phase 2's value doesn't depend on it.
Present it as an explicit scope question at sign-off; the human decides.

## 3. Stage 1 — Re-plan and specify (the HANDOVER's task list)

### 1a. Expand the placeholder issues

Rewrite #22–#29 as full, ready-to-work issues (motivation, approach sketch,
files touched, acceptance criteria, size S/M/L) using §5 below as the draft.
Add the two spike issues and the land-budget issue as new tracker issues
(labels: `spike`, `phase-2`, plus `kernel`/`renderer`/`ui`/`infra` as
appropriate; anything expected to change golden hashes gets `goldens`).

### 1b. Update the tracker structure

- `docs/PLAN.md`: replace the Phase 2 placeholder list with the expanded
  table + dependency sketch (mirror the Phase 1 section's format).
- Issue #4: update the task list to the final issue set.
- `.github/workflows/tracker-sync.yml`: add the new issue numbers to the
  Phase 2 milestone table and encode the dependency graph from §6 in its
  `deps` table, then dispatch it (it is idempotent).

### 1c. Write `docs/PHASE_2_SPEC.md`

In the spirit of `docs/PHASE_1_SPEC.md`: milestones, acceptance criteria,
and the decisions of §5 folded in as reviewable choices — including the Stage
0 measurements, the quantization table (per-field format/range/precision),
the memory budget targets, the herringbone recommendation, and what is
explicitly out of scope (#28 adaptive density unless data says otherwise).

### 1d. Present and pause

Present the spec to the human and **stop for sign-off.** While waiting, the
only permissible work is Stage 0-style measurement or documentation.

## 4. Stage 2 — Spikes (after sign-off)

Prototype where the plan names risk, before integration — this worked in
Phase 1. Findings go in `docs/spikes/PHASE_2_SPIKES.md` (create it, format
per `docs/spikes/PHASE_1_SPIKES.md`).

### Spike A — Quantization fidelity (S)

Using the PNG harness in `packages/sim-cli`: take checkpoints from a seed-42
run, round-trip each stored field through the proposed codec
(quantize → dequantize), and dump original vs round-tripped PNGs plus
max/mean absolute error. Question to answer: are the proposed formats (§5,
#22) visually lossless on the globe's color ramp and displacement scale?
Watch elevation banding near sea level specifically — the hypsometric ramp
and the land/ocean `select` in `material.ts` make the 0 m crossing the most
error-sensitive value; if Uint16 over the full range bands there, consider a
piecewise (higher precision near 0) mapping *documented in the codec*.

### Spike B — Blend-path frame rate (M)

A minimal harness (can live behind a dev-only route or flag in `apps/web`):
two full texture sets uploaded, blend uniform animated, texture-set swap
every second — measure fps and upload stalls under the e2e Xvfb path. This
answers: (a) does dual-sample + lerp hold 60 fps at N=128 across six faces;
(b) how expensive is a texture-set swap (the scrub-crossing-keyframe cost);
(c) do quantized uploads need staging. Test on the *actual* acceptance path
(`pnpm -F web e2e` harness), not just a desktop browser.

**Upload-format trap to resolve here:** #22's sketch says "textures upload as
normalized integers", but in WebGPU `r16unorm` is an optional feature, and
the existing face textures are bordered R16F because half-float filters
everywhere (R32F filtering is optional too — see ARCHITECTURE). The safe
default: keep textures R16F and decode quantized bytes to `Float16` on the
CPU upload path (fast, and the `neighbors()`-based seam-border fill keeps
working unchanged); use `r8unorm` (core, filterable) only for genuinely 8-bit
fields if profitable. Spike B decides; the spec records the outcome.

## 5. Stage 3 — Implementation issues (the expanded #22–#29)

One issue at a time, in dependency order (§6). Sizes are estimates for the
issue bodies. Every contract change updates `docs/ARCHITECTURE.md` in the
same commit.

### #22 — Field quantization codec (M, `kernel`, `goldens` for new codec goldens only)

- **What:** a pure encode/decode module, `packages/sim-kernel/src/codec.ts`
  (kernel is the right home: zero-dep, pure, shared by worker and renderer
  through the existing dependency direction). Quantization is a pure function
  of the float field; **it never touches simulation bytes** — sim goldens
  must not change. Add *new* golden tests over the quantized bytes for seeds
  {1, 42, 1337}.
- **Stored field set (prune first, then quantize):** store only
  `elevation`, `plateId`, `crustAge`, `temperature`, `crustType`.
  `precipitation` is analytic from latitude (recompute at decode/render);
  `boundaryStress` is derivable and visually unused; `iceFraction`/`biome`
  are still zero. The container format is versioned and self-describing
  (field name → format/range table in the header) so Phase 3 fields flow in
  without a format break.
- **Draft quantization table** (verify ranges against Phase 1 reality — the
  ARCHITECTURE table's elevation range predates trenches at −8500 m and the
  9 km orogeny cap; the stability invariant allows −11…+9 km):

  | Field       | Format | Range               | Precision  | Notes |
  |-------------|--------|---------------------|------------|-------|
  | elevation   | Uint16 | −11,000 … +9,500 m  | ~0.31 m    | Spike A checks banding at 0 m |
  | crustAge    | Uint16 | 0 … 7.0 Gyr         | ~107 kyr   | covers 4.5 Gyr sim + 2 Gyr shield offset + headroom |
  | temperature | Uint8  | 180 … 320 K         | ~0.55 K    | placeholder climate; revisit range in Phase 3 |
  | plateId     | Uint8  | 0 … 255             | exact      | plate table is append-only (~tens of records per 4.5 Gyr — the PR #55 declined-finding contract); assert < 256 |
  | crustType   | Uint8  | {0, 1}              | exact      | candidate to pack with plateId later; keep separate first |

- **Per-keyframe payload at N=128:** ~98,304 × (2+2+1+1+1) B ≈ 688 KB;
  451 keyframes ≈ **0.31 GB** — in line with the handover estimate.
- **plateId/crustType are categorical:** codec must be exact (no scaling
  error), and the decode path must preserve integer identity — GPU blending
  (#25) needs hold/nearest semantics, never lerp.
- **Acceptance:** round-trip error bounds asserted per field; codec goldens
  for 3 seeds; sim goldens byte-identical before/after the PR; Spike A PNGs
  attached to the issue.

### #23 — Worker protocol: progressive full-history streaming (M, `ui`, `infra`)

- **What:** extend `apps/web/src/worker/messages.ts` and
  `apps/web/src/worker/simWorker.ts` from one-shot generate to a history run:
  `RunHistoryRequest { requestId, seed, gridN, untilYears, keyframeIntervalYears }`;
  worker steps the kernel, and at each keyframe interval posts
  `HistoryKeyframe { requestId, index, timeYears, landFraction, quantized payload, events since last }`
  (transfer the quantized ArrayBuffers — cheaper than raw Float32 and they're
  what #24/#25 consume anyway), plus `HistoryProgress` and `HistoryDone`.
  Keep iterating `FIELD_NAMES`/codec-table generically so schema growth flows
  through.
- **Cancellation/regeneration:** a new `requestId` supersedes; the worker
  checks a cancellation flag between steps and aborts cheaply. Changing seed
  mid-run cancels and restarts; the UI reflects the partial timeline
  resetting.
- **Event log:** keyframes already carry a deep-copied event list from the
  kernel; forward events with their keyframes for #26's markers.
- **Acceptance:** a 4.5 Gyr run streams keyframes with monotonically
  increasing `timeYears`; the timeline becomes scrubbable over the streamed
  prefix while the run continues; cancel mid-run leaves no stuck worker
  state; `usePlanetWorker.ts` (rename/extend to a history hook) has unit
  coverage for message ordering and supersession.

### #24 — IndexedDB keyframe cache (M, `ui`, `infra`)

- **What:** persist quantized keyframes + event log + a manifest, keyed by
  `(seed, gridN, untilYears, keyframeIntervalYears, paramsHash, HISTORY_FORMAT_VERSION, KERNEL_BEHAVIOR_VERSION)`.
  On load: manifest hit → hydrate the timeline from cache (no worker run);
  miss → run #23 and write through as keyframes arrive (so a mid-run reload
  still salvages the prefix — cheap and it makes the cache resumable).
- **Invalidation is the interesting part:** introduce
  `KERNEL_BEHAVIOR_VERSION` in `sim-kernel` (a manually-bumped integer,
  documented in `CLAUDE.md`'s golden-regeneration workflow: **any deliberate
  golden regeneration bumps it in the same commit**). `HISTORY_FORMAT_VERSION`
  lives in the codec (#22). Either mismatch → treat as miss; stale entries
  garbage-collected (simple LRU by manifest timestamp — planet histories are
  ~0.3 GB, browsers will evict; handle `QuotaExceededError` by evicting
  oldest and retrying once).
- **Acceptance:** same-context reload hydrates instantly (measured; e2e
  proves it — note the trap: IndexedDB in Playwright profiles is ephemeral
  per run, so the test must reload within one browser context, not relaunch);
  version bump invalidates; corrupted/partial records fall back to
  regeneration, never a broken timeline.

### #25 — GPU keyframe blending: fieldsB + blend uniform (L, `renderer`)

- **What:** the signature mechanism, in `packages/planet-renderer/src/`
  (`material.ts`, `textures.ts`): a second texture set `fieldsB`, a
  `blend` uniform, per-fragment `mix(sampleA, sampleB, blend)` for
  continuous fields (elevation now; temperature/crustAge when a view needs
  them) and **hold-A (or nearest: `blend < 0.5 ? A : B`) for categorical
  `plateId`/`crustType`** — never lerp categorical fields.
- **Residency management:** the scrub position maps to a bracketing keyframe
  pair (i, i+1); the CPU only re-uploads when the playhead crosses a keyframe
  boundary, and then only the one set that changed (swap roles of A/B rather
  than re-uploading both — the ping-pong). Prefetch the next keyframe in
  scrub direction. Decode-to-Float16-on-upload per Spike B's finding; the
  bordered (N+2)² seam fill (`neighbors()`-based) must keep working on the
  decode path — extend `textures.ts`, don't fork it.
- **Displacement continuity:** vertex displacement uses the blended
  elevation, so continents *morph* rather than pop; verify no seam cracks
  during blends (border texels must be blended with the same uniform —
  they are, if borders live in the same textures).
- **Acceptance:** e2e screenshot mid-blend between two hand-picked keyframes
  shows an intermediate state (no popping, no seams); frame rate from Spike
  B's harness re-measured in-app at ≥ 60 fps at N=128; categorical fields
  visibly hold (no plate-color smearing).

### #26 — Timeline UI: scrubber with event markers (M, `ui`)

- **What:** in `apps/web/src/` (new `Timeline.tsx` + state wiring through
  `App.tsx`/`PlanetScene.tsx`): a scrubber spanning 0 … 4.5 Gyr driving the
  blend machinery (#25); play/pause with variable speed; event markers with
  hover labels from the event log (~18 events per 2 Gyr — render every
  marker, no clustering); progressive availability while #23 streams
  (unreached time visually distinct, playhead clamped to streamed prefix,
  progress indicator).
- **Time mapping:** start **linear**. Deep time is uneven (4–6 sutures in
  the first ~30 Myr, then slow Wilson cycling), but log-warping is a
  taste-bound call — ship linear, show the human, ask at the demo. Keep the
  mapping a single pure function so swapping is trivial.
- **Feel:** scrub must be tactile — pointer-down drags update the blend every
  frame (the GPU path makes this free); no debounce on the uniform, only on
  texture-set swaps (they're already boundary-crossing-only).
- **Acceptance:** e2e drives the scrubber to positions and screenshots;
  markers appear at event times with correct labels; play mode advances
  smoothly across keyframe boundaries; UI stays functional-and-clean
  (Phase 5 restyles it — don't gold-plate).

### #27 — Memory budget: measure and enforce (S, `infra`) — the named risk

- **What:** measure, on a real 4.5 Gyr history: worker heap high-water,
  main-thread retained size, IndexedDB footprint, GPU texture residency
  (sets × faces × fields × bytes). Write the numbers into a short report
  section in `PHASE_2_REPORT.md`-to-be and `docs/ARCHITECTURE.md`; derive and
  **enforce** defaults: keyframe interval (start at 10 Myr ⇒ 451 keyframes ≈
  0.31 GB quantized), stored-field set, and resident-texture count, as named
  constants with the budget math in comments.
- **Target:** streams and scrubs on a mid-range laptop; a hard ceiling
  (recommend: ≤ 0.5 GB main-thread retained history + ≤ 64 MB GPU textures)
  goes in the spec at sign-off.
- **Acceptance:** the report with real numbers; defaults derived from it; an
  assertion/warning path when a requested history would bust the budget.

### #28 — Stretch: adaptive keyframe density (skip by default)

Only if #27's numbers show fixed 10 Myr intervals either waste memory in
quiet eons or visibly under-sample the first ~30 Myr burst when scrubbed.
The event log knows where history is fast. **Skip without guilt** if fixed
intervals hit the done-criteria; record the decision in the report.

### #29 — Phase 2 acceptance + PHASE_2_REPORT.md (M, `ui`, `infra`)

- **What:** the done-check, executable under the existing Xvfb e2e harness
  (`apps/web/scripts/run-e2e.mjs`; plain headless Chromium loses the WebGPU
  device — see PHASE0_REPORT):
  1. Playwright drives the timeline to 5 positions across 4.5 Gyr,
     screenshots each; screenshots differ meaningfully pairwise (pixel-diff
     threshold) and are deterministic across two full runs.
  2. Scrub fps measured (rAF timing) ≥ ~60 at N=128; number recorded.
  3. Reload within the same browser context hydrates from IndexedDB
     "instantly" (define: timeline interactive < 1 s, no worker restart).
  4. Continents visibly drift across the 5 screenshots — **look at them.**
- E2e budget note: a fresh 4.5 Gyr history is ~10 min single-threaded — the
  e2e must either persist a fixture history, use a reduced `untilYears` run
  for the screenshot determinism check plus one full-history manual
  acceptance, or spend the sim-CLI profiling headroom. Decide in the spec,
  don't discover it in CI.
- **Ends with `PHASE_2_REPORT.md`**: what was built, deviations, surprises,
  measured numbers, and re-planning input for Phase 3 (sea level will want
  land fraction as a first-class quantity — note anything learned).

## 6. Dependency graph (drives tracker-sync `deps` and work order)

```
Stage 0 (measure)   land-budget-4.5Gyr (#54 pt 2, new issue) ──┐  (kernel go/no-go — earliest)
Stage 1 (plan)      expand issues, PLAN.md, tracker, SPEC ─────┤→ SIGN-OFF GATE
Stage 2 (spikes)    Spike A (quant fidelity) → #22             │
                    Spike B (blend fps)      → #25             │
Stage 3 (build)     #22 → {#23, #24, #25, #27}                 │
                    #23 → #26;  #25 → #26                      │
                    #24 needs #22, #23                         │
                    #27 refines after #25/#26 land             │
                    #28 gated on #27's data (default: skip)    │
                    {#23, #24, #25, #26, #27} → #29            │
```

Suggested build order: #22 → #23 → #25 → #24 → #26 → #27 (final numbers) →
#28 decision → #29. (#24 after #25 so the cache stores what the blender
actually consumes; swap if streaming lands first — both only depend on #22.)

## 7. Standing rules for the implementing agent

- **Verification loop, every time:** kernel changes → `pnpm -F sim-kernel
  test` + a `--report`/`--dump` run you actually look at; renderer/web
  changes → `pnpm -F web e2e` and inspect the screenshots yourself. All of
  `pnpm test`, `pnpm lint`, `pnpm typecheck` green before any push.
- **Goldens change only for deliberate kernel-behavior reasons**, explained
  in the commit body, regenerated via `pnpm -F sim-kernel test -- -u`.
  Nothing in Phase 2 should change sim goldens except an approved
  herringbone fix or land-budget retune. Storage quantization must not.
- **Do not bump `three` (pinned 0.184.0) or `@playwright/test` (pinned
  1.56.1)** — 0.185 black-canvases Chromium ≤ 142; Playwright downloads are
  disabled in the remote env.
- **Do not "optimize away" dead plate-table slots** — plateId stability
  across all of history is the contract keyframe scrubbing stands on
  (declined finding, PR #55).
- Small single-purpose commits, imperative subject, physical/behavioral
  reasoning and verification evidence in the body. One issue per commit
  series, in dependency order. Docs (`ARCHITECTURE.md`, `PLAN.md`) update in
  the same commit as any contract change.
- Ask the human only for taste-bound calls (timeline feel/mapping, visual
  direction, herringbone scope, budget ceiling); decide engineering details
  yourself within the invariants. Reality over plans: when measurements
  diverge from this plan, update the spec and say so.
- End the phase with `PHASE_2_REPORT.md` and re-planning input for Phase 3.
