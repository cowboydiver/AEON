# Crustal columns — stage C0/C1 gate record

**Status: C0 and C1 landed and gated; C2 not started (owner consultation is
the phase-2 → phase-3 gate).** Companions: `CRUSTAL_COLUMN_PROPOSAL.md`
(the signed-off design, §6 staged plan), `CRUSTAL_COLUMN_PHASE0_BASELINE.md`
(the r9-both yardstick and the land-instrument correction).

Commits: C0 instrumentation `7a28552`; C1 field + flag + shims (KBV 18 → 19)
`201eefc`. All measurements below at N=64, seeds {1, 42, 1337}, on this
container.

## 1. C0 — the instruments (exit: scoreboard emitted, baselines recorded)

`--crust-stats` now prints, per keyframe: `landA%` (dynamic-sea land by TRUE
solid angle — the §3 gate number), `band%` (share of land AREA with freeboard
in (0, 800 m] — the hypsometry gate), `land0m%` (the frozen historical
instrument, printed side by side so the two land definitions can never be
silently joined again), and — with C1 — `Tmean/Tmin/Tmax` (continental
thickness, RAW) and `mass` (the crustal ledger total, 1e21 kg). Kernel change:
one pure re-export (`cellSolidAngleTable`); goldens byte-identical.

### Stock world (shipped defaults, flag-off), 4.5 Gyr — the C2 "before"

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| final landA% (area, dyn sea) | 32.2% | 32.0% | 33.7% |
| past-1-Gyr mean landA% | 32.4% | 33.8% | 32.9% |
| landA% min (whole run) | 21.9% | 22.2% | 23.2% |
| **final band occupancy** | **5.3%** | **9.8%** | **5.7%** |
| past-1-Gyr mean band | 6.9% | 7.3% | 7.6% |
| final mean freeboard | 5367 m | 3326 m | 5078 m |
| past-1-Gyr mean freeboard | 4876 m | 4431 m | 4597 m |
| final cont crust fraction | 35.0% | 44.7% | 39.0% |
| final submerged share | 10.5% | 30.8% | 14.4% |
| final sea level | −1758 m | −1883 m | −1818 m |
| final land0m% (frozen datum) | 27.7% | 25.4% | 29.1% |
| dispersal / monopoly | 98.7% / 0 Myr | 96.5% / 0 Myr | 99.3% / 0 Myr |

Reading: the shipped world already sits INSIDE the 25–35% land-area gate
(land was never the hard part — phase-0 finding, reconfirmed area-weighted)
and FAILS the hypsometry gates exactly as diagnosed — band occupancy 5–10%
vs the ≥ 40% target, freeboard 3.3–5.4 km vs < 1.5 km. Those two rows are
what stages C2+ exist to move; the landA%/dispersal rows are what they must
not break (floor: landA ≥ 20% — measured mins 21.9–23.2% leave real but not
generous margin).

### r9-both (the beat-the-servo reference), 4.5 Gyr, new instruments

Rebuilt from the `CRUSTAL_COLUMN_PHASE0_BASELINE.md` §2 recipe on top of
`201eefc` — five constants + freeboard term (3) **+ `--block-isostasy`**
(part of the r9-both package; a first rebuild without it diverged, which is
itself a useful reminder that the recipe's run command is normative).
Faithfulness check PASSED bit-exactly: final land (cell count)
34.3/34.4/33.8%, crust 38.7/38.7/39.3%, submerged 12.4/13.0/16.0%, sea
−1782/−1961/−2163 m, freeboard 3085/2556/2484 m — every phase-0 ★ row and
campaign number reproduced to the digit. Since this rebuild ran on the C1
head (flag-off), it is ALSO a full-4.5 Gyr trajectory-identity proof for C1
flag-off on a non-stock constants configuration with blockIsostasy engaged —
far stronger than the 10-step golden audit alone.

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| final landA% (area, dyn sea) | 34.5% | 34.3% | 33.6% |
| landA% min (whole run) | 29.7% | 27.4% | 26.3% |
| **final band occupancy** | **16.8%** | **26.1%** | **21.2%** |
| past-1-Gyr mean band | 21.0% | 20.5% | 21.7% |
| final mean freeboard | 3085 m | 2556 m | 2484 m |
| past-1-Gyr mean freeboard | 2800 m | 2847 m | 2734 m |
| final sea level | −1782 m | −1961 m | −2163 m |

Reading: the craton servo buys band occupancy 5–10% → ~20% (the platform
parks land near sea + 400, some of it inside (0, 800]) and freeboard
5 km → ~2.8 km — still far from the ≥ 40% / < 1.5 km gates. These are the
numbers the column model must beat WITHOUT the servo.

## 2. C1 — shim equivalence (the exit gate)

Six runs: flag-off vs flag-on (onset 0), 500 Myr, N=64, three seeds.
Gate: distributional |Δ| ≤ 1 pt (percentages) / ≤ 100 m (freeboard).

| seed | Δ landA% (mean / max-per-kf) | Δ freeboard | Δ crust% | Δ band% | Δ dispersal |
|---|---|---|---|---|---|
| 1 | +0.00 / 0.00 pt | +0.00 / 0 m | +0.00 pt | +0.00 pt | +0.00 pt |
| 42 | +0.00 / 0.00 pt | +0.00 / 0 m | +0.00 pt | +0.00 pt | +0.00 pt |
| 1337 | +0.00 / 0.00 pt | +0.00 / 0 m | +0.00 pt | +0.00 pt | +0.00 pt |

**PASS with maximal margin**: every elevation-derived statistic is identical
at printed precision (0.1 pt / 1 m) on every one of the 51 keyframes, per
seed. The paired logs differ ONLY in the thickness/ledger columns.

This is not a byte-level no-op — engagement is proven three ways:

1. Field-hash comparison (same seed 42, 10 steps, all other mechanisms off):
   flag-on `elevation` hash differs from flag-off (`cebe781f` vs `373918c2`),
   as do the climate fields downstream of it — the derivation genuinely owns
   elevation, rewriting it at f32-ULP level on every continental write.
   Discrete tectonic state (`plateId`, `crustType`, `crustAge`,
   `sutureYears`) is hash-identical at 10 steps.
2. The engaged golden (`golden.test.ts`): after 30 default-world steps every
   continental cell satisfies `elevation === fround(C + k·T)` bit-exactly —
   a check the flag-off world provably fails.
3. The A/B harness tripwire: `--ab crustal-columns` pre-branch keyframes
   bit-identical; post-branch window deltas +0.00 across the board.

Shim-era honesty, visible in the instruments (both declared in the proposal):

- **The negative lobe**: flag-on `Tmin` reaches ≈ −1.8 km by 500 Myr —
  legacy-pump-flooded cells inverting below e(0). Declared Δ-space
  bookkeeping (proposal §6 C1 validity domain); regularized at C5; nothing
  physical consumes raw shim-era thickness.
- **Ledger drift**: the on-arm total crustal mass moves ×1.00–×1.34 over
  500 Myr (seed-dependent), dominated by arc-maturation credits (inversion
  at flip founds ~20+ km columns from 7.1 km oceanic precursors — honest
  ex-nihilo crust production, today's semantics) plus the servo shims'
  non-conservative mirrors. At C1 the ledger is a reported tripwire; the
  per-term closure gates activate at C2 when erosion becomes a real mass
  transaction (declared deviation from proposal §7, recorded in the C1
  commit message).

## 3. Also pinned at C1

- KBV 18 → 19; golden regen audited: **84 insertions, 0 deletions** — every
  pre-existing field hash bit-identical across all 25 prior spines; the
  additions are the new field's hash lines + two new C1 spines.
- Full kernel suite 473/473 green (~104 s — within the v17 budget note);
  lint + typecheck clean; new fixtures sub-4 s combined.
- Founding synthesis reproduces the proposal's closure-check-2 numbers live:
  t=0 Tmean 39.0 km / Tmin 32.8 km / Tmax 67.8 km (predicted 39 / 32.7 /
  67.8). Post-t=0 flag-on Tmax ≈ 86–94 km is the shim faithfully mirroring
  today's 9-km-over-sea orogeny ceiling (e = C + k·T reproduces the cap to
  the metre) — the C3 thickness cap (70 km) is what retires that.

## 4. What C2 must do (pre-registered, from the proposal §6)

Sites 13–15 → thickness space, real mass transactions
(`sedimentM += ΔT·ρ_cc/ρ_sed`). Gates: band occupancy strictly increases vs
the C1 world (baselines above: stock final band 5.3–9.8%); mean freeboard
−200 m by +1 Gyr post-branch; measured planation rate reported against the
4.7 m/Myr budget on BOTH source and sink sides; conservation fixtures;
landA% floor ≥ 20% holds.
