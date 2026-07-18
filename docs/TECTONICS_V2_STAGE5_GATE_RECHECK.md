# Tectonics V2 — Stage 5 pre-promotion gate re-check (#115)

Before flipping `forceKinematics` + `emergentSuture` + `tensionRift` to default-on
and regenerating the main golden spine, the #115 gating (and standing-authorization
§2) require re-verifying **every #111–#114 gate at the promotion defaults** — i.e.
the *full three-flag stack*, not each mechanism in isolation. This document records
that re-check.

- **Promotion config:** `--force-kinematics --emergent-suture --tension-rift`,
  `riftSutureCooldownYears = 120e6` (the owner-fixed stage-5 config, #109 decision
  2026-07-18).
- **Grid:** seed 42 @ N=128 (authoritative) + N=64; seeds 1 & 1337 @ N=64. 4.5 Gyr each.
- **Harness:** one combined `--plate-census --metrics --suture-analysis` run per
  cell. No NaN/Inf; all runs exited 0. Census statistics are means past 1 Gyr over
  351 keyframes (the same window stage 1 used).

## Scoreboard (promotion config)

| metric (gate) | s42 N=128 | s42 N=64 | s1 N=64 | s1337 N=64 | verdict |
|---|---|---|---|---|---|
| census speed median cm/yr (2–6) | **6.10** | **6.14** | **6.27** | **6.01** | ✗ marginal overshoot |
| speed–slab-attach corr (≥ +0.3) | **0.070** | **0.086** | **0.042** | **0.019** | ✗ HARD FAIL |
| pole stability, mean cos (< 1.0 ⇒ migrate) | 0.986 | 0.991 | 0.986 | 0.986 | ✓ |
| seafloor age median Myr (< 200) | 56 | 49 | 48 | 43 | ✓ |
| land min % (≥ 10) | 22.3 | 24.6 | 27.1 | 26.9 | ✓ |
| dispersal min Gyr-bucket (≥ 0.7) | 0.91 | 0.75 | 0.64* | 0.94 | ✓ (*owner-accepted) |
| >85% monopoly window Myr (< 400) | 0 | 0 | 0 | 0 | ✓ |
| re-suture min interval Myr (> 100) | 140 | 140 | 141 | 140 | ✓ |
| rift-convergence @ +50 Myr (≈0 intended) | 0.069 | 0.119 | 0.129 | 0.127 | not ≈0 — cooldown load-bearing (per #114) |
| boundary churn (pair-flips /100 Myr) | 8876 | 2110 | 2186 | 2304 | context |

\* seed-1's 0.64 dispersal bucket at cd=120 is the property the owner explicitly
accepted as owned by stage 5 (#109 decision §2), not a regression.

### Stage-1 solo-config reference (from `TECTONICS_V2_STAGE1_CENSUS.md`)
Measured with **forceKinematics alone** (stages 2/3 not yet built):

| metric | s42 N=128 | s42 N=64 | s1 N=64 | s1337 N=64 |
|---|---|---|---|---|
| speed median cm/yr | 4.55 | 4.67 | 4.89 | 4.54 |
| slab-attach corr | 0.499 | 0.393 | 0.304 | 0.477 |

## The two misses

Every world-shape gate (land, dispersal, monopoly, poles, seafloor age, re-suture)
passes at the promotion config on every seed and both grids. **Two #111 *census*
gates do not hold once all three flags are on:**

1. **speed–slab-attachment correlation collapses** from the stage-1 solo band
   (0.30–0.50) to **0.02–0.09** — a ~5–15× shortfall against the ≥ +0.3 gate, on
   every seed, worst at N=128 (0.499 → 0.070). This is the Forsyth & Uyeda signal
   the owner installed to replace the degenerate oc/cont ratio gate — the redesign's
   headline "slab-attached plates move faster" claim.
2. **census speed median runs hot:** 6.0–6.3 cm/yr vs the 2–6 band and the stage-1
   solo 4.5–4.9. Marginal (≈ at the ceiling for three of four cells, 4.5% over for
   seed 1), not a blowout.

### Root cause (physically coherent, not a bug)
Adding `tensionRift` + `emergentSuture` to `forceKinematics` makes the world
**far more tectonically active**: continuous tension-driven rifting mints young,
fast, slab-light oceanic plates, and stall-suturing churns the plate population.
Boundary churn rises to 2100–2300 /100 Myr at N=64 and **8876 at N=128** (vs the
quieter solo-forceKinematics world). Two consequences:

- The **median speed** rides higher because the ocean floor is younger on average
  (more ridges), so more plates sit in the fast slab-pull regime.
- The **slab-pull correlation washes out**: per-keyframe `slab` correlation swings
  hard both signs (e.g. N=128 tail: +0.53, +0.74, −0.36, −0.29 in adjacent frames);
  averaged over 351 deep-time keyframes it lands near zero. The signal is **real but
  transient** — the stage-1 doc already noted it is strongest at plate birth
  (t=10–60 Myr, corr −0.44..−0.75 for the sister continentality metric) and
  "washes to ≈0 deep-time." The extra churn from the full stack amplifies that wash.

The physics the gate intends (slab-attached plates faster) is present at plate
birth; it is not *statistically legible as a deep-time mean* in the busier
promotion world.

## Disposition: HALT stage 5 pending owner decision (do NOT auto-promote)

Standing-authorization §2 pre-authorizes stage-5 promotion **iff every #111–#114
gate is green at promotion defaults**, and instructs: "If any condition fails, do
NOT promote — post the miss on #115 and halt that stage instead." Two #111 gates
are not green at the promotion config.

The owner's 2026-07-18 stage-5 decision pre-accepted *specific* promotion-config
properties (land min 22.3%, seed-1 0.64 dispersal bucket) but **did not address the
slab-correlation collapse or the speed-median overshoot** — those were invisible in
the stage-4 grid, which measured via `--suture-analysis`, not `--plate-census`. So
this miss is not covered by any existing issue, the proposal, or the #109
authorization. Per the executor's hard rule, an uncovered decision is escalated, not
guessed.

**No defaults were flipped, no goldens regenerated, `main` untouched.** The
stage-5 branch carries only this measurement doc.

### Options put to the owner (see #115)
- **A — Accept & promote.** Treat both misses as owned, honestly-documented stage-5
  baseline properties (like land-min/dispersal), record them in the §3 Earth
  scoreboard as misses, and proceed. Rationale: the collapse is a consequence of a
  *healthier, more active* tectonic world; the transient Forsyth-Uyeda signal is
  intact; every world-shape gate passes.
- **B — Re-scope the slab-corr gate** to a solo-`forceKinematics` re-verification
  (still 0.30–0.50), reading it as "the mechanism works in isolation" rather than
  "the shipped deep-time mean shows it," then promote.
- **C — Investigate/mitigate** with the one permitted companion retune (e.g. a small
  basal-drag increase to pull median speed back under 6). Risk: perturbs the
  promotion config off the stage-3-end state; unlikely to fix the churn-driven
  correlation wash.
- **D — Halt the program at stage 4** as the terminal deliverable (no default flip).

Executor recommendation: **A or B.** The misses are real and must be reported
honestly, but they reflect a more active, more Earth-like tectonic engine rather
than a defect, and they do not touch the shipped world's habitability shape.

---

## Owner decision: **B** (2026-07-18, #115 — "Go ahead with option B")

Re-scope the slab-attachment-correlation gate to a **solo-`forceKinematics`
re-verification** (where it passes 0.30–0.50), read it as "the mechanism works in
isolation," document the full-stack behaviour honestly, then promote.

### Window study — does the signal survive the full stack in *any* principled window?

Before adopting the isolation framing, I measured candidate full-stack gate
definitions (throwaway spikes `packages/sim-cli/src/spikes/stage5_slabcorr.ts`,
`stage5_birthwin.ts`; Pearson is scale-invariant so R and cell-area drop out).
Goal: NOT to cherry-pick a passing window, but to find out whether a defensible
one exists. **It does not.**

| definition (full stack, ≥ +0.3 wanted) | s42 N=64 | s1 N=64 | s1337 N=64 |
|---|---|---|---|
| mean of per-keyframe pearson, past 1 Gyr | 0.086 | 0.042 | 0.019 |
| **pooled** pearson over all plate-pairs, past 1 Gyr (n≈5300) | 0.118 | 0.083 | 0.053 |
| **pooled, oceanic-only** (contFrac < 0.5, n≈3900) | 0.138 | 0.081 | 0.052 |
| birth window mean, 10–50 Myr | 0.860 | **0.053** | 0.558 |
| birth window mean, 10–100 Myr | 0.802 | **0.257** | 0.487 |
| birth window mean, 10–200 Myr | 0.643 | **0.192** | 0.365 |

N=128 seed 42 corroborates the shape: meanPerKeyframe 0.070, pooledAll 0.097,
pooledOceanic 0.117, engagedTransient(10–200 Myr) 0.331 — pooling fails, the
transient is only marginal. Same story as N=64.

**Findings:**
- **Large-sample pooling does not rescue it** (0.05–0.14). The weak deep-time mean
  is not a small-sample per-keyframe noise artifact — the speed↔slab relationship
  is genuinely weak in the shipped deep-time world, even among oceanic plates.
- **No seed-robust window passes.** Seed 42 and 1337 pass the birth window, but
  **seed 1 never reaches +0.3 at any width** (peak 0.257 at 10–100 Myr). The strong
  0.79–0.92 numbers seen earlier were seed-42's first ~70 Myr only — the
  initial-condition engagement transient as the random ω⃗ draws first pick up slab
  pull, not a steady-state property, and not reproducible across seeds.

### Physical interpretation (a real property, not a bug)
`forceKinematics` in isolation produces the Forsyth & Uyeda correlation because
plates are long-lived: oceanic plates accumulate attached slab and accelerate
together, cratons stay slow — a stable speed↔slab coupling (solo census
0.30–0.50). Adding `tensionRift` + `emergentSuture` reorganizes boundaries faster
than the τ≈10 Myr velocity relaxation can re-equilibrate: rift fragments **inherit**
the parent's fast ω⃗ but carry **no** fresh slab (high speed, low slab), and sutures
merge slab-laden plates into slow composites. Instantaneous speed is therefore a
mix of inherited momentum and current forcing, decoupled from instantaneous slab
attachment. The signal is legible only when plates sit still long enough to
equilibrate — which the active shipped world rarely allows.

### Consequence for stage 5 (honest statement of what B ships)
**The shipped tectonics-v2 world does not exhibit the Forsyth & Uyeda slab-speed
correlation as a measurable steady-state signal.** The torque balance (#109's stated
goal) is in place and working; the F&U correlation — the *validation metric* the
owner installed for stage 1 — is an **isolation-only** property of `forceKinematics`,
washed out by the churn of the full mechanism stack. Option B ships this with the
washout documented as a known, mechanistically-understood property, and re-verifies
the gate under solo `forceKinematics` (unchanged code path, stage-1 numbers
0.30–0.50 hold). The census `speedSlabAttachmentCorr` readout stays as an honest
diagnostic; the §3 Earth scoreboard will record the full-stack washout as a miss.

_Executor note: this is a materially more sobering finding than the "clean windowed
pass" I sketched when first recommending B — pooling and every seed-robust window
fail. B remains the right disposition (the isolation framing is the honest one, and
pooling/mitigation cannot recover a churn-driven decoupling), but the owner should
promote with eyes open that the redesign's headline physical signal is isolation-only._

---

## Promotion execution — WIP state (owner said "ship it" 2026-07-18)

### Prerequisites — both settled ✓
- **B gate (solo-`forceKinematics` slab-corr re-verify):** 0.393 / 0.304 / 0.477 (N=64
  s42/s1/s1337) and **0.499** (N=128 s42), speed median 4.5–4.9 — exact stage-1
  match (byte-identical code path), all ≥ +0.3. Green.
- **Slot-headroom (owner condition 3):** direct `plates.length` measurement at the
  promotion config over 4.5 Gyr — **158 / 169 / 172** (N=64) and **176** (N=128 s42),
  all well under the 200-slot budget and the 256 u8 ceiling (**≥31% headroom**).
  Resolution: **u8 is adequate for the shipped grids; dead-slot reclamation deferred**
  as a future change (unneeded). The codec `plateId < 256` assertion is the loud
  guardrail. (Note: healthier than stage-3's earlier 205/256 estimate — the branch's
  history evolved with the stage-2/4 merges.)

### Promotion mechanics applied (committed, goldens NOT yet regenerated)
- `KERNEL_BEHAVIOR_VERSION` 16 → **17** with a full rationale entry (constants.ts).
- `createPlanetParams` defaults flipped: `forceKinematics` / `emergentSuture` /
  `tensionRift` → **true** (onsets 0, cooldown 120 Myr).
- New **pre-V2-promotion default golden spine** added to `golden.test.ts` and
  auto-populated — verified **byte-identical** to the current main goldens for all
  three seeds (pins that the promotion changed only the three V2 defaults).

### ⚠️ Two blockers surfaced by the flip — MUST resolve BEFORE regenerating goldens
The default flip fails **26 tests across 9 files** (expected scope of a promotion).
Most are mechanical, but two are real and could alter the shipped bytes, so goldens
are deliberately **left un-regenerated** until these are resolved:

1. **Kernel suite blows the < 30 s budget** (CLAUDE.md hard rule + #115 gate). Full
   suite now ~**54 s** (vitest Duration); the single 4.5 Gyr phase-1 invariant test
   alone is **20.4 s** (its own soft guard is 20 s). Cause: V2's per-step torque
   balance + rifting/suturing makes every simulated step costlier. Fix options:
   optimize the `plateDynamics` hot path, and/or trim the expensive 4.5 Gyr invariant
   tests (coarser grid / fewer steps / shorter span), and/or raise the documented
   perf guards. This is a promotion gate — must land under 30 s.
2. **Hypsometry bimodality** fails at seed 42, t=450 Myr (`invariants/phase1.test.ts`;
   150 & 300 Myr pass). `isBimodal` wants an abyssal peak and a platform peak split
   by a trough (−3000..−1500 m); the more-active V2 world likely fills that trough
   with young rifted/thinned-margin crust, blurring the split. Investigate: is this a
   real (mild, acceptable) property of the V2 world → update the test's V2 baseline /
   relax the trough ratio with rationale; or a coarse-grid (N=32) transient; or a
   genuine degradation. Do NOT regenerate to silence it (CLAUDE.md).

### 26-test reconciliation map (for the next chunk)
- **A. Default-tracking goldens → regenerate** (after blockers resolved): `golden.test.ts`
  main ×3 + #105 water arm + #106 land arm; `codec.test.ts` encoded-keyframe byte
  goldens ×3 (layout unchanged — only the encoded field values differ; no
  HISTORY_FORMAT_VERSION bump).
- **B. Legacy-path tests → pin explicit V2-off flags** (their setup assumed default-off):
  `forceKinematicsScaffold.test.ts` ×2 (now assert default-**on**); `plateDynamics.test.ts`
  flag-off identity + the 3 engaged flag-on spines (set `emergentSuture:false,
  tensionRift:false` so the isolated forceKinematics spine stays forceKinematics-only);
  `tensionRift.test.ts` ×2 (flag-off baseline); `wilson.test.ts` ×4 (legacy size-ramp /
  fixed-countdown suture / #57 cooldown / #18 suturing — set the V2 flags off to test
  the legacy wilson path they target).
- **C. Investigate** (the two blockers above): `carbon.test.ts` ×3 and `oxygen.test.ts` ×1
  also fail — the V2 tectonic history shifts outgassing/climate; confirm whether the
  snowball/thermostat/O₂-monotonicity scenarios need explicit-flag pinning or a
  V2-aware threshold, or reveal a real coupling change.

### Next-firing plan
Resolve blocker 1 (perf < 30 s) and blocker 2 (hypsometry) FIRST — they may change
the shipped bytes. THEN category-B test edits, THEN regenerate the category-A goldens
once, verify the snapshot diff touches only expected spines, run lint + typecheck +
kernel suite < 30 s, `/code-review`. Only after that: ARCHITECTURE.md rewrite, dead-
constant retirement, the §3 Earth scoreboard, the N=128 flipbook review, then PR into
`tectonics-v2` and merge.

---

## Promotion + suite reconciliation — DONE (28081da; suite 434/434 green)

Both blockers were resolved and the whole kernel suite reconciled to V2 default-on.

- **Blocker 1 (perf):** the owner lifted the < 30 s budget "for now" (do not optimize
  prematurely). The phase-1 soft perf guard is relaxed 20 s → 90 s (runaway tripwire
  only). Suite now ~63 s wall.
- **Blocker 2 (hypsometry):** resolved as a coarse-grid small-sample artifact, NOT a
  degradation. The phase-1 `isBimodal` check moved N=32 → N=64, where both previously-
  failing seeds are comfortably bimodal at every checkpoint (platform/trough 2.1–7.0;
  abyssal always 10–27×). Evidence: at N=32 the near-sea-level platform mode is only
  44–80 of 6144 cells under V2's more-active early dispersal; at N=64 it is 229–666.
- **Category A (goldens regenerated):** golden main ×3 + #105 + #106; codec byte-goldens
  ×3 (layout unchanged, no HISTORY_FORMAT_VERSION bump). Verified the snapshot diff
  touches EXACTLY those blocks — every explicit-flag spine (legacy-off, the new pre-V2
  default, blockIsostasy, #88–91, bathymetry, plateDynamics engaged) is byte-identical.
- **Category B/C (legacy-path + system-property tests):** pinned to the explicit
  flag-off world — forceKinematicsScaffold (now asserts default-on), plateDynamics
  (engaged spines pin forceKinematics-in-isolation; flag-off identity explicit),
  wilson ×4, tensionRift ×2, carbon ×3, oxygen ×1. The carbon/oxygen pinning also
  **confirms the #111-flagged outgassing risk is real** (V2 reads hotter: hothouse
  CO₂ ~2010 vs legacy ~1150) — documented, not hidden; the V2 world's own climate
  health is covered by phase-1 (CO₂ regulated, sane land, 4.5 Gyr).
- **Verification:** `pnpm -F sim-kernel test` 434/434; `pnpm typecheck` clean; `pnpm
  lint` clean.

### Remaining stage-5 work (next chunk[s])
1. `docs/ARCHITECTURE.md` — rewrite the plate-kinematics / Wilson sections: delete the
   "plate speeds do not slow in collisions" note, the size-ramp/cooldown docs, and the
   "no force feedback" caveats; document the torque balance, the stall suture, and the
   tension hazard as the shipped model.
2. Dead constants — `RIFT_MIN_AGE_YEARS`, `RIFT_SIZE_RATE_*`, `RIFT_PROBABILITY_PER_MYR`,
   azimuth-fan constants: **mark legacy-spine-only** (they are still exercised by the
   pinned flag-off spines, so they cannot be deleted — the legacy path stays live).
3. §3 Earth scoreboard findings doc — final census vs the proposal §3 Earth targets,
   including the honest misses (speed median hot; F&U correlation isolation-only).
4. N=128 flipbook review of the promoted default world (dump launched) — actually
   inspect the PNGs (the "numbers pass but continents look like static" gate).
5. `/code-review` pass, then PR into `tectonics-v2` and merge (auth §1 gate).
