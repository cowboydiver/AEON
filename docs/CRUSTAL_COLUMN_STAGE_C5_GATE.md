# Crustal columns — stage C5 gate record (founder/retirement re-keys + the structural floor)

**Status: C5 landed and measured, default-off. Every pre-registered gate
passes: the T2 floor is now STRUCTURAL and measured — min continental
elevation pins at e(T_min) = −2306 m bit-exactly on every seed for the whole
4.5 Gyr (no ratchet; the −17.8 km failure shape is non-expressible), and it
holds even on a water-0.5 world whose sea falls 2.6 km BELOW the floor; the
one-time regularization credit is exactly the predicted ≈ nil (0.00 m over
continental area on every seed); the thickness-keyed retirement is reachable
at the shipped endowment (400–567 cells retired) and provably sea-gated (39
on the dry probe — crust hoarding, as designed); the consumption side of the
mass budget is printed for the first time and the total ledger tightens to
+1–15%/4.5 Gyr (C4: +8–20%). All floors hold. One NEW FINDING outside this
stage's gates, measured by the first off-scale water probe and scoped to C7:
at water scale 0.5 the sea falls below the ABSOLUTE maturation gate's reach
while the arc growth ceiling stays SEA-KEYED, so continental creation
starves (matF → 0) and crust fraction collapses 40% → 3.5% — the trap-T3
divergence the C4 record predicted for the sweep, now with its mechanism
pinned. Next per the staged plan: C6 margins, then C7 calibration + the
water sweep, which must resolve the creation-datum mismatch.**

Companions: `CRUSTAL_COLUMN_PROPOSAL.md` (§5 sites 4/17/19/20, §6 C5, §8
T2/T3, §9 risk 3), `CRUSTAL_COLUMN_STAGE_C4_GATE.md` (the world this stage
builds on and is scored against), `CRUSTAL_COLUMN_STAGE_C3_GATE.md` (the
site-20 pull-forward this stage completes), C2/C0-C1 records (protocol +
baselines).

Commits: kernel `93a3386` (sites 4/17/19 + onset regularization + the
structural floor + fixtures + flag-arm golden regen, no KBV bump per the
owner's cadence decision, proposal §11 answer 4); sim-cli `674e7fd`
(cmin/reg/trim/ret/retC gate columns). All measurements N=64, seeds
{1, 42, 1337}, 4.5 Gyr, flag-on (onset 0), scored against the C4 gate
record's tables (the flag-off path is byte-identical across C2→C5 by
construction; its baselines are unchanged from the C2/C3 records), this
container.

## 1. What landed

On the columns path only (flag-off byte-identical; all 25 flag-off spines
bit-unchanged; only the two flag-arm spines regenerated):

- **Site 4, the isolated-sliver founder:** a stranded one-cell fragment is
  thinned crust — it trims to `CONTINENTAL_THICKNESS_MIN_M` (20 km) and its
  column rests at e(T_min) = −2306 m *definitionally*, replacing the
  sea-keyed elevation clamp (one less sea-keyed target — T1). The trim is
  the declared founder debit, counted (`columnsFounderTrimM3`).
- **Site 19, the crustFates founder + retirement:** foundering is now
  crustal THINNING toward the identity floor (the same 1e-3 m/yr surface
  rate read through the derivation, ΔT = Δe/k, with a physical stop — the
  T2 "a rate needs a stop" audit closed), and the retirement trigger
  re-keys to thickness: a small component retires only when wholly
  SUBMERGED (below the lagged dynamic sea — still never a land-mask pop)
  AND wholly AT THE FLOOR (T ≤ T_min + ε). The legacy trigger (max elev ≤
  sea − 200) is unreachable once foundered columns rest at −2306 m on any
  sea above −2106 m; the consequence on seas BELOW the floor is stated
  honestly and now measured (§3): foundered fragments stand emergent and
  crust is hoarded — physical, watched via `columnsRetiredCells`.
  Retirement debits counted (`columnsRetiredDebitM3`).
- **The one-time onset regularization** `T := max(T, T_min)` over
  continental cells closes the C1–C4 shim-era validity domain (the legacy
  pump's flooded lobe); the credit is the §9 risk 3 reported A/B statistic
  (`columnsRegularizedCreditM3`).
- **The structural floor (T2), everywhere:** every remaining sea-keyed
  thinning stop bottoms out at `CONTINENTAL_FLOOR_ELEVATION_M` = e(T_min) —
  the site-21 margin shim, erosion's coastal-export and marine-planation
  base levels, and the site-17 blockIsostasy cap. All inert on seas above
  the floor (every measured scale-1.0 sea); they bind only on the dry half
  of the water sweep, which the w05 probe exercised for real (§3).
- **Site 17, blockIsostasy:** stays default-off and superseded; under
  columns its cap is floored (above). Redundancy measured, not asserted
  (§4 item 3).
- **C5 diagnostics** (same contract as C2–C4; flag-off holds 0):
  `columnsRegularizedCreditM3` / `columnsFounderTrimM3` /
  `columnsRetiredDebitM3` / `columnsRetiredCells`; `--crust-stats` prints
  `cmin` (min continental elevation — the floor gate read directly), `reg`
  (cumulative regularization credit, rock m over continental area),
  `trim` / `ret` (founder and retirement debits, rock m/Myr over
  continental area — the consumption side answering the C4 `crea`/`accr`
  creation print) and `retC` (cumulative retired cells — the reachability
  audit's numerator).

Verified: 499/499 kernel tests, incl. new fixtures — the T2 floor fixture
through the full default pipeline (live from this stage, as
pre-registered), onset-regularization credit arithmetic, site-4 trim
directionality on both arms + idempotence, site-19 thinning-stop + retire
sequencing, the dry-sea no-retirement directional fixture (hoarding), and
margin-shim + erosion floors binding on a −4000 m sea. Flag-off arm
untouched byte-for-byte.

## 2. Measurements (scale 1.0)

"C4" = the C4 gate record's flag-on world; "C5" = this stage. "Late" =
past-1-Gyr keyframe mean.

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| **run-min cont elevation, m (the T2 gate)** | **−2306** | **−2306** | **−2306** |
| late mean cmin, m | −2305 | −2306 | −2306 |
| **regularization credit `reg`, m over cont area** | **0.00** | **0.00** | **0.00** |
| late cont crust fraction (T3 band 0.35–0.45; C4: 0.391/0.381/0.380) | 0.399 | 0.379 | 0.375 |
| late mean freeboard, m (C4: 2651/2870/3051) | 2668 | 2929 | 2859 |
| late mean band% (C4: 14.7/13.7/13.3) | 14.5 | 13.9 | 14.7 |
| late mean landA% (C4: 32.1/32.3/33.3) | 33.1 | 32.4 | 31.9 |
| landA% run min (C4: 26.1/27.7/29.1) | 28.6 | 29.3 | 28.8 |
| peaks above sea ≥1 Gyr, mean (range) | 6474 (6133–7045) | 6680 (6306–7055) | 6801 (6490–7227) |
| final Tmean / Tmin / Tmax, km | 45.0 / **20.0** / 69.9 | 44.7 / **20.0** / 69.9 | 44.6 / **20.0** / 69.9 |
| final crustal mass, e21 kg (t=0: 28.7; C4: 34.4/31.2/31.1) | 32.9 | 29.1 | 29.0 |
| trim late (founder debit) / ret late, m/Myr over cont area | 22.7 / 0.18 | 24.8 / 0.27 | 22.6 / 0.20 |
| retired cells `retC` (cumulative) | 434 | 567 | 400 |
| matF late per 10 Myr / crea late (C4 instruments, non-regression) | 403 / 106 | 428 / 116 | 393 / 108 |
| thickness-cap binds (C4: 14.6/15.3/16.2M) | 14.9M | 16.1M | 14.6M |
| dispersal / monopoly (C4: 97.8/96.7/97.8% / 0) | 97.6% / 0 | 98.0% / 0 | 98.7% / 0 |
| last tectonic event, Myr | 4461 | 4456 | 4462 |
| late land components / largest comp (C4: 213/0.342, 200/0.375, 196/0.371) | 212 / 0.382 | 200 / 0.342 | 207 / 0.385 |
| `metrics` cell-count land min % (side-by-side rule; floors gate on landA) | 18.8 | 19.5 | 17.6 |

PNGs (seed 42 flipbook, t=0 → 4.5 Gyr, inspected): the C4 look holds —
coherent continental blocks, brown highland interiors ringed by green
coastal lowlands (the band made visible), shelf halos, ridge fabric; no
archipelago regression, no new artifacts. Numbers and maps agree.

## 3. The water-0.5 probe (retirement reachability + the floor under a dry sea)

One 4.5 Gyr N=64 run, seed 42, `--water-scale 0.5` — the first deep-time
run of this program on the dry half of the sweep. Late means: sea
−4960 m, cont fraction **0.050**, freeboard 6.1 km, landA 7.4%, matF **0**.

- **The floor held where it finally binds: cmin pinned at −2306 m for the
  whole run** while the sea fell to −5.0 km — 2.7 km below the floor. On
  the servo model this configuration is exactly the one that ratcheted
  flooded interiors to −17.8 km; in thickness space it is non-expressible,
  and the measurement agrees. This is the T2 headline, demonstrated in the
  regime it was designed for.
- **Retirement reachability, measured both ways:** 400–567 retirements at
  scale 1.0 (seas 0.5–1.0 km above the floor — foundered fragments drown
  and the debit fires) vs **39** on the dry world (fragments rest emergent
  at −2306 over a −5.0 km sea; crust is hoarded, exactly the §5 site-19
  consequence, visible not silent).
- **NEW FINDING (T3, scoped to C7 — not a C5 gate):** the dry world's
  continental system COLLAPSES — crust fraction 40% → 3.5% by 2.5 Gyr, a
  600 Myr monopoly window, land min 0.7%. Mechanism pinned: the arc GROWTH
  ceiling is sea-keyed (`platformDatumOffsetM + ARC_MAX_ELEVATION_M` ≈
  sea + 1 km, boundaries.ts:264 — deliberately untouched v1 oceanic-branch
  machinery, proposal §2.1) while the C4 maturation gate is ABSOLUTE
  (−2306 m). Once the sea falls below ≈ −3.3 km, arcs cap ~1 km above the
  sea and can never reach the gate: creation goes to zero (matF = 0 from
  ~0.4 Gyr on) while collision consumption continues, and the crust
  inventory drains. The C4 record predicted the gates "genuinely diverge"
  across the sweep; this is that divergence, with sign and mechanism. The
  §7 alt-world acceptance gate ("all four water-scale worlds tectonically
  alive") is currently FAILED on the dry half — a C7 design item (the
  creation datum mismatch: either the growth ceiling learns the absolute
  datum's reach, or the maturation gate's fallback band is invoked —
  20–25 km, pre-registered — or the v1 arc scope fence is revisited).
  Recorded as the program's top open risk going into C7; nothing in C5's
  own scope caused or can fix it (the same collapse reproduces at C4 by
  construction — no C5 mechanism is involved in the creation path).

## 4. Gate scoring (pre-registered, proposal §6 C5)

1. **Min continental elevation ≥ e(T_min) = −2306 m from here on: PASS,
   bit-exact.** Run-min cmin −2306 on all seeds (and on the dry probe);
   the pipeline T2 fixture asserts it structurally at every keyframe. The
   floor is enforced by construction (no thinning writer can cross it),
   not policed by a clamp on a servo.
2. **No ratchet over 4.5 Gyr: PASS.** The cmin time series is CONSTANT at
   the floor once the first fragments founder (late means −2305…−2306);
   nothing drifts, even under a sea 2.7 km below the floor (§3).
3. **Regularization credit reported (§9 risk 3): PASS, ≈ nil as
   predicted.** `reg` = 0.00 m over continental area on every seed — the
   C3-addendum measurement (the lobe dissipated when the pump retired)
   confirmed; the re-staging trigger is moot. The credit fixture proves
   the accounting works where the lobe exists (unit world at −4000 m).
4. **Flooded share reported (watch band):** late submerged share of
   continental crust 16.7–19.2% at the measured seas (finals 10.2–16.6%)
   — inside the Earth-like 10–35% watch band (Earth ~25%), unchanged in
   regime from C4 (not a gate; carried to C7).
5. **Retirement-reachability audit across the sweep seas: DELIVERED**
   (§3) — reachable at scale 1.0, sea-gated shut on the dry half, both
   measured, plus the directional kernel fixtures both ways.
6. **Site-17 redundancy measured:** a 1 Gyr N=64 A/B (columns vs columns +
   blockIsostasy) differs by −2.5 pt landA / −3.3 pt crust fraction /
   +1.2 pt band — same order as single-arm chaotic variability at 1 Gyr,
   so the residual is bounded but not provably nil; the cap is NOT
   structurally redundant (it still planes above-cap small-block relief,
   now floored at e(T_min)). Verdict: the tall-small-block pathology it
   existed for is structurally superseded on the columns path (slivers and
   small components thin to the floor and drown), the prototype stays
   default-off exactly as today, and any future default-on proposal owes
   its own measured case as declared flexure. No silent servo kept.
7. **Re-armed C2–C4 gates, non-regression: PASS.** Band 13.9–14.7 vs C4's
   13.3–14.7; freeboard 2668–2929 vs 2651–3051 (noise); landA late
   31.9–33.1, mins 28.6–29.3 (best of the program); peaks 6.1–7.2 km in
   the 5–9 km band; crust fraction 0.375–0.399 in the T3 band; cap binds
   14.6–16.1M (C4: 14.6–16.2M); zero elevation-cap events, structurally;
   maturation instruments unchanged (matF ~390–430/10 Myr, flip-weighted
   late matE −1504…−1560 — the sea-independent band, closure check 3).
8. **The mass ledger, both sides printed:** creation crea 106–116 +
   accr 2.6–3.0 m/Myr vs consumption src 6.6–7.8 + sink 4.1–4.9 + trim
   22.6–24.8 + ret 0.18–0.27 m/Myr. The founder trim — until now an invisible shim flow —
   is measured as the LARGEST single consumption term. Net: total mass
   +1.0–1.4% per 4.5 Gyr on seeds 42/1337 (28.7 → 29.0–29.1e21 kg — the
   tightest ledger of the program; C4 was +8–9%) and +15% on seed 1
   (32.9e21; C4 +20% — the late high-crust epoch watch item, §5).

**Floors:** landA run minima 28.6–29.3% (≥ 20% with margin); dispersal
97.6–98.7%; monopoly 0 Myr everywhere; last tectonic event ≥ 4456 Myr; no
NaN (CLI tripwire silent). **All PASS.**

## 5. Watch items (carried / updated)

1. **Seed-1 crustal mass** +15%/4.5 Gyr (C4: +20%; the C5 debits eat part
   of it). Still correlated with the late high-crust epoch (late fraction
   0.399, top of the seeds). Score at C7.
2. **Land shape** — largest land component 0.34–0.39 late vs flag-off
   0.40–0.44 (unchanged from C3/C4; seed-1 final frame reaches 0.46 with
   a 0.95-of-continental-area supercontinent). C7 scoreboard item.
3. **NEW — the creation-datum mismatch (T3/C7, §3):** sea-keyed arc
   ceiling vs absolute maturation gate starves creation once the sea falls
   below ≈ −3.3 km; the water sweep's dry half is currently a dead world.
   THE open design item for C7; the pre-registered fallback knob
   (`ARC_MATURATION_THICKNESS_M` 20–25 km) cannot address it (the gate
   already sits at the band's bottom), so the resolution lives in the arc
   scope fence (proposal §2.1/§11 answer 3) and needs the owner at the C7
   gate.
4. **Founder trim magnitude** — 22.6–24.8 m/Myr over continental area is
   the largest consumption flux (the legacy shim destroyed the same order
   silently in elevation space; now it is visible). Physically it is
   margin/collision debris recycling into the mantle wedge. Watch at C6/C7
   for interaction with the margin re-key.

**Stage C5 is complete: all pre-registered gates pass, all floors hold,
the shim-era validity domain is closed, and the T2 floor is structural and
measured — including under a sea 2.7 km below it. Next per the staged
plan: C6 margins (the last shim), then C7 calibration + the water sweep,
which now has a named, mechanism-pinned blocker to resolve (watch item 3).**
