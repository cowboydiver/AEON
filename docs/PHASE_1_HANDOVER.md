# PHASE_1_HANDOVER.md — Implementation brief for Phase 1 (Tectonics)

**Audience:** a fresh Claude session taking over as Phase 1 implementer, with
no memory of prior sessions. Everything you need is in the repo and the
GitHub tracker; this file is the map.

**Precondition:** `docs/PHASE_1_SPEC.md` has been signed off by the human.
If the human hands you this file, treat the spec as approved as committed —
but if the spec and this brief ever disagree, the spec wins, and if the spec
and reality disagree, reality wins (report it, don't paper over it).

---

## 1. Read these, in this order, before writing any code

1. `CLAUDE.md` — hard rules. Determinism is sacred; kernel systems are pure;
   fields are typed arrays; the grid is shared truth; no `any`. Non-negotiable.
2. `docs/ARCHITECTURE.md` — the Phase 0 contract you are extending: grid
   mapping and flat index scheme, field schema, state/params/system shapes,
   keyframe format, determinism contract (what is golden-hashed and when
   regeneration is allowed).
3. `docs/PHASE_1_SPEC.md` — the signed-off plan: milestones, ordering,
   acceptance criteria, contract changes, and the decisions already made
   (derived boundary type, conservative erosion, visual-only transforms,
   fixed plate speeds, CLI-only acceptance). Do not relitigate those.
4. `PHASE0_REPORT.md` — deviations and environment traps that will bite you
   (summarized in §5 below).
5. The GitHub issues, as you reach them: #9–#21 under milestone
   "Phase 1 — Tectonics" (overview issue #3). Each carries motivation,
   approach sketch, files touched, and acceptance criteria at working depth —
   the spec deliberately does not duplicate that detail.

## 2. What exists (Phase 0, complete and green)

pnpm monorepo, strict TS, ESM, Node ≥ 22:

- `packages/sim-kernel` — pure, zero-runtime-dep kernel: `rng.ts` (sfc32 with
  label-derived `fork`), `hash.ts` (murmur3-style `hash2`/`hash3`, FNV-1a),
  `grid.ts` (tangent-adjusted cube-sphere, seam-aware `neighbors()`,
  `directionToIndex`), `fields.ts` (`FIELDS` const — single source of field
  truth), `state.ts`, `step.ts` (`step`/`run`, keyframes), `noise.ts`,
  `constants.ts`, one real init pass (`systems/initialTerrain.ts`) and an
  `identity` pipeline system. 43 tests in ~2 s including golden FNV-1a
  snapshots for seeds {1, 42, 1337}.
- `packages/sim-cli` — headless harness: `--seed/--until/--keyframe-interval/
  --grid-n/--report/--dump/--out`, equirectangular PNGs, NaN tripwire.
  **This is your primary acceptance instrument for the whole phase.**
- `packages/planet-renderer` + `apps/web` — WebGPU planet in the browser.
  **You should not need to touch either in Phase 1** (spec decision #6).
- Tracker: issues #3–#52, milestones 1–6, native blocked-by dependencies,
  labels `spike/kernel/renderer/ui/infra/goldens` + `phase-N`. `docs/PLAN.md`
  mirrors the roadmap. `.github/workflows/tracker-sync.yml` reapplies
  milestones/dependencies if the plan is restructured.

## 3. The work, in one paragraph

Six milestones, strictly gated at the front: **spikes first** (#9 plate-seeding
flood fill, #10 crust-advection candidate shootout, #11 PNG-harness upgrades
for flipbooks/palettes), and **nothing integrates into the kernel until #10
has a written winner** with metrics and flipbook evidence on the issue. Then
plates enter the state (#12 plateId + plate table, #17 event log), motion
lands (#13 Euler-pole advection using the #10 winner), boundary physics in
order (#14 classification/stress → #15 spreading/crust-age/bathymetry → #16
subduction/orogeny), deep time (#18 Wilson cycles, #19 erosion with the
latitude precipitation proxy), and finally the phase-level invariant suite
(#20) and the acceptance pass + `PHASE_1_REPORT.md` (#21). Dependency sketch:
#9→#12; #10→#13; #11, #17 any time (do #11 first — every eyeball check uses
it); #13→#14→#15→#16→{#18,#19}→#20→#21; #18 also needs #17.

## 4. Working process

- **One issue at a time, in dependency order.** Read the issue, do the work,
  meet its acceptance criteria, close it with evidence (PNGs/flipbooks
  attached where the issue demands them — spike issues #9/#10 *require*
  findings written on the issue).
- **Verification loop after any kernel change:** `pnpm -F sim-kernel test`,
  then `pnpm sim -- --seed 42 --until <horizon> --report --dump <fields> --out tmp/`
  and **look at the PNGs**. Numbers passing while the map looks like static
  noise is a failure. Commands reference: `CLAUDE.md`.
- **Goldens:** #12–#16, #18, #19 (and possibly #21) each regenerate golden
  hashes deliberately via `pnpm -F sim-kernel test -- -u`, with the physical
  reason in the commit message. Never regenerate to silence a test you don't
  understand. No golden change may ride along in #11, #17, or #20.
- **Docs in the same commit:** every new field, state member, param, or
  system updates `docs/ARCHITECTURE.md` atomically with the code.
- **Commits:** small, single-purpose, imperative subject; body states what
  physical behavior changed and how it was verified.
- **Budget guard:** kernel suite stays < 30 s. Long-run tests use small grid
  N; if 2 Gyr coverage can't fit, put it behind a slower tag and document
  that in #20.
- **Ask the human** only for genuinely taste-bound calls (does this look like
  a planet? scope trade-offs); decide engineering details yourself within the
  invariants. If a spec assumption proves wrong, update the plan visibly —
  in the issue, and ultimately in `PHASE_1_REPORT.md` — never bend results
  to match the spec.
- **End of phase:** write `PHASE_1_REPORT.md` (what was built, deviations,
  surprises, implications for Phase 2 — especially keyframe memory footprint
  now that fields are non-trivial, and event-log behavior). Phase 2 gets
  re-planned from it; don't start Phase 2 work.

## 5. Environment traps (learned the hard way in Phase 0)

- **`three` is pinned to 0.184.0** — 0.185 passes a `swizzle` view descriptor
  Chromium ≤ 142 rejects (black canvas). Don't bump it casually. Likewise
  `@playwright/test` is pinned to 1.56.1 to match the preinstalled Chromium.
- **e2e needs Xvfb** (`apps/web/scripts/run-e2e.mjs` handles it) — plain
  headless Chromium loses the WebGPU device on canvas present. You likely
  won't run e2e in Phase 1 at all (renderer untouched), but don't "fix" this.
- **`pnpm sim -- --out tmp/` resolves against `INIT_CWD`** — output lands at
  the repo root, not inside `packages/sim-cli`.
- **JS transcendentals are the one determinism soft spot** (documented in
  ARCHITECTURE.md): all targets are V8 today, goldens are stable; don't add
  new reliance on exotic math functions in hot deterministic paths without
  noting it.
- **Kernel purity is typecheck-enforced** — `sim-kernel`'s tsconfig has
  `"types": []`, so Node/DOM API usage fails the build; ESLint bans
  `Math.random`/`Date.now`/`performance.now` in `sim-kernel/src`.
- Kernel init at N = 128 costs ~0.2 s — cheap; but 2 Gyr at 1 Myr steps is
  2000 steps, so profile advection early (a #10 evaluation metric).

## 6. Definition of done (the bar you are driving at)

Seed 42 over 2 Gyr shows recognizable continental cycles — assembly and
breakup — in dumped PNG flipbooks, inspected by eye, with evidence on #21;
crust covers the sphere after every step; hypsometry is bimodal; long runs
are stable; goldens updated deliberately with reasons; kernel suite < 30 s;
lint and typecheck clean; ARCHITECTURE.md current; `PHASE_1_REPORT.md`
committed. Milestone 1 closes with overview issue #3.

If, at #21, the continents look like soup: **reality wins.** File the fix-up
issues, hold the phase open, and say so in the report.
