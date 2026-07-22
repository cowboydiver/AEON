# Crustal columns — stage C6 gate record (rift-margin thinning: the last shim retired)

**Status: C6 landed and measured, default-off. The migration is
MECHANISM-COMPLETE: every continental write site is now a thickness
transaction — the site-21 passive margin, the model's last shim AND last
sea-keyed relaxation target, is retired for finite-β rift thinning (bands
thin at the legacy surface rate toward the 30 km stretch budget and STOP;
the trap-T1 property "no relaxation target in the final model reads sea
level" now holds for the whole model, fixture-proven sea-independent).
Two of the three pre-registered gates pass outright (the β-budget stop,
bit-exact; shelf halos visible); the shallow-ocean gate MISSES at water
scale 1.0 — 3.3–3.6% late vs the 4–10% band — and the paired probes pin
both the attribution and the physics: the C5 shim MANUFACTURED the
in-band number by holding margins at sea − 150 under any sea (C5 code
measures 8.6% on the same seed), while the C6 fixed datum returns the
property emergently at Earth-like endowment (water 1.5: shallow 7.5%,
submerged share 27.8% ≈ Earth's ~25%, freeboard down 1.1 km into the
partial-win band) — the shelf regime is an ENDOWMENT fact flowing through
fixed physics, which is the alt-world honesty the redesign exists for.
The β knob stays untouched (fitting it to re-submerge margins under the
scale-1.0 sea would re-key the stop to the current sea by hand — the
servo shape this program retires — and would break the water-1.5 world it
just fixed). All C2–C5 floors hold at program-best levels, the ledger's
consumption side is fully counted for the first time (the margin debit,
~50 m/Myr, is the largest single term — the shim destroyed more, silently),
and the C3-era land-shape watch item RESOLVES (largest land component
0.51–0.56 of land late vs 0.34–0.39 — emergent margins reconnect the
continents; seed 1337 ends in a 0.85-of-land supercontinent). Next per
the staged plan: C7 calibration + the water sweep, which now owns two
named datum-vs-endowment items (the creation datum from C5, the
margin/shelf datum from this stage) and the default-endowment product
decision.**

Companions: `CRUSTAL_COLUMN_PROPOSAL.md` (§5 site 21, §6 C6, §8 T1/T2,
§11 answer 2), `CRUSTAL_COLUMN_STAGE_C5_GATE.md` (the world this stage
builds on and is scored against), C4/C3/C2/C0-C1 records (protocol +
baselines).

Commits: kernel `0eb99e9` (site 21 + fixtures + engaged flag-arm golden
regen, no KBV bump per the owner's cadence decision, proposal §11 answer
4); sim-cli `152ff5c` (the `marg` gate column). All measurements N=64,
seeds {1, 42, 1337}, 4.5 Gyr, flag-on (onset 0), scored against the C5
gate record's tables (the flag-off path is byte-identical across C2→C6
by construction), this container.

## 1. What landed

On the columns path only (flag-off byte-identical; all 25 flag-off spines
bit-unchanged; only the ENGAGED flag-arm spine regenerated — the isolated
arm runs with `freeboard` off and is untouched):

- **Site 21, the passive margin (freeboard.ts term 2):** the band
  geometry is unchanged (same-plate ocean adjacency, BFS width 2,
  convergent coasts excluded), but the write is now rift-margin
  THINNING, a native thickness transaction:
  - **Rate** — the legacy surface rate read through the derivation,
    dT = (2e-5 m/yr)/k ≈ 140 m/Myr of thickness, so the surface answers
    at exactly the old `PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR`. C6 changes
    the STOP, not the rate (fixture: k·dT = 20 m/step).
  - **Stop** — the finite stretch budget
    `CONTINENTAL_REFERENCE_THICKNESS_M / MARGIN_STRETCH_FACTOR` = 30 km
    (β = 1.3, McKenzie 1978), e(30 km) ≈ −882 m: a FIXED thickness.
    Never the 20 km identity floor (the T2 unbounded-grind shape — a
    constant rate needs a stop), and never a sea-keyed level: the
    sea-keyed shelf target (sea − 150, C5-floored) is deleted, retiring
    the model's LAST sea-keyed relaxation target (T1 closed for the
    final model, exactly as proposal §8 promised). Columns at or below
    the budget are never touched (a stop, not an attractor).
  - **Ledger** — the thinned volume is the declared post-rift subsidence
    debit, counted on true areas (`columnsMarginThinnedM3`; v1's fixed
    grid cannot spread a stretched column laterally, so the volume is
    declared, not transported). Every non-conserving flow in the model
    is now declared and counted.
- **C6 diagnostic** (same contract as C2–C5; flag-off holds 0):
  `--crust-stats` gains `marg` (margin-thinning debit, rock m/Myr over
  continental area) — the last consumption term, completing the ledger
  print.

Verified: 504/504 kernel tests, incl. new fixtures — budget-stop
directionality (band cells settle bit-exactly AT 30 km and never below),
stop-not-attractor (25 km columns untouched), **sea-independence
(identical bytes under a −500 m and a −4000 m sea — the T1 claim as a
fixture, not a promise)**, surface-rate equivalence, the unchanged
legacy arm, the counted debit; the C5 T2/coherence fixtures hold through
the new writer. Flag-off arm untouched byte-for-byte.

## 2. Measurements (scale 1.0)

"C5" = the C5 gate record's flag-on world; "C6" = this stage. "Late" =
past-1-Gyr keyframe mean.

| | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| **late shallow-ocean share (the C6 gate; band 4–10%)** | **3.6%** | **3.3%** | **3.5%** |
| shallow% late range | 2.5–4.9 | 2.0–4.8 | 2.1–5.2 |
| late submerged cont share (watch band 10–35%; C5: 16.7–19.2) | 4.1% | 3.2% | 2.4% |
| late cont crust fraction (T3 band 0.35–0.45; C5: 0.399/0.379/0.375) | 0.398 | 0.388 | 0.385 |
| late mean freeboard, m (C5: 2668/2929/2859) | 2899 | 3108 | 3105 |
| late mean band% (C5: 14.5/13.9/14.7) | 19.2 | 12.6 | 10.7 |
| late mean landA% (C5: 33.1/32.4/31.9) | 38.9 | 38.5 | 38.6 |
| landA% run min (C5: 28.6/29.3/28.8) | 34.9 | 35.2 | 34.0 |
| peaks above sea ≥1 Gyr, mean (range) | 6421 (6005–6699) | 6566 (6221–7046) | 6676 (6252–7080) |
| final Tmean / Tmin / Tmax, km | 45.4 / 20.0 / 69.9 | 46.1 / 20.0 / 69.9 | 45.0 / 20.0 / 69.9 |
| final crustal mass, e21 kg (t=0: 28.7; C5: 32.9/29.1/29.0) | 30.0 | 30.5 | 31.5 |
| **marg late (margin debit) / trim / ret, m/Myr over cont area** | **50.5** / 24.3 / 0.20 | **50.4** / 25.2 / 0.20 | **49.1** / 23.0 / 0.17 |
| retired cells `retC` (C5: 434/567/400) | 465 | 437 | 364 |
| run-min cmin, m (the T2 floor, re-armed) | **−2306** | **−2306** | **−2306** |
| regularization credit `reg` | 0.00 | 0.00 | 0.00 |
| matF late per 10 Myr / crea late (C5: 403/106, 428/116, 393/108) | 407 / 108 | 425 / 114 | 400 / 108 |
| src / sat% / sink late (C5 regime) | 7.3 / 16.3 / 4.5 | 7.7 / 15.9 / 4.8 | 7.6 / 18.0 / 4.6 |
| thickness-cap binds (C5: 14.9/16.1/14.6M) | 15.3M | 16.6M | 15.3M |
| dispersal / monopoly (C5: 97.6/98.0/98.7% / 0) | 98.9% / 0 | 99.8% / 0 | 99.1% / 0 |
| last tectonic event, Myr | 4491 | 4435 | 4484 |
| late land components / largest comp (C5: 212/0.382, 200/0.342, 207/0.385) | 130 / **0.513** | 131 / **0.532** | 130 / **0.563** |
| `metrics` 0 m-instrument land min % (side-by-side rule) | 21.4 | 20.6 | 19.0 |

PNGs (seed 42 flipbook t=0 → 4.5 Gyr + final frames of the other seeds,
inspected): coherent continental blocks, brown highland interiors ringed
by green coastal lowlands, ridge fabric — the C4/C5 look holds, with
visibly LARGER connected landmasses (the shape numbers above made
visible; the seed-1337 final frame is one supercontinent). Shelf halos
are present along the coasts (the oceanic sediment shelf) but thinner
than the shim era's drowned-margin aprons — consistent with the
submerged-share drop. Numbers and maps agree.

## 3. The attribution probes (what moved shallow%, and is the physics right)

**Probe A — attribution (C5 code, seed 42, scale 1.0).** A worktree at
the C5 gate commit (`5fd1595`) re-ran seed 42 under identical
instrumentation. It replicates the C5 gate record's seed-42 column
EXACTLY (freeboard 2929, landA 32.4, band 13.9, trim 24.8, ret 0.27,
retC 567, mass 29.1 — cross-container determinism, incidentally
re-verified) and measures the number no prior record printed:
**shallow% 8.6 late (range 5.8–12.1) — in-band**, submerged share 16.7%.
The C6 re-key is therefore the mover (8.6 → 3.3 on the same seed), and
the mechanism is plain: the shim held margins at sea − 150 — permanently
0–150 m below ANY sea — i.e. it MANUFACTURED in-band shallow ocean by
construction, the signature of a sea-keyed servo, retired deliberately.
The C6 margins stop at the fixed e(30 km) ≈ −882 m, which stands
1.0–1.3 km ABOVE the scale-1.0 late seas (−1.9…−2.1 km): margins emerge,
epicontinental seas drain, land area rises ~6 points, mean freeboard
rises ~200 m — one mechanism, four instrument movements, all coherent.

**Probe B — the physics (C6 code, seed 42, water scale 1.5).** Same
code, Earth-ward endowment: the sea equilibrates at −555 m, the SAME
fixed stop now sits ~330 m BELOW the sea, and the shelf regime returns
emergently — **shallow% 7.5 late, final 11.2 (in-band; Earth's shelf
seas ~7–8%); submerged share 27.8% ≈ Earth's ~25% (final 33.8); landA
28.1 late (inside the §3 25–35% target); mean freeboard 1963 m — down
1.1 km from scale 1.0, inside the pre-registered 1.5–2.5 km partial-win
band** — while the world stays alive (dispersal 97.6%, monopoly 0, last
tectonic event 4434 Myr) and CREATION stays alive (matF 420, crea 120):
the C5 creation-datum mismatch is confirmed to be a dry-half problem
only. Peaks 5.0–5.9 km — the §3 high-water scoping note measured (the
band's bottom, cap-limited, as scoped). cmin −2306 bit-pinned; marg
~52 m/Myr (margins thin at the same rate; now they drown). Land is more
fragmented (largest land component 0.26 late) — high water floods the
lowland connections; the supercontinent story belongs to drier worlds.

Together: the margin/shelf regime is an ENDOWMENT fact flowing through
fixed physics — Earth-like water gives Earth-like shelves, dry worlds
stand proud — measured on both sides with one constant and zero knobs.
The servo world could not express this (sweep §10: water was
neutralized); this is the T5 alt-world honesty the redesign exists for,
now demonstrated on the margin axis.

## 4. Gate scoring (pre-registered, proposal §6 C6)

1. **Margin thinning verifiably stops at the β budget (no cell below
   30 km by margin action alone): PASS, structural + bit-exact.** The
   writer floors every subtraction at the budget and skips cells at or
   below it; kernel fixtures prove band cells settle exactly AT 30 km
   over any number of steps, that 25 km columns are never touched, and
   that the thinning is byte-identical under a −500 m and a −4000 m sea.
   Deep-time: `marg` decays from the founding transient (~74 m/Myr, N=32
   smoke) to a sustained ~50 m/Myr as band geometry refreshes — margins
   that reach the budget stop thinning, exactly the finite-budget design.
2. **Shallow-ocean share stays in the Earth-like 4–10% band: MISS at
   water scale 1.0 — measured, attributed, and physically resolved.**
   Late means 3.3–3.6% (ranges 2.0–5.2) vs the band; probe A shows the
   C5 shim sat at 8.6% by manufacturing the number (sea-keyed target),
   probe B shows the C6 fixed datum recovers 7.5% at water 1.5 with
   Earth-like flooding. The gate's premise — that the sediment machinery
   alone would hold the band at scale 1.0 — is falsified: the sediment
   shelf contributes ~3.5%, and the balance was always the shim's
   drowned margins. Scoring verdict: the MECHANISM is correct (probe B),
   the DEFAULT PLANET is dry (T5, known since phase 0) — the finding
   routes to C7's endowment decision rather than to a mechanism change.
3. **Shelf halos visible in dumps: PASS** (eyeballed per the house
   rule) — coastal halos persist (the sea-graded sediment shelf, which
   owns shelf shallowness by design); the broad drowned-margin aprons of
   the shim era are gone, which is gate 2's fact seen in the maps.
4. **Pre-registered knob (β within the cited 1.2–2): NOT touched.**
   Re-fitting β so margins re-submerge under the scale-1.0 sea needs
   β ≈ 1.7–1.8 (stop ≈ 22–23 km, e ≈ −1.9 km): that is re-keying the
   budget to the CURRENT sea by hand — the servo shape §8 T1/T2 exist to
   retire — it parks the stop 2–3 km of thickness from the identity
   floor, and it would sink the water-1.5 world's margins 1.4 km below
   ITS sea, breaking the world probe B just validated. One fixed stop
   cannot track two seas; that is the design, not a defect. The knob
   stays at the cited 1.3; C7 adjudicates across the sweep.

**Re-armed C2–C5 gates, non-regression: PASS with two explained
movements.** Crust fraction late 0.385–0.398 in the T3 band (finals dip
to 0.349 on seeds 1/42 — epoch weather; the gate reads late means);
peaks 6.0–7.1 km in the 5–9 km band; zero elevation-cap events,
structurally; cap binds 15.3–16.6M (C5: 14.6–16.1M); cmin pinned at
−2306 bit-exactly on every seed (no ratchet; the T2 fixture holds
through the new writer); reg 0.00; retirement reachable (retC 364–465
vs C5 400–567); maturation/creation instruments unchanged (matF 400–425,
crea 108–114 — margins do not touch the creation path). The two
movements, both mechanical consequences of margins standing at e(30 km)
instead of sea − 150: mean freeboard late 2899–3108 vs C5 2668–2929
(+180–250 m — margin cells 1.0–1.3 km higher lift the continental mean;
the C7 freeboard verdict is unchanged: partial-win band at scale 1.0,
full win judged across the sweep, owner decision §11.2, and probe B
measures the sweep moving the right way); band% late 10.7–19.2 vs C5
13.9–14.7 (emergent margins carry ~1.1 km freeboard — above the 800 m
band ceiling — and add ~6 points of land area to the denominator; still
≫ the flag-off 6.3–7.0).

**Floors:** landA run minima 34.0–35.2% (≥ 20% with the program's
largest margin); dispersal 98.9–99.8%; monopoly 0 Myr everywhere; last
tectonic event ≥ 4435 Myr; no NaN (CLI tripwire silent). **All PASS.**

## 5. Watch items (carried / updated)

1. **Crustal-mass drift — IMPROVED, spread tightened.** Total mass ends
   +4.5/+6.3/+9.8% per 4.5 Gyr (C5: +15/+1.4/+1.0) — the widest seed
   halves and the band is the program's tightest. The margin debit
   (~50 m/Myr, now the largest counted consumption term) is SMALLER than
   the flow the shim destroyed silently (the shim ground margins toward
   sea − 150 ≈ 21 km columns; the budget stops 9 km earlier), so seeds
   42/1337 retain slightly more mass while seed 1's high-crust epoch
   subsides. Score at C7 as before.
2. **Land shape — RESOLVED, dropped.** Largest land component late
   0.513–0.563 of land (C5: 0.342–0.385; flag-off 0.40–0.44), land
   components 130 vs 200–212: emergent margins reconnect coastal
   lowlands, and the §3 supercontinent property (largest component
   ≥ 0.5 of land) is now met as a late MEAN on all seeds. Becomes a C7
   scoreboard positive. (Probe B shows the property is endowment-keyed
   too: at water 1.5 the lowland connections flood and land fragments —
   0.26 late. Earths are wetter and patchier; Pangaeas are dry.)
3. **The creation-datum mismatch (T3/C7, carried from C5):** unchanged
   by this stage (creation instruments identical), and probe B bounds it
   from the wet side — creation is alive at scale 1.5, so the mismatch
   is confirmed dry-half-only. Still THE open design item for C7.
4. **NEW — the margin/shelf datum is endowment-keyed (C7).** This
   stage's probe pair measures it both ways on one seed: scale 1.0 →
   shallow 3.3%, margins proud, submerged 3.2%; scale 1.5 → shallow
   7.5%, submerged 27.8% ≈ Earth. The §3 scoreboard rows this touches
   (shallow band, flooded-share watch band, land 25–35%, freeboard) all
   move toward Earth together at Earth-ward endowment with zero knob
   changes. C7's water sweep scores the full grid and carries the
   default-endowment product decision (§11 answer 2 anticipated exactly
   this: "a separate later decision could make scale ~1.5 the shipped
   default planet") — alongside watch item 3, since both C5/C6 findings
   are the same shape: fixed datums vs a movable sea.
5. **NEW — land area above target at scale 1.0.** landA late 38.5–38.9%
   vs the §3 25–35% band (C5 sat at the top). Same root cause as gate 2;
   probe B measures 28.1% at scale 1.5 (in-band). Not a floor; flagged
   so C7 starts from the measured number.

**Stage C6 is complete: the last shim and the last sea-keyed relaxation
target are retired, the mass ledger's consumption side is fully counted,
the β-budget stop is structural and fixture-proven sea-independent, all
C2–C5 floors hold at program-best levels, and the land-shape watch item
resolves. One pre-registered gate — shallow-ocean share at water scale
1.0 — is measured below band and attributed to the endowment, not the
mechanism: the shim manufactured the old number, and the fixed datum
recovers it emergently at Earth-like water. The β knob stays untouched;
the finding routes to C7, which now owns the water sweep, both
datum-vs-endowment items, and the default-endowment decision with the
owner — exactly where the proposal put them.**
