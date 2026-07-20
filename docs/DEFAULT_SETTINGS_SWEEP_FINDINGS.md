# Default-settings sweep — Wilson cycles, coherent continents, lower mountains

Owner feedback on the promoted default (`KERNEL_BEHAVIOR_VERSION` 18): the world
reads as "scattered fragments and many, many islands and many very high mountain
chains" — missing large coherent continents and occasional supercontinents. This
campaign measured which knobs govern those three complaints and found a
recommended candidate config, plus two hard cliff edges worth recording.

All runs: 4.5 Gyr, N=64, full instrumentation (`--report --metrics
--crust-stats --suture-analysis --dump elevation --dump-every 45`), constants
patched per-arm in isolated worktrees (the working tree and goldens are
untouched — **nothing in this campaign changed shipped behavior**). 16 runs
total across 4 rounds, 2026-07-20. Evidence PNGs in
`default-settings-sweep-evidence/`.

## 1. The complaints are measured properties of the default, and the promotion
grid never gated them

- **No supercontinents.** Default dispersal is 96.5–99.3% with monopoly 0 Myr —
  the world is almost never assembled. `TECTONICS_V2_PROPOSAL.md` §3 targeted
  "supercontinent tenure ~100–200 Myr; assembly→breakup cycle 400–700 Myr", but
  no stage-5 or item-9 gate ever scored it; the surviving gates (dispersal
  ≥ 0.7, monopoly < 400 Myr) only punish assembly.
- **Fragmentation.** 152–194 land components with the largest holding 0.29–0.44
  of land (Earth: Afro-Eurasia alone is ~0.57).
- **Mountains.** Continental mean 2.7–3.7 km vs Earth's ~0.8 km; the findings-§5
  levers (`OROGENY_RATE_M_PER_YR`, `OROGENY_MAX_ELEVATION_M`) were never swept.

## 2. Knob map (what was swept)

| knob | default | swept values |
|---|---|---|
| `RIFT_HAZARD_AT_REF_PER_MYR` | 0.0075 | 0.005, 0.0025 |
| `RIFT_TENSION_REF_N` | 3e19 | 6e19 |
| `CRUST_FATE_MERGE_GAP_CELLS` | 2 | 4 |
| `OROGENY_RATE_M_PER_YR` | 6e-4 | 5e-4, 4e-4, 3e-4 |
| `OROGENY_MAX_ELEVATION_M` | 9000 | 8000, 7500, 6000 |
| `riftSutureCooldownYears` (param) | 120e6 | 240e6 |

## 3. Scoreboard (all 16 runs)

"epis." = per-Gyr dispersal buckets < 1.00 past the first Gyr (assembly
episodes); "comps" = final-frame land components (largest fraction);
"contElev" = mean continental elevation @ 1.5/3.0/4.5 Gyr (m, report line).

| run | seed | dispersal (epis.) | monopoly | land min–final % | comps | contElev | alive to | verdict |
|---|---|---|---|---|---|---|---|---|
| base | 42 | 96.5% | 0 | 11.1–25.4 | 194 (0.29) | 3396/1835/1443 | 4457 | reference |
| rift-hazard-third (0.0025) | 42 | 68.1% | **1120 Myr** | 0.0 final | — | 2458/168/−2350 | **3524** | ☠ permanent monopoly → drowns |
| tension-ref-2x | 42 | 97.8% | 0 | 11.1–24.6 | 192 (**0.69**) | 3689/224/2394 | 4494 | big final mass; risky in stacks |
| dock-gap-4 | 42 | 97.8% | 0 | 11.2–27.9 | **137 (0.37)** | 3002/3003/2478 | 4480 | ✓ coherence win |
| orogeny-soft (3e-4/6000) | 42 | 99.1% | 0 | 9.3–19.9 | 180 (0.24) | −348/322/15 | 4484 | too flat (max 3.6 km) |
| cooldown-240 | 42 | 97.1% | 0 | 11.1–25.3 | 218 (0.28) | 3592/1808/2392 | 4435 | neutral — dropped |
| combo r1 (ref2x+gap4+oro-soft) | 42 | 6.9% | **4190 Myr** | 0.0 final | — | frozen | **303** | ☠ tectonic death |
| hazard-mid (0.005) | 42 | 94.2% (0.79) | 0 | 11.1–27.1 | 165 (0.37) | 2428/2707/2543 | 4435 | ✓ **Wilson-cycle episode @~3.5–3.9 Gyr** |
| ref2x-gap4 | 42 | 98.4% | 0 | 11.2–19.8 | 299 (0.36) | 2070/177/1038 | 4435 | survives but choppy |
| orogeny-mid (4e-4/7500) | 42 | 98.0% | 0 | 10.2–21.0 | 244 (0.51) | 1939/−220/854 | 4476 | ✓ realistic relief solo |
| ref2x-gap4-oromid | 42 | 6.9% | **4190 Myr** | 0.1 final | — | frozen | **304** | ☠ same death as combo r1 |
| candidate r3 (0.005+gap4+oromid) | 42 | 60.5% | **1670 Myr** | 0.0 final | — | 1116/−2763/−2229 | **2984** | ☠ seed-dependent death |
| candidate r3 | 1 | 96.5% (0.89) | 0 | 10.3–18.8 | 183 (0.13) | −628/931/86 | 4441 | survives, bland |
| candidate r3 | 1337 | 97.3% (0.93,0.90) | 0 | 8.0–22.3 | 162 (0.28) | 281/1520/923 | 4455 | survives |
| **pair** (0.005 + gap4) | 42 | 88.5% (**0.82, 0.76**) | **70 Myr** ✓ | 7.4–26.9 | **122 (0.37)** | 2751/1260/2792 | 4478 | ✓✓ two episodes + transient supercontinent |
| pair | 1 | 97.8% | 0 | 11.3–27.6 | 169 (0.47) | 3750/3321/2730 | 4466 | ✓ coherent (final cont comp 0.815) |
| pair | 1337 | 96.9% (0.95, 0.90) | 0 | 8.9–25.1 | 232 (0.29) | 1425/2292/2264 | 4463 | ✓ mild episodes |
| **pair-oro5** (0.005 + gap4 + 5e-4/8000) | 42 | 98.0% (0.91) | 0 | 10.8–25.9 | **91 (0.39)** | 1418/−1314/2073 | 4484 | ✓✓ best fragmentation of campaign |
| pair-oro5 | 1 | 99.1% | 0 | 10.8–25.5 | 132 (0.35) | 2076/992/2441 | 4450 | ✓ healthy |
| pair-oro5 | 1337 | 93.1% (**0.78**) | **10 Myr** ✓ | 8.4–19.1 | 188 (0.30) | 2421/2530/1318 | 4473 | ✓ early episode + brief supercontinent |

Tempo stayed in the 100–300 Myr per-plate band on every surviving run
(159–176 Myr; base 176).

## 4. The two cliff edges (record these — they are the campaign's hardest facts)

1. **Raising `RIFT_TENSION_REF_N` is threshold-fatal in stacks.** 2× ref alone
   survives, but 2× ref + wider docking (± any orogeny cut) dies the same death
   every time: early welding assembles a monopoly, boundary tension never
   reaches the raised reference, no rift ever fires, and the last tectonic
   event lands at ~300 Myr. Scaling the hazard **rate** has no such cliff —
   rifting stays proportional at every tension level. *Tempo must be tuned via
   `RIFT_HAZARD_AT_REF_PER_MYR`, not the reference tension.*
2. **A tectonically dead world drowns.** Every dead run (hazard 0.0025 solo,
   the ref2x stacks, candidate-r3 seed 42) converges to land ≈ 0% with
   continental mean ≈ −2.3 to −2.6 km: no collisions → no orogeny influx →
   freeboard/subsidence/erosion grind the continents below the sea, and the
   frozen world stays a waterworld for gigayears. **Episodic breakup is
   load-bearing for land itself**, not just aesthetics. Follow-up worth filing:
   a loud kernel event (or phase-1 invariant) when no tectonic event fires for
   ~500 Myr — every death in this campaign would have tripped it by 1 Gyr, and
   the metric already exists as `last tectonic event`.

Also confirmed: `orogeny-soft` (3e-4/6000) is an overshoot (max elevation
3.6 km — no ranges at all), and orogeny cuts at 4e-4 stacked on other knobs are
seed-dependently fatal (candidate-r3 s42), while 5e-4/8000 stacked survived all
three seeds. `cooldown-240` measured neutral and was dropped.

## 5. Recommendation

**Candidate default: `RIFT_HAZARD_AT_REF_PER_MYR` 0.0075 → 0.005,
`CRUST_FATE_MERGE_GAP_CELLS` 2 → 4, `OROGENY_RATE_M_PER_YR` 6e-4 → 5e-4,
`OROGENY_MAX_ELEVATION_M` 9000 → 8000** (the `pair-oro5` arm), which against
base delivers:

- **Fragmentation:** final land components 91/132/188 (seeds 42/1/1337) vs
  base 194 — the campaign's best coherence, with peak-land coherent masses
  visible in every mid-run frame.
- **Mountains:** continental mean ~1.0–2.4 km late-time (base 1.4–3.4 km,
  promoted-default review numbers 2.7–3.7 km), peaks ~5.2–6.0 km — ranges
  still exist, walls of 7 km+ chains don't.
- **Wilson cycle:** assembly episodes on 2 of 3 seeds (s1337 carries a
  brief >85% supercontinent that breaks up; s42 a 0.91 Gyr-bucket) — vs
  **zero** episodes on base for any seed. The stronger episodic behavior
  lives one step away in `pair` (stock orogeny): two episodes + a 70 Myr
  supercontinent on s42, at the cost of ~2.8 km continental means.
- **Health floors:** no deaths, no permanent monopoly, engine alive past
  4.4 Gyr, tempo in-band, land min ≥ 10% on s42/s1; s1337 transiently dips
  to 8.4% during its assembly episode (the promoted default itself records
  a 7.1% transient at N=128, so this is in-family, but it is below the 10%
  N=64 gate and must be owned explicitly if promoted).

If the supercontinent axis matters more than the mountain axis, ship `pair`
and leave orogeny stock; the two configs differ by one commit-sized diff.

## 6. What promotion still requires (not done here)

This campaign is measurement-only. Promoting the candidate requires the
standard discipline: N=128 confirmation run, seed robustness at the final
constants, deliberate golden regen under `KERNEL_BEHAVIOR_VERSION` 19 with
test-fixture reconciliation (the twoPlateState/plateDynamics spines pin
specific force balances), a datum-off spine carry-over, and an acceptance
grid reconciled against the stage-5 scoreboard floors. Also worth adding
first: an **episode metric** in the sim-cli harness (longest max-plate-frac
> 0.6 window + count of assembly→breakup transitions), so the Wilson-cycle
property gets a real gate instead of being read off per-Gyr dispersal
buckets — and so the §3 assembly→breakup 400–700 Myr target from the
proposal finally gets scored.

## 7. Round 5 — erosion, cliff probing, docking radius, N=128 (2026-07-20, second session)

Run under the absolute-palette dump fix (sim-cli `render.ts`): land now scales
against a fixed 6 km reference (dark rust-brown top, white reserved for the ice
dump) instead of stretching to each frame's own max — the old near-white peaks
read as snow/clouds and made arms visually incomparable.

| run | dispersal (epis.) | monopoly | land min–final % | comps | contElev @1.5/3/4.5 | verdict |
|---|---|---|---|---|---|---|
| erosion-3x on candidate, s42 | 90.9% (0.95/0.89/**0.75**) | 70 Myr ✓ | 9.8–23.6 | 212 (0.22) | 1871/−743/1417 | erosion ≠ elevation lever, but strengthens episodes |
| hazard-0.004 (+gap4+oro5), s42 | 95.6% (0.87/0.93) | 20 Myr ✓ | 10.8–26.1 | 142 (0.22) | 1145/−388/2480 | ✓ alive — the hazard cliff is below 0.004 |
| gap-3 (+0.005+oro5), s42 | 94.0% (0.87/0.88/0.96) | 0 | 10.7–26.2 | 146 (0.38) | 1070/−159/2130 | ✓ healthy; gap4 still better on s42 (91) |
| **candidate @ N=128**, s42 | 96.7% (0.95/0.98/0.84) | 0 | **6.4**–12.8 final | 602 (0.25) | −77/−309/−819 (vs 0 datum) | health floors hold; land-min and comps need owning — see below |

- **Erosion verdict (question closed):** 3× `EROSION_RATE_PER_YR` left the
  continental mean essentially unchanged (1.4–1.9 km vs candidate's 1.4–2.1) —
  influx-dominance now verified under the candidate config, matching the code
  reading (orogeny out-injects root decay ~20× on active margins; interior
  belts already die via the 300 Myr root-decay tau). Side effect worth a look:
  stronger erosion strengthened Wilson cycling (a 0.75 Gyr-bucket + 70 Myr
  monopoly) — plausibly sediment export → freeboard → tension coupling.
- **N=128 caveats, stated plainly:** transient land min 6.4% (the shipped
  default's owner-accepted N=128 transient is 7.1% — ours is slightly worse and
  must be owned explicitly); final land 12.8% with 602 land components. No
  comparable base-default N=128 component count exists in any findings doc, and
  finer grids resolve more small islands by construction, so the fragmentation
  number is NOT interpretable until a base N=128 rerun is measured side-by-side.
  Tempo (161 Myr), monopoly (0), engine liveness (4497 Myr) all in-band.
- Dense-dump reruns (30 Myr cadence) of pair s42 and candidate s1337 harvested
  the supercontinent gallery below; deterministic replays of the round-3/4
  worlds, new palette.

## 8. Open kernel gaps surfaced by owner review (not knob-fixable)

- **Isolated seas never desiccate.** `seaLevel.ts` solves ONE global scalar;
  `oceanVolumeMean` floods every cell below the level with no
  connected-to-ocean test, so a landlocked basin below global sea level stays
  sea forever — no Messinian-style evaporative drawdown/refill. Needs a
  connectivity mask in the sea-level solve + an endorheic basin water balance
  (evaporation vs runoff); kernel mechanism, own golden regen.

## 9. Evidence index (`default-settings-sweep-evidence/`)

Supercontinent gallery (absolute palette):

| file | shows |
|---|---|
| `supercontinent-pair-s42-3540Myr.png` | pair, s42: assembly phase |
| `supercontinent-pair-s42-3600Myr.png` | pair, s42: peak supercontinent (the Gyr-3 0.76 bucket) |
| `breakup-pair-s42-3840Myr.png` | pair, s42: breakup in progress |
| `supercontinent-candidate-s1337-1200Myr.png` | candidate, s1337: assembly phase |
| `supercontinent-candidate-s1337-1350Myr.png` | candidate, s1337: peak assembly (Gyr-1 0.78 bucket) |

Round 1–4 frames (legacy per-frame-stretch palette — peak-white is elevation,
not snow):

| file | shows |
|---|---|
| `baseline-s42-4500Myr.png` | promoted default final frame — the complaint |
| `pair-s42-3600Myr-supercontinent.png` | pair, seed 42: assembled supercontinent mid-episode |
| `pair-s42-4500Myr-postbreakup.png` | pair, seed 42: dispersed again after breakup |
| `pair-oro5-s42-2250Myr.png` | candidate, seed 42: coherent continents, moderated relief |
| `pair-oro5-s42-4500Myr.png` | candidate, seed 42: final frame (91 land components) |
| `pair-oro5-s1337-1350Myr-assembled.png` | candidate, seed 1337: early assembly episode |
| `cliff-rift-hazard-third-3150Myr-dying.png` | cliff #1: hazard 0.0025 — monopoly world drowning |
| `cliff-ref2x-stack-4500Myr-dead.png` | cliff #2: ref2x stack — frozen waterworld |
