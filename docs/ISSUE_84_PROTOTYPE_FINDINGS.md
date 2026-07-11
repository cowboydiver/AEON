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
