# Crustal-Column Redesign — Phase 0 Baseline (ground truth)

Phase 0 of `CRUSTAL_COLUMN_HANDOVER.md` §10: own the yardstick before
designing. Three deliverables, all completed 2026-07-20:

1. **The r9-both baseline replayed** — bit-for-bit — on all three golden
   seeds, from a reconstructed patch (the campaign's worktrees were
   ephemeral and its craton patch was never committed; it is now recorded
   verbatim in §2 so it cannot be lost again).
2. **The report-vs-metrics land% discrepancy resolved** (handover §9 open
   item) — it is a datum difference, fully explained, with a consequential
   correction to the campaign's "land gap vs Earth" framing (§4).
3. Mandatory reading done (`ARCHITECTURE.md`, `SEA_LEVEL_DATUM_FINDINGS.md`,
   sweep findings in full). No corrections to the handover's kernel survey
   were found; the §5 notes record only what phase 1 must carry forward.

## 1. Replay verdict up front

The r9-both package reproduces the campaign's round-9/10 numbers **exactly**
— every metric on every seed, and the elevation dumps are pixel-identical to
the committed evidence PNGs (`r9-both-s42-3600Myr.png`, the Pangea frame,
included). The yardstick is owned, the harness is trusted, and the
reconstructed patch in §2 is validated as trajectory-identical to the lost
original (a deterministic kernel leaves no other explanation for 451
keyframes × 3 seeds of agreement to the last printed digit).

## 2. The r9-both recipe, reproducible

Detached worktree at `c66e6fd` (post-#130 merge head, KBV 18). Five constant
edits in `packages/sim-kernel/src/constants.ts`:

| constant | stock | r9-both |
|---|---|---|
| `RIFT_HAZARD_AT_REF_PER_MYR` | 0.0075 | 0.005 |
| `OROGENY_RATE_M_PER_YR` | 6e-4 | 4e-4 |
| `OROGENY_MAX_ELEVATION_M` | 9000 | 6000 |
| `CRUST_FATE_MERGE_GAP_CELLS` | 2 | 4 |
| `PASSIVE_MARGIN_WIDTH_CELLS` | 2 | 1 |

Plus the craton-emergence prototype as term (3) of
`packages/sim-kernel/src/systems/freeboard.ts` — the exact reconstruction,
validated bit-for-bit (§1). Before the final per-cell loop:

```ts
const platformLevel = seaLevel + 400;
const lift = 1e-4 * dtYears;
```

and inside the loop, after the passive-margin subsidence line:

```ts
// (3) Craton-emergence prototype: continental interiors outside the
// passive-margin band and under no convergent stress relax upward toward
// the platform level, upward-only, clamped at the platform.
if (
  depth[i] === -1 &&
  boundaryStress[i]! <= ACTIVE_MARGIN_STRESS_M_PER_YR &&
  e < platformLevel
) {
  e = Math.min(platformLevel, e + lift);
}
```

Semantics that matter (they were only prose in the sweep doc, now pinned by
the bit-identical replay): the gate is **below the platform level** — not
"below sea level". The term lifts every low interior cell toward
`sea + 400`, which is why the platform target measurably matters (t150 vs
t400 differ; sweep §12.2) and why the mesa reads as green plains rather than
a coastline-hugging smear. Interaction with term (1): interiors rise at the
net of the craton lift (+100 m/Myr) and the epeirogenic shift (−20 m/Myr at
its bound), i.e. +80 m/Myr — the "outruns the regulator 5:1" mechanism of
sweep §10.3.

Run command (per handover §9; ~9 min per seed at N=64 on this container, 3
concurrent on 4 cores):

```
pnpm sim -- --seed <s> --until 4.5e9 --grid-n 64 --report --metrics \
  --crust-stats --suture-analysis --block-isostasy \
  --dump elevation --dump-every 15 --out <dir>
```

## 3. The yardstick, replayed and extended

Campaign-reported numbers (handover §6 / sweep §§12–13) vs this replay: all
match exactly, so only one set is printed. Columns marked ★ are numbers the
campaign did not record — they are new ground truth from the same runs.

| quantity (4.5 Gyr, N=64) | seed 1 | seed 42 | seed 1337 |
|---|---|---|---|
| dispersal (of 451 keyframes) | 99.1% | 98.4% | 94.9% |
| monopoly (>85% plate) window | 0 | 0 | 0 |
| last tectonic event | 4492 Myr | 4495 Myr | 4455 Myr |
| tempo (mean interval/plate) | 171 Myr | 166 Myr | 180 Myr |
| land min / max (0 m datum) | 10.7 / 31.4% | 10.7 / 30.2% | 8.3 / 30.6% |
| final land (0 m datum, metrics) | 24.9% | 20.8% | 20.1% |
| final largest land comp | 0.324 | 0.806 | 0.263 |
| past-1-Gyr largest land comp | 0.415 | 0.429 | 0.482 |
| mean continental freeboard | 3085 m | 2556 m | 2484 m |
| peak above sea | 5960 m | 5928 m | 5976 m |
| ★ final land (dynamic sea, report) | **34.3%** | **34.4%** | **33.8%** |
| ★ final continental crust fraction | 38.7% | 38.7% | 39.3% |
| ★ submerged share of cont. crust | 12.4% | 13.0% | 16.0% |
| ★ final sea level | −1782 m | −1961 m | −2163 m |
| ★ past-1-Gyr cont crust of sphere | 0.379 | 0.387 | 0.386 |
| NaN tripwire | clean | clean | clean |

Freeboard here is the crust-stats `meanFreeboardM`: cell-count mean
elevation of ALL continental crust (submerged included) minus `seaLevelM`
(`metrics.ts:116`).

Notes on the ★ rows:

- **Continental crust holds 38.7–39.3%** — essentially at the 40% Cogley
  anchor and inside the handover §7 gate (0.35–0.45). The T3 re-measure
  after the maturation-gate conversion has a tight reference band to hit.
- **The r9-both sea sits at −1.8..−2.2 km, not the stock −3.5 km.** The
  craton platform + blockIsostasy move enough hypsometry up to lift the
  equilibrium sea by well over a kilometre. Any phase-2 "flag-on t=0
  hypsometry ≈ today's" calibration must compare against the actual
  mechanism stack it runs with, not the stock-world numbers in
  `SEA_LEVEL_DATUM_FINDINGS.md`.
- **Submerged share of continental crust is 12–16%** vs Earth's ~25% (and
  vs 44–59% for the pre-craton datum-stack world). The platform mesa
  emerges *most* of the previously flooded interior. An honest crustal
  column should land between these regimes; worth adding to the §7 grid as
  a watch metric (not a gate).

## 4. The land% discrepancy — resolved (handover §9 open item)

Two instruments, one real difference (verified at source, and reproduced
exactly: the replay's seed-1 final frame prints the very 34.3%/24.9% pair
the handover flagged):

- **Report table land%** (`sim-cli/src/main.ts:480–483`): cells with
  `elevation >= keyframe.globals.seaLevelM` / all cells. The kernel's
  actual coastline. `--crust-stats` land% is algebraically identical
  (`metrics.ts:106–120`), and the `--dump` PNG ocean/land split matches it.
- **Metrics land%** (`metrics.ts:146`): cells with `elevation >= 0` / all
  cells — the fixed t=0 datum, kept deliberately for comparability with
  historical findings tables (documented in-file at `metrics.ts:76–78` and
  `186–188`: "don't join the two tables on this").

Everything else — area weighting (neither weights; both are cell counts),
threshold inclusivity, denominator, ice handling, keyframe timing — is
identical between the two. The gap is exactly the cells in
`[seaLevelM, 0)`: with the late-time sea at −1.8..−2.2 km under r9-both,
that band contains **the entire craton platform** (`sea + 400` ≈ −1400..
−1800 m absolute), which is precisely the land the prototype exists to
create. The metrics instrument is structurally blind to the mechanism the
campaign was tuning.

**Consequences, stated plainly:**

1. **The campaign's internal comparisons stand.** Every r6–r10 arm was
   ranked on the same 0 m instrument; relative verdicts (which knob helped,
   the r9-both local optimum, the cliff edges) are unaffected.
2. **The "land gap vs Earth 29%" framing does not survive.** Measured at
   the kernel's actual coastline, r9-both holds **33.8–34.4% dry land** —
   *above* Earth's 29%, on all three seeds. The handover §1.4/§13 "land
   21–25% vs Earth 29, structural gap" was an artifact of measuring a
   sea-relative world against the stranded 0 m datum. What remains true
   and structural: the **freeboard gap** (mean 2.5–3.1 km vs Earth ~0.8 km,
   measured sea-relative — instrument-clean) and the **hypsometry shape**
   (land piled at the mesa level and in high belts, not in Earth's
   200–800 m band). The redesign's headline win condition (handover §7,
   freeboard < 1.5 km) is unaffected; its land gate should be re-anchored.
3. **Recommendation for the §7 acceptance grid (phase 1 design doc):**
   define land-fraction gates on the dynamic-sea definition
   (report/crust-stats), and for gate-grade Earth comparisons sum
   `cellSolidAngleTable` over land cells rather than counting cells (the
   cube-sphere leaves ±35% per-cell area distortion — handover trap T7;
   today only kernel-side consumers weight by true area). Keep printing
   the 0 m number for continuity with the historical tables, but never
   gate on it. Suggested restated gate: dynamic-sea land in the ~25–35%
   band with the Earth-like hypsometry gates doing the real work
   (bimodality + 200–800 m band occupancy + freeboard < 1.5 km), since
   r9-both proves raw land area is already achievable by servo — area was
   never the hard part; its *elevation distribution* is.

## 5. Ground-truth notes phase 1 must carry forward

Nothing in the mandatory reading contradicts the handover survey. Items
worth pinning beyond it, from this pass:

- **The craton prototype's true semantics** (§2 above): it is a *platform
  fill toward sea+400*, not a flooded-cell rescue. Handover §5.2's claim
  that erosion+rebound makes the prototype "never needed" must therefore
  reproduce a specific behavior: broad interiors converging a few hundred
  metres above sea. In thickness space that number falls out of the
  density ratio × equilibrium thickness — the first calibration check of
  the phase-1 derivation should be that an equilibrium continental column
  (~35–40 km at cited densities) yields freeboard of that order against
  this world's actual sea.
- **The sea the columns will float against is mechanism-dependent**
  (−1.8..−2.2 km under r9-both vs −3.4..−3.9 km stock). The isostasy
  derivation reads the water load *relative to its own surface*; nothing
  in it may assume a fixed abyssal sea. T1 conditioning (volume slope
  > 0.2 in the bisection) must be re-verified against the compressed
  hypsometry the column model will produce, not the servo world's.
- **Tempo/health context for A/B reading:** r9-both runs 4.0–4.3
  reorganizations/100 Myr (118–125 rifts, 64–70 sutures per history), and
  seed 1337 carries the accepted 8.3% land-min transient plus a 0.84
  dispersal bucket in Gyr 2 — in-family dips that phase-3 A/B arms should
  not be failed for reproducing.
- **Sweep §§1–9 cliff edges** (constraints on any constants the migration
  touches): rift-hazard death threshold sits below 0.004/Myr (0.0025 is
  monopoly-death); raising `RIFT_TENSION_REF_N` is threshold-fatal in
  stacks (tune tempo via hazard rate only); a tectonically dead world
  drowns (dead runs converge to land ≈ 0%, continental mean −2.3..−2.6
  km — episodic breakup is load-bearing for land itself); root-decay
  tau 300→150 Myr is seed-fatal alone (cliff #4, sweep §12.1); orogeny
  3e-4/6000 produces no ranges at all (max elev 3.6 km).
- **The one §8 kernel gap** (isolated seas never desiccate — single global
  sea level) stays out of scope, per handover §9.

## 6. Artifacts

- Replay worktree recipe: §2 (the worktree itself is container-local and
  disposable; everything needed to rebuild it is in this file).
- Replay logs and dumps: `tmp/r9-s{1,42,1337}/` in the worktree —
  container-local, not committed; the numbers are the §3 table, and the
  frames are bit-identical to the already-committed
  `docs/default-settings-sweep-evidence/r9-*.png` / `r10-both-s1-*.png`.
- Discrepancy resolution: §4 (source-verified at
  `main.ts:474–483` / `metrics.ts:76–78,106–120,146,186–188`).

## 7. Phase-0 exit state

Phase 0 is complete: yardstick replicated exactly and extended (§3),
discrepancy closed with a gate recommendation (§4), traps re-verified
against source and prior art (§5). Open decisions for the phase-1 design
doc (`CRUSTAL_COLUMN_PROPOSAL.md`), beyond the handover's own list: adopt
the §4.3 land-gate re-anchoring; choose the equilibrium-freeboard
calibration check of §5; decide whether "submerged share of continental
crust" joins the §7 grid as a watch metric. Owner review gates phase 1 →
phase 2.
