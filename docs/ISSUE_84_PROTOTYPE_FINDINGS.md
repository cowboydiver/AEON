# Issue #84 prototype — crustal-block isostasy (measured)

The deep-time "tall-island confetti" complaint, reproduced and measured, and
the first shape-preservation mechanism from the
[#60/#67 conclusion](PHASE_2_STAGE0_FINDINGS.md) prototyped against it:
**small continental blocks cannot hold high topography**. Everything here is
behind a default-off param (`blockIsostasy` / `--block-isostasy` / `?iso=1`);
flag-off runs are byte-identical to the pre-#84 kernel (goldens unchanged).

Reproduce:

```
pnpm sim -- --seed 42 --until 4.5e9 --grid-n 64 --metrics                    # baseline
pnpm sim -- --seed 42 --until 4.5e9 --grid-n 64 --metrics --block-isostasy   # prototype
pnpm sim -- --seed 42 --until 4.5e9 --metrics --block-isostasy \
  --dump elevation,crustType --dump-every 5 --out tmp/iso                    # N=128 flipbook
pnpm -F web dev   # then open /?iso=1 to scrub the prototype on the globe
```

Curated frames: `docs/issue84-evidence/` (baseline vs iso, same seed/epoch).

## Mechanism (see `systems/blockIsostasy.ts`)

Per step: label 4-connected components of continental crust; relax elevation
above the component's ceiling toward it at `BLOCK_ISOSTASY_RELAX_M_PER_YR`
(1e-3 m/yr — a 9 km orogen founders in ~9 Myr, no keyframe popping).

```
cap(A) = −200 m                                    A ≤ 300k km²   (founders)
       = −200 + 9200·sqrt(Ā)  m,  Ā ∈ (0,1)        300k…2M km²    (sqrt ramp)
       = 9000 m                                    A ≥ 2M km²     (inert)
```

crustType is untouched — foundering moves *land* out of the visible mask but
keeps the crustal-area ledger intact (Zealandia-style, can re-accrete), which
is why the metrics harness gained land-mask shape numbers (`landComponents`,
`largestLandCompFrac`) alongside the crustType ones.

## Measured (N=64, 4.5 Gyr, three golden seeds; "off / on")

| metric (past 1 Gyr unless noted) | seed 42 | seed 1 | seed 1337 |
|---|---|---|---|
| land components | 224 / 227 | 232 / **208** | 295 / **226** |
| largest land comp (share of land) | 0.345 / 0.259 | 0.355 / 0.331 | 0.324 / **0.360** |
| cont components | 103 / 104 | 85 / 91 | 112 / **95** |
| largest cont comp | 0.284 / 0.219 | 0.285 / 0.247 | 0.291 / **0.318** |
| land min over 4.5 Gyr | 14.0% / 11.3% | 15.6% / 14.2% | 15.9% / 12.7% |
| dispersed keyframes | 87.6% / 87.6% | 79.8% / 89.6% | 94.9% / 83.1% |
| last tectonic event (Myr) | 4435 / 4485 | 4424 / 4370 | 4353 / 4450 |

N=128 seed 42 (the web app's grid), off → on: land components 517 → 531,
largest land comp 0.344 → 0.288, land min 11.9% → 10.6%, cont components
275 → 288, dispersed 89.6% → 87.1%, alive to 4483/4444 Myr. (Baseline
land components in the *hundreds* — the "countless islands" complaint,
quantified.)

### Honest reading

1. **The safety properties all hold.** Land stays inside the [10, 60]% band
   on every seed and grid (min 10.6% at N=128 — grazing but inside),
   dispersal and event liveness are unchanged within seed noise, no
   keyframe popping (rate-bound working), kernel suite + goldens green.
2. **The aggregate shape metrics are inside trajectory noise on both
   grids.** The first founder event perturbs the whole subsequent tectonic
   trajectory (chaotic divergence), so on/off pairs are different worlds;
   seed 1337 improves on every shape metric, seed 42 degrades on most
   (at N=64 and N=128), seed 1 is mixed. Single-seed shape numbers cannot
   accept or reject this mechanism; the seed spread brackets the truth:
   **the founder removes the worst speckle but does not by itself
   consolidate land into continents.**
3. **The N=128 flipbook is visibly better mid-history** (1.7–2.9 Gyr:
   larger compact green masses, mountain belts attached to them, less
   isolated 9 km white speckle) **and still archipelago-heavy at deep
   time.** Two residuals it deliberately does not touch explain most of
   what remains: unmatured **oceanic arc chains** (crustType 0, up to
   +1 km) standing along every active margin — Japan/Aleutians-like,
   arguably correct physics, but a big share of the visible island count —
   and the **continental-crust lace itself** (crustType frames are
   near-identical in character; this mechanism moves the land mask, not
   the crust map).
4. **Land-budget cost is real** (~1–3 points of land min): foundered blocks
   are land the planet no longer shows. The sea-level solver claws part of
   it back (more ocean volume → lower sea level → larger continents gain
   shelf-edge land).

### Founder-threshold sweep (seed 42, N=64)

| `BLOCK_FOUNDER_AREA_M2` | land comps past 1 Gyr | largest land comp | land min |
|---|---|---|---|
| off (baseline) | 224 | 0.345 | 14.0% |
| 1.5e11 (150k km²) | 272 | 0.319 | 13.9% |
| **3e11 (300k km², shipped)** | 227 | 0.259 | 11.3% |
| 6e11 (600k km²) | **221** | **0.363** | 11.7% |

The spread across thresholds is the same size as the on/off spread across
seeds — one more confirmation that single-run shape numbers at N=64 are
trajectory noise. 6e11 is the best single point (fewest components, biggest
largest-component share, land min comfortably in band) and is the candidate
to promote if a multi-seed re-measure confirms it; 3e11 ships because it is
the physically motivated midpoint and the sweep cannot distinguish them.

## Verdict and follow-up

Ship the prototype **default-off** as the measurement substrate it was built
to be. It is safe, deterministic, visually inspectable (`?iso=1`), and its
founder half demonstrably kills the immortal 9 km splinter peaks. What it is
NOT yet is the continent-consolidation lever — per the #60 conclusion the
remaining raggedness is manufactured as crustType lace at boundaries, so the
next candidates, measurable with the same harness, are:

1. **Small-component crust fates** — extend #67 consolidation from 1-cell
   islands to whole small components (merge into the nearest large component
   across ≤2 cells of ocean, or founder the *crust* record too), attacking
   the lace itself.
2. **Compact arc maturation** — bias maturation toward cells with ≥2
   continental neighbors so creation stops manufacturing chains (re-measure
   the #67 attachment-gate starvation trap with the belt kept).
3. **Arc-chain visual accounting** — active oceanic arcs are the other half
   of the island count; if they read as noise on the globe, cap emergent arc
   relief by margin age rather than a flat +1 km ceiling.

Two further levers surfaced in the PR #85 review, complementary to the
list above because both are *conservative* (transport, not subsidence) and
attack consolidation rather than visibility:

4. **Terrane docking** — Earth's actual fate for microcontinents is not
   foundering but accretion: fragments ride plate motion into subduction
   margins and dock (Wrangellia-style). Candidate 1's proximity merge is the
   static half; the transport half (small components advected into a large
   component's margin weld onto it) is the missing consolidation dynamics.
5. **Marine planation for small components** — the #84 issue's own recap
   pins island immortality on erosion (`EROSION_SUBSEA_FACTOR` ×0.1,
   coastal export vanishing at 0 m). Scaling either by component area
   removes island mass into `sedimentM` (conserved) instead of destroying
   it, and composes with the shelf machinery: the founder level already
   coincides with `SEDIMENT_SHELF_CEILING_M`.

## Post-review follow-up: the branched A/B instrument

The honest-reading conclusion above — whole-history on/off comparisons are
trajectory noise, so the harness "cannot accept or reject" — was itself the
biggest gap, and it is fixable. The PR #85 review pass added the fix:

- **`blockIsostasyOnsetYears`** (kernel param, default 0): the system is
  inert before the onset year. It consumes no RNG, so a flag-on run with
  onset Y is **bit-identical** to a flag-off run until Y (invariant-tested
  through the full pipeline) and diverges after Y only by the mechanism's
  direct effect.
- **`pnpm sim -- --ab-block-isostasy <years>`**: runs both arms, verifies
  pre-branch keyframes are bit-identical (a tripwire, not an assumption),
  and prints paired per-keyframe land-shape deltas plus window means. Trust
  the first few hundred Myr after the branch most: the deltas themselves
  compound, so deep-window rows decay back into trajectory comparison.
- **True component areas**: the review also switched component area from
  cells × mean cell area to summed per-cell solid angles × R²
  (`cellSolidAngleTable`); the warp's ±35% residual distortion was enough to
  mis-bin threshold-scale blocks near face corners. The measured tables
  above predate this correction (their character is unaffected — the spread
  they document is seed noise, which is the point); the flag-on goldens pin
  the corrected math.

Measured with the instrument (seed 42, N=64, branch at 3000 Myr — inside
the deep-time confetti regime — window to 3500 Myr):

```
pnpm sim -- --seed 42 --until 3.5e9 --grid-n 64 --ab-block-isostasy 3e9
```

301 pre-branch keyframes verified bit-identical, then (off → on, excerpt):

| t | land comps | largest land comp | land% |
|---|---|---|---|
| 3000 Myr | 252 → 252 | 0.300 → 0.300 | 18.5 → 18.5 |
| 3120 Myr | 215 → 216 | 0.369 → 0.367 | 16.9 → 16.2 |
| 3240 Myr | 219 → 228 | 0.407 → 0.428 | 16.6 → 15.6 |
| 3360 Myr | 212 → 217 | 0.431 → 0.370 | 16.2 → 15.1 |
| 3500 Myr | 227 → 218 | 0.426 → 0.441 | 15.4 → 14.2 |

Window means over 51 paired keyframes: **Δ land components −0.2, Δ largest
land comp −0.017, Δ land −0.96 pts, land min (on) 14.0%.**

Reading: the instrument turns the "cannot accept or reject" shrug into a
direct answer. Paired at the same trajectory, the mechanism (a) does not
reduce the island count — foundered splinters are replaced by fresh ones
from the boundary-process layer at the same rate, so Δ components ≈ 0;
(b) does not consolidate — largest-component share is flat-to-slightly-down;
(c) costs just under 1 point of land, ramping in over ~150 Myr as blocks
founder (the sea-level solver claws back part, as predicted). The
visibility claim (no more immortal 9 km splinter peaks) stands from the
invariant tests and flipbooks; the consolidation claim is now *measured
dead* rather than "inside noise" — which is exactly why follow-ups 1/2/4
(crust fates, arc maturation, docking) are the levers that matter, and
they should be evaluated with this same branched harness.

Remaining methodology gap, deliberately not built yet: seed *batches*
(15–20 seeds per arm) to put error bars on whole-history claims. The
branched A/B answers "does the mechanism do what it says where it acts";
batches answer "does it improve planets on average". Batch runs are a shell
loop over `--seed` today; a `--seeds` convenience flag only earns its keep
once a specific promotion decision needs it.
