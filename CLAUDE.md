# CLAUDE.md — Planet Evolution Simulator

A 3D web application that simulates the full evolutionary history of a procedurally
generated planet — formation through deep time — viewed from space with a timeline
scrubber. A deterministic simulation kernel produces keyframed planet state; a
WebGPU renderer blends keyframes on the GPU. A future phase adds surface exploration
via quadtree LOD and procedural detail amplification, which is why determinism is
sacred.

## Monorepo layout

```
packages/sim-kernel/      Pure TypeScript simulation. ZERO runtime deps. No Three, no DOM, no Node APIs in src/.
packages/planet-renderer/ Three.js (WebGPU + TSL) materials, meshes, keyframe-blending. No React.
packages/sim-cli/         Node CLI harness: run sims headless, print reports, dump field PNGs.
apps/web/                 Vite + React + React Three Fiber app. Timeline UI, worker host.
docs/ARCHITECTURE.md      Field schema, system coupling graph, grid indexing. Read it before touching the kernel.
```

Dependency direction is strictly: `apps/web` → `planet-renderer` → `sim-kernel`,
and `sim-cli` → `sim-kernel`. Never the reverse. `sim-kernel` imports nothing.

## Hard rules (never violate)

1. **Determinism.** Same seed + same parameters ⇒ bit-identical history, on every
   machine, forever. All randomness flows through the seeded PRNG in
   `sim-kernel/src/rng.ts` or the position hash in `hash.ts`. `Math.random`,
   `Date.now`, `performance.now`, and iteration over non-deterministic key order
   are banned in `sim-kernel` (ESLint enforces the first three; you enforce the
   last one).
2. **Kernel purity.** Every system is a pure function
   `(state: PlanetState, dt: number, ctx: SimContext) => PlanetState`. No I/O, no
   globals, no mutation of the input state. Internal buffer pooling is allowed only
   inside the kernel's step scheduler, never inside a system.
3. **Fields are typed arrays.** Per-cell data lives in `Float32Array`s (quantized
   forms come later) laid out in the flat cube-sphere index order defined in
   `docs/ARCHITECTURE.md`. Never per-cell JS objects. Never resize a field.
4. **The grid is shared truth.** Simulation and rendering use the same cube-sphere
   grid and index scheme. Any change to grid math is a breaking change: update
   `ARCHITECTURE.md`, regenerate golden hashes deliberately, and say so loudly.
5. **No `any`, no `@ts-ignore`** without an adjacent comment explaining why.
   TypeScript is `strict: true` everywhere.

## Commands

```
pnpm test                 # all Vitest suites (kernel tests must stay < 30 s)
pnpm -F sim-kernel test   # kernel only — run after ANY kernel change
pnpm sim -- --seed 42 --until 500e6 --report
                          # headless run: prints summary stats per checkpoint
pnpm sim -- --seed 42 --until 500e6 --dump elevation,temperature --out tmp/
                          # writes equirectangular PNGs of fields — LOOK at them
pnpm -F web dev           # Vite dev server
pnpm -F web e2e           # Playwright: renders app, screenshots timeline positions
pnpm lint                 # ESLint incl. kernel determinism rules
```

## Verification workflow (follow this, in order)

- **Changed the kernel?** `pnpm -F sim-kernel test`, then run the sim harness with
  `--report` and at least one `--dump`, and actually inspect the PNGs. Numbers
  passing but continents looking like static noise is a failure.
- **Changed golden-hash behavior on purpose?** Explain the physical/algorithmic
  reason in the commit message, then regenerate via `pnpm -F sim-kernel test -- -u`.
  Never regenerate to silence a test you don't understand.
- **Changed the renderer?** `pnpm -F web e2e` and inspect the screenshots yourself.
- **Adding a system or field?** Update `docs/ARCHITECTURE.md` in the same commit.

## Testing requirements

- **Golden determinism tests:** FNV-1a hashes of every field at fixed checkpoints
  for seeds {1, 42, 1337}. These are the project's spine.
- **Invariant tests per system:** conservation properties (crust area equals sphere
  area, water mass conserved across hydrology, energy balance closes within
  tolerance) and directional sanity (converging plates raise elevation at the
  boundary; windward slopes get more precipitation than lee slopes).
- Prefer many small, fast, brutally specific tests over broad slow ones.

## Conventions

- pnpm workspaces; ESM only; Node ≥ 22 for tooling.
- Sim units are SI internally; time in years (as `number`, documented per API).
  Constants live in `sim-kernel/src/constants.ts` with a source comment each.
- Field names are the single source of truth in `sim-kernel/src/fields.ts`
  (a const object, not a string union scattered around).
- Commit style: small, single-purpose commits; imperative subject line; body states
  what physical behavior changed and how it was verified.
- When plans and reality diverge, reality wins: report what the sim actually
  produced, don't paper over it.
