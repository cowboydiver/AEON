# PHASE_2 Stage 0 findings — de-risking measurements

Stage 0 of `docs/PHASE_2_OPUS_PLAN.md`: measurement-only runs on the existing
`sim-cli`, no new code paths. Their job is to feed `docs/PHASE_2_SPEC.md` and,
per the plan, to catch a go/no-go before any Phase 2 feature work.

**Headline: the 4.5 Gyr runs surface a deep-time problem that Phase 1's 2 Gyr
acceptance never reached. Two of three acceptance seeds go tectonically dead by
~1.5 Gyr; the third grinds below the 10% land floor. This is the plan's
"world degenerates late / land collapses → stop and tell the human" case.**
No Phase 2 planning is blocked by writing this down, but the phase's premise —
"scrub 4.5 Gyr with continents *visibly drifting*" — is not currently met by
the kernel for the back two-thirds of the timeline.

Reproduce (existing tooling, ~1 min total on a fast box):

```
pnpm sim -- --seed 42   --until 4.5e9 --report --dump elevation,plateId,crustAge --dump-every 25 --out tmp/p2-s42
pnpm sim -- --seed 1    --until 4.5e9 --grid-n 64 --report --dump elevation,plateId --dump-every 45 --out tmp/p2-s1
pnpm sim -- --seed 1337 --until 4.5e9 --grid-n 64 --report --dump elevation,plateId --dump-every 45 --out tmp/p2-s1337
```

Grids match Phase 1 acceptance: seed 42 at N=128, seeds 1/1337 at N=64.
Curated evidence PNGs live in `docs/phase2-evidence/stage0/`.

---

## 0a. Land budget at 4.5 Gyr (#54 pt 2)

| Seed | Grid | Land @2 Gyr (Phase 1) | Land @4.5 Gyr | In 10–60% band? |
|------|------|-----------------------|---------------|-----------------|
| 42   | 128  | 21.8%                 | **24.4%**     | ✓               |
| 1    | 64   | ~20%                  | **20.4%**     | ✓               |
| 1337 | 64   | ~11% (the canary)     | **7.5%**      | ✗ (< 10% floor) |

Seed 1337's decline is gradual, not a cliff: ~26% (0.4 Gyr) → 12% (0.9 Gyr) →
hovers 10–11% (1.3–2.8 Gyr) → sags to 8.4% (3.3 Gyr) → **7.5% (4.5 Gyr)**. The
`#20` stability invariant asserts land ∈ [10%, 60%] but only exercises it to
2 Gyr; at 4.5 Gyr seed 1337 would fail it. So on the narrow land-budget metric
the verdict is **mixed** — two seeds fine, the canary breaches the floor in the
back third.

## The bigger finding: tectonic death (not in the plan's checklist, but decisive)

Land fraction alone hid this because a *frozen* world doesn't change its land
fraction. The event log and the `plateId` field tell the real story:

| Seed | Total events | Last event | plateId in the back half |
|------|--------------|-----------|--------------------------|
| 42   | 18 (6 rift / 12 suture)  | **1510 Myr** | collapses to a **single plate** (whole sphere = plate 0), FNV hash *exactly* constant 1.6→4.5 Gyr |
| 1    | 18 (6 / 12)              | **1476 Myr** | frozen multi-plate config, hash constant ~1.6→4.5 Gyr |
| 1337 | 32 (13 / 19)             | 4018 Myr     | **stays active** to ~4 Gyr, but only ~2 plates and land grinds < 10% |

For seeds 42 and 1, **no tectonic events fire for the last ~3 Gyr — two-thirds
of the 4.5 Gyr timeline — and `plateId` is bit-for-bit unchanging.** No
rifting, no suturing, no boundary stress (the `boundaryStress` field hashes to
the all-zero value), and no crust advection changing ownership. The only system
still doing anything is erosion, slowly softening the frozen relief.

### What the flipbooks show (seed 42, N=128 — the acceptance seed)

`plateId`, the tectonic engine:

- `s42-plateId-0000Myr.png` — 10 crisp contiguous plates (healthy t=0 partition).
- `s42-plateId-0750Myr.png` — already down to ~2 plates; the front-loaded suture
  burst has run. Herringbone shredding visible along the convergent margin.
- `s42-plateId-1500Myr.png` — 2 plates (red/green), one about to absorb the other.
- `s42-plateId-4500Myr.png` — **one uniform color. A single plate covering the
  whole planet.** This is the last ~3 Gyr of the timeline.

`elevation`, what the renderer shows:

- `s42-elevation-0000Myr.png` — crisp continents, mountain belts, clean hypsometry.
- `s42-elevation-1500Myr.png` — continents have drifted/coalesced; still reads as
  continents (this is roughly the last frame with real motion).
- `s42-elevation-4500Myr.png` — continents *are still there* (24% land, bimodal),
  but static: 3 Gyr of erosion-only, plus scattered **stranded single-cell peaks
  ("white speckle") in the ocean**.

So the narrow question "do continents still look like continents at 4.5 Gyr?"
is **yes** — but "do they visibly drift across the timeline?" is **no for the
back two-thirds** on 2 of 3 seeds.

### Root cause (confirmed by code read — `wilson.ts` `riftPlate`)

This is **a specific bug, not a tuning problem.** The rift split picks two seed
cells (min-hash cell `seedA` and the plate cell farthest from it, `seedB`),
grows two half-plates by Dijkstra, and rotates the halves apart about a pole
built from their centroids:

```
const rawPole = cross3(normalize3(centroidA), normalize3(centroidB));
const poleMag  = |rawPole|;
if (poleMag < 1e-9) return state;   // wilson.ts ~L325-327 — skip the rift
```

That guard was added in PR #55 for the *rare* near-antipodal degenerate (a
vanishing cross product would give a NaN pole). But **when one plate covers the
whole sphere, every bisection is two hemispheres, and hemisphere centroids are
always near-antipodal** (`seedB` is chosen as the most distant cell from
`seedA`, i.e. its antipode). So `centroidA ≈ −centroidB`, the cross product
collapses, and the rift is skipped — *every step, forever*. The supercontinent
becomes a **one-way ratchet with no possible breakup.**

The event trace matches exactly: plate 0 rifts successfully at 538 and 1226 Myr
(when it is *not* the whole sphere — the halves are not antipodal), but the
instant it absorbs the last remaining plate (~1510 Myr) and becomes
sphere-spanning, the antipodal guard trips on every subsequent draw and
`plateId` freezes bit-for-bit. Seed 1337 never fully merges (stays ~2 plates),
so its rift splits are never whole-sphere-antipodal — which is precisely why it
stays tectonically alive to ~4 Gyr.

**The fix is small and localized** (~a handful of lines in `riftPlate`): when
`poleMag` is tiny, fall back to a deterministic valid pole (any axis
perpendicular to the `seedA`/`seedB` separation opens the rift) instead of
`return state`. It is **golden-changing** (it revives deep-time tectonics for
every seed), so it is out of scope for a Stage 0 measurement pass and out of
scope for "no implementation before sign-off" — flagged here for the human's
decision. It is `#54`-adjacent but far cheaper than the broad retune the plan
anticipated.

### A second, distinct deep-time issue (tuning, not a bug)

Seed 1337's slide to 7.5% land is separate: it stays *alive*, so ongoing
continent–continent collisions keep consuming continental area, and the
arc-maturation creation term (`ARC_MATURATION_ELEVATION_M`) doesn't fully
replace it over 4.5 Gyr at N=64. That is genuine tuning territory (`#54`:
arc-creation vs collision-consumption balance) and is *independent* of the rift
bug above — fixing the rift bug revives 42/1 but would not by itself lift 1337
back over 10%. Both belong in a deep-time kernel pass; they are different
defects with different fixes.

## 0b. Margin herringbone + speckle (#54 pt 1)

The herringbone shredding is **present and visible** on the equirectangular
dumps at active convergent margins (clearest in `s42-plateId-0750Myr.png` and
the left margin of `s42-plateId-1500Myr.png`) — feathered diagonal
plate/ocean stripes from quantized advection alternately opening young ocean
and re-maturing arcs. It is localized (not soup) and the equirectangular
projection exaggerates it at high latitude; a 3D globe will show it less.

A related, arguably worse deep-time artifact is the **stranded single-cell
peaks** littering the ocean by 4.5 Gyr — most extreme in
`s1337-elevation-4500Myr.png`, where the low-land canary at N=64 reads as
speckle rather than clean continents. These are isolated high cells left behind
by advection/arc maturation with no neighbors to erode against them.

**Recommendation carried into the spec (unchanged from the plan):** defer the
herringbone kernel fix to a follow-up unless it's prominent on the *globe*; it's
golden-changing with tuning risk and Phase 2's value doesn't hinge on it. But
note the speckle is entangled with the tectonic-death / land-budget issues
above, which may warrant a combined deep-time kernel pass regardless.

## #57 fix — verification (re-run after the antipodal-pole fix)

The `riftPlate` fix (deterministic fallback pole when the half-centroids are
antipodal) was implemented and the 4.5 Gyr runs repeated. It **eliminates the
hard freeze** and needs **no golden regeneration** — the standard goldens hash
the first 10 steps, and the bug only manifests when a whole-sphere plate forms
(~1.5 Gyr in), so the 10-step goldens are byte-identical (kernel suite green,
102 tests). Deep-time behavior:

| Seed | Events (was) | Last event (was) | Final land (was) |
|------|--------------|------------------|------------------|
| 42   | **38** (18)  | **3766 Myr** (1510) | 19.1% (24.4%) |
| 1    | **38** (18)  | **4461 Myr** (1476) | 18.0% (20.4%) |
| 1337 | 32 (32)      | 4018 Myr (4018)     | 7.5% (7.5%)   |

So the world is **no longer tectonically dead** — seeds 42/1 now rift and
suture across deep time instead of freezing at ~1.5 Gyr. The rift trace for
seed 42 shows a supercontinent cycle every ~150–250 Myr (rifts at 1627, 1787,
1963, 2114, 2277, 2742, 3031, 3206, 3556, 3750 Myr).

**But a second deep-time issue is now visible that the freeze had hidden:**
each rift **re-sutures ~16 Myr later** (the `SUTURE_AFTER_YEARS = 15 Myr`
threshold), because opposite rotations about the fallback pole leave part of
the two hemispheres' shared boundary convergent, so they re-collide before
dispersing. The every-250-Myr `plateId` snapshots therefore still land on a
single plate almost every time (`fix-s42-elevation-{2500,4500}Myr.png` show a
persistent, slowly-eroding supercontinent, not bold drift). **Net: the freeze
is fixed and the world cycles, but it is supercontinent-dominated — "continents
visibly drifting across the *whole* 4.5 Gyr" is still not met.** Closing that
gap is dispersal tuning (longer suture wait and/or a post-rift suture cooldown
so halves can drift apart before re-merging; possibly cleaner rift kinematics)
— a distinct follow-up from both the #57 bug and the #58 land-bleed, newly
revealed because you cannot see dispersal behavior in a frozen world. Flagged
for the human: do the dispersal tuning now, or proceed to Phase 2 on the
un-frozen-but-supercontinent-dominated sim.

## Dispersal-tuning pass — post-rift suture cooldown (bounded, timeboxed)

Acting on the flagged decision above (human chose: tune dispersal now), I added
a **post-rift suture lock**: a rift stamps both halves with
`sutureLockUntilYears = now + RIFT_SUTURE_COOLDOWN_YEARS` and a locked plate's
convergent contact is not recorded, so the freshly-rifted margin cannot
re-suture until the lock lifts (and then needs a *fresh* `SUTURE_AFTER_YEARS`).
Only rift children are locked; primordial plates (created at t=0) are exempt, so
first-assembly and the golden hashes are unchanged. This mechanism is sound and
lengthens each breakup — but the cooldown *value* runs straight into the
land-budget wall, so it is a **measured tradeoff, not a free win**.

**Why longer is not better.** A rift's two halves share an in-plane rotation
pole, so ~half their new boundary is convergent. While that arc can't suture it
grinds continent-on-continent (the `#16` advection consumes the subducting
continental cell — the very bleed that suturing exists to halt). Longer locks
therefore bleed land. Measured min land fraction over the `#20` 2 Gyr N=16
invariant run (floor = 10%):

| cooldown | seed 42 min | seed 1 min | seed 1337 min | verdict |
|----------|-------------|------------|---------------|---------|
| 0 (base) | 31.9%       | 27.1%      | 28.5%         | baseline; re-sutures ~16 Myr |
| **30 Myr** | **31.9%** | **32.7%**  | **28.6%**     | **no bleed; shipped** |
| 50 Myr   | 31.9%       | 22.5%      | 16.3%         | 1337 bleeding |
| 100 Myr  | 14.9%       | 32.0%      | **8.3%**      | **breaks 10% floor** |

**30 Myr is the knee** — the largest lock with zero land regression. Shipped at
`RIFT_SUTURE_COOLDOWN_YEARS = 30e6`; all 104 kernel tests green (two new
invariant tests: the lock is stamped on both halves, and a rifted half cannot
re-suture within the window), goldens untouched.

**What 30 Myr buys — and what it does not.** It triples the dispersed-window
length (~16 → ~45 Myr, i.e. ~4–5 render keyframes) and keeps the world
tectonically alive to ~4.4 Gyr on all seeds. But a 4.5 Gyr N=64 flipbook (seed
42) shows the deep-time world is **still supercontinent-dominated**: max
single-plate area sits at ~100% from ~1.2 Gyr on, dipping to ~50% only in brief
single-sample rift flickers before re-suturing. Only ~22–29% of keyframes are
"dispersed" (max plate area < 60%), and those cluster in the first ~1 Gyr.
Visually the rift *does* fire (`plateId-003900Myr` splits the sphere into two
hemisphere-plates), but the continents shift only modestly across the window
(`elevation-003850` vs `elevation-004000`) — a crack-and-reshuffle, not bold
"fragments sailing across an ocean."

**Root blocker (deeper than a tuning constant).** By deep time the
supercontinent's *plate* has grown to cover the **whole sphere** (land is ~20%,
but one plate owns ~100% of cells — plate ≠ land). Splitting a whole-sphere
plate necessarily yields two **antipodal** hemisphere-plates: they are already
maximally separated, so they cannot "drift apart" — they shear about the shared
pole and re-suture. Real supercontinents (Pangaea) sit inside a superocean and
fragment into pieces that translate across it; ours has no ocean to disperse
into. Delivering bold sustained drift needs one of: (a) rift kinematics that
carve a *smaller* fragment with a genuinely separating pole (not a 50/50
antipodal hemisphere split); (b) stopping continent–continent grinding so
buoyant crust thickens instead of being consumed, which would let a much longer
cooldown run without bleeding land; and/or (c) a mechanism that caps how much of
the sphere one plate may own. All are `#57`/`#16`-adjacent kernel work, not a
Phase-2 tuning pass — flagged to the human as a distinct follow-up (candidate
`#59`: deep-time dispersal / whole-sphere-plate breakup).

**Net:** the bounded pass extracted the safe win (world alive + reshuffling in
deep time, no land regression) and stopped at the land-budget wall exactly as
scoped. The headline "continents visibly drifting across the *whole* 4.5 Gyr"
is **partially** met — periodic breakups, modest drift — but not the bold
Pangaea-style dispersal, which is now a tracked deeper-fix decision.

## Runtime (streaming UX calibration)

The full 3-seed batch finished in **~1 minute wall-clock** on this box — roughly
**10× faster** than Phase 1's ~120 ms/step estimate (this machine does
~13–18 ms/step at N=128). That number is machine-dependent; the streaming UX
should still budget the slow end (~10 min for a 4.5 Gyr N=128 history on a
mid-range laptop) and the progressive-streaming design stays mandatory. The
profiling headroom flagged in `docs/spikes/PHASE_1_SPIKES.md` (restrict claim
tests to a boundary band) is *not* needed on fast hardware but remains the lever
if generation time bites on slow machines.

## Bottom line for the sign-off

- **Land budget:** two seeds healthy, canary (1337) breaches the 10% floor at
  4.5 Gyr.
- **World liveness:** seeds 42 & 1 freeze (single/static plate) by ~1.5 Gyr and
  show a static planet for the last ~3 Gyr; seed 1337 stays lively but low-land.
- Phase 1's 2 Gyr acceptance sat right at the edge of activity, which is why
  none of this was visible before.
- **Root cause is two separable deep-time defects:** (1) a *small, specific
  bug* — the antipodal rift-pole guard forbids a whole-sphere plate from ever
  rifting, freezing 42/1; (2) a *tuning imbalance* — arc creation lags collision
  consumption over 4.5 Gyr, sinking 1337 below 10% land. Both are
  golden-changing.
- Per the plan this is a **stop-and-decide** point: fixing (1) revives deep-time
  drift for the whole timeline and is cheap; (2) is a separate tuning pass. The
  scope/sequencing decision (fix-first vs. scope-the-timeline vs. accept) is the
  human's; this document is the measurement input to it.

## #59 deep-time dispersal pass — results (fragment rifts + crust conservation)

The "root blocker" section above said bold dispersal needed (a) rift
kinematics that carve a smaller fragment with a genuinely separating pole,
(b) an end to continent–continent grinding, and/or (c) a cap on how much of
the sphere one plate may own. The #59 pass implemented **all three**, plus
the coherence work they exposed. Mechanisms (each with a constants-level
source comment):

1. **Fragment rifts** (`riftPlate` rewrite): a rift carves a contiguous
   continental fragment (hash-drawn 20–40% of the plate, jittered Dijkstra
   from a continental seed) and puts it on an Euler pole perpendicular to
   its own centroid — the rotation that *translates* a cap across the
   sphere. The parent keeps its motion. The travel azimuth is
   **ocean-seeking** (8 hash-phased candidate headings scored by oceanic
   crust beyond the fragment edge): continents rift toward the superocean,
   so the leading edge subducts ocean instead of grinding continent.
2. **Oversize rift pressure**: a plate owning >55% of the sphere skips the
   rift age gate and draws at 8× probability — the monopoly brake.
3. **Suture floor 4 → 2 + consumed-plate retirement** (`plateConsumed`
   event): a world parked at the floor had its collisions barred from
   suturing forever (seed 1 sat there from ~0.25 Gyr, grinding continent
   the whole time), and zombie cell-less plates held the floor "satisfied".
4. **Continental conservation in advection** (direction (b), the
   golden-invasive one): displaced continental crust is bulldozed one cell
   deeper into its own plate — re-rooting on same-plate ocean (area
   conserved; forward first, else lateral — Indochina-style escape) or
   thickening continental ground (half the displaced relief, capped 9 km).
   Covers both the static-displaced and the blocked-mover cases, with
   source-dedup so the non-bijective advection map can't duplicate crust.
5. **Accretionary arc maturation** (above −500 m, only adjacent to existing
   continent, growth raised to 1 mm/yr): at deep-time equilibrium most
   crust has been recycled through the creation term, so continents take
   the *shape* of creation — ungated maturation freckled along herringbone
   trails and dissolved deep-time land into lace.
6. **Ocean relief memory**: the thermal-subsidence hard-set became bounded
   relaxation (200 m/Myr), so a half-built arc survives the margin
   flickering off it (herringbone) and can finish maturing — this is what
   keeps creation effective at fine grids — and dead arcs/trenches decay
   over Myr instead of popping.
7. **Micro-continent foundering**: an isolated continental cell (no
   continental 4-neighbor) is pinned below −200 m (keeps crustal identity,
   Zealandia-style) — stranded collision debris no longer speckles the
   ocean with immortal one-cell peaks.
8. **Rift continental gate 5% → 2% of sphere**: at 5% a low-continent world
   dead-locked (no eligible plate → frozen tectonics → no arc creation →
   permanent death spiral).

`KERNEL_BEHAVIOR_VERSION` 1 → 2; goldens regenerated (arc-maturation gating,
conservation, and subsidence relaxation all reach the 10-step goldens).

### Measured, N=64 unless noted (baseline = pre-#59 main, same metrics script)

| metric | seed 42 base | seed 42 #59 | seed 1 base | seed 1 #59 | seed 1337 base | seed 1337 #59 |
|---|---|---|---|---|---|---|
| dispersed keyframes (max plate <60%) | 22.2% | **68.3%** | 22.0% | **67.4%** | 29.3% | **70.5%** |
| dispersal in EVERY Gyr bucket? | no (first Gyr only) | **yes (55–80%)** | no | **yes (63–73%)** | no | **yes (62–78%)** |
| last tectonic event | 4105 Myr | 4483 | 4119 | 4477 | 4427 | 4474 |
| rift+suture events | 42 | ~200 | 36 | ~200 | 46 | ~190 |
| land min over 4.5 Gyr | 8.6% | **10.4%** | 4.7% | **10.1%** | 8.8% | 8.7% |

Seed 42 at the N=128 acceptance grid: dispersed 70.1%, alive to 4.47 Gyr,
land min 6.6%. At the N=16 invariant grid all three seeds hold the [10,60]
band across the FULL 4.5 Gyr (mins 23–28%), the longest >85%-of-sphere
monopoly window is 60 Myr (was ~3 Gyr), and the #20 invariant is now
extended to 4.5 Gyr with a <400 Myr monopoly-duration assertion.

**Flipbooks** (`plateId`): multi-plate partitions at every epoch; the
4.5 Gyr frame shows a compact fragment sailing inside a larger plate — the
Pangaea-piece topology the phase premise asks for. (`elevation`): coherent
drifting continents through ~1.5–2 Gyr; deep time reads as drifting **ragged
continental clusters** with mountain belts — a live, cycling world, no
confetti, no freeze.

### Honest residuals (tracked, not hidden)

- **Deep-time land at fine grids dips below the 10% floor** (N=128 min
  6.6%, N=64 seed 1337 min 8.7%). The creation/consumption balance is
  resolution-dependent: margins dwell on a cell ∝ 1/N, so arcs mature less
  efficiently at high N. Arc memory (mech. 6) shrank but did not remove the
  trend. The band invariant (defined at N=16) passes to 4.5 Gyr; the
  acceptance-grid dip is the top follow-up candidate — either further
  creation retune or a resolution-aware maturation term.
  **RESOLVED by the creation retune below**: all seeds/grids now hold the
  band (N=128 mins 11.5/10.7, N=64 mins 12.9–17.6).
- **Deep-time continents are ragged clusters, not clean cratons.** The
  churn of ~200 reorganizations reworks continental shapes; conservation +
  accretionary creation keep them cluster-coherent, but "bold clean Pangaea
  pieces at 4 Gyr" would need shape-preserving crust dynamics (e.g. craton
  stiffness / suture-line memory) — out of scope here; filed as
  [#60](https://github.com/cowboydiver/AEON/issues/60) alongside the
  #57/#58 kernel follow-ups.
- Herringbone margin shredding (§0b) is unchanged in kind; arc memory
  visibly softens the stripe contrast (partial arcs no longer snap to
  abyssal depth between advection events).

## Creation retune (#59 follow-up): resolution-consistent arc creation

The first residual above measured out to a single root cause: **arc
creation was written in per-cell terms while the physics is
per-margin-length**, so its efficiency fell with grid resolution in two
independent ways, and the deep-time continental budget equilibrium fell
with it (N=16 healthy, N=128 starved below the floor). Two scalings, one
pivot (`ARC_CREATION_REFERENCE_GRID_N` = 32; both are `max(1, ·)` because
at or below the reference grid growth saturates against the maturation/
ARC_MAX ceilings and the belt is already one cell — coarse grids keep the
measured-healthy #59 tuning):

1. **Arc growth rate ∝ N** (`max(1, N/32)`, plus base 1e-3 → 1.25e-3
   m/yr): the flux is per unit margin length, concentrated on a
   one-cell-wide boundary line whose width — and a migrating margin's
   dwell time on it — shrinks ∝ 1/N. This alone recovered N=128 land
   min 6.6% → 9.5–10.0%, and a further +25% base rate moved it ~0.1
   point: the per-cell climb stopped being the limiter.
2. **Accretionary belt width ∝ N** (`max(1, round(N/32))` cells, ~300 km
   fixed physical width, real accreted-terrane scale): maturation was
   gated on 4-neighbor adjacency to continent, a frontier always one cell
   wide, so matured *area* per unit time went as frontier cells × cell
   area ∝ N·1/N² = 1/N. The belt is a multi-source BFS mask over the
   immutable pre-topography crust field (order-independent, O(cells)).

`KERNEL_BEHAVIOR_VERSION` 2 → 3; N=128 field goldens and (for the base-
rate bump) N=32 codec byte goldens regenerated deliberately.

### Measured (same metrics script; "#59" = pre-retune column above)

| metric | grid | seed 42 #59 | seed 42 retune | seed 1 #59 | seed 1 retune | seed 1337 #59 | seed 1337 retune |
|---|---|---|---|---|---|---|---|
| land min over 4.5 Gyr | N=64 | 10.4% | **12.9%** | 10.1% | **17.6%** | 8.7% | **13.9%** |
| land min over 4.5 Gyr | N=128 | 6.6% | **11.5%** | — | — | 9.5%* | **10.7%** |
| dispersed keyframes | N=64 | 68.3% | 66.3% | 67.4% | 67.8% | 70.5% | 72.1% |
| dispersed keyframes | N=128 | 70.1% | 72.5% | — | — | — | 80.3% |
| last tectonic event | N=64 | 4483 Myr | 4465 | 4477 | 4473 | 4474 | 4474 |

*seed 1337 N=128 was first measured during this retune (rate-scaling-only
round), not in the original pass. Land maxes stay 30.6–33.2% everywhere —
nowhere near the 60% ceiling. Continental crustType equilibrium lifted
from 10.8–15.5% to 13.5–20.1% of the sphere. Dispersal and event liveness
are unchanged within seed noise — the retune bought land without buying
back the monopoly.

**Flipbooks** (N=128 seed 42, elevation + plateId + crustType): first
~1.5 Gyr shows large coherent drifting continents with an opening
ridge-crossed ocean; deep time remains drifting ragged continental
clusters plus unmatured island-arc chains standing above the datum — the
same character as the pre-retune elevation flipbook, i.e. the #60
shape-coherence residual. crustType frames show cluster-shaped
continental masses with ragged interiors (not dissolved freckle-trails);
a like-for-like crustType comparison against the rate-scaling-only commit
confirms the belt did not change the deep-time character.

## #60 suture-line memory — carve-weighting results (negative, measured)

**What shipped:** the `sutureYears` field (advected crust property; suturing
stamps the 2-cell continent-continent weld belt with the merge time; fresh
ocean and fresh arc crust carry 0) plus tests, and **no carve behavior
change** — every pre-existing field's bytes are bit-identical to the #61
kernel in every run (verified: 4.5 Gyr dispersal/land/event trajectories for
seeds {1, 42, 1337} × {N=64} and seed 42 × N=128 reproduce the baseline
exactly). `KERNEL_BEHAVIOR_VERSION` 4 → 5 for the schema/golden change.

**What was tried and measured (and reverted):** seven rift-carve weightings
aimed at #60's acceptance ("compact continents with persistent cores, no
dispersal regression"). Metrics: same script as the #59/#61 passes plus
continental-shape coherence — connected components of `crustType`, the
largest component's share of continental area, both averaged over keyframes
past 1 Gyr. N=64, three golden seeds, 4.5 Gyr; representative numbers are
seed-42 / seed-1 / seed-1337.

| carve variant | dispersed keyframes | largest cont. component (share of cont. area) | cont. components | cont. crust (sphere frac.) |
|---|---|---|---|---|
| **baseline (#61, age-blind)** | **.73 / .72 / .74** | **.110 / .113 / .109** | **799 / 866 / 855** | .230 / .215 / .234 |
| absolute age stiffness + suture-discount corridors, suture-cell seeding | .75 / .62 / .78 | .075 / .100 / .083 | 895 / 940 / 908 | .201 / .221 / .214 |
| + continental quota (two-phase carve), weld walls, flank seeding | .67 / .51 / .89 | .073 / .080 / .056 | 1258 / 1121 / 1292 | .314 / .341 / .308 |
| plate-relative age stiffness + young-tier seeding + walls | .61 / .56 / .80 | .062 / .083 / .050 | 1211 / 1077 / 1256 | .354 / .347 / .338 |
| weld walls + flank seeding only (no age term); also with 800 Myr decay | .71 / .63 / .70 | .081 / .066 / .078 | 1135 / 1163 / 1166 | .336 / .334 / .351 |
| 200 Myr fresh-weld window; also + spent-on-rift weld clearing | .72 / .68 / .65 | .042 / .059 / .042 | 1292 / 1230 / 1235 | .237 / .247 / .247 |
| craton rim toll (cost on age-stiffness contrast between edge cells), 2N | .68 / .57 / .65 | .121 / .108 / .114 | 1213 / 1224 / 1192 | .340 / .359 / .340 |

Every variant loses on coherence (largest component collapses toward
.04–.08), on dispersal (as low as .51 vs the .72–.74 baseline), or both.
The rim toll is the interesting near-miss: it grows the largest block ~55%
in *absolute* terms (.025 → .039–.041 of the sphere) and is the only
variant that protects cores — but it does so by hoarding them on the
parent plate (fragments leave continent-poor, the parent stays huge and
sutures everything), which is exactly the dispersal regression, and the
margin-hugging subduction it induces inflates continental crust into lace
(land ~30% of speckle; flipbooks look worse than baseline).

**Failure mechanisms (each isolated by an ablation):**

1. *Repulsive continent pricing* (any per-cell stiffness, absolute or
   relative — the relative datum degenerates anyway, because a deep-time
   plate always carries a just-matured arc cell, so "youngest continental
   age" ≈ 0): the carve grabs ocean and tears off marginal continental
   shreds. Forcing a continental quota to compensate disperses crust onto
   every fragment instead.
2. *Weld walls + flank seeding* put the new plate boundary through the
   continent interior (that is what "reopen along the suture" means
   geometrically) — and this kernel's per-boundary processes (quantized
   advection herringbone, #16 collision consumption, arc freckling) destroy
   far more coherence along that interior line than the carve shape saves.
   Permanent memory also saturates: ~110 sutures per 4.5 Gyr weld-partition
   the whole continent. Decay windows and spent-weld clearing fix the
   saturation and the crust inflation but not the interior-boundary damage.
3. *Rim tolls* avoid interior boundaries but create the core-hoarding
   parent above.

**Conclusion / follow-up:** #60's goal is real but its lever is wrong. The
ragged-archipelago character is manufactured at *plate boundaries* after
reorganization, not by where the carve cuts; compact deep-time continents
need the boundary-process layer to preserve shape (bulldozer debris,
micro-continent fates, arc-freckle compactness, herringbone rework) before
any weld-guided carve can pay off. The weld record now exists — advected,
tested, and free — for that future pass, and as a renderable "assembly
scars" layer.

## #67 boundary-process coherence pass — results (consolidation + bulldozer fates ship; maturation gating rejected)

The #60 conclusion said compact deep-time continents need the
boundary-process layer to preserve shape before any carve weighting can pay
off. #67 attacked the three implicated mechanisms directly. Measurement:
the #60 harness, now a durable `pnpm sim -- --metrics` mode (per-keyframe
continental connected components, largest-component fraction of continental
area, continent edge-to-area ratio, max-plate dispersal; summary aggregates
past 1 Gyr). N=64, seeds {42, 1, 1337}, 4.5 Gyr; numbers are seed-42 /
seed-1 / seed-1337, shape metrics averaged over keyframes past 1 Gyr.

Candidates (each implemented, toggled, and measured independently):

- **C1 — attachment-gated arc maturation**: keep the #59 accretionary belt
  but require the maturing arc cell to be 4-connected to pre-topography
  continent through cells already at maturation elevation (accretion onto a
  face of the continent, never across open water).
- **C2 — compactness-seeking bulldozer**: displaced continental crust picks
  its landing cell at apply time against the resolved post-advection crust
  map, preferring same-plate oceanic ground *attached* to continental crust
  (forward, then any) over unattached ocean, over thickening.
- **C3 — margin consolidation**: pair-flip stray one-cell continental
  islands (0 continental 4-neighbors) against enclosed ocean holes (≥3
  continental 4-neighbors), ascending cell order, min(#islands, #holes)
  pairs — continental cell count exactly conserved.

| variant | dispersed keyframes | largest cont. component | cont. components | edge/area | land min % | cont. crust (sphere frac.) |
|---|---|---|---|---|---|---|
| baseline (#66 kernel) | .93/.93/.94 | .102/.097/.080 | 770/805/895 | 1.88/1.88/2.02 | 12.7/12.4/11.3 | .173/.179/.171 |
| C1+C2+C3 | .83/.86/.84 | .264/.221/.257 | 115/136/116 | 0.98/1.12/1.07 | 13.0/13.6/10.9 | .166/.152/.141 |
| C1+C2 (no consolidation) | .95/.83/.92 | .093/.090/.108 | 696/597/674 | 1.84/1.78/1.78 | 11.8/12.9/12.9 | .175/.164/.180 |
| C3 only | .84/.82/.94 | .279/.248/.230 | 91/106/119 | 0.80/0.85/0.87 | 15.4/14.7/15.7 | .187/.176/.209 |
| **C2+C3 (shipped)** | **.91/.87/.90** | **.265/.306/.219** | **119/97/107** | **0.83/0.80/0.86** | **19.1/16.7/14.4** | **.228/.206/.183** |
| C2 only | .81/.92/.89 | .109/.084/.079 | 731/866/814 | 1.85/1.99/1.84 | 11.7/12.2/13.8 | .175/.174/.197 |
| C2+C3, hole gate 4 (vs 3) | .92/.85/.90 | .213/.167/.213 | 312/290/240 | 1.22/1.21/1.12 | 16.6/13.0/15.2 | .194/.186/.191 |

**What the ablations attribute:**

1. **Consolidation (C3) is the coherence lever.** Alone it takes the
   largest component from ~0.10 to 0.23–0.28 and cuts components ~8×. The
   mechanism: the lace's raggedness lives in the one-cell holes and stripe
   scars *inside* the mass; healing a hole doesn't just add a cell, it
   welds the components around it into one. Pairing each heal against a
   stray fleck keeps the crustal ledger exact — the pass moves stranded
   area from a form the planet can never read as continent into the
   enclaves the boundary processes tore open. The ≥3-neighbor hole gate is
   the right one: at ≥4 the pass cannot eat stripe lines and coherence
   halves (the hole-gate-4 row).
2. **Bulldozer fates (C2) are the budget lever, and only pay WITH C3.**
   Alone, shape stays at baseline (largest comp .079–.109). Combined with
   consolidation, land minima rise 12–19% → 14.4–19.1% and continental
   crust equilibrium rises to .18–.23 of the sphere (above baseline):
   attached re-roots both stop manufacturing islands (freeing consolidation
   capacity for real holes) and stop feeding the founder clamp, and compact
   masses expose less margin length to collision consumption — coherence
   compounds into budget.
3. **Maturation gating (C1) is a measured negative — rejected** (the same
   discipline as #60's carve weightings). It removed detached-freckle
   deposition as designed, but under consolidation those freckles are not a
   shape leak — they are creation-budget flux that consolidation relocates
   into enclave holes. Gating them starved creation: in C1+C2+C3, land
   minima fell 2–4 points vs C2+C3 (seed 1337 to 10.9%, grazing the #20
   floor), continental crust fell to .141–.166, and the largest component
   stayed within noise. The belt-only #59 gate ships unchanged (applied in
   one pass after the margin loop — an ordering-hygiene change only).

**Acceptance vs the issue:** largest component ≥ 2× the 0.11 baseline on
all three seeds — met (.219–.306, 2.2–3.2×). Dispersal holds — met
(.87–.91 vs the ~63% bound; within noise of the #66 baseline's .93, worst
per-Gyr bucket 0.73, longest >85% monopoly window 190 Myr at N=64).
Land band holds everywhere and *improves* (min 14.4–19.1 at N=64, 16.5 at
N=128 seed 42, 20.1–21.5 at N=16; max ≤41%). Cross-grid: N=128 seed 42
gives largest comp .245, edge/area .726, dispersed 92.5% — the coherence
win is resolution-stable. Flipbooks (crustType/elevation, seeds 42/1/1337):
deep-time frames read as a handful of bold continental masses with
internal mountain belts and shelf fringes — no confetti, no lace. Seed 1
stays the most ragged of the three but is qualitatively transformed.

**#54 finding 1 (herringbone) — closed as mitigated, residual re-scoped.**
The stripe *scars* (parallel one-cell ocean lines through continent) are
now healed by consolidation within steps of forming, and the #59 arc
memory already softened stripe contrast on the creation side; deep-time
frames no longer read as striped. What remains of #54-1 is the underlying
quantized-advection oscillation itself (margins still flicker at
advection-quantum spacing — visible as transient coastline shimmer between
keyframes, not as persistent terrain). Fixing THAT means sub-cell advection
or gap-fill/re-maturation hysteresis in the advection kernel — out of
scope here and not currently earning its risk: no shipped metric or
flipbook shows a persistent artifact attributable to it.

Shipped: `KERNEL_BEHAVIOR_VERSION` 7 → 8, field + codec goldens
regenerated deliberately in the same commit. New invariant tests: paired
flip conserves continental cell count and inherits neighbor properties;
unpaired islands stay (foundered); unpaired holes stay open. The #59
bulldozer conservation suite (salient leak bounded, escape conserves)
passes unchanged over the C2 rework.
