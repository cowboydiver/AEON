# Tectonics V2 — Stage 5 Earth-target scoreboard (#115)

The proposal's §3 scoreboard, now scored against the **promoted default** world
(`forceKinematics` + `emergentSuture` + `tensionRift` all default-on,
`riftSutureCooldownYears` = 120 Myr, `KERNEL_BEHAVIOR_VERSION` 17). This is the
config the owner authorized to promote (#109, 2026-07-18) via option B (#115).

**Grid:** seed 42 @ N=128 (authoritative) + N=64; seeds 1 & 1337 @ N=64; 4.5 Gyr
each; measured with `--plate-census --metrics --suture-analysis`. Census stats
are means past 1 Gyr (the window stage 1 used). All four runs exited 0, no
NaN/Inf. Numbers are lifted from `TECTONICS_V2_STAGE5_GATE_RECHECK.md`, which is
the primary measurement record; this doc frames them against the §3 Earth
targets and states the misses plainly.

## Scoreboard

| §3 claim (Earth target) | s42 N=128 | s42 N=64 | s1 N=64 | s1337 N=64 | verdict |
|---|---|---|---|---|---|
| Speed census median (2–6 cm/yr) | 6.10 | 6.14 | 6.27 | 6.01 | ✗ **marginal overshoot** (0.02–0.27 over) |
| Fast plates = most slab, least continent — speed–slab-attach corr (≥ +0.3, Forsyth & Uyeda) | 0.070 | 0.086 | 0.042 | 0.019 | ✗ **MISS in full stack** (passes solo — see below) |
| Seafloor age median (< 200 Myr; Earth mean 60–80) | 56 | 49 | 48 | 43 | ✓ |
| Pole behavior — mean cos, < 1 ⇒ migrating (not frozen) | 0.986 | 0.991 | 0.986 | 0.986 | ✓ |
| Same-plate reorg tempo (100–300 Myr) | _see note_ | — | — | — | ✓ (114–189 Myr across stages 2–3) |
| Dispersal, min Gyr-bucket (≥ 0.7) | 0.91 | 0.75 | 0.64\* | 0.94 | ✓ (\*seed-1 bucket owner-accepted, #109 §2) |
| Land min % (≥ 10, hard floor) | 22.3 | 24.6 | 27.1 | 26.9 | ✓ |
| > 85% monopoly window (< 400 Myr) | 0 | 0 | 0 | 0 | ✓ |
| Re-suture min interval (> 100 Myr, no rift/re-weld flicker) | 140 | 140 | 141 | 140 | ✓ |
| Rift-convergence @ +50 Myr (context; cooldown load-bearing per #114) | 0.069 | 0.119 | 0.129 | 0.127 | — timer is hysteresis, not redundant |
| Boundary churn (pair-flips /100 Myr; context) | 8876 | 2110 | 2186 | 2304 | — the more-active V2 engine |

## The two honest misses (owned by stage 5, not regressions to chase)

Both misses are **new to the full three-flag stack** — `forceKinematics` *alone*
(the stage-1 solo config that passed every #111 gate) hits the targets:

| metric | solo `forceKinematics` | full V2 stack |
|---|---|---|
| speed median cm/yr | 4.55 / 4.67 / 4.89 / 4.54 | 6.10 / 6.14 / 6.27 / 6.01 |
| speed–slab-attach corr | 0.499 / 0.393 / 0.304 / 0.477 | 0.070 / 0.086 / 0.042 / 0.019 |

**Root cause (physical, not a bug).** Adding `tensionRift` + `emergentSuture`
makes the world far more active: continuous tension rifting mints young / fast /
slab-light oceanic plates and stall-suturing churns the population (boundary
churn 2100–2300 /100 Myr at N=64, **8876 at N=128** vs the quieter solo world).
So (1) the median runs hotter — younger seafloor drives faster plates — and (2)
the slab-pull "fast plates carry the most slab" signal is **real but transient**
(strongest at plate birth) and washes out in a 351-keyframe deep-time mean:
adjacent N=128 keyframes swing +0.53, +0.74, −0.36, −0.29. No principled
full-stack window rescues the deep-time gate (pooled / oceanic-only / birth
windows all measured — table in `TECTONICS_V2_STAGE5_GATE_RECHECK.md`).

**Owner disposition (#115, option B):** re-scope the slab-corr gate to a
**solo-`forceKinematics` re-verification** — the mechanism demonstrably works in
isolation (0.30–0.50 ≥ +0.3), and its wash-out in the busier promoted world is a
property of a healthier, more Earth-like tectonic engine, not a defect. Every
world-shape gate (land, dispersal, monopoly, poles, seafloor, re-suture) passes
on all seeds/grids. Speed overshoot (≈ at the 6 cm/yr ceiling, 4.5 % over on
seed 1) is recorded as an owned baseline property.

## Must-not-regress floor (§3) — all green at the promotion config

- dispersal ≥ 0.7 every Gyr bucket: ✓ (seed-1's 0.64 bucket is the explicitly
  owner-accepted exception, #109 decision §2).
- land min ≥ 10 % on all three golden seeds over 4.5 Gyr: ✓ (min 22.3 %).
- monopoly windows < 400 Myr: ✓ (0 on all).
- kernel tests < 30 s: **relaxed to a runaway-tripwire guard** (owner call,
  #115 — the V2 per-step torque balance makes the suite ~63 s wall; no premature
  optimization). Documented deviation from the CLAUDE.md budget, approved for
  stage 5.

## Notes

- **Tempo:** the promoted-stack same-plate reorganization interval was measured
  114–124 Myr (stage 3) and 164–189 Myr (stage 2) — inside the 100–300 Myr band.
  The seed-42 N=128 `--report` tempo line from the stage-5 flipbook run confirms
  this; see the flipbook review comment on #115.
- **Slot headroom:** direct `plates.length` over 4.5 Gyr = 158 / 169 / 172
  (N=64) and 176 (N=128 s42) — ≥ 31 % headroom under the 256 u8 `plateId`
  ceiling. u8 is adequate under the V2 rift regime; dead-slot reclamation is
  **deferred** (#113 flag resolved; the codec `plateId < 256` assertion is the
  loud guardrail).
- **Climate coupling:** the full stack reads hotter (hothouse CO₂ ~2010 vs
  legacy ~1150) — the #111-flagged outgassing risk, confirmed and documented,
  not hidden. The V2 world's own climate health (CO₂ regulated, sane land over
  4.5 Gyr) is covered by the phase-1 invariant suite.

## Post-promotion re-verification — #127 items 4(a) & 5

The #127 follow-ups changed two default-on behaviors: item 4(a) made `tensionN`
a true pull-class scalar (slab pull + slab suction on the overrider; ridge push
and collision damping excluded), and item 5 gated the `emergentSuture` stall on
the pair's gross relative motion (mean |v_own − v_other| < `SUTURE_SHEAR_MAX_M_PER_YR`
= 8 mm/yr), so shearing / rotating contacts no longer weld as "stalled".
`riftSutureCooldownYears` (120 Myr) was left untouched. Re-scored against the
authoritative seed-42 N=128 column above (4.5 Gyr, `--plate-census --metrics
--suture-analysis`):

| §3 claim | scoreboard s42 N=128 | #127 s42 N=128 | verdict |
|---|---|---|---|
| Speed census median (2–6 cm/yr) | 6.10 | 6.14 | = owned overshoot, unchanged |
| speed–slab-attach corr (owned miss) | 0.070 | 0.016 | still washes out deep-time (owned) |
| Seafloor age median (< 200 Myr) | 56 | 49 | ✓ |
| Pole mean cos (< 1 ⇒ migrating) | 0.986 | 0.982 | ✓ |
| Dispersal, min Gyr-bucket (≥ 0.7) | 0.91 | 0.93 | ✓ |
| Land min % (≥ 10 hard floor) | 22.3 | 22.2 | ✓ |
| > 85% monopoly window (< 400 Myr) | 0 | 0 | ✓ |
| Re-suture min interval (> 100 Myr) | 140 | **270** (median 320) | ✓ **improved** |
| Boundary churn (context) | 8876 | 9599 | — still the more-active engine |

Every must-not-regress floor holds; both owned misses are unchanged. The
re-suture interval rose 140 → 270 Myr — removing the shearing/mixed false
sutures (and their compensating re-rifts) reduces rift↔re-weld flicker, the
intended direction. Companion N=64 grid (seeds 1/42/1337): dispersal 94.5–99.8 %,
land min 25–28 %, zero monopoly, same-plate reorg interval 168–194 Myr (inside
the 100–300 band), slot peak ~130–145. Goldens are byte-identical (the 10-step
spine hashes fields, not the plate records `tensionN` lives in, and no rift/
suture decision differs that early); the deep-time change is carried by the
phase-1 4.5 Gyr invariant, which passes.
