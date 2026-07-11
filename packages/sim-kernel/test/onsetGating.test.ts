import { describe, expect, it } from 'vitest';
import { FIELD_NAMES } from '../src/fields';
import { hashFloat32Array } from '../src/hash';
import { createPlanetParams, type PlanetParams } from '../src/state';
import { run, type Keyframe } from '../src/step';

/**
 * The branched-A/B instrument contract (#84 → #88/#89/#90/#91), through the
 * FULL system pipeline: a flag-on run with onset Y is bit-identical to a
 * flag-off run until Y, for every default-off mechanism. None of the gated
 * systems consumes RNG, so post-onset deltas in the paired harness are the
 * mechanism's direct effect, not seed-level trajectory divergence — this
 * test is what makes `pnpm sim -- --ab <mechanism>` a measurement rather
 * than a hope. (blockIsostasy has the same test in blockIsostasy.test.ts,
 * where the instrument was born.)
 */

const MECHANISMS: ReadonlyArray<Partial<PlanetParams>> = [
  { crustFates: true, crustFatesOnsetYears: 20e6 },
  { compactArcs: true, compactArcsOnsetYears: 20e6 },
  { marinePlanation: true, marinePlanationOnsetYears: 20e6 },
  { emergentArcTaper: true, emergentArcTaperOnsetYears: 20e6 },
];

describe('onset gating (#88/#89/#90/#91 branched A/B)', () => {
  const untilYears = 30e6;
  const onsetYears = 20e6;
  const collect = (partial: Partial<PlanetParams>): Keyframe[] => {
    const frames: Keyframe[] = [];
    const params = createPlanetParams({ seed: 42, gridN: 32, ...partial });
    run(params, untilYears, (kf) => frames.push(kf));
    return frames;
  };
  const off = collect({});

  for (const mech of MECHANISMS) {
    const name = Object.keys(mech).find((k) => !k.endsWith('OnsetYears'))!;
    it(`${name}: flag-on with onset Y is bit-identical to flag-off until Y`, () => {
      const on = collect(mech);
      expect(on.length).toBe(off.length);
      for (let i = 0; i < off.length; i++) {
        if (off[i]!.timeYears > onsetYears) continue;
        for (const field of FIELD_NAMES) {
          expect(
            hashFloat32Array(on[i]!.fields[field]),
            `${name}: ${field} @ ${off[i]!.timeYears} yr`,
          ).toBe(hashFloat32Array(off[i]!.fields[field]));
        }
      }
    });
  }
});
