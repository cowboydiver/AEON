import { PNG } from 'pngjs';

/** Fraction of pixels whose summed RGB delta exceeds a small threshold — a
 *  cheap perceptual diff that ignores SwiftShader anti-aliasing jitter.
 *  (Same metric as planet.spec.ts.) */
export function diffFraction(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  const n = Math.min(pa.data.length, pb.data.length) / 4;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const dr = Math.abs(pa.data[i * 4]! - pb.data[i * 4]!);
    const dg = Math.abs(pa.data[i * 4 + 1]! - pb.data[i * 4 + 1]!);
    const db = Math.abs(pa.data[i * 4 + 2]! - pb.data[i * 4 + 2]!);
    if (dr + dg + db > 24) changed++;
  }
  return changed / n;
}

/** Wait for two presented frames so a scrub's uniform/upload has rendered. */
export async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.waitForTimeout(150);
}
