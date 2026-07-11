# LABELS.md — Issue label taxonomy

The tracker organizes work along two axes: **native GitHub milestones** (one
per phase, see [`PLAN.md`](PLAN.md)) and **labels**. This file is the single
source of truth for what each label *means*. The one-line descriptions here are
also applied to the labels on GitHub by the `Sync standing labels` step in
[`.github/workflows/tracker-sync.yml`](../.github/workflows/tracker-sync.yml) —
edit this file and that step together, then re-dispatch the workflow.

Labels come in two groups: **type labels** (what kind of work an issue is) and
**phase labels** (which phase it belongs to). An issue usually carries one or
more type labels plus exactly one `phase-N`.

## Type labels

| Label | Meaning | Scope |
|-------|---------|-------|
| `spike` | Time-boxed research/prototype to de-risk a decision before committing to an approach. Ends with a written finding, not shipped behavior. | any |
| `kernel` | Changes the deterministic simulation. | `packages/sim-kernel` |
| `renderer` | Changes the Three.js/WebGPU (TSL) materials, meshes, and keyframe blending. | `packages/planet-renderer` |
| `ui` | Changes the timeline UI, React/R3F app, and worker host. | `apps/web` |
| `infra` | Tooling, harness, measurement, planning, and phase-acceptance/report work — the connective tissue that makes the simulator buildable, testable, and shippable, as opposed to a sim/renderer/UI feature. | `packages/sim-cli`, CI, `docs/`, acceptance issues |
| `goldens` | Flags that the change will move the golden determinism hashes. | `packages/sim-kernel` output |

### `goldens` in detail

The project's spine is the **golden determinism tests**: FNV-1a hashes of every
field at fixed checkpoints for seeds {1, 42, 1337} (`CLAUDE.md`,
`packages/sim-kernel/test/golden.test.ts`). Any change to *simulation output* —
a new field, a new or altered system, or retuned constants that affect the sim
— invalidates those hashes. The rule (`CLAUDE.md` → "Verification workflow") is
that you regenerate them **deliberately** (`pnpm -F sim-kernel test -- -u`),
explain the physical/algorithmic reason in the commit message, and usually bump
`KERNEL_BEHAVIOR_VERSION` (which also busts the IndexedDB keyframe cache, #24).

`goldens` is therefore a heads-up to author and reviewer — "expect golden-hash
churn here, and justify it" — not merely a synonym for `kernel`. Kernel work
that does not change deterministic output omits it (e.g. #38 consumes kernel
state in the renderer; #83 is an explicitly read-only view — neither carries
`goldens`). It is not mutually exclusive with `infra`: a phase-acceptance issue
that also does the final deliberate golden regeneration carries both (e.g. #21).

### `infra` in detail

`infra` marks the plumbing and process work rather than the product features
themselves. In this repo it has covered:

- **Phase-acceptance gates + reports** — #21, #29, #36, #41, #47 (each is
  "Phase N acceptance … + `PHASE_N_REPORT.md`").
- **Phase planning** — e.g. #48 (plan the Phase 6 arc, write its spec).
- **Tooling / harness / measurement** — #11 (CLI PNG-dump harness), #23 (worker
  streaming protocol), #24 (IndexedDB keyframe cache), #27 (memory-budget
  measurement).

## Phase labels

Every issue additionally carries one `phase-N` label matching its milestone.
These mirror the roadmap in [`PLAN.md`](PLAN.md); the milestone is the native
grouping and the label is the quick filter.

| Label | Phase |
|-------|-------|
| `phase-1` | Tectonics |
| `phase-2` | Timeline scrubbing |
| `phase-3` | Climate, hydrology, biomes |
| `phase-4` | Biosphere & planetary story |
| `phase-5` | Presentation polish |
| `phase-6` | Surface exploration |

## Applying label descriptions

The descriptions are reconciled onto GitHub by dispatching `tracker-sync.yml`
(Actions tab → tracker-sync → Run workflow). The step is idempotent: it creates
a missing standing label and updates an out-of-date description, leaving an
existing label's color untouched.

As a one-off, the same can be done with the `gh` CLI, e.g.:

```bash
gh label edit goldens --repo cowboydiver/aeon \
  --description "Touches deterministic kernel output — expect a deliberate golden-hash regeneration"
```
