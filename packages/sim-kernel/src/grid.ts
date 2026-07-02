/**
 * Cube-sphere grid: 6 faces x N x N cells, flat index
 * `i = face * N * N + row * N + col`.
 *
 * Mapping (documented in docs/ARCHITECTURE.md): a cell parameter s in [-1, 1]
 * is tangent-warped to the cube coordinate w = tan(s * PI/4), then the face
 * point `normal + w_u * uAxis + w_v * vAxis` is normalized onto the unit
 * sphere. The tangent warp makes cell angular size nearly uniform (area ratio
 * max/min ~1.3 vs ~5.2 for the unwarped cube), and is its own exact inverse
 * (s = atan(w) * 4/PI), which keeps direction -> cell lookup cheap.
 *
 * Face frames are the single source of truth: seam adjacency (the classic bug
 * farm) is *derived* from them at module load by folding each edge onto its
 * neighboring face with exact +/-1 dot products — no hand-written 24-entry
 * table to get wrong. Faces are ordered +X, -X, +Y, -Y, +Z, -Z.
 */

export type Vec3 = [number, number, number];

export const DEFAULT_GRID_N = 128;

const FACE_NORMAL: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
// uAxis maps col growth, vAxis maps row growth.
const FACE_U: readonly Vec3[] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [1, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
];
const FACE_V: readonly Vec3[] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
];

const QUARTER_PI = Math.PI / 4;

/** Tangent warp: grid parameter s in [-1,1] -> cube face coordinate. */
export function warp(s: number): number {
  return Math.tan(s * QUARTER_PI);
}

/** Inverse tangent warp: cube face coordinate -> grid parameter in [-1,1]. */
export function unwarp(w: number): number {
  return Math.atan(w) / QUARTER_PI;
}

export function cellCount(N: number): number {
  return 6 * N * N;
}

export function indexToFaceRC(i: number, N: number): [face: number, row: number, col: number] {
  const perFace = N * N;
  const face = Math.floor(i / perFace);
  const rem = i - face * perFace;
  const row = Math.floor(rem / N);
  const col = rem - row * N;
  return [face, row, col];
}

export function faceRCToIndex(face: number, row: number, col: number, N: number): number {
  return face * N * N + row * N + col;
}

/**
 * Unit-sphere direction for face parameters s (col axis) and t (row axis),
 * both in [-1, 1] *before* the tangent warp. Shared by cell centers, cell
 * corners and the renderer's mesh vertices so simulation and rendering agree.
 */
export function faceSTToDirection(face: number, s: number, t: number): Vec3 {
  const n = FACE_NORMAL[face]!;
  const u = FACE_U[face]!;
  const v = FACE_V[face]!;
  const wu = warp(s);
  const wv = warp(t);
  const x = n[0] + wu * u[0] + wv * v[0];
  const y = n[1] + wu * u[1] + wv * v[1];
  const z = n[2] + wu * u[2] + wv * v[2];
  const invLen = 1 / Math.sqrt(x * x + y * y + z * z);
  return [x * invLen, y * invLen, z * invLen];
}

export function cellCenterDirection(i: number, N: number): Vec3 {
  const [face, row, col] = indexToFaceRC(i, N);
  const s = ((col + 0.5) / N) * 2 - 1;
  const t = ((row + 0.5) / N) * 2 - 1;
  return faceSTToDirection(face, s, t);
}

/** Nearest cell containing the given (not necessarily unit) direction. */
export function directionToIndex(dir: Vec3, N: number): number {
  const [x, y, z] = dir;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x >= 0 ? 0 : 1;
  else if (ay >= az) face = y >= 0 ? 2 : 3;
  else face = z >= 0 ? 4 : 5;

  const n = FACE_NORMAL[face]!;
  const u = FACE_U[face]!;
  const v = FACE_V[face]!;
  const invD = 1 / (x * n[0] + y * n[1] + z * n[2]);
  const wu = (x * u[0] + y * u[1] + z * u[2]) * invD;
  const wv = (x * v[0] + y * v[1] + z * v[2]) * invD;
  const s = unwarp(wu);
  const t = unwarp(wv);
  const col = Math.min(N - 1, Math.max(0, Math.floor(((s + 1) / 2) * N)));
  const row = Math.min(N - 1, Math.max(0, Math.floor(((t + 1) / 2) * N)));
  return faceRCToIndex(face, row, col, N);
}

// --- Seam adjacency, derived from the face frames -------------------------

interface EdgeMap {
  /** Neighboring face across this edge. */
  face: number;
  /** On the neighbor, does the along-edge index vary col (true) or row? */
  alongIsCol: boolean;
  /** Reverse the along-edge index (k -> N-1-k)? */
  flip: boolean;
  /** Is the neighbor's perpendicular index at N-1 (true) or 0 (false)? */
  boundaryHigh: boolean;
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Fold edge `e` of face `f` onto its neighboring face. Edges are numbered
 * 0: col=-1, 1: col=N, 2: row=-1, 3: row=N. All arithmetic below is exact
 * (dot products of +/-1 unit basis vectors), so the derived table is exact.
 */
function computeEdgeMap(f: number, e: number): EdgeMap {
  const n = FACE_NORMAL[f]!;
  const u = FACE_U[f]!;
  const v = FACE_V[f]!;
  const fixU = e === 0 ? -1 : e === 1 ? 1 : 0;
  const fixV = e === 2 ? -1 : e === 3 ? 1 : 0;

  // A point just beyond the edge determines the neighbor face by dominant axis.
  const beyond: Vec3 = [
    n[0] + 1.5 * (fixU * u[0] + fixV * v[0]),
    n[1] + 1.5 * (fixU * u[1] + fixV * v[1]),
    n[2] + 1.5 * (fixU * u[2] + fixV * v[2]),
  ];
  let g = -1;
  for (let cand = 0; cand < 6; cand++) {
    if (cand !== f && dot3(beyond, FACE_NORMAL[cand]!) > 1.25) g = cand;
  }
  if (g < 0) throw new Error(`grid: no neighbor face for face ${f} edge ${e}`);

  // Edge points E(w) = n + fixed axis + w * along axis lie on g's plane.
  const along = e < 2 ? v : u;
  const fixed: Vec3 = [
    n[0] + fixU * u[0] + fixV * v[0],
    n[1] + fixU * u[1] + fixV * v[1],
    n[2] + fixU * u[2] + fixV * v[2],
  ];
  if (dot3(fixed, FACE_NORMAL[g]!) !== 1) {
    throw new Error(`grid: edge of face ${f} does not lie on face ${g}'s plane`);
  }
  // Neighbor-local coordinates of the edge: one is constant +/-1 (the
  // perpendicular boundary), the other varies as +/-w (the along-edge axis).
  const constU = dot3(fixed, FACE_U[g]!);
  const constV = dot3(fixed, FACE_V[g]!);
  const slopeU = dot3(along, FACE_U[g]!);
  const slopeV = dot3(along, FACE_V[g]!);

  if (slopeU !== 0) {
    if (Math.abs(slopeU) !== 1 || Math.abs(constV) !== 1 || slopeV !== 0) {
      throw new Error(`grid: degenerate edge fold for face ${f} edge ${e}`);
    }
    return { face: g, alongIsCol: true, flip: slopeU === -1, boundaryHigh: constV === 1 };
  }
  if (Math.abs(slopeV) !== 1 || Math.abs(constU) !== 1) {
    throw new Error(`grid: degenerate edge fold for face ${f} edge ${e}`);
  }
  return { face: g, alongIsCol: false, flip: slopeV === -1, boundaryHigh: constU === 1 };
}

const EDGE_MAPS: readonly (readonly EdgeMap[])[] = FACE_NORMAL.map((_, f) =>
  [0, 1, 2, 3].map((e) => computeEdgeMap(f, e)),
);

/**
 * The 4 edge-adjacent neighbors of cell i, in order [col-1, col+1, row-1,
 * row+1], crossing face seams where needed. Every cell — corners included —
 * has exactly 4 neighbors (cube corner cells have two same-face and two
 * cross-seam neighbors; there are no diagonal adjacencies).
 */
export function neighbors(i: number, N: number): number[] {
  const [face, row, col] = indexToFaceRC(i, N);
  return [
    neighborCell(face, row, col - 1, N),
    neighborCell(face, row, col + 1, N),
    neighborCell(face, row - 1, col, N),
    neighborCell(face, row + 1, col, N),
  ];
}

function neighborCell(face: number, row: number, col: number, N: number): number {
  if (row >= 0 && row < N && col >= 0 && col < N) {
    return faceRCToIndex(face, row, col, N);
  }
  const e = col < 0 ? 0 : col >= N ? 1 : row < 0 ? 2 : 3;
  const k = e < 2 ? row : col; // along-edge index on the source face
  const m = EDGE_MAPS[face]![e]!;
  const kk = m.flip ? N - 1 - k : k;
  const boundary = m.boundaryHigh ? N - 1 : 0;
  return m.alongIsCol
    ? faceRCToIndex(m.face, boundary, kk, N)
    : faceRCToIndex(m.face, kk, boundary, N);
}
