# AEON Architecture

Phase 0 skeleton. Grid mapping and index scheme below are final; the field
schema table, pipeline shape, keyframe format and determinism contract are
completed in Milestone 5.

## Cube-sphere grid

The planet surface is 6 cube faces, each an N×N cell grid (default N = 128).

### Flat index scheme

```
i = face * N * N + row * N + col        face ∈ [0,6), row/col ∈ [0,N)
```

Every per-cell field is a `Float32Array` of length `6·N²` in exactly this
order. Simulation and rendering share it.

### Faces

Faces are ordered `+X, -X, +Y, -Y, +Z, -Z`. Each face has an orthonormal frame
(normal `n`, `u` along growing col, `v` along growing row), defined in
`sim-kernel/src/grid.ts` (`FACE_NORMAL`, `FACE_U`, `FACE_V`) — that table is
the single source of truth; seam adjacency is *derived* from it at module
load, not hand-written.

### Mapping formula (tangent-adjusted cube-sphere)

A cell parameter `s ∈ [-1, 1]` along a face axis maps to the unit sphere via:

```
w   = tan(s · π/4)                    tangent warp (inverse: s = atan(w)·4/π)
p   = n + w_u · u + w_v · v           point on the unit cube face
dir = p / |p|                         radial projection to the sphere
```

Cell centers use `s = ((col + 0.5) / N) · 2 − 1` (rows likewise). The tangent
warp equalizes cell *angles* along each axis, reducing the max/min per-cell
solid-angle ratio from ~5.2 (plain cube projection) to ~1.3. The tests assert
per-cell solid angles stay within ±35% of the mean and sum to 4π within 1%.

### Neighbors across seams

`neighbors(i, N)` returns the 4 edge-adjacent cells in order
`[col−1, col+1, row−1, row+1]`, crossing face seams where needed. There are no
diagonal adjacencies; cube-corner cells still have exactly 4 neighbors (2
same-face, 2 across seams).

Seam mapping is derived by folding each face edge onto its neighbor: the fold
is computed from the face frames with exact ±1 dot products (which face the
edge lands on, which of its axes runs along the edge, whether the along-edge
index flips). Because both faces warp their shared edge with the same odd
`tan` function, along-edge cell k on one face aligns exactly with cell k (or
N−1−k) on the other.

```
        +----+            Unfolded cube (face indices):
        | +Y |
   +----+----+----+----+       rows of the +Z face meet +Y/-Y,
   | -X | +Z | +X | -Z |       cols wrap -X → +Z → +X → -Z → -X.
   +----+----+----+----+
        | -Y |
        +----+
```
