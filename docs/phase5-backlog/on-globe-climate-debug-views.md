# Phase 5 candidate — On-globe debug views for the climate fields

> **Status: filed as [#83](https://github.com/cowboydiver/AEON/issues/83)** in the
> Phase 5 milestone (`renderer` + `ui` + `phase-5`). This doc is the working
> draft; #83 is the tracked issue. Raised by the #36 acceptance review — see
> `PHASE_3_REPORT.md`.

## Motivation

Phase 3 populates five climate fields — `temperature` (#30), `windU`/`windV`
(#31), `precipitation` (#32), `iceFraction` (#33) — but the from-orbit render
only visualises three surface signals: `biome` colour (#35), ice whitening
(#33), and the sea-level shoreline (#33). `temperature`, `precipitation` and the
winds are **inputs** that decide the biomes and ice you see; they have no on-globe
view of their own. Today the only way to look at them is the CLI `--dump`
(`docs/phase3-evidence/`). A viewer scrubbing the live timeline therefore cannot
directly see the rain shadow as a precipitation field, the zonal temperature
gradient, or the wind bands — the systems are working (kernel invariants + dumps
prove it) but are invisible in the app, which reads as "the planet looks the
same". A field-overlay debug mode closes that gap and is a natural home for the
`windU`/`windV` fields that are already stored for exactly this future use
(spec §7.3).

## Approach sketch

- A render "view" selector (URL param `?view=biome|temperature|precipitation|wind`
  and/or a HUD control, alongside the existing `?until=`/plate-debug toggle).
- The blend material already samples `elevation`/`biome`/`iceFraction` per
  keyframe set A/B; add the extra fields to the stored/uploaded set (or recompute
  winds at render per the §7.3 alternative) and switch the `colorNode` between:
  - **biome** — the shipped default (unchanged).
  - **temperature** — a thermal ramp on the zonal + per-cell field.
  - **precipitation** — the dry→wet ramp, so the rain shadows read on the globe
    the way `--dump precipitation` shows them.
  - **wind** — visualise `windU`/`windV` (arrows or a signed diverging tint of
    the zonal component), the band structure.
- Reuse the CLI's fixed-reference palettes (`packages/sim-cli/src/render.ts`) so
  the globe and the `--dump` PNGs agree.
- Categorical hold/nearest vs continuous lerp rules across keyframes stay exactly
  as they are per field (biome nearest; temperature/precip/ice/wind linear).

## Out of scope

- Not scattering/clouds/specular ocean/night side (those are #42–#45).
- No new kernel behaviour or golden changes — this is a renderer/UI read-only view
  over fields that already exist.

## Acceptance criteria

- Switching `?view=` (and/or the HUD control) repaints the globe with the
  selected field's ramp; `biome` remains the default and is byte-identical to
  today.
- The `precipitation` view shows the rain shadows behind the mountain belts in
  the live render (the field, not just via biomes) — the §8 "in the live render"
  criterion, now shown directly.
- The `temperature` and `wind` views read the zonal gradient / band structure.
- Palettes match the `--dump` output for the same field and state.
- `pnpm -F web e2e` extended with a view-switch screenshot per mode; typecheck +
  lint clean; no kernel golden churn.
