import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import { SKY } from '../config';
import { gameState } from '../state/gameState';
import { computeSky } from './skyState';

/**
 * Sky, sun and fog, driven by the real time in Korea.
 *
 * All of the maths lives in `skyState.ts`; this only mounts what it describes.
 * Recomputed every `SKY.updateMs` — the sun moves a quarter of a degree a
 * minute, so nothing here belongs in the render loop.
 */

export function Atmosphere() {
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState(gameState.sky.mode);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), SKY.updateMs);
    return () => window.clearInterval(id);
  }, []);

  // The N key and the title screen both write straight to `gameState`; pick the
  // change up here so it applies at once rather than at the next slow tick.
  useFrame(() => {
    if (gameState.sky.mode !== mode) setMode(gameState.sky.mode);
  });

  const sky = useMemo(() => computeSky(now, mode), [now, mode]);

  // Published for the facade lighting, which fades its lit windows in as the
  // sun goes down.
  gameState.sky.sunAltitude = sky.altitude;
  gameState.sky.dayFactor = sky.dayFactor;

  return (
    <>
      <color attach="background" args={[sky.fog]} />
      <fogExp2 attach="fog" args={[sky.fog, sky.fogDensity]} />

      {/* The daylight model goes black well before astronomical night; past
          that a flat sky reads better and lets the stars carry it. */}
      {sky.showSky && (
        <Sky
          sunPosition={sky.sunPosition}
          turbidity={6}
          rayleigh={1.4}
          mieCoefficient={0.006}
          distance={4000}
        />
      )}
      {sky.showStars && (
        <Stars radius={1400} depth={80} count={2200} factor={6} saturation={0} fade speed={0.3} />
      )}

      <hemisphereLight args={[sky.hemiSky, sky.hemiGround, sky.hemiIntensity]} />
      <directionalLight
        position={sky.keyPosition}
        color={sky.keyColor}
        intensity={sky.keyIntensity}
        castShadow={sky.castShadow}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-620}
        shadow-camera-right={620}
        shadow-camera-top={620}
        shadow-camera-bottom={-620}
        shadow-camera-near={10}
        shadow-camera-far={1400}
        shadow-bias={-0.0006}
        shadow-normalBias={0.7}
      />
    </>
  );
}
