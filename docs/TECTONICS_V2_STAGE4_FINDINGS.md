# Tectonics V2 — Stage 4 (post-rift suture cooldown retirement) findings

Measurement + terminal-fallback record for stage 4 (#114). Stage 4 set out to
**retire** the 120 Myr post-rift suture cooldown (`RIFT_SUTURE_COOLDOWN_YEARS`),
on the hypothesis (issue #114, proposal §5) that under force-driven kinematics
(#111) + tension-driven rifting (#113), *ridge push at the fresh divergent
boundary does the lock's job physically*, so the timer is redundant and can be
shrunk 120 → 30 → 0 Myr and deleted.

**The hypothesis is refuted by measurement.** Ridge push does **not** separate
rifted halves cleanly, the 120 Myr cooldown is **load-bearing**, and retiring it
re-triggers the pre-#59 fast-re-suture pathology. Per the #109 stop-valve
(gate failed at both retirement steps, no single companion-constant fix) the
**pre-registered fallback applies**: this measured cooldown-vs-metrics tradeoff
table is stage 4's terminal deliverable, and the cooldown is **retained at the
stage-3 default of 120 Myr** (no default flip, no golden regeneration, no
azimuth-fan deletion — that cleanup was gated on the 0 Myr step passing).

Runs: branch `claude/tectonics-v2-stage4`, all with
`--force-kinematics --tension-rift --emergent-suture --report --metrics --suture-analysis`
(the stage-5-target flag configuration), `--rift-suture-cooldown {120e6,30e6,0}`,
4.5 Gyr, `--dump elevation`. Acceptance grid: seed 42 @ N=128; seeds 1 and 1337 @
N=64.

## Headline

- **Re-suture-interval gate (the clean, seed- and grid-independent signal):**
  passes only at cd=120 (min interval 140–141 Myr on all three seeds, zero pairs
  re-merging < 100 Myr). At **cd=30 it fails on all three** (min 50 Myr, 8–10
  pairs < 100 Myr); at **cd=0 it fails hard on all three** (min **21 Myr** — the
  pre-#59 ~16 Myr pathology — with 3 / 19 / 52 pairs re-merging < 100 Myr).
- **Direct mechanism probe `convergent-at-+50 Myr` never reaches ≈ 0** at *any*
  cooldown: 0.07 (N=128) / 0.10–0.13 (N=64), essentially cooldown-independent.
  Ridge push leaves 7–13 % of fresh-rift seam cells still convergent 50 Myr
  later — it is **not** what holds the halves apart. The timer is.
- **cd=0 macro collapse**, seed-dependent in form but universal in that the
  planet leaves the healthy regime:
  - seed 42 @ N=128 (acceptance anchor): **supercontinent locks for 3630 Myr**,
    last tectonic event at **868 Myr**, dispersal 0.62 → 0.00 after the first
    Gyr (total 13.7 %). Flipbook: a globe-spanning ice-capped landmass by 3 Gyr,
    no oceans, no active margins.
  - seed 1 @ N=64: supercontinent locks for **2520 Myr**, dead by 1976 Myr,
    dispersal collapses to 0 after 1 Gyr (total 20.8 %).
  - seed 1337 @ N=64: does not freeze but **thrashes** — 354 rifts + 235 sutures,
    tempo 13.1 reorg/100 Myr, 52 of 120 rifted pairs re-merging < 100 Myr; a
    rift→re-suture churn, not stable dispersal.
- **Flipbooks are coherent geology, not noise**, in every case — the cd=0 failure
  is a real supercontinent lock / churn, visually unambiguous against the alive,
  Earth-like cd=120 control at 4.5 Gyr.

## The cooldown tradeoff table (V2 regime, the stage-4 deliverable)

Metrics over the full 4.5 Gyr run. **Gate targets:** re-suture min interval
> 100 Myr; conv-at-+50 ≈ 0; dispersal ≥ 0.7 every Gyr bucket; monopoly (> 85 %
window) < 400 Myr; tempo (mean interval / plate) 100–300 Myr; land min ≥ stage-3
value − 1 pt. **Bold = gate miss.**

### seed 42 @ N=128 (acceptance anchor)

| cooldown | land min | dispersal per-Gyr | monopoly | re-suture min (# ≤100) | conv@+50 | tempo | verdict |
|---|---|---|---|---|---|---|---|
| **120 Myr** | 22.3 % | 1.00/0.91/0.97/0.98/0.98 | 0 | 140 (0) | 0.069 | 125 | **healthy (control)** |
| 30 Myr | 23.9 % | 1.00/0.95/1.00/1.00/1.00 | 0 | **50 (8)** | 0.077 | **90** | re-suture + tempo miss |
| 0 Myr | 21.2 % | **0.62/0.00/0.00/0.00/0.00** | **3630** | **21 (3)** | 0.072 | **46** | **collapse** |

### seed 1 @ N=64

| cooldown | land min | dispersal per-Gyr | monopoly | re-suture min (# ≤100) | conv@+50 | tempo | verdict |
|---|---|---|---|---|---|---|---|
| **120 Myr** | 27.1 % | 0.99/1.00/0.97/**0.64**/1.00 | 0 | 141 (0) | 0.129 | 132 | healthy (one marginal bucket) |
| 30 Myr | **24.7 %** | 0.99/1.00/0.92/0.81/1.00 | 0 | **50 (9)** | 0.130 | **87** | land + re-suture + tempo miss |
| 0 Myr | 26.5 % | **0.76/0.18/0.00/0.00/0.00** | **2520** | **21 (19)** | 0.100 | **51** | **collapse** |

### seed 1337 @ N=64

| cooldown | land min | dispersal per-Gyr | monopoly | re-suture min (# ≤100) | conv@+50 | tempo | verdict |
|---|---|---|---|---|---|---|---|
| **120 Myr** | 26.9 % | 0.94/1.00/1.00/0.95/0.98 | 0 | 140 (0) | 0.127 | 141 | **healthy (control)** |
| 30 Myr | 26.0 % | 1.00/0.94/0.97/0.88/0.90 | 0 | **50 (10)** | 0.123 | **82** | re-suture + tempo miss |
| 0 Myr | 26.3 % | 0.99/0.99/0.91/0.94/**0.51** | 130 | **21 (52)** | 0.118 | **45** | re-suture + tempo + dispersal miss (thrash) |

Notes:
- **Land min reference caveat.** The literal #114 gate compares against the
  stage-3 land mins (s42 25.0 %, s1 27.0 %, s1337 24.2 %). Those were measured
  *without* `emergentSuture`; the stage-5-target config here has all three flags
  on, and `emergentSuture` alone lowers the cd=120 control land min (s42 to
  22.3 %). The honest within-experiment comparison is therefore each cooldown row
  vs its **cd=120 control**, not the cross-config stage-3 number. Under that
  control comparison, land is roughly cooldown-flat (the cd=0 failure is a
  *dispersal/tempo/re-suture* failure, not primarily a land-bleed one) — a
  different failure mode from the historic pre-#111 table, where a longer cooldown
  bled land by *grinding*. Under V2 the cooldown does not grind (kinematics are
  force-driven); it provides post-rift **hysteresis**.
- Every cd=120 control run stays tectonically alive to 4.5 Gyr (last event
  4454–4497 Myr), monopoly 0.

## Why retirement fails (mechanism)

The #114 hypothesis assumed ridge push actively separates rifted halves. The
`convergent-at-+50 Myr` probe measures this directly and finds **7–13 % of fresh
seam cells still closing 50 Myr after the rift, at every cooldown value**. The
#113 fragment kinematics (`omegaVec` inherits the parent, no divergence draw) do
not impart enough relative divergence to overcome the fact that on a closed
sphere, drifting plates re-contact — and once continental crust re-contacts, the
suture scan (and, under `emergentSuture`, the stall detector) welds it. The
120 Myr cooldown is the **hysteresis** that lets a fresh rift clear contact before
it can re-weld. Remove it and the re-suture interval collapses straight to the
pre-#59 ~21 Myr pathology; the macro outcome is then a coin-flip between a frozen
supercontinent (seeds 42, 1) and rift/re-suture thrash (seed 1337).

No single companion boundary-process retune rescues this: the deficit is on the
**separation (kinematics)** side, not a suture-side constant, and strengthening
ridge push is a mechanism change (a second mechanism), not the one allowed
constant retune (#66/#101 discipline). Needing a mechanism change is itself the
stop-valve signal.

## Disposition

- **Cooldown retained at 120 Myr** (stage-3 default). No kernel behavior change
  this stage; flag-off and default remain byte-identical to stage 3, so `main`
  and the golden spine are untouched.
- **Kept as durable infrastructure** (firings 1–2, already on the branch):
  `PlanetParams.riftSutureCooldownYears` (the cooldown is now a documented,
  measurable knob) and the sim-cli `--suture-analysis` harness (re-suture-interval
  + convergent-at-+50 probes). Both are behavior-neutral.
- **Not done** (correctly gated on the 0 Myr step passing, which failed): the
  default flip to 0, the flag-on golden regeneration, and the ocean-seeking
  azimuth-fan deletion.

## Stage-5 inputs surfaced here (durable)

1. **`emergentSuture` lowers land min and adds a marginal dispersal bucket** in
   the all-three-flags config: s42 land min 22.3 % (cd=120), and seed 1 has a
   single 0.64 dispersal bucket at cd=120. Neither is a stage-4 (cooldown) issue,
   but both are the stage-5 default-on baseline and should be acknowledged when
   stage 5 sets its acceptance numbers.
2. **The 120 Myr cooldown must ship as default-on in stage 5** — it is load-
   bearing. Stage 5's promotion config is `forceKinematics + tensionRift +
   emergentSuture` with the cooldown **at 120 Myr**, not retired.
3. **Open question for the owner (does stage 5 proceed?).** The #109 stage-5
   pre-authorization requires "every #111–#114 gate green." #114's *retirement*
   gate is not green — it terminates via the characterized fallback (#109 auth
   point 5). Whether the program advances to stage-5 default-on promotion with the
   cooldown kept at 120 Myr, or halts, is a decision the standing authorization
   does not cleanly cover. Raised on #114/#109; not auto-promoted.
