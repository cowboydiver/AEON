# HANDOVER.md — Project Roadmap & Planning Brief

**Audience:** Claude Code, taking over as lead implementer and planner.
**Status:** Phase 0 (walking skeleton) is complete and green. This document hands
over the full product vision and instructs you to plan the remaining phases as
milestones and issues.

Read `CLAUDE.md` (hard rules — still binding), `docs/ARCHITECTURE.md` (what
exists), and `PHASE0_REPORT.md` (deviations, surprises) before planning anything.

---

## 1. Product vision

A 3D web application simulating the full evolutionary history of a procedurally
generated planet, viewed from space, with a timeline scrubber spanning billions of
years. The planet is a deeply coupled system: star type and luminosity evolution,
moon/tidal history, rotation, tectonics, elemental composition, atmosphere, climate
with orographic effects, hydrology, ice, and eventually a biosphere that feeds back
into climate and appearance. Scrubbing the timeline morphs the planet smoothly —
continents drift, ice ages breathe, oceans green.

A later content package adds **surface exploration**: standing at any coordinate at
any moment in history. This is achievable only because everything is a pure
function of (seed, position, time) — coarse simulation fields amplified by
deterministic procedural detail. Every architectural decision protects that
property.

## 2. Architecture recap (the invariants you plan around)

- `sim-kernel`: pure, deterministic, dependency-free TypeScript. Systems are
  `(state, dt, ctx) => state`. All randomness via seeded PRNG / integer hash.
- Cube-sphere grid shared verbatim between simulation and rendering.
- History = keyframes (typed-array field snapshots) every N Myr; the renderer
  blends bracketing keyframes on the GPU (TSL), so scrubbing never touches the CPU.
- Verification loop: Vitest goldens + invariants, `sim-cli` reports and field PNGs
  (look at them), Playwright screenshots for the renderer.
- Discrete events (impacts, breakups, oxygenation) live in an event log alongside
  keyframes — this later powers timeline annotations.

## 3. Remaining phases

Order is fixed; internal breakdown is yours to plan. For each phase: the goal, the
core design intent, the main risk, and the shape of "done."

### Phase 1 — Tectonics
**Goal:** believable continents emerging, drifting, colliding, and rifting over
billions of years. **This is the risk concentrator for the whole project** — if
continents look like soup, everything downstream inherits blandness. Prototype
algorithm candidates in isolation using the PNG harness *before* integrating.
- Intent: N plates seeded as regions (Voronoi-style flood fill on the grid), each
  with an Euler pole + angular velocity; advect crust; divergent boundaries create
  young ocean crust, convergent boundaries subduct the denser side and build
  mountains, transforms shear. Periodic plate reorganization (Wilson cycles) for
  supercontinent formation/breakup. Erosion as precipitation-weighted diffusion
  (use a crude latitude-based precipitation proxy until Phase 3). New fields as
  needed (plateId, boundary type/stress); update `fields.ts` + `ARCHITECTURE.md`.
- Risk: crust advection on a discrete sphere grid (gaps/overlaps at boundaries).
  Budget explicit spike issues for this.
- Done: seed 42 run over 2 Gyr shows recognizable continental cycles in dumped
  PNGs; invariants hold (crust covers sphere, elevation distribution roughly
  bimodal like real hypsometry); goldens updated deliberately; kernel suite still
  fast.

### Phase 2 — Timeline scrubbing
**Goal:** the signature interaction. Full-history run (streamed progressively from
the worker), keyframes cached in IndexedDB, GPU blending between bracketing
keyframes, and a timeline UI that feels tactile.
- Intent: quantize fields (Uint8/Uint16 with documented ranges) for storage and
  texture upload; `fieldsA`/`fieldsB` + blend uniform in the material (the hook was
  left in Phase 0); adaptive keyframe density is a stretch goal — flag it, don't
  gold-plate it. Event log rendered as timeline markers.
- Risk: memory. Budget an issue to measure and set a keyframe budget (target: a
  4.5 Gyr history streams and scrubs on a mid-range laptop).
- Done: scrub 4.5 Gyr at 60 fps with continents visibly drifting; reload is
  instant from cache; Playwright screenshots at 5 timeline positions differ
  meaningfully and deterministically.

### Phase 3 — Climate, hydrology, biomes
**Goal:** the planet becomes colorful and reactive. Zonal energy-balance model
(insolation × albedo × greenhouse), wind bands derived from rotation rate,
moisture transport with orographic precipitation (rain shadows must emerge, not be
painted), sea level, ice sheets, carbonate–silicate CO₂ feedback (slow
self-regulation, occasional snowball states). Biomes as a Whittaker-style lookup
from temperature × precipitation, driving the color ramp.
- Risk: coupled feedbacks oscillating or diverging. Lean hard on invariant tests
  (energy balance closes; water mass conserved) and long-run stability tests.
- Done: rain shadows visible behind Phase 1 mountain ranges in PNGs and in the
  render; ice caps advance/retreat over the timeline; a snowball episode is
  reachable with plausible parameters and recovers.

### Phase 4 — Biosphere & planetary story
**Goal:** life as a system with feedback: oceanic abiogenesis → photosynthesis →
oxygenation (atmosphere color shift, ozone) → land colonization → vegetation
altering albedo and weathering. Event log grows into a narrated planetary history
(timeline annotations: "Great Oxidation", "First forests", impacts).
- Done: two different seeds tell visibly different life stories; disabling the
  biosphere measurably changes late-history climate (proving the coupling is real).

### Phase 5 — Presentation polish
**Goal:** the from-space view earns screenshots. Atmospheric scattering rim, cloud
layer (advected noise driven by wind bands), specular ocean, night-side handling,
moon and optional ring system rendering, star color from stellar class, camera
polish. UI/visual design direction comes from Claude Design deliverables (timeline
HUD language, per-epoch palettes) — treat those as the target, build issues around
matching them.
- Done: side-by-side with Phase 4 screenshots is night-and-day; frame budget still
  met while scrubbing.

### Phase 6 — Surface exploration (content package)
**Goal:** click any point at any time, descend to the surface. Quadtree LOD on the
cube-sphere (CDLOD-style), floating origin + log depth, procedural amplification of
sim fields via `hash3(seed, …)`-seeded noise whose *character* is chosen from sim
data (young convergent crust → ridged; ancient shield → rolling). Biome-driven
ground materials; sky from atmosphere state at that epoch.
- Risk: largest phase by far. Plan it as its own multi-milestone arc with an
  explicit spike phase; do not start it until 1–5 are stable.
- Done (first cut): seamless zoom from orbit to ~100 m altitude anywhere, terrain
  consistent with the space view, identical across reloads and machines.

## 4. Your planning task (do this first, before writing code)

1. Create one **milestone per phase** (Phases 1–6) in the repo's tracker. If a
   GitHub remote with issues is configured, use `gh` (milestones + issues +
   labels); otherwise maintain `docs/PLAN.md` with the same structure and keep it
   updated as the single source of truth.
2. Break **Phase 1 into full, ready-to-work issues** (each: motivation, approach
   sketch, files touched, acceptance criteria including which tests/PNG checks
   prove it, size S/M/L). Include the algorithm-prototype spike issues explicitly.
3. Break Phases 2–6 into **coarser placeholder issues** (a title and a paragraph) —
   enough to see the shape, cheap to revise. Do not over-specify future phases;
   they will be re-planned when their turn comes, informed by what earlier phases
   taught us.
4. Add standing labels: `spike`, `kernel`, `renderer`, `ui`, `infra`, `goldens`
   (any issue expected to change golden hashes).
5. Before starting each phase, write `docs/PHASE_N_SPEC.md` (in the spirit of
   `SCAFFOLD_SPEC.md`: milestones + acceptance criteria), present the plan, and
   pause for the human's sign-off before implementation.

## 5. Working agreements (carried over, plus planning-mode additions)

- `CLAUDE.md` hard rules are non-negotiable; determinism above all.
- Reality over plans: when a phase's assumptions prove wrong, update the plan and
  say so in the phase report — never bend results to match the spec.
- End every phase with `PHASE_N_REPORT.md`: what was built, deviations, surprises,
  and what it implies for the next phase's plan.
- Keep the kernel test suite fast and the PNG harness first-class; they are your
  eyes. When judging visual output (continents, rain shadows, clouds), actually
  look — numbers alone are not acceptance.
- Ask the human when a decision is genuinely taste-bound (visual direction,
  parameter feel, scope trade-offs); decide yourself when it's an engineering
  detail covered by the invariants.
