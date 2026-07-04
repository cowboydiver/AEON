import { uploadKeyframe, type BlendFieldName, type PlanetFieldTextures } from './textures';
import type { Fields } from 'sim-kernel';

/** A decoded keyframe's blendable fields (elevation required; plateId when present). */
export type BlendFields = Partial<Pick<Fields, BlendFieldName>>;

/** Minimal view of the `blend` uniform node (`uniform(0)` from three/tsl). */
interface BlendUniform {
  value: number;
}

/**
 * Ping-pong residency for the two keyframe texture sets. Given a bracketing
 * keyframe pair (aIndex, bIndex) and a blend fraction, it re-uploads ONLY the
 * physical set that changed since the last call — swapping which physical set
 * plays the "a" role rather than re-uploading both — and sets the shared `blend`
 * uniform so the material's `mix`/nearest sampling reads a→b correctly whichever
 * role order the sets ended up in.
 *
 * Scrubbing within one bracket (only the fraction changes) touches no texture at
 * all: it just moves the uniform, which is why the scrub stays tactile. A GPU
 * upload happens only when the playhead crosses a keyframe boundary, and then for
 * a single set. Crossing forward (0,1)→(1,2) keeps keyframe 1 resident and
 * uploads only 2; crossing back does the mirror — one upload per boundary either
 * way.
 */
export class KeyframeBlender {
  /** Keyframe index currently uploaded to each physical set; -1 = nothing yet. */
  private residentA = -1;
  private residentB = -1;

  constructor(
    private readonly setA: PlanetFieldTextures,
    private readonly setB: PlanetFieldTextures,
    private readonly blend: BlendUniform,
  ) {}

  /**
   * Show keyframe `ai` (fields `af`) blended toward `bi` (`bf`) at fraction
   * `f` ∈ [0, 1]. `ai === bi` (an exact keyframe, or a single-frame history)
   * shows just that keyframe with no blend.
   */
  set(ai: number, af: BlendFields, bi: number, bf: BlendFields, f: number): void {
    if (ai === bi) {
      if (this.residentA === ai) this.blend.value = 0;
      else if (this.residentB === ai) this.blend.value = 1;
      else {
        uploadKeyframe(this.setA, af);
        this.residentA = ai;
        this.blend.value = 0;
      }
      return;
    }

    // Both sets already hold the pair (in either role order): move the uniform only.
    if (this.residentA === ai && this.residentB === bi) {
      this.blend.value = f;
    } else if (this.residentA === bi && this.residentB === ai) {
      this.blend.value = 1 - f;
    }
    // Otherwise keep whichever resident keyframe is still needed and upload the
    // other set; blend is f when physical A holds `ai`, else 1 - f.
    else if (this.residentA === ai) {
      uploadKeyframe(this.setB, bf);
      this.residentB = bi;
      this.blend.value = f;
    } else if (this.residentA === bi) {
      uploadKeyframe(this.setB, af);
      this.residentB = ai;
      this.blend.value = 1 - f;
    } else if (this.residentB === ai) {
      uploadKeyframe(this.setA, bf);
      this.residentA = bi;
      this.blend.value = 1 - f;
    } else if (this.residentB === bi) {
      uploadKeyframe(this.setA, af);
      this.residentA = ai;
      this.blend.value = f;
    } else {
      uploadKeyframe(this.setA, af);
      uploadKeyframe(this.setB, bf);
      this.residentA = ai;
      this.residentB = bi;
      this.blend.value = f;
    }
  }
}
