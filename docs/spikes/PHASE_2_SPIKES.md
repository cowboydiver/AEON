# Phase 2 spike findings — blend-path frame rate (#25, Spike B)

Spike A (quantization fidelity) resolved inside #22 — see the Spike A entry in
`docs/PHASE_2_SPEC.md` (max elevation error = half a Uint16 step, 0 coastline
cells migrated; locked by `codec.test.ts`). This file records **Spike B**.

Prototype: rather than a throwaway route, Spike B measured the *real* dual-sample
material shipped in #25, through the acceptance path itself. Reproduce with:

```
pnpm -F web e2e -- -g "Spike B"
```

(the `renders the dual-sample blend material without stalling (Spike B)` test in
`apps/web/e2e/planet.spec.ts`; `run-e2e.mjs` wraps it in Xvfb on displayless
Linux).

---

## Spike B — blend-path frame rate & set-swap cost

**Method.** Load a short history (`/?until=100e6`) so it streams to completion
fast and deterministically, pin a **fractional** scrub position (`0.5`) so both
texture sets are resident and every fragment samples A *and* B and mixes, then:

1. **Steady fps** — count presented frames (`requestAnimationFrame`) over a
   2.5 s window with no scrub input. R3F renders every rAF (frameloop "always"),
   so this is the material's raw render rate, isolated from React/scrub cost.
2. **Set-swap cost** — scrub across a keyframe boundary (`2.5`, a new bracket),
   forcing a one-set re-upload, and time to the next presented frame.

The environment is the acceptance reality: headed Chromium under Xvfb with
`--use-vulkan=swiftshader`, N=128, six displaced cube faces.

**Results.**

| Metric | Value (Xvfb / SwiftShader, N=128) |
|--------|-----------------------------------|
| Steady render fps (dual-sample + `mix`) | **~2.6 fps** (7 frames / 2702 ms) |
| Keyframe-boundary set-swap (upload + present) | **~1.7 s** |
| Fraction-only scrub inside a bracket | uniform write only — **no upload** |

**Reading the numbers.**

- **This is software rasterization, not the fps oracle.** ~2.6 fps is SwiftShader
  raster-bound (6 faces × ~33k displaced triangles + a two-texture fragment
  shader), exactly the caveat `PHASE0_REPORT.md` and the #25 handover call out:
  *"if SwiftShader/Xvfb can't hit [60 fps], record the real number and note that
  the CI path is not the fps oracle — a real GPU is."* The 60 fps target is a
  real-GPU expectation and cannot be measured on this path.
- **Dual-sample + `mix` is not the problem.** The blend material renders and the
  fractional-scrub morph test proves the interpolation is correct and
  deterministic (mid-frame differs from both endpoints, sits between them, and is
  pixel-stable across re-scrubs). The cost is per-pixel raster, which the same
  scene incurred before #25 — the second sampler adds a marginal fragment cost,
  not a stall.
- **The set-swap is dominated by render latency, not upload.** ~1.7 s ≈ a couple
  of ~385 ms SwiftShader frames plus one set's CPU `toHalfFloat` pack + texture
  upload; the upload is the small term. Because a fraction-only scrub within a
  bracket touches **no** texture (it only moves the `blend` uniform), perceived
  scrub smoothness is bounded by render fps — which a real GPU makes a non-issue.

**Decisions (measurement-driven).**

- **Keep textures R16F, decode-to-Float16 on the CPU upload path — no staging.**
  Uploads are not the bottleneck, confirming the `PHASE_2_SPEC.md` "Upload-format
  decision" default. `r8unorm` was not pursued (no win to chase when render, not
  upload, is the wall).
- **Two texture sets, ping-pong; no prefetch third set.** With two sets a boundary
  crossing is a single-set re-upload (`residency.ts`), and prefetching into a
  third set can't beat a wall that is render fps, not upload latency — so the
  extra set and its material plumbing are intentionally omitted. Revisit only if a
  real-GPU profile shows uploads stalling the present.
- **CI asserts "live, not stalled," not a fps figure.** The Spike-B test floors
  steady fps at 0.4 and bounds the swap, and *logs* the real numbers; it does not
  gate on a SwiftShader fps target. Real-GPU fps is validated by eye, per the
  acceptance.
