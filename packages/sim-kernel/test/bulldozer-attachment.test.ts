import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge } from '../src/bathymetry';
import { cellCenterDirection, neighbors } from '../src/grid';
import { runSystems, twoPlateState } from './helpers';
import type { PlanetState } from '../src/state';

const N = 16;

/**
 * Pins the #67 bulldozer attachment preference: displaced continental crust
 * re-roots on same-plate oceanic ground ATTACHED to continental mass in
 * preference to unattached ocean, even when the unattached candidate is the
 * better-aligned (forward) one. Without this test, a refactor could revert
 * to the pre-#67 forward-first pick and every conservation test would stay
 * green — the regression would only surface as deep-time shape metrics
 * drifting.
 *
 * The fixture uses the BLOCKED-MOVER push (a moving continental source
 * whose content wins at no target), because it is the only case that can
 * discriminate: in the static-displaced case every candidate is a
 * 4-neighbor of the displaced cell, and that cell ends the event holding
 * the winner's continental crust, so every candidate is trivially attached.
 * A blocked mover's own cell instead receives its plate's trailing OCEANIC
 * content, leaving its neighbors' attachment to be decided by the rest of
 * the map.
 *
 * World: plate 1 (z < 0, continental by default) rotates east about +Z;
 * plate 0 (z >= 0) is static and continental. A one-cell continental
 * salient M of plate 1 is embedded in the row just north of the equator
 * near +X (away from cube-face corners, so rotation preserves rows), with
 * a run of plate-1 OCEANIC cells painted west of it (its trailing crust)
 * and an oceanic strip painted around the candidates:
 *
 *      row +2N :  cont | ocean(N1,p0) | cont  | cont ...   (static plate 0)
 *      row +1N :  ...  W3     W2        W1      M    E ...  (W* = p1 ocean, M = p1 cont, E = p0 cont)
 *      row -1S :  ... SW3    SW2       SW1     S2   ...     (all p1 ocean)
 *      row -2S :  cont   cont         cont    cont  ...     (plate 1 cont)
 *
 * At the first advection event M's content maps onto static plate-0
 * continental ground (E/EE) and loses everywhere (same type, lower plate id
 * wins) — a blocked mover. Its push direction is backward (west), where W1
 * sits perfectly aligned but UNATTACHED (all four of W1's post-advection
 * neighbors are oceanic), while S2 sits sideways (dot ~ 0) but ATTACHED
 * (row -2S below it stays continental). The pre-#67 pick chose the forward
 * W1; the #67 pick must choose the attached S2.
 */
function attachmentWorld(): { state: PlanetState; M: number; W1: number; S2: number } {
  const state = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 0, 1], omega: 8e-9 });
  const { plateId } = state.fields;

  // Directional neighbor walk: the 4-neighbor whose center moves furthest
  // along dir. Near the +X face center rows/columns align with +-y / +-z.
  const walk = (i: number, dir: [number, number, number]): number => {
    const c = cellCenterDirection(i, N);
    let best = -1;
    let bestDot = -Infinity;
    for (const nb of neighbors(i, N)) {
      const nc = cellCenterDirection(nb, N);
      const d = (nc[0] - c[0]) * dir[0] + (nc[1] - c[1]) * dir[1] + (nc[2] - c[2]) * dir[2];
      if (d > bestDot) {
        bestDot = d;
        best = nb;
      }
    }
    return best;
  };
  const WEST: [number, number, number] = [0, -1, 0];
  const SOUTH: [number, number, number] = [0, 0, -1];
  const NORTH: [number, number, number] = [0, 0, 1];

  // M: the plate-0 boundary-row cell nearest +X (has a plate-1 neighbor).
  let M = -1;
  let bestX = -Infinity;
  for (let i = 0; i < plateId.length; i++) {
    if (plateId[i] !== 0) continue;
    let touchesP1 = false;
    for (const nb of neighbors(i, N)) if (plateId[nb] === 1) touchesP1 = true;
    if (!touchesP1) continue;
    const x = cellCenterDirection(i, N)[0];
    if (x > bestX) {
      bestX = x;
      M = i;
    }
  }
  expect(M).not.toBe(-1);

  const plateIdNew = plateId.slice();
  const crustType = state.fields.crustType.slice();
  const crustAge = state.fields.crustAge.slice();
  const elevation = state.fields.elevation.slice();
  const paintOcean = (i: number): void => {
    crustType[i] = 0;
    crustAge[i] = 50e6;
    elevation[i] = oceanicDepthForAge(50e6);
  };

  // The salient: M becomes plate-1 continental with a marker elevation.
  plateIdNew[M] = 1;
  elevation[M] = 777;

  // Trailing plate-1 ocean west of M (long enough to feed M's cell and
  // W1's cell for any 1-2.5 cell advection quantum), with the strip south
  // of it also oceanic (it flows east into S2 and SW1 at the event) and
  // the one cell north of W1 oceanic (static plate 0 keeps it in place).
  // That leaves W1's entire post-advection neighborhood oceanic —
  // unattached — while S2 stays attached through the continental row two
  // south of the boundary.
  let w = M;
  const wRun: number[] = [];
  for (let k = 0; k < 5; k++) {
    w = walk(w, WEST);
    wRun.push(w);
    plateIdNew[w] = 1;
    paintOcean(w);
    paintOcean(walk(w, SOUTH)); // naturally plate 1
  }
  const W1 = wRun[0]!;
  paintOcean(walk(W1, NORTH)); // stays plate 0, static
  const S2 = walk(M, SOUTH);
  expect(plateIdNew[S2]).toBe(1);
  paintOcean(S2);
  // The attachment source: two rows south of the boundary stays continental.
  const SS = walk(S2, SOUTH);
  expect(plateIdNew[SS]).toBe(1);
  expect(crustType[SS]).toBe(1);

  return {
    state: {
      ...state,
      fields: { ...state.fields, plateId: plateIdNew, crustType, crustAge, elevation },
    },
    M,
    W1,
    S2,
  };
}

describe('bulldozer attachment preference (#67)', () => {
  it('a blocked mover re-roots on attached ocean, not the better-aligned unattached ocean', () => {
    const { state, M, W1, S2 } = attachmentWorld();

    // Step until plate 1's first advection event, then stop: later events
    // advect the re-rooted marker onward and would blur the assertion. The
    // salient's east face is convergent until the event (the boundary wraps
    // around it), so collision orogeny grows M's elevation from the 777
    // marker — the displaced column carries M's elevation AT THE START of
    // the event step, captured as prevM.
    let s = state;
    let prevM = s.fields.elevation[M]!;
    for (let i = 0; i < 40 && s.plates[1]!.advectionCount === 0; i++) {
      prevM = s.fields.elevation[M]!;
      s = runSystems(s, 1);
    }
    expect(s.plates[1]!.advectionCount).toBe(1);
    expect(prevM).toBeGreaterThanOrEqual(777);

    // M's cell now carries the trailing ocean; its displaced column
    // re-rooted on the ATTACHED candidate S2 (sideways), not the
    // forward-aligned unattached W1.
    expect(s.fields.crustType[S2]).toBe(1);
    expect(s.fields.elevation[S2]).toBe(prevM);
    expect(s.fields.crustType[W1]).toBe(0);
    // And it landed attached: the re-rooted cell has continental neighbors.
    let contNb = 0;
    for (const nb of neighbors(S2, N)) if (s.fields.crustType[nb] === 1) contNb++;
    expect(contNb).toBeGreaterThan(0);
  });
});
