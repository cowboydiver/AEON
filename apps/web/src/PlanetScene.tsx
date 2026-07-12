import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { KeyframeBlender, MARINE_TINT_ON, createPlanetMesh, createStarfield } from 'planet-renderer';
import { EARTH_RADIUS_M } from 'sim-kernel';
import type { RenderBlend } from './usePlanetWorker';

const SUN_DIRECTION: [number, number, number] = [1, 0.25, 0.45];

interface PlanetSceneProps {
  gridN: number;
  blend: RenderBlend | null;
  /** Debug overlay: plate boundaries + crust-type colours (oceanic vs continental). */
  plateDebug: boolean;
  /** Scalar debug field index: 0 = off, 1..N = false-colour that continuous
   *  field (see `DEBUG_FIELDS`); takes precedence over `plateDebug`. */
  debugField: number;
  /** Tint the ocean green by marine productivity in the beauty render (#38).
   *  Off leaves the surface byte-identical to the pre-#38 render. */
  oceanLife: boolean;
  onFirstFrame: () => void;
}

export function PlanetScene({ gridN, blend, plateDebug, debugField, oceanLife, onFirstFrame }: PlanetSceneProps) {
  const { camera, gl } = useThree();
  const planet = useMemo(() => createPlanetMesh(gridN, EARTH_RADIUS_M), [gridN]);
  // Ping-pong residency between the two texture sets: re-uploads only the set
  // that changed on a keyframe-boundary crossing, and moves the blend uniform
  // for every fractional scrub (no upload, so scrubbing stays tactile).
  const blender = useMemo(
    () => new KeyframeBlender(planet.fieldsA, planet.fieldsB, planet.uniforms.blend),
    [planet],
  );
  const starfield = useMemo(() => createStarfield(), []);
  const framesSinceUpload = useRef(0);
  const uploadedRef = useRef(false);
  const notified = useRef(false);

  useEffect(() => {
    planet.uniforms.sunDirection.value.set(...SUN_DIRECTION).normalize();
  }, [planet]);

  // Drive the plate-debug overlay uniform (0/1) from the toggle. Cheap: flips a
  // single uniform, no re-upload — the material's `plateDebug` swaps the biome
  // surface for the crust-type + plate-boundary map.
  useEffect(() => {
    planet.uniforms.plateDebug.value = plateDebug ? 1 : 0;
  }, [planet, plateDebug]);

  // Drive the scalar debug-field uniform (0 = off). Like plateDebug, this flips a
  // single uniform — no re-upload — and the material false-colours the selected
  // continuous field through viridis.
  useEffect(() => {
    planet.uniforms.debugField.value = debugField;
  }, [planet, debugField]);

  // Marine-productivity ocean tint (#38): a uniform flip, no re-upload. Off (0)
  // keeps the beauty surface byte-identical to the pre-#38 render.
  useEffect(() => {
    planet.uniforms.marineTint.value = oceanLife ? MARINE_TINT_ON : 0;
  }, [planet, oceanLife]);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.3;
    controls.maxDistance = 12;
    return () => controls.dispose();
  }, [camera, gl]);

  useEffect(() => {
    // Regenerate routes blend through null; re-arm so onFirstFrame fires again
    // for the new run (readiness is per-run, not once per component lifetime).
    if (!blend) {
      uploadedRef.current = false;
      notified.current = false;
      framesSinceUpload.current = 0;
      return;
    }
    blender.set(blend.aIndex, blend.aFields, blend.bIndex, blend.bFields, blend.fraction);
    // Arm the readiness countdown only on the first upload of a run — not on
    // every fractional scrub, which would re-fire onFirstFrame needlessly.
    if (!uploadedRef.current) {
      uploadedRef.current = true;
      framesSinceUpload.current = 0;
      notified.current = false;
    }
  }, [blend, blender]);

  // Report readiness a few frames after the first keyframe upload so the canvas
  // has actually presented the planet (e2e keys off this).
  useFrame(() => {
    if (!uploadedRef.current || notified.current) return;
    framesSinceUpload.current++;
    if (framesSinceUpload.current >= 3) {
      notified.current = true;
      onFirstFrame();
    }
  });

  return (
    <>
      <primitive object={starfield} />
      {blend ? <primitive object={planet.group} /> : null}
      {/* Scene sun light matching the material's sun uniform, for future
          standard-lit objects (moons, atmosphere). */}
      <directionalLight position={SUN_DIRECTION} intensity={2} />
    </>
  );
}
