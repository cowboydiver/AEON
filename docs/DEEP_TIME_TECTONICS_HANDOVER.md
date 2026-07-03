# DEEP_TIME_TECTONICS_HANDOVER.md — the whole-sphere supercontinent problem

**Audience:** a fresh session (Fable) diving into the AEON kernel's deep-time
tectonics with no memory of prior sessions. This is an **open-ended physics /
algorithm investigation**, not a spec-driven feature — closer to research than to
ticket-work. Everything you need is in the repo. This file is the map and the
honest state of what's known.

**The one-sentence problem:** by deep time (~1.5 Gyr in) one plate grows to own
the **entire sphere**, and a whole-sphere plate cannot meaningfully break up — so
the back two-thirds of the 4.5 Gyr timeline is a static or merely-reshuffling
supercontinent, when it should show continents **drifting apart across an ocean**.
Phase 2's whole premise is "scrub 4.5 Gyr with continents *visibly drifting*."
The renderer can now show it; the kernel doesn't yet produce it.

> ⚠️ **This is a known rabbit hole.** Phase 1's land-budget tuning and Phase 2's
> dispersal-cooldown pass both timeboxed out here. Treat it as a research dive
> with a stop valve, not a task with a definite finish. The prior sessions
> extracted the *safe, bounded* wins and deliberately stopped at the physics wall
> described below. Your job is to get past the wall — or to prove what it would
> cost and report back.

---

## 1. Read these first (in order)

1. `CLAUDE.md` — hard rules. **Determinism is sacred**; kernel is pure and
   zero-dep; fields are typed arrays; `Math.random`/`Date.now`/`performance.now`
   are ESLint-banned in `sim-kernel/src`; goldens change **only** for a deliberate
   physical reason and **bump `KERNEL_BEHAVIOR_VERSION`** in the same commit.
2. **`docs/PHASE_2_STAGE0_FINDINGS.md`** — the primary input. The full
   measurement story: the freeze, the #57 fix, the dispersal-cooldown tradeoff
   table, and the "Root blocker (deeper than a tuning constant)" section. Read it
   twice; this handover summarizes it but the findings doc has the numbers.
3. `docs/ARCHITECTURE.md` — the field schema, grid indexing, and the Wilson-cycle
   / plate-record contract (incl. `sutureLockUntilYears`).
4. The three kernel files below.

## 2. The state of play — what's already been tried

Two **separable** deep-time defects were found and partly addressed. Do not
conflate them; they have different fixes.

### Defect 1 — whole-sphere-plate breakup (the headline; candidate issue #59)

- **Symptom (pre-fix):** seeds 42 & 1 went **tectonically dead** by ~1.5 Gyr —
  `plateId` frozen bit-for-bit, no rifts/sutures, no boundary stress, for the last
  ~3 Gyr. Only erosion still ran.
- **#57 fix (shipped):** the `riftPlate` rift-pole came from
  `cross3(centroidA, centroidB)`; when a plate covers the whole sphere every
  bisection is two **antipodal** hemispheres, so that cross product vanishes and
  the rift was skipped *every step forever*. Fixed with a deterministic fallback
  pole (`perpendicular3(centroidA)`) when `poleMag < 1e-9`. This **un-froze** the
  world — seeds 42/1 now rift & suture across deep time (last event 3766/4461 Myr,
  was 1510/1476). No golden regen needed (bug only manifests ~1.5 Gyr in; the
  10-step goldens are byte-identical). See `wilson.ts` `riftPlate` ~L335–397.
- **Dispersal-cooldown pass (shipped, bounded):** even un-frozen, each rift
  **re-sutured ~16 Myr later** because the two hemisphere-halves share an in-plane
  rotation pole, so ~half their new boundary is convergent and they re-collide.
  Added a **post-rift suture lock** (`sutureLockUntilYears`, per plate;
  `RIFT_SUTURE_COOLDOWN_YEARS = 30e6`): a rift child can't accumulate suture
  contact until the lock lifts. **30 Myr is the measured knee** — the longest lock
  with *zero* land regression (see the tradeoff table below). It tripled the
  dispersed window (~16 → ~45 Myr) but the deep-time world is **still
  supercontinent-dominated**: one plate owns ~100% of cells from ~1.2 Gyr on.

- **The root blocker (this is the real problem, and it is not a tuning constant):**
  splitting a whole-sphere plate *necessarily* yields two **antipodal hemisphere
  plates**. They are already maximally separated on the sphere, so they cannot
  "drift apart" — they **shear about the shared pole and re-suture**. Real
  supercontinents (Pangaea) sit inside a **superocean** and fragment into pieces
  that **translate across it**. Ours has no ocean to disperse into because one
  plate owns the whole surface. **Plate ≠ land**: land is ~20%, but a single
  *plate* owns ~100% of cells.

  The findings doc names three candidate directions — none is a one-liner:
  - **(a) Rift kinematics that carve a *smaller* fragment** with a genuinely
    separating pole, instead of a 50/50 antipodal hemisphere split. A small
    fragment on a translating pole can sail across the surface.
  - **(b) Stop continent–continent grinding** so buoyant crust *thickens* instead
    of being consumed (see Defect 2 / `#16` below) — which would also let a much
    longer cooldown run without bleeding land.
  - **(c) Cap how much of the sphere one plate may own** — a mechanism that
    prevents the whole-sphere monopoly forming in the first place.

### Defect 2 — land-bleed on the canary seed (candidate issue #58)

- **Symptom:** seed **1337** stays *alive* but slides to **7.5% land at 4.5 Gyr**,
  under the `#20` invariant's **10% floor** (which only tested to 2 Gyr, so it
  never caught this). Gradual, not a cliff.
- **Cause:** because 1337 stays alive, ongoing continent–continent collisions keep
  **consuming continental area** — in `tectonics.ts`, a convergent overlap is an
  ownership transfer where *"the subducting side's crust is consumed"* (`#16`,
  ~L146–151). The arc-maturation **creation** term
  (`ARC_MATURATION_ELEVATION_M = -200`) doesn't fully replace it over 4.5 Gyr at
  N=64. This is a **creation-vs-consumption balance** tuning problem, independent
  of Defect 1. Fixing the rift bug revived 42/1 but does **not** lift 1337 back
  over 10%.
- Note the entanglement: direction (b) for Defect 1 (stop grinding) would also
  *help* Defect 2. They may share a fix, but they are distinct defects — verify
  each on its own metric.

### The measured cooldown tradeoff (why "just raise the cooldown" fails)

Min land fraction over the `#20` 2 Gyr N=16 invariant run (floor = 10%):

| cooldown | seed 42 min | seed 1 min | seed 1337 min | verdict |
|----------|-------------|------------|---------------|---------|
| 0 (base) | 31.9% | 27.1% | 28.5% | baseline; re-sutures ~16 Myr |
| **30 Myr** | **31.9%** | **32.7%** | **28.6%** | **no bleed; shipped** |
| 50 Myr   | 31.9% | 22.5% | 16.3% | 1337 bleeding |
| 100 Myr  | 14.9% | 32.0% | **8.3%** | **breaks 10% floor** |

Longer locks give more dispersal time but bleed land, because while a boundary
can't suture it grinds continent-on-continent. **This is the wall.** You cannot
buy dispersal with a bigger cooldown; you have to remove the grinding or change
the kinematics.

## 3. The code you'll be working in

- **`packages/sim-kernel/src/systems/wilson.ts`** — Wilson cycles. `applyWilson`
  does the per-step contact scan (continent–continent convergent boundary cells
  per plate pair), sutures the first pair in contact ≥ `SUTURE_AFTER_YEARS`, and
  rifts the first eligible plate whose deterministic hash draw fires.
  **`riftPlate`** (exported for unit tests) is the two-seed jittered Dijkstra split
  and the divergence kinematics — **this is where fragment shape and separation
  pole are decided** (candidate direction (a)/(c) live here). The `locked()` /
  `sutureLockUntilYears` machinery is the cooldown.
- **`packages/sim-kernel/src/systems/tectonics.ts`** — advection + convergence
  resolution. **`#16` continent consumption** (~L146–151) is where colliding
  continental crust is consumed; **`ARC_MATURATION_ELEVATION_M`** is the creation
  side. Defect 2 and direction (b) live here.
- **`packages/sim-kernel/src/constants.ts`** — the knobs, each with a source
  comment: `SUTURE_AFTER_YEARS = 15e6`, `RIFT_SUTURE_COOLDOWN_YEARS = 30e6`,
  `RIFT_MIN_AGE_YEARS = 150e6`, `RIFT_PROBABILITY_PER_MYR = 0.006`,
  `MIN_PLATES = 4`, `MAX_PLATES = 16`, `ARC_MATURATION_ELEVATION_M = -200`,
  `KERNEL_BEHAVIOR_VERSION = 1`.
- **`packages/sim-kernel/src/plates.ts`** — `PlateRecord` (eulerPole,
  angularVelRadPerYr, continentalFraction, alive, createdAtYears,
  sutureLockUntilYears). Dead plate slots are **never reclaimed** — `plateId`
  values are stable across all of history (Phase 2 keyframes depend on this; don't
  "optimize" it away).

## 4. How to measure (look at the pictures — numbers hide this)

Land fraction alone **hid** tectonic death for a whole phase, because a *frozen*
world doesn't change its land fraction. The `plateId` field and the event log are
where the truth is. Reproduce (existing tooling, ~1 min for the batch):

```
pnpm sim -- --seed 42   --until 4.5e9          --report --dump elevation,plateId,crustAge --dump-every 25 --out tmp/dt-s42
pnpm sim -- --seed 1    --until 4.5e9 --grid-n 64 --report --dump elevation,plateId --dump-every 45 --out tmp/dt-s1
pnpm sim -- --seed 1337 --until 4.5e9 --grid-n 64 --report --dump elevation,plateId --dump-every 45 --out tmp/dt-s1337
```

(Grids match acceptance: seed 42 at N=128, seeds 1/1337 at N=64. `--out` resolves
against repo root via `INIT_CWD`.) **Then actually open the PNG flipbook** — a
`plateId` sequence that collapses to one uniform color is the failure; continents
*translating* across the elevation frames is the win. Curated reference evidence
from prior passes is in `docs/phase2-evidence/stage0/`.

**Metrics that actually discriminate** (build/borrow a small analysis if useful):
- **Max single-plate area fraction over time** — the whole-sphere-monopoly
  detector. Today it pins at ~100% from ~1.2 Gyr. Success drives it durably down.
- **Dispersed-window fraction** — % of keyframes with max plate area < ~60%.
  Today ~22–29%, clustered in the first ~1 Gyr. Success spreads it across all
  4.5 Gyr.
- **Event count + last-event time** per seed (liveness).
- **Land fraction *trajectory*** (not just the endpoint) against the [10%, 60%]
  band, all three seeds.

## 5. What "success" looks like (and the guardrails)

**Success:** continents **visibly drift apart across an ocean** through the
*whole* 4.5 Gyr on the acceptance seeds — bold Pangaea-style dispersal, not
crack-and-reshuffle — while **all three seeds stay inside the [10%, 60%] land
band** for the full span, and the herringbone/speckle artifacts (findings §0b)
don't get worse. Partial but real progress (e.g. max-plate-area durably below
~70%, dispersed windows in every Gyr) is worth reporting even if not the full
Pangaea.

**Guardrails (non-negotiable):**
- **Determinism.** Same seed + params ⇒ bit-identical history, forever. All
  randomness through `rng.ts` / `hash.ts`. No `Math.random`/`Date.now`. No
  iteration over non-deterministic key order (the contact scan already sorts keys
  — keep that discipline).
- **Any golden-changing tuning is deliberate:** explain the *physical* reason in
  the commit, **bump `KERNEL_BEHAVIOR_VERSION`**, and regenerate goldens with
  `pnpm -F sim-kernel test -- -u`. Never regenerate to silence a test you don't
  understand. (The `KERNEL_BEHAVIOR_VERSION` bump also invalidates the Phase 2
  IndexedDB history cache automatically — intended.)
- **Invariants must still hold:** crust area = sphere area; the `#20`
  land-in-band invariant (extend it to 4.5 Gyr as part of this work — the fact
  that it only tested to 2 Gyr is *why* Defect 2 slipped through); directional
  sanity (converging plates raise boundary elevation). Add new invariant tests for
  whatever mechanism you introduce (e.g. "no single plate owns > X% for > Y Myr").
- **Kernel purity / typed-array fields / shared grid** all still apply. A grid-math
  change is a breaking change (update `ARCHITECTURE.md`, regenerate goldens
  loudly).

**Verification loop:** `pnpm -F sim-kernel test` after any kernel change (must
stay < 30 s), **then** the sim harness with `--report` and `--dump` and *inspect
the PNGs*. Numbers passing while the flipbook shows static noise is a failure.

## 6. Why this is a Fable dive, and how to scope it

This is genuinely open-ended: it's plate-tectonics *modeling*, not bug-fixing.
The three candidate directions (smaller-fragment kinematics, stop-grinding /
crust-thickening, plate-area cap) are design choices with different physical
character and different blast radii on the goldens and the land budget. Expect to:
prototype a mechanism behind a constant, measure the four metrics above across all
three seeds, look at flipbooks, and iterate — with the explicit understanding that
you may find the honest answer is "direction X costs Y and here's the tradeoff,"
which is a perfectly good deliverable.

**Suggested entry point:** direction (c) or (a) first — capping/monopoly-breaking
or smaller-fragment rifts attack the root ("one plate owns the sphere") most
directly, and `riftPlate` is a contained, unit-testable function. Direction (b)
(consumption/creation rebalance in `tectonics.ts`) is the fix for Defect 2 and a
force-multiplier for (a), but it's the most golden-invasive — do it deliberately.

**Stop valve:** if you're several prototypes deep and every path either breaks the
land band or the goldens without clear net progress, **stop and write up the
tradeoff** (what you tried, the metrics, the wall you hit) rather than grinding. A
well-characterized "here's what real dispersal costs" is the win the prior
timeboxes were reaching for.

## 7. Bookkeeping

Candidate issues to file/track (the GitHub tracker sync for Phase 2 is a deferred
task — check whether **#58** land-bleed and **#59** whole-sphere-plate breakup
already exist before creating them). Land your work on its own branch with small,
single-purpose commits; imperative subject; the *physical* behavior change and the
measured evidence in the body. Update `docs/ARCHITECTURE.md` (Wilson section)
and `docs/PHASE_2_STAGE0_FINDINGS.md` (append a results section) in the same
commits as the contract/behavior changes. Ask the human for the taste/scope calls
(how bold is "bold drift"; is a plate-area cap physically acceptable; how much
golden churn is worth it); decide the modeling details yourself within the
invariants.
