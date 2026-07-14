# Tectonics V2 — Stage 0 baseline census

The reference the stage-1 `forceKinematics` `--ab` (and every later stage)
measures against. Produced by the `--plate-census` instrument (#110, proposal
§3/§5) on the **current** kernel (the scripted immutable-Euler-vector plate
model), which stays the untouched comparison baseline. **Measurement only —
main goldens are byte-identical** (the census toggle is default-off and writes
only diagnostic `globals`, never a field).

## How this was produced

```
pnpm sim -- --seed <S> --grid-n <N> --until 4.5e9 --plate-census
```

Acceptance grid (per #109 / proposal §5): **seed 42 at N=128**, **seeds 1 and
1337 at N=64**, plus **seed 42 at N=64** for the cross-N check. Full 4.5 Gyr
histories. Each summary is the mean over the 351 keyframes past 1 Gyr (early
keyframes still remember the initial partition, the repo's shape-metrics
convention). Raw per-keyframe tables are reproducible with the command above.

## Baseline numbers (mean over keyframes past 1 Gyr)

| metric | seed 42 / N=128 | seed 42 / N=64 | seed 1 / N=64 | seed 1337 / N=64 | Earth / §3 target |
|---|---|---|---|---|---|
| plate speed median (cm/yr) | _pending_ | 1.90 | 1.60 | 2.10 | **2–6** |
| plate speed min–max (cm/yr) | _pending_ | 0.76–3.49 | 0.65–3.41 | 0.84–3.85 | — |
| oceanic/continental speed ratio | _pending_ | 0.00 | 0.00 | 0.01 | **1.5–4** |
| speed–continentality correlation | _pending_ | +0.404 | +0.212 | +0.107 | **negative** (keel drag) |
| pole stability (mean cosine) | _pending_ | 0.9983 | 0.9995 | 0.9996 | — (immutable ⇒ ~1) |
| seafloor age median (Myr) | _pending_ | 271 | 326 | 289 | ~60–80 |
| seafloor age mean (Myr) | _pending_ | 395 | 486 | 439 | — |
| seafloor age max (Myr) | _pending_ | 4750 | 4750 | 4750 | <200 |
| ocean area older than 200 Myr | _pending_ | 57.7% | 63.4% | 61.1% | ~0% |
| plateness (top-decile stress share) | _pending_ | 0.289 | 0.275 | 0.264 | — |
| boundary churn (#67 pair-flips / 100 Myr) | _pending_ | 371.9 | 321.7 | 320.9 | ↓ under force model |

Age–area histogram (share of oceanic cells per 20-Myr bin, seed 42 / N=64):
`0-:6.2% 20-:5.4% 40-:4.9% 60-:4.5% 80-:4.2% 100-:3.9% 120-:3.6% 140-:3.4%
160-:3.2% 180-:3.0% 200+:57.7%`. Seeds 1 and 1337 match the shape (a thin
young-floor spread under a dominant >200 Myr spike).

## What the baseline says — the pathologies stage 1 is accountable to

These are the Forsyth & Uyeda (1975) sign-test failures the census exists to
expose. They are the **falsifiable claims** the torque balance must move
(proposal §3):

1. **Speeds run slow and too uniform.** Median 1.6–2.1 cm/yr, below the 2–6
   target; the min–max spread is a fixed uniform draw at creation, not a
   slab-pull-driven regime. Nothing accelerates a plate with a long subducting
   margin.

2. **No oceanic/continental speed structure (ratio ≈ 0).** By deep time the
   surviving plates almost all classify continental (creation-time
   `continentalFraction` ≥ 0.5, after sutures merge oceanic plates away), so the
   oceanic class empties and the ratio degenerates. There is no fast-oceanic /
   slow-continental population — the anticorrelation the balance should make
   emergent is simply absent.

3. **Speed–continentality correlation has the WRONG sign (+0.1 to +0.4).**
   Earth's continental keels drag (negative). The scripted speeds carry no
   keel-drag coupling, so if anything the more-continental plates run *faster*
   here — exactly backwards.

4. **Poles are effectively frozen (stability ≈ 1.0).** A plate's Euler pole
   moves only when a suture momentum-blends it or a rift assigns a fresh
   fragment pole; between reorganizations it is immutable. There is no
   continuous pole migration, so the stage-1 pole-autocorrelation-**time**
   diagnostic is undefined on this baseline (it needs poles that actually
   wander).

5. **The seafloor never recycles (median age 270–330 Myr; >57% older than 200
   Myr; max 4750 Myr).** Real oceanic crust is almost all younger than 200 Myr.
   Fixed speeds give no age-selective subduction; slab pull ∝ √age (stage 1)
   should preferentially consume old floor and pull the whole distribution down
   toward the triangular target.
   - *Caveat (a real stage-0 finding):* the kernel seeds continental crust at
     `CONTINENTAL_INITIAL_AGE_YEARS = 2e9` and converts some continent→ocean at
     margins without resetting `crustAge`, so a ~2 Gyr former-continental tail
     inflates the age **mean** and the 4750 Myr max. The census therefore
     reports a robust **median** alongside mean/max. The median (270–330 Myr) is
     itself far above Earth, so the old-floor pathology is pervasive, not just a
     tail artifact.

6. **Margins flicker (churn 320–372 #67 pair-flips / 100 Myr).** The
   consolidation pass repairs ~3+ margin flips per Myr. Force-persistent margins
   (stage 2 `emergentSuture` / the torque balance) should reduce this; the
   number here is the "before."

Plateness (0.26–0.29) is the one metric already in a plausible range — stress
does concentrate at margins even under the scripted model.

## Cross-N and cross-seed stability

All three N=64 seeds agree on every qualitative verdict (slow speeds,
degenerate oceanic/continental ratio, wrong-sign correlation, frozen poles,
un-recycled old floor, high churn) and agree quantitatively within a factor
that leaves ample signal for the stage-1 gates. The seed-42 N=64↔N=128 pair is
the cross-N control (N=128 row above once the confirmation run lands).

## Provenance

Instrument: `--plate-census` (kernel `plateCensusSystem` + sim-cli
`metrics.ts`), documented in `docs/ARCHITECTURE.md`. This doc is the durable
reference for stage 1's `--ab forceKinematics` comparison; regenerate the raw
tables with the command at the top if a metric definition changes.
