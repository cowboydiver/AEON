# PHASE_2_HANDOVER.md — Planning brief for Phase 2 (Timeline scrubbing)

**Audience:** a fresh Claude session taking over as Phase 2 planner (and, after
sign-off, implementer), with no memory of prior sessions. Phases 0 and 1 are
merged to `main` and green; everything you need is in the repo and the GitHub
tracker. This file is the map.

**Your task, in order (HANDOVER §4.5 gate — do not skip ahead):**
1. Re-plan Phase 2: expand the placeholder issues #22–#29 into full,
   ready-to-work issues (motivation, approach sketch, files touched,
   acceptance criteria, size S/M/L), informed by `PHASE_1_REPORT.md`.
   Update `docs/PLAN.md` and the tracker to match (milestone 2, overview
   issue #4, labels; `.github/workflows/tracker-sync.yml` reapplies
   milestones/dependencies — edit its tables if you restructure).
2. Write `docs/PHASE_2_SPEC.md` in the spirit of `PHASE_1_SPEC.md`
   (milestones + acceptance criteria + decisions folded in for review).
3. Present the spec and **pause for human sign-off. No Phase 2
   implementation before sign-off.** Spike prototypes are part of the
   signed-off plan, not pre-approved exceptions.

## 1. Read these, in this order

1. `CLAUDE.md` — hard rules, still binding. Determinism is sacred.
2. `HANDOVER.md` §3 "Phase 2 — Timeline scrubbing" — the goal, intent, risk
   and done-shape you are planning against.
3. `PHASE_1_REPORT.md` — **the main input to your plan.** Especially
   "Surprises / findings for later phases" and "Post-review amendments".
4. `docs/ARCHITECTURE.md` — the kernel/renderer contract as it exists now.
5. `docs/PLAN.md` + issues #4, #22–#29 (placeholders you will expand) and
   #54 (deep-time follow-ups filed from Phase 1 acceptance).
6. `PHASE0_REPORT.md` — environment traps. **Phase 2 is renderer/web-heavy,
   so unlike Phase 1 these now bite** (see §4).

## 2. Phase 2 in one paragraph (from HANDOVER §3)

The signature interaction: run a full history (streamed progressively from
the worker), cache keyframes in IndexedDB, blend bracketing keyframes on the
GPU (`fieldsA`/`fieldsB` + blend uniform — the hook was deliberately left in
Phase 0), and a timeline UI that feels tactile, with the event log rendered
as markers. Quantize fields (Uint8/Uint16 with documented ranges) for
storage and texture upload. Adaptive keyframe density is a stretch goal —
flag it, don't gold-plate it. The named risk is **memory**: budget an issue
to measure and set a keyframe budget. Done: scrub 4.5 Gyr at 60 fps with
continents visibly drifting; reload instant from cache; Playwright
screenshots at 5 timeline positions differ meaningfully and
deterministically.

## 3. Phase 1 outputs that must shape the plan

- **Memory math (why quantization is not optional):** 9 fields ×
  98,304 cells × 4 B ≈ 3.5 MB per raw keyframe; 4.5 Gyr at 10 Myr intervals
  is 451 keyframes ≈ **1.6 GB raw**. Only ~4 fields matter visually so far
  (elevation, plateId, crustAge, temperature); `precipitation` is a pure
  function of latitude (analytic — don't store it); `iceFraction`/`biome`
  are still zero; `boundaryStress` is derivable. A pruned Uint16 set is
  ~0.35 GB before compression. Field ranges to quantize against are in the
  ARCHITECTURE schema table.
- **Runtime:** ~120 ms/step at N=128 (advection-dominated) → a 4.5 Gyr
  history is ~9–10 minutes single-threaded. Progressive streaming UX is
  mandatory, and there is profiling headroom flagged in the spike doc
  (restrict advection claim tests to a boundary band) if generation time
  needs to shrink. The worker protocol already carries `timeYears`
  (`apps/web/src/worker/messages.ts`); the worker transfers field buffers
  and iterates `FIELD_NAMES` generically, so schema growth flows through.
- **Land budget at 4.5 Gyr is unverified** (#54): Phase 1 proved stability
  to 2 Gyr (seed 42: 21.8%, seed 1: ~20%, seed 1337: ~11% — 1337 is the
  canary). Budget an early issue to run 4.5 Gyr across seeds/grids BEFORE
  building the timeline UX on full histories. If land collapses late, that
  is kernel re-tuning work and the human should hear about it early.
- **Events are sparse** (~18 per 2 Gyr for seed 42): timeline markers need
  no clustering logic. Keyframes already carry a deep-copied event list.
- **plateId stability contract:** dead plate-table slots are never
  reclaimed so `plateId` values mean the same thing across all of history —
  Phase 2 keyframes depend on this; do not "optimize" it away (declined
  review finding on PR #55, rationale in the report).
- **Known visual artifact** (#54): margin "herringbone" shredding in slow
  oscillating convergence zones, amplified at high latitude by the
  equirectangular *dump* projection (the 3D globe will show it less).
  Decide in planning whether Phase 2 addresses it or defers; scrubbing
  makes artifacts more visible.
- **Early-history burst:** initial kinematics produce 4–6 sutures in the
  first ~30 Myr before settling into slow Wilson cycling. Fine for physics;
  consider what the timeline should show for t < 100 Myr.
- **Renderer hooks left ready in Phase 0/1:** texture set named `fieldsA`
  precisely so `fieldsB` + a blend uniform can be added without rework;
  face textures are (N+2)² bordered **R16F** (half-float filters
  everywhere; R32F filtering needs an optional feature) — quantized upload
  formats must keep the seam-border fill working (`neighbors()`-based).

## 4. Environment traps (they matter now)

- **`three` pinned to 0.184.0** — 0.185 breaks Chromium ≤ 142 (`swizzle`
  in createView → black canvas). **`@playwright/test` pinned to 1.56.1** —
  matches the preinstalled Chromium build; downloads are disabled in the
  remote env. Don't bump either casually.
- **e2e runs headed under Xvfb** (`apps/web/scripts/run-e2e.mjs`): plain
  headless Chromium loses the WebGPU device on canvas present. Phase 2's
  "screenshots at 5 timeline positions" acceptance runs through this path —
  budget for its quirks; see PHASE0_REPORT for the full rabbit hole.
- IndexedDB in Playwright/Chromium profiles is ephemeral per run — the
  "instant reload" acceptance needs a same-context reload, not a fresh
  browser launch.
- `pnpm sim -- --out` resolves against `INIT_CWD` (repo root).
- Kernel purity is typecheck-enforced (`"types": []`) and
  `Math.random`/`Date.now`/`performance.now` are ESLint-banned in
  `sim-kernel/src`. Quantization codecs that live in the kernel must honor
  all of it; goldens change ONLY for deliberate kernel-behavior reasons —
  storage-side quantization should not touch simulation bytes.

## 5. Working process (unchanged from Phase 1 — it worked)

One issue at a time in dependency order; spikes before integration where
the plan names a risk (memory/quantization fidelity and the 60 fps blend
path are the obvious spike candidates — prototype with the PNG harness and
a minimal render loop before wiring the full UI). Verification loop:
kernel changes → `pnpm -F sim-kernel test` + sim-cli dumps you actually
look at; renderer/web changes → `pnpm -F web e2e` and inspect the
screenshots yourself. Docs update in the same commit as any contract
change. Small single-purpose commits, imperative subject, physical/
behavioral reasoning in the body. Reality over plans: when the plan and
measurements diverge, update the plan and say so. End the phase with
`PHASE_2_REPORT.md` and re-planning input for Phase 3. Ask the human only
for taste-bound calls (timeline feel, visual direction, scope trades);
decide engineering details yourself within the invariants.

## 6. Definition of done you are planning toward (HANDOVER §3)

Scrub 4.5 Gyr at 60 fps with continents visibly drifting; reload is
instant from cache; Playwright screenshots at 5 timeline positions differ
meaningfully and deterministically. Add to that whatever acceptance
criteria your re-planning derives from the Phase 1 findings above (memory
budget number, land-budget verification, streaming progress UX) — and get
the spec signed off before building any of it.
