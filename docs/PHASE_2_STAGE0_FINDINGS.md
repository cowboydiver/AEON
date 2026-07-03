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

### Root-cause hypothesis (not yet confirmed in code)

The endgame events are telling: at 1226 Myr plate 0 rifts off a 48k-cell plate,
which re-sutures back into plate 0 within one step; at 1509 Myr a rift produces
a **1-cell** plate (`newPlateCells=1`), and at 1510 Myr the last real plate is
absorbed into plate 0. After that the single super-plate never rifts again for
3 Gyr, even though it is old, large, and continent-carrying (nominally eligible
at `RIFT_PROBABILITY_PER_MYR = 0.006`, ~1 expected rift per 167 Myr). Something
in the Wilson rift path either fails to fire, or fails to "take," once the world
is a single plate — the split halves immediately re-collide and re-suture, so
the supercontinent is a one-way ratchet with no breakup. This is `#54`-adjacent
kernel work (knobs in `sim-kernel/src/constants.ts`: `RIFT_*`, `SUTURE_*`,
`MIN_PLATES`, arc maturation) and is **golden-changing** — out of scope for a
Stage 0 measurement pass; flagged here for the human's decision.

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
- Per the plan this is a **stop-and-decide** point: the fix is golden-changing
  deep-time kernel re-tuning, which reshapes Phase 2's acceptance criteria and
  possibly its issue order. The scope decision is the human's; this document is
  the measurement input to it.
