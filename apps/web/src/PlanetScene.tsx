import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPlanetMesh, createStarfield, uploadKeyframe } from 'planet-renderer';
import { EARTH_RADIUS_M } from 'sim-kernel';
import type { RenderKeyframe } from './usePlanetWorker';

const SUN_DIRECTION: [number, number, number] = [1, 0.25, 0.45];

interface PlanetSceneProps {
  gridN: number;
  keyframe: RenderKeyframe | null;
  onFirstFrame: () => void;
}

export function PlanetScene({ gridN, keyframe, onFirstFrame }: PlanetSceneProps) {
  const { camera, gl } = useThree();
  const planet = useMemo(() => createPlanetMesh(gridN, EARTH_RADIUS_M), [gridN]);
  const starfield = useMemo(() => createStarfield(), []);
  const framesSinceUpload = useRef(0);
  const uploadedRef = useRef(false);
  const notified = useRef(false);

  useEffect(() => {
    planet.uniforms.sunDirection.value.set(...SUN_DIRECTION).normalize();
  }, [planet]);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.3;
    controls.maxDistance = 12;
    return () => controls.dispose();
  }, [camera, gl]);

  useEffect(() => {
    uploadedRef.current = false;
    framesSinceUpload.current = 0;
    notified.current = false;
    const elevation = keyframe?.fields.elevation;
    if (elevation) {
      uploadKeyframe(planet.fieldsA, { elevation });
      uploadedRef.current = true;
    }
  }, [keyframe, planet]);

  // Report readiness a few frames after the keyframe upload so the canvas
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
      {keyframe ? <primitive object={planet.group} /> : null}
      {/* Scene sun light matching the material's sun uniform, for future
          standard-lit objects (moons, atmosphere). */}
      <directionalLight position={SUN_DIRECTION} intensity={2} />
    </>
  );
}
