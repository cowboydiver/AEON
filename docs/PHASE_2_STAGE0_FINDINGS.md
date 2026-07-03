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
