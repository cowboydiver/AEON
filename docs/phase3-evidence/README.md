# Phase 3 acceptance evidence (#36)

Curated equirectangular field dumps from the headless harness, the "look at
them" evidence for the Phase 3 climate stack. All frames are **seed 42, N=96**,
default params, regenerable with:

```
pnpm sim -- --seed 42 --until 2e9 --grid-n 96 --keyframe-interval 200e6 \
  --dump elevation,precipitation,temperature,iceFraction,biome --out tmp/phase3
```

Projection: 512×256 equirectangular (−180…180° lon, 90…−90° lat). Palettes are
the fixed-reference ramps in `packages/sim-cli/src/render.ts` (so brightness is
comparable across frames, not per-frame stretched — except `temperature`, which
falls through to a min/max grayscale: bright = warm, dark = cold).

## Rain shadows emerge behind the mountain belts (#32)

- **`elevation-001000Myr.png`** / **`precipitation-001000Myr.png`** — the hero
  pair. Read them together: the precipitation field is the emergent moisture
  transport (arid tan → savanna → forest green → wet blue on a fixed 2500
  kg/m²/yr reference), not a painted latitude proxy. The equatorial ITCZ is the
  wet belt; on top of it, precipitation varies strongly **with longitude at the
  same latitude** — windward continental margins and coasts run green/wet while
  the lee interiors behind the `elevation` mountain belts dry to tan. That
  windward-wet / lee-dry contrast across the ranges is the rain shadow, emergent
  from the transport (the metric backing this is `moisture.test.ts`).
- **`elevation-002000Myr.png`** / **`precipitation-002000Myr.png`** — the same
  read on the more mature 2 Gyr terrain.

## The planet looks alive from orbit (#35)

- **`biome-002000Myr.png`** — the Whittaker biome classification the renderer
  colours the globe by: blue ocean, tan/khaki deserts and grasslands over the
  dry subtropics and rain-shadowed interiors, green temperate and tropical
  forests over the wet belts, grey tundra at the cold high latitudes. The
  ecosystem bands track the temperature/precipitation fields below.

## The zonal energy balance (#30)

- **`temperature-002000Myr.png`** — bright (warm) equator fading to dark (cold)
  poles, with the mountain belts picked out as cold dark streaks (the lapse-rate
  term over the `elevation` relief). This is the zonal EBM profile plus per-cell
  lapse/continentality corrections, not a latitude band.

## Ice caps advance AND retreat over the timeline (#33)

- **`iceFraction-000200Myr.png`** (mean cover ≈ 0.021) →
  **`iceFraction-003250Myr.png`** (≈ 0.045) → **`iceFraction-004000Myr.png`**
  (≈ 0.039) — dark slate is ice-free, pale blue → white is ice cover on a fixed
  0–1 scale. Early (200 Myr) the planet is nearly ice-free (thin polar and summit
  traces); by 3.25 Gyr the polar caps and montane glaciers have **advanced** to
  their widest in this record; by 4 Gyr they have **retreated** again (visibly
  fewer bright patches than at 3.25 Gyr). That advance-then-retreat is one cycle
  of the breathing — the full mean-cover series oscillates repeatedly across the
  4.5 Gyr span (per-seed spans, direction-reversal counts and Σ advance/retreat
  are in `PHASE_3_REPORT.md`; the standing invariant is in
  `test/invariants/phase3.test.ts`), and it is what the live timeline scrub shows.

## The live render (#35/#36)

`render/` holds the from-orbit globe captured by the `phase3-acceptance.spec.ts`
e2e (headed Chromium under Xvfb, Vulkan-on-SwiftShader, N=128, seed 42), the
"looks alive from orbit" done-criterion:

- **`render/render-000Myr.png`** — formation. A warm, near ice-free young planet:
  the biome ramp already colours it (blue ocean, tan interiors, green vegetation
  fringes) with only faint polar ice.
- **`render/render-250Myr.png`** / **`render/render-500Myr.png`** — 0.25 and 0.5
  Gyr. The continents have drifted and the **polar ice caps have grown** to bold
  white caps at both poles (plus montane ice), over a biome-coloured surface with
  a sea-level shoreline. The HUD reads seed, time, and the emergent land fraction.
  The three frames together are the render half of "biome-driven colour with ice
  caps that advance over the timeline".

**Rain shadows in the live render** show up *through* the biome ramp (the render
is biome-driven, #35, not a raw precipitation channel): the wet windward margins
carry green vegetation while the dry continental interiors and mountain lees are
tan desert/grassland — the same rain shadow the `precipitation` dumps show as a
field. `phase3-acceptance.spec.ts` asserts both the vegetated (green) and arid
(tan) families are present on the end-of-span globe as the from-orbit
rain-shadow signature.
