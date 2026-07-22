# Crustal columns — stage C7 gate record (calibration + the water sweep)

**Status: C7 measured, default-off, STOPPED AT THE OWNER SIGN-OFF GATE —
this record is the promotion evidence, not the promotion. One mechanism
change landed (the creation-datum re-key the C5 record scoped here: on the
columns path the arc growth ceiling floors at the absolute maturation gate,
so continental creation cannot starve under dry seas — zero new constants,
fixture-proven inert on every wet sea and byte-inert on the legacy path),
and the full §3/§10 acceptance grid ran: 3 seeds × 4 water scales, N=64,
4.5 Gyr, plus N=128 replication. The headline: the vertical axis now
answers the water endowment monotonically on every seed — mean freeboard
falls 5.5 km → 3.0 km → 1.6–2.0 km → 0.5–1.0 km across scales 0.5→2.0 and
the submerged share of continental crust rises 0% → 2–4% → 28–34% → 41–48%
(Earth ~25% sits between scales 1.5 and 2.0) — the T5 alt-world honesty
the servo model measurably lacked, now measured on twelve deep-time
worlds. The dry half of the sweep, a dead world at C5 (crust 40% → 3.5%,
matF 0), is ALIVE on all three seeds (crust fraction 0.29–0.31, dispersal
92–97%, monopoly ≤ 30 Myr). Eleven of twelve grid cells are tectonically
alive; the twelfth (seed 1337 × water 1.5) dies a MONOPOLY death at
2.9 Gyr — the pre-existing V2 kinematic fragility family, measured here
for the first time because no prior stage ever ran this cell, and provably
not a C7 regression (the re-key never engages above sea −3.3 km; this
run's sea never fell below −1476 m, and every scale-1.0 run reproduces the
C6 gate tables digit-for-digit). Land area is monotonic in water on the
wet side (38.5–38.9% → 27–28% → 21–22%) but INVERTS at the dry end
(30–32% at scale 0.5, BELOW scale 1.0) — attributed: the v1 oceanic
branch's still-sea-keyed creation datums (trench floor, age-depth) make
the crust inventory itself endowment-coupled (matF 322–339 vs 400–425),
and on both dry scales virtually all crust is emergent, so land tracks
inventory, not flooding. Two §3 gates miss and are stated plainly:
band occupancy 10.7–19.5% everywhere vs the ≥ 40% Earth-shape gate (3× the
servo world's 6–7%, moving Earth-ward with water, still short), and
scale-1.0 freeboard 2.9–3.1 km (above even the 1.5–2.5 km partial-win
band; the < 1.5 km and < 1.0 km marks are reached at scales 1.5–2.0,
which owner decision §11.2 pre-authorized judging across the sweep). The
default-endowment product decision (§11 answer 2's anticipated "make
scale ~1.5 the shipped default planet") is now fully quantified for the
owner, with the measured trade: Earth-like flooding/shallow-seas/land at
1.5 versus the supercontinent story and the 1337 death. The N=128
replication (§7) preserves aliveness, the structural floors and the
monotonic water axis and produces the program's most Earth-like maps —
band occupancy 37.7% at scale 1.5, one knife edge from the Earth-shape
gate the coarse grid missed by 3× — but the creation–consumption
equilibrium drifts with resolution (crust fraction 0.30–0.32 late,
below the T3 band; the founder/retirement granularity is the
un-N-scaled consumption family), a named pre-promotion calibration
item. Promotion, KBV bump, golden regen and the default flip all await
sign-off.**

Companions: `CRUSTAL_COLUMN_PROPOSAL.md` (§3 scoreboard, §6 C7, §10
acceptance grid, §11 owner decisions), `CRUSTAL_COLUMN_STAGE_C6_GATE.md`
(the world this stage scores and its two carried datum-vs-endowment
items), `CRUSTAL_COLUMN_STAGE_C5_GATE.md` §3 (the creation-datum mismatch
this stage resolves), `CRUSTAL_COLUMN_PHASE0_BASELINE.md` (the r9-both
yardstick the scoreboard beats).

Commits: kernel `c6415b7` (the arc-ceiling floor + fixtures +
`ARCHITECTURE.md`, no KBV bump — the promotion bump is the owner's,
proposal §11 answer 4). All measurements N=64 (plus §5 N=128), seeds
{1, 42, 1337} × water scales {0.5, 1.0, 1.5, 2.0}, 4.5 Gyr, flag-on
(onset 0), this container. "Late" = past-1-Gyr keyframe mean; land gates
read the area-weighted dynamic-sea instrument (`landA`); "run min"
excludes the founding transient (post-200 Myr), matching the C5/C6
convention, with the t=0-inclusive minimum also given where it differs.

## 1. What landed (the creation-datum re-key)

On the columns path only (flag-off byte-identical structurally — the
floor is gated on the thickness array; all 25 flag-off spines and both
flag-arm spines bit-unchanged, 508/508 kernel tests):

- **The arc growth ceiling floors at the absolute maturation gate.**
  `arcCeiling = max(platformDatumOffsetM + ARC_MAX_ELEVATION_M,
  e(ARC_MATURATION_THICKNESS_M))` when columns are active. The island
  ceiling is a sea-relative statement about EMERGENT edifices ("a 1 km
  island"); read verbatim under a sea more than ~3.3 km below the datum
  it capped arc columns at ~12 km thickness-equivalent — below the cited
  20–35 km arc-crust range (Suyehiro et al. 1996; Calvert 2011) that the
  maturation threshold itself is built on — so creation starved while
  collision consumption continued: the C5 §3 collapse (crust fraction
  40% → 3.5% by 2.5 Gyr, matF = 0 from 0.4 Gyr, 600 Myr monopoly,
  land min 0.7% at water scale 0.5). This is option (a) of the three
  resolutions the C5 record named ("the growth ceiling learns the
  absolute datum's reach"); the fallback-knob option was already ruled
  out there (the gate sits at the cited band's bottom) and the
  scope-fence revision (accrued oceanic thickness) remains the successor
  issue. Zero new constants, zero new knobs — the floor reuses the C4
  gate value, and arcs that reach it mature the same step (the clip
  lands exactly AT the gate; the f32 store rounds to the emergent side,
  and the fixture asserting maturation is the permanent tripwire on that
  rounding).
- **Fixtures** (4 new, all sub-second): dry-sea clip exactly AT the gate
  with a 20 km founded column; the legacy arm maturing through its own
  sea-keyed pair on the same dry world (both legacy datums ride the sea
  together — the mismatch was columns-only, never a legacy defect);
  wet-sea inertness (sea −2000: the sea-keyed ceiling binds unchanged);
  clip-not-attractor (an arc at the floored ceiling stays, never lifted).

**Inertness on the wet regime, measured at deep time, not just proven at
fixture scale:** the floor engages only when the sea sits below −3306 m.
Across the nine scale ≥ 1.0 sweep runs the run-minimum sea is
−2493/−1116/0 (seed 42), −2563/−1090/0 (seed 1), −2582/−1476/−93
(seed 1337) — it never engages — and all three scale-1.0 runs reproduce
the C6 gate record's per-seed tables digit-for-digit (every printed
column, all 451 keyframes' derived statistics: freeboard 2899/3108/3105,
landA 38.9/38.5/38.6, matF 407/425/400, marg 50.5/50.4/49.1, retC
465/437/364, cmin −2306 …). The scale-1.0 world of record is therefore
EXACTLY the C6 world; every C2–C6 gate and floor carries over unchanged
at the default endowment.

## 2. The sweep grid (N=64, 4.5 Gyr, late means)

Water scale 0.5 — the dry half, revived (C5: dead by 2.5 Gyr):

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| sea late, m | −4148 | −4117 | −4206 |
| cont crust fraction | 0.286 | 0.310 | 0.297 |
| mean freeboard, m | 5538 | 5549 | 5604 |
| landA% late (run min) | 30.4 (26.1) | 32.4 (27.4) | 31.3 (25.7) |
| submerged% / shallow% | 0.0 / 8.4 | 0.0 / 8.6 | 0.0 / 9.1 |
| band% late | 2.1 | 1.3 | 1.4 |
| peaks above sea, m | 8948 | 8917 | 9006 |
| matF /10 Myr / crea | 322 / 91.6 | 339 / 89.8 | 334 / 92.3 |
| mass final, e21 kg (t=0 ≈ 28.6–29.2) | 26.9 | 27.3 | 28.9 |
| cmin run-min | −2306 | −2306 | −2306 |
| retC (crust hoarding, expected) | 38 | 39 | 28 |
| dispersal / monopoly, Myr | 92.0% / 30 | 96.7% / 0 | 94.7% / 0 |
| last tectonic event, Myr | 4491 | 4435 | 4466 |

Water scale 1.0 — the default endowment; **identical to the C6 gate
record on every seed** (§1), reproduced here for the grid:

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| sea late, m | −1621 | −1766 | −1876 |
| cont crust fraction | 0.398 | 0.388 | 0.385 |
| mean freeboard, m | 2899 | 3108 | 3105 |
| landA% late (run min) | 38.9 (34.9) | 38.5 (35.2) | 38.6 (34.0) |
| submerged% / shallow% | 4.1 / 3.6 | 3.2 / 3.3 | 2.4 / 3.5 |
| band% late | 19.2 | 12.6 | 10.7 |
| peaks above sea, m | 6421 | 6566 | 6676 |
| largest land comp late | 0.513 | 0.532 | 0.563 |
| dispersal / monopoly | 98.9% / 0 | 99.8% / 0 | 99.1% / 0 |
| last tectonic event, Myr | 4491 | 4435 | 4484 |

Water scale 1.5 — the Earth-flooding candidate (and the one dead cell):

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| sea late, m | −306 | −556 | (−933) |
| cont crust fraction | 0.399 | 0.381 | (0.382) |
| mean freeboard, m | 1641 | 1963 | **DEAD** (1439) |
| landA% late (run min) | 27.0 (23.7) | 28.1 (14.6 t=0-incl.) | (32.2) |
| submerged% / shallow% | 33.5 / 5.2 | 27.8 / 7.5 | (18.1 / 6.8) |
| band% late | 15.4 | 15.6 | (37.9) |
| peaks above sea, m | 5106 | 5356 | (4312) |
| largest land comp late | 0.222 | 0.262 | (0.486) |
| mass final, e21 kg | 32.5 | 31.6 | (24.4) |
| dispersal / monopoly, Myr | 96.0% / 0 | 97.6% / 0 | **63.6% / 1590** |
| last tectonic event, Myr | 4497 | 4434 | **2927** |

Water scale 2.0 — the high-water bound:

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| sea late, m | +770 | +454 | +345 |
| cont crust fraction | 0.393 | 0.364 | 0.368 |
| mean freeboard, m | **522** | **995** | **998** |
| landA% late (run min) | 21.0 (18.2) | 22.0 (21.0*) | 21.9 (19.3) |
| submerged% / shallow% | 47.8 / 2.9 | 41.0 / 2.6 | 41.8 / 2.7 |
| band% late | 19.5 | 16.9 | 17.5 |
| peaks above sea, m | 4030 | 4346 | 4030 |
| largest land comp late | 0.134 | 0.160 | 0.162 |
| dispersal / monopoly | 97.3% / 0 | 97.1% / 0 | 100.0% / 0 |
| last tectonic event, Myr | 4477 | 4484 | 4474 |

(*the t=0-inclusive minima at scale 2.0 are 5.1–5.8% — the founding
transient is largely flooded until creation/orogeny catch up over the
first ~150 Myr; the post-200 Myr minima quoted are the floors the worlds
actually live above.)

PNG dumps inspected across the grid (house rule; final frames all seeds,
seed-42 flipbook at every scale), with the headline frames committed for
the sign-off review in `docs/crustal-column-c7-evidence/` (the seed-42
final at all four scales, the 1337 scale-1.0 supercontinent, the
1337×1.5 dead world, both N=128 finals — the sweep-campaign evidence
precedent): the endowment story is VISIBLE — proud
brown highland blocks with little shelf at 0.5; the C6 look (coherent
continents, highland interiors ringed by green lowlands, ridge fabric,
shelf halos) at 1.0; broad green lowlands and wide flooded margins at
1.5; a fragmented low-relief archipelago world at 2.0. The 1337×1.5 dead
world planes to featureless green lowlands with no ridge fabric — the
documented "dead world drowns" signature, unmistakable in one glance.
Numbers and maps agree everywhere.

## 3. The monotonicity verdict (T5, the redesign's reason to exist)

Strictly monotonic in water on EVERY seed, across the full sweep:

- **Mean freeboard** (m): 5538→2899→1641→522 (s1); 5549→3108→1963→995
  (s42); 5604→3105→(dead)→998 (s1337). The vertical axis answers the
  endowment through the fixed physics — no servo, no knob. The sweep
  crosses the < 1.5 km headline mark between scales 1.5 and 2.0 and the
  < 1.0 km full-win mark at 2.0 (522–998 m ≈ Earth's ~0.8 km).
- **Submerged share of continental crust**: 0% → 2.4–4.1% → 27.8–33.5% →
  41.0–47.8%. Earth's ~25% sits between scales 1.5 and 2.0, nearer 1.5.
- **Peaks above sea**: 8.9–9.0 km → 6.4–6.7 km → 5.1–5.4 km → 4.0–4.3 km
  — exactly the §3 scoping prediction (the 70 km cap bounds absolute
  elevation at +4815 m, so the peak band compresses as the sea rises).

**Land area is NOT monotonic at the dry end** — the one caveat, with the
mechanism pinned: landA late runs 30–32% (0.5), 38.5–38.9% (1.0), 27–28%
(1.5), 21–22% (2.0). On both dry scales virtually all continental crust
is emergent (submerged 0–4%), so land area tracks the crust INVENTORY —
and the inventory itself is endowment-coupled through the v1 oceanic
branch, which deliberately keeps sea-keyed datums (proposal §2.1): at a
−4.1 km sea the age-depth floor rides down (`bathymetryDatum`), arcs
climb from deeper starts, and the maturation flux runs ~20% slower
(matF 322–339 vs 400–425; crea 90–92 vs 108–114), yielding crust
fractions 0.29–0.31 vs 0.385–0.398. The "less water ⇒ more land"
expectation holds only where the sea can actually flood crust (scales
≥ 1.0, where it does hold, on every live seed). What the servo world got
WRONG is fixed regardless: there, less water produced LESS land at the
SAME crust because the freeboard servo dragged continents down to any
sea (sweep §10.2); here the emergent share responds physically (100% →
96–98% → 66–72% → 52–59%). The dry-end inversion is the oceanic branch's
remaining sea coupling made visible — the successor issue's territory
(accrued oceanic thickness), not a knob to tune here.

## 4. Gate scoring (proposal §3 scoreboard + §10 grid)

1. **Alt-world water sweep ("monotonically decreasing land fraction, all
   four alive"): PARTIAL — the substance passes, the letter does not,
   both measured.** Alive: 11 of 12 cells (the C5-era dry half now
   fully alive on all seeds — the C7 re-key's direct win; the 1337×1.5
   monopoly death is scored in item 2). Monotonic: freeboard, submerged
   share and peaks on every seed across the whole sweep; land area on
   the wet side only, with the dry-end inversion attributed to the v1
   oceanic-branch creation datums (§3) rather than to the vertical axis
   this program rebuilt. The gate as WRITTEN assumed inventory-fixed
   land; the measured model says land = inventory × flooding, and the
   flooding response is now honest. Owner reads the attribution and
   judges.
2. **Health floors across the grid: PASS on 11/12; one named death.**
   All live cells: monopoly ≤ 30 Myr (0 on 9), dispersal 92.0–100%,
   last tectonic event ≥ 4434 Myr, no NaN anywhere (tripwire silent).
   Seed 1337 × water 1.5 dies the documented monopoly death (>85% plate
   from ~2.9 Gyr, last event 2927 Myr, tectonically flat and drowned by
   4.5 Gyr) — the V2 kinematic fragility family from the sweep
   campaign's cliff notes, in a cell no stage ever ran before. Provably
   not the C7 re-key (§1: the floor never engages above −3306 m; this
   run's sea min is −1476 m) and not a columns-datum failure shape
   (creation was alive until the rifts stopped). Attribution probes
   (flag-off same cell; water 1.6 same seed) are in §6; the cell stands
   as a real, honestly-reported acceptance miss for the owner.
3. **Freeboard (< 1.5 km at scale 1.0; partial-win band 1.5–2.5 km;
   < 1.0 km somewhere in the sweep): the sweep verdict is the win the
   owner pre-authorized; scale 1.0 alone misses.** At scale 1.0:
   2899–3108 m — above even the partial-win band (the C6 finding,
   unchanged, mechanism understood: emergent margins lifted the mean
   ~200 m over C5). Across the sweep: < 1.5 km at scale 2.0 on all
   seeds (and seed 1 at 1.5 misses by 141 m), < 1.0 km at scale 2.0 on
   all seeds (522/995/998). Owner decision §11.2 defined the win as
   "the physics is right across the water sweep" — that is what §3
   measures. The closure-check-4 equation said this from the start: a
   39 km column over a scale-1.0 sea STANDS 2.4 km proud; the freeboard
   gap and the water deficit are one fact.
4. **Hypsometry band gate (≥ 40% of land in (0, 800 m]): MISS everywhere
   — the honest residual gap.** Best live-world values 19.2–19.5%
   (seed 1 at 1.0 and 2.0); the servo world held 6.3–7.0%. The model
   tripled band occupancy and the band rises with water, but land
   remains too concentrated above 800 m: platform interiors erode toward
   base level at the measured src ≈ 4.5–10 m/Myr against the 4.7 m/Myr
   budget, yet 4.5 Gyr is not enough to plane 2–3 km of freeboard at
   scale 1.0 (the planation-budget arithmetic of proposal §2.3 said
   ~3 Gyr for 2 km — marginal, and the measured sink-side saturation
   16–54% eats part of it). At Earth-ward endowments the equilibrium
   column starts closer to base level and band% still stalls at ~16–20:
   the residual is relief SHAPE (orogen-belt-heavy land, cap-limited
   summits) — the collapse-rate successor's territory (§9 risk 5), not
   a servo to re-add. Reported as the program's remaining Earth-shape
   gap, with the direction right and the magnitude quantified.
5. **Land 25–35% (area-weighted, dynamic sea): PASS at scale 1.5
   (27.0–28.1); above at 1.0 (38.5–38.9, the C6 watch item 5 number);
   below at 2.0 (21.0–22.0).** The band was written against Earth; the
   scale that hits it is the Earth-flooding scale — consistent with
   every other instrument (§5).
6. **Structure: crust fraction 0.35–0.45: PASS on all live wet cells
   (0.364–0.399); below at scale 0.5 (0.286–0.310, the §3 inventory
   coupling — revived from 0.035–0.05 but creation still runs slow
   under a −4.1 km sea).** Supercontinent epochs (largest land
   component ≥ 0.5 of land): PASS at scale 1.0 on every seed
   (0.513–0.563 late; 1337 final frame 0.853); fragmenting with water
   (0.13–0.26 at 1.5–2.0) — "Earths are wetter and patchier, Pangaeas
   are dry", now a three-seed regularity. Submerged-share watch band
   10–35%: scale 1.5 sits at 27.8–33.5 ≈ Earth; 1.0 at 2.4–4.1 (dry);
   2.0 at 41–48 (above).
7. **Peaks 5–9 km at scale 1.0: PASS (6.4–6.7 km).** Shallow-ocean
   share 4–10%: at scale 1.5, 5.2–7.5% — the C6 finding standing on
   three seeds… of which one is dead; on the two live seeds, in-band.
   At 1.0: 3.3–3.6 (the C6 miss, endowment-attributed there); at 2.0:
   2.6–2.9 (margins drown 1.3 km below the +0.5 km sea — below the
   shelf band; the fixed β stop cannot track every sea, by design).
8. **Determinism/process: PASS.** Flag-off byte-identity structural +
   golden-verified (all 25 spines); the engaged/isolated flag arms
   unchanged; zero RNG in every columns writer including the C7 floor;
   scale-1.0 digit-identity with C6 across all three seeds doubles as a
   cross-run determinism check. Kernel suite 508/508 in ~63 s (budget
   note honored; the 4 new fixtures are sub-second).

**Scoreboard vs r9-both (the beat-the-servo reference, phase-0 numbers):**

| | r9-both (servo best, scale 1.0) | columns @ 1.0 | columns @ 1.5 (live seeds) |
|---|---|---|---|
| mean freeboard | 2484–3085 m | 2899–3108 m (par) | **1641–1963 m** |
| band% of land | ~6–7% (flag-off proxy) | 10.7–19.2 | 15.4–15.6 |
| landA (dynamic sea) | 33.8–34.4% | 38.5–38.9% | 27.0–28.1% |
| submerged share | 12.4–16.0% | 2.4–4.1% | **27.8–33.5% ≈ Earth** |
| shallow seas | (not printed) | 3.3–3.6% | **5.2–7.5% in-band** |
| supercontinent (largest land comp, late) | 0.415–0.482 | **0.513–0.563** | 0.222–0.262 |
| peaks above sea | 5.9–6.0 km | 6.4–6.7 km | 5.1–5.4 km |
| water response | **neutralized** (less water = less land) | monotonic freeboard/flooding/peaks on every live seed | same |
| crust fraction | 0.379–0.393 | 0.385–0.398 | 0.381–0.399 |

At the shared endowment the column world matches the tuned servo optimum
on area/structure/peaks, beats it on supercontinent coherence and band
occupancy, and ties on freeboard — while doing it with a mass budget and
zero vertical servos. Its real win is the row the servo cannot enter at
any tuning: the endowment axis works.

## 5. The default-endowment decision (owner, product) — quantified

The two carried datum-vs-endowment items (C5 creation, C6 margin/shelf)
plus this stage's grid all point the same way: the model's fixed datums
are Earth-calibrated, and the scale-1.0 planet is simply DRIER than the
calibration (sea −1.6…−1.9 km vs Earth ≈ 0 over the datum). What each
candidate default buys, measured:

- **Scale 1.0 (status quo):** the best supercontinent storytelling
  (0.51–0.56 late, near-Pangea finals), peaks 6.4–6.7 km, land 38–39%;
  freeboard 2.9–3.1 km, submerged 2–4%, shallow 3.3–3.6% — a proud, dry
  world with Earth's structure but not Earth's coastline regime.
- **Scale 1.5 (the §11.2 anticipated candidate):** Earth-like flooding
  (submerged 28–34% ≈ 25%), shallow seas in-band (5.2–7.5%), land
  27–28% in the Earth band, freeboard 1.6–2.0 km (partial-win band),
  peaks 5.1–5.4 km — at the cost of fragmented land (largest comp
  0.22–0.26) and, on this grid, the seed-1337 kinematic death (§4.2,
  §6 probes).
- **Scale 2.0:** freeboard 0.5–1.0 km ≈ Earth and fully alive on all
  three seeds, but land 21–22%, archipelago shape (0.13–0.16), shallow
  seas below band, peaks 4.0–4.3 km.

No recommendation is baked into the mechanism (the flag and physics are
scale-agnostic); the record's read: **scale 1.5 is the Earth-likeness
optimum and scale 1.0 the drama optimum**, and the 1337×1.5 death must
be adjudicated (or the default seed set re-drawn) before 1.5 could ship
as default. This is §11 answer 2's deferred product choice, now with its
price list.

## 6. The seed-1337 × water-1.5 death — attribution probes

Two paired 4.5 Gyr N=64 probes bracket the dead cell:

- **Same cell, flag OFF: alive.** Dispersal 96.9%, monopoly 0 Myr, last
  tectonic event 4470 Myr, final land 28.4%. The legacy arm at the same
  seed × endowment survives — so the death is not a property of the
  shared kinematic engine at this endowment; it is the columns arm's own
  trajectory (the two arms diverge chaotically from onset, so this is
  one sample per arm, not a controlled A/B of mechanism health).
- **Same seed, water 1.6, columns: fully alive.** Dispersal 100.0%
  (every keyframe), monopoly 0, last event 4458 Myr — and squarely in
  the Earth regime (freeboard 1772 m, submerged 30.9%, landA 26.8%,
  crust fraction 0.380). One tick of endowment away, the same seed
  produces the program's healthiest kinematic history.

Verdict: a knife-edge, single-trajectory event of the documented V2
monopoly-death family (a late supercontinent consolidates and the
size/stress-keyed rift hazard stops firing), drawn once in the thirteen
columns cells measured at deep time (12 grid + the 1.6 probe) — not an
endowment basin, not a creation-datum failure (creation ran until the
rifts stopped), and provably untouched by the C7 re-key (§1). The honest
statement for the acceptance grid: per-seed deep-time survival at
off-default endowments is ~92% measured, with the failure mode
pre-existing, named, and kinematic. Whether that number gates the
scale-1.5 default (or motivates hazard-side work in the V2 trio's
territory, where the sweep campaign's cliff notes already live) is the
owner's §5/§9 call.

## 7. N=128 replication (the shipped default grid)

Two 4.5 Gyr runs, seed 42, scales 1.0 and 1.5, N=128 — the handover §9
requirement ("replicate any final calibration at N=128 before
promotion"), and it earns its keep: the qualitative story replicates,
the quantitative equilibrium does not.

| | N=64 @ 1.0 | **N=128 @ 1.0** | N=64 @ 1.5 | **N=128 @ 1.5** |
|---|---|---|---|---|
| alive (disp/monopoly/last event) | 99.8/0/4435 | 97.3%/0/4497 | 97.6/0/4434 | 99.1%/0/4466 |
| cont crust fraction late | 0.388 | **0.303** | 0.381 | **0.321** |
| sea late, m | −1766 | −2421 | −556 | −1047 |
| mean freeboard late, m | 3108 | 2938 | 1963 | 1699 |
| landA% late | 38.5 | 31.0 | 28.1 | 27.9 |
| band% late | 12.6 | 8.7 | 15.6 | **37.7** |
| submerged% late | 3.2 | 0.2 | 27.8 | 14.2 |
| shallow% late | 3.3 | 3.1 | 7.5 | 3.4 |
| peaks above sea late, m | 6566 | 7221 | 5356 | 5847 |
| mass final, e21 kg (t=0 28.6) | 30.5 | 25.5 | 31.6 | 25.9 |
| cmin run-min / reg | −2306 / 0 | −2306 / 0 | −2306 / 0 | −2306 / 0 |
| retC final | 437 | 2118 | 429 | 4586 |

**What replicates:** aliveness and tempo (dispersal 97–99%, monopoly 0,
last events > 4.45 Gyr at both endowments); the monotonic water axis
(freeboard 2938 → 1699, submergence 0.2 → 14.2 across 1.0 → 1.5); the
structural floors (cmin pinned at −2306 bit-exactly, reg 0.00, zero
elevation-cap events); the character in the dumps — the N=128 frames
resolve narrow orogenic spines over broad green lowlands with crisp
ridge fabric and are the most Earth-like maps the program has produced
(inspected; the scale-1.5 final frame especially).

**What does not: the creation–consumption equilibrium drifts with
resolution.** Crust fraction settles at 0.30–0.32 late — BELOW the T3
0.35–0.45 band that N=64 sits inside — with the sea correspondingly
~0.5–0.65 km lower, land at 1.0 down to 31%, and total mass drifting
−10% instead of +7…+10%. The arc machinery carries explicit N-scaling
(`ARC_CREATION_REFERENCE_GRID_N`: per-cell rate and belt width both
∝ N/32) and creation per area indeed holds (crea 120–145 vs 108–120),
but the consumption side scales FASTER at fine grid: the founder/
retirement layer sees many more small components (retC 2118–4586 vs
~430 — component granularity is resolution-dependent) and trim runs
38–24 vs 24–25 m/Myr, so the inventory equilibrates lower. One genuine
hypsometry surprise, in-family with the granularity story: at scale 1.5
band occupancy nearly reaches the Earth-shape gate (37.7% vs ≥ 40%,
N=64: 15.6%) — the chunky N=64 belts under-resolved exactly the coastal
lowland band the gate reads, so §4.4's miss is partly a RESOLUTION
artifact, and the shipped-grid Earth-candidate world stands one knife
edge from the discriminating gate.

Verdict for the promotion decision: the N=64 gate tables are the right
MECHANISM evidence (every stage's A/B was N=64-internal), but the
shipped world is the N=128 world, and its budget sits ~6 points of
crust fraction below the N=64 calibration. Pre-registered response
shapes, for the owner: accept the N=128 numbers as the shipped truth
and re-anchor the T3 band (the world is alive, Earth-shaped, and
floor-sound there); or charter a resolution-invariance pass on the
founder/retirement granularity terms (the one consumption family
without explicit N-scaling) before the flip. Both are one-decision
items; neither is a servo.

## 8. Watch items (carried / updated)

1. **Crustal-mass drift — now sweep-scored.** Per 4.5 Gyr: −6…+1% at
   scale 0.5 (the dry world nets slightly negative: slow creation, full
   emergence feeding erosion), +2.7…+9.8% at 1.0 (the C6 numbers),
   +9…+11% at 1.5–2.0 live cells. Bounded, declared, no runaway; the
   wet-side positive drift tracks the higher maturation flux. Carried.
2. **Land shape vs endowment (new form of the resolved C6 item):** the
   supercontinent property is now measured to be endowment-keyed on
   three seeds (§4.6). Not a defect — a documented world-character axis.
3. **The dry-end land inversion (§3):** the v1 oceanic branch's
   sea-keyed creation datums couple crust inventory to endowment. The
   named successor issue (accrued oceanic thickness / absolute oceanic
   datums) owns it; until then the sweep's landA row carries the
   attribution note.
4. **Band occupancy (§4.4):** the remaining Earth-shape gap, direction
   right, magnitude 2–3× short of the 40% gate. Routed to the
   collapse-rate successor (proposal §9 risk 5) and/or a measured
   erosion-efficiency pass — never a servo.
5. **Kinematic fragility at off-default endowments (§4.2, §6):** first
   measured instance of the V2 monopoly death inside the acceptance
   grid. Whether this gates the 1.5 default is the owner's §5 call.
6. **NEW — resolution drift in the crust budget (§7):** the shipped
   N=128 grid equilibrates ~6 points of crust fraction below the N=64
   calibration (0.30–0.32 vs 0.385–0.398), driven by the
   resolution-dependent granularity of the founder/retirement layer
   (retC 2118–4586 vs ~430) against N-scaled creation. Pre-promotion
   decision item: re-anchor T3 to the shipped grid, or charter the
   resolution-invariance pass. Paired upside, same cause: N=128
   resolves the coastal-lowland band the hypsometry gate reads
   (band 37.7% at scale 1.5 vs the ≥ 40% gate).

## 9. Promotion checklist (all awaiting owner sign-off — none executed)

Per proposal §6 C7 / §8 and the §11 answer-4 cadence: the promotion
commit is defaults-on + KBV bump (→ 20) + full golden regen + the
pre-promotion default spine pinned verbatim + the `ARCHITECTURE.md`
promotion rewrite. None of that is in this branch: the mechanism stays
default-off, KBV 19, all flag-off spines byte-identical to v18, and this
record + the sweep evidence are the sign-off package. Open items for the
gate conversation, in the order they bind: (1) accept/score the 11/12
alive verdict and the 1337×1.5 death (§6 probes attached); (2) the
freeboard sweep-win reading under §11.2; (3) the band-gate miss routed
to successors vs blocking; (4) the default-endowment product choice
(§5); (5) if promoting: at which endowment, and whether the water sweep
becomes a standing CI probe.
