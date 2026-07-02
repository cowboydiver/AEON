import { BufferGeometry, Float32BufferAttribute, Points, PointsMaterial } from 'three';
import { createRng } from 'sim-kernel';

/**
 * Deterministic background starfield: seeded points on a large sphere.
 * Uses the kernel PRNG so screenshots are reproducible.
 */
export function createStarfield(count = 2000, radius = 60, seed = 7): Points {
  const rng = createRng(seed).fork('starfield');
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform direction: rejection-sample the unit ball, project to sphere.
    let x: number;
    let y: number;
    let z: number;
    let len2: number;
    do {
      x = rng.next() * 2 - 1;
      y = rng.next() * 2 - 1;
      z = rng.next() * 2 - 1;
      len2 = x * x + y * y + z * z;
    } while (len2 > 1 || len2 < 1e-6);
    const scale = radius / Math.sqrt(len2);
    positions[i * 3] = x * scale;
    positions[i * 3 + 1] = y * scale;
    positions[i * 3 + 2] = z * scale;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({ color: 0xffffff, size: 0.05, sizeAttenuation: true });
  const points = new Points(geometry, material);
  points.name = 'starfield';
  return points;
}
