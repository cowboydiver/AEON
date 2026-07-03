# PHASE_2_ISSUE_25_HANDOVER.md — GPU keyframe blending (`fieldsB` + blend uniform)

**Audience:** a fresh Claude session implementing **issue #25** with no memory of
prior sessions. Phase 2's storage/streaming/scrubber spine is built and pushed;
#25 is the signature *visual* mechanic that makes it feel alive. Everything you
need is in the repo. This file is the map.

**One-line goal:** scrub the timeline and watch continents **morph** between
keyframes instead of popping — dual GPU texture sets blended by a `blend` uniform,
with vertex displacement driven by the *blended* elevation.

---

## 1. Where the work sits (read this first)

Phase 2 so far is on branch `claude/phase-2-opus-plan-b6b3is` (PR #57), commits
`096c07c…c697c78`. Confirm whether that PR is merged before you branch:

- **If merged:** start #25 from the latest default branch on a fresh branch.
- **If open:** rebase onto it or continue per your own branch instructions —
  don't stack unrelated commits on someone else's open PR without being told to.

Delivered and green (don't redo): **#22** field quantization codec
(`sim-kernel/src/codec.ts`), **#23** worker progressive streaming, **#26 core**
timeline scrubber, **#27** memory budget/clamp (`planHistory`), **#24** IndexedDB
history cache. The renderer today still does **decode-nearest-keyframe**: the
scrubber pins to one keyframe and uploads its elevation. #25 replaces "nearest"
with "bracketing pair + fractional blend."

**Read, in order:** `CLAUDE.md` (hard rules — determinism is sacred; `three`
pinned to **0.184.0**, `@playwright/test` to **1.56.1**, don't bump either);
`docs/PHASE_2_HANDOVER.md` §3–§4 (the Phase-0/1 renderer hooks and environment
traps); `docs/PHASE_2_SPEC.md` (the #25 acceptance + the "Upload-format decision"
box); `docs/ARCHITECTURE.md` "History streaming & timeline" + the grid/texture
sections; then the four renderer files below.

## 2. What exists to build on

**`packages/planet-renderer/src/textures.ts`** — per-face field textures for one
keyframe, deliberately named the **A set**:
- 6 faces, each an **(N+2)×(N+2) R16F** `DataTexture` (bordered — the 1-texel
  seam border is filled from adjacent faces via the kernel's seam-aware
  `neighbors()`, so linear filtering has no cracks at cube seams; diagonal corner
  texels hold the 3-cell mean so all faces agree at cube corners).
- **R16F, not R32F** on purpose: WebGPU only guarantees linear filtering of
  32-bit float behind the optional `float32-filterable` feature; half-float
  filters everywhere. Elevation spans ±~6500 m; half precision resolves ~4 m.
- `uploadKeyframe(textures, { elevation })` packs a kernel `Float32Array` into
  the 6 bordered faces via `DataUtils.toHalfFloat`. Elevation is the only field
  packed today.

**`packages/planet-renderer/src/material.ts`** — TSL `MeshBasicNodeMaterial` per
face. Samples `elevationA` for (a) **radial vertex displacement**
(`positionLocal.mul(1 + elevation/radius * exaggeration)`) and (b) a hypsometric
color ramp. `createPlanetUniforms()` returns `{ exaggeration, sunDirection }`.
The doc-comment already promises: *"a second keyframe texture set and a blend
uniform slot in later without restructuring."* That promise is your contract.

**`apps/web/src/PlanetScene.tsx`** — R3F scene; takes the current decoded
`RenderKeyframe | null`, uploads its `elevation` to the A textures, calls
`onFirstFrame` once presented.

**`apps/web/src/usePlanetWorker.ts`** — streams history, accumulates every
encoded keyframe in `historyRef` (payloads retained), decodes the latest (or the
pinned one) into `current`. `select(index | null)` pins a keyframe or follows the
live edge. `decodeKeyframe(payload)` (from `sim-kernel`) returns
`{ count, fields: Partial<Record<FieldName, Float32Array>> }`. `historyRef` is
your source of bracketing keyframes.

**The codec** decodes categorical fields (`plateId`, `crustType`) **bit-exact**
and continuous fields (`elevation`, `crustAge`, `temperature`) to within half a
quant step. That distinction is the whole reason categorical fields must never be
lerped (see §4).

## 3. Spike B first — it gates the design (do not skip)

The spec makes #25 depend on **Spike B**, still pending. Build a minimal harness
(a dev-only route/flag in `apps/web`, or a throwaway page): upload **two** full
texture sets, animate the `blend` uniform, swap the texture-set every second, and
**measure fps + upload stalls on the actual `pnpm -F web e2e` Xvfb path** (not
just a desktop browser — SwiftShader under Xvfb is the acceptance reality; see
`PHASE0_REPORT.md`). Answer:

1. Does dual-sample + `mix` hold interactive fps at **N=128 across six faces**?
2. How expensive is a **texture-set swap** (the scrub-crossing-keyframe cost)?
3. Do quantized uploads need staging / a decode-to-Float16 step, or is the
   straight `toHalfFloat` path fine?

**Upload-format trap Spike B must resolve:** #22's early sketch said "textures
upload as normalized integers," but WebGPU `r16unorm` is an **optional** feature.
The recorded safe default (`PHASE_2_SPEC.md` "Upload-format decision"): **keep
textures R16F and decode quantized bytes to Float16 on the CPU upload path**
(fast; the `neighbors()` seam-border fill keeps working unchanged); use `r8unorm`
(core, filterable) only for genuinely 8-bit fields if Spike B shows a win.
Record Spike B's numbers in `docs/PHASE_2_SPEC.md` (there's a Spike B stub) and,
if you add a spikes doc, under `docs/spikes/`.

## 4. Implementation shape (once Spike B says go)

In `packages/planet-renderer/src/` (`textures.ts`, `material.ts`):

- **Second texture set `fieldsB`** mirroring A, and a **`blend`** uniform in
  `createPlanetUniforms()`.
- **Per-fragment/vertex blend:** `mix(sampleA, sampleB, blend)` for **continuous**
  fields (elevation now; temperature/crustAge when a view needs them). For
  **categorical** `plateId`/`crustType`, **hold-A or nearest**
  (`blend < 0.5 ? A : B`) — **never `mix`** a categorical field; a lerp between
  plate ids 3 and 7 is a meaningless 5. The codec keeps categoricals bit-exact
  precisely so this path can stay crisp.
- **Displacement continuity:** vertex displacement uses the **blended** elevation,
  so continents *morph* rather than pop. Verify **no seam cracks** during a blend
  — the (N+2)² border texels must be blended with the *same* uniform, which they
  are if borders live in the same textures. Don't fork `textures.ts` for the
  decode path — extend it.
- **Residency / ping-pong:** the scrub position maps to a **bracketing keyframe
  pair (i, i+1)** and a fractional `blend = (t − t_i) / (t_{i+1} − t_i)`. The CPU
  re-uploads **only when the playhead crosses a keyframe boundary**, and then
  only the **one** set that changed (swap the A/B roles rather than re-uploading
  both). **Prefetch** the next keyframe in the scrub direction.

In `apps/web/` (`usePlanetWorker.ts`, `PlanetScene.tsx`, `App.tsx`): the scrubber
must expose a **continuous** position (fractional between keyframes), not just an
integer index, and hand `PlanetScene` two decoded keyframes + the fraction (or
drive the uniform directly). Keep the existing decode-nearest path working behind
the blend so a single-keyframe history still renders.

## 5. Acceptance (what "done" means)

- Scrubbing shows continents **visibly morphing** across a keyframe boundary — no
  pop. Vertex relief interpolates; coastlines slide, not jump.
- **Categorical fields never lerp** — if/when `plateId` drives any coloring,
  plate boundaries stay crisp across a blend (assert nearest, not mixed).
- **No seam cracks** at cube-face edges during a blend.
- `pnpm -F web e2e` green; the "screenshots at N timeline positions" differ
  **meaningfully and deterministically** (same seed → same pixels). **Look at the
  screenshots yourself** — numbers passing while continents shimmer or crack is a
  failure. Add a blend-specific e2e (scrub to a fractional position between two
  keyframes; screenshot; assert it differs from both endpoints).
- Interactive fps target from Spike B met (the HANDOVER's aspiration is 60 fps at
  N=128; if SwiftShader/Xvfb can't hit it, record the real number and note that
  the CI path is not the fps oracle — a real GPU is).

## 6. Traps specific to #25

- **e2e is headed under Xvfb** (`apps/web/scripts/run-e2e.mjs`) — plain headless
  Chromium loses the WebGPU device on canvas present. Two texture sets + swaps
  stress this path; budget for it.
- **`three@0.184.0` is pinned** — 0.185 breaks Chromium ≤142 (`swizzle` in
  `createView` → black canvas). TSL node APIs move between three versions; write
  against 0.184's `three/tsl` surface.
- **Determinism** still applies to anything you touch in `sim-kernel` — but #25
  should be **renderer-only**: no kernel or codec change, so **no golden change**.
  If you find yourself editing `codec.ts`, stop and reconsider.
- The scrubber's data already lives in `historyRef` as **encoded** payloads;
  decoding two per frame is cheap but don't decode on every animation frame —
  decode on boundary crossing and cache the two active `Float32Array`s.

## 7. Working process (unchanged, it works)

One concern at a time: **Spike B → measure → record → implement**. Renderer
changes verify through `pnpm -F web e2e` + your own eyes on the screenshots. Docs
(`ARCHITECTURE.md` "History streaming & timeline", and the Spike B outcome in
`PHASE_2_SPEC.md`) update in the same commit as the contract change. Small
single-purpose commits, imperative subject, the *visual* behavior change and how
you verified it in the body. Ask the human only for taste calls (blend easing,
exaggeration, whether to color by `plateId` now); decide the engineering yourself
within the invariants. When measurements and the plan diverge, the measurements
win — say so.

## 8. What #25 does *not* cover

The deep-time **tectonic-death / supercontinent-dispersal** problem
(`docs/PHASE_2_STAGE0_FINDINGS.md`, candidate issues #58 land-bleed / #59
whole-sphere-plate breakup) is a separate **kernel** investigation with its own
handover (`docs/DEEP_TIME_TECTONICS_HANDOVER.md`). #25 makes whatever the kernel
produces *look* continuous; it does not fix what the kernel produces. If the sim
is supercontinent-dominated in the back half, blending will faithfully show a
slowly-morphing supercontinent — that's correct behavior for #25, not a bug in it.
