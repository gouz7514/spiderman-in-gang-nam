import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, MathUtils } from 'three';
import type { LineBasicMaterial, LineSegments } from 'three';
import { gameState } from '../state/gameState';

/**
 * Cheap motion streaks: a shell of short lines locked to the camera that scroll
 * past as the player accelerates. No post-processing, one draw call, and it
 * fades out completely below ~25 m/s so ordinary movement stays clean.
 */

const COUNT = 110;
const SPAN = 26; // depth of the shell in front of the camera
const FADE_IN = 24; // m/s where streaks start appearing
const FADE_FULL = 62; // m/s where they reach full strength

export function SpeedStreaks() {
  const camera = useThree((state) => state.camera);
  const linesRef = useRef<LineSegments>(null);
  const materialRef = useRef<LineBasicMaterial>(null);

  const { geometry, depths, seeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 6);
    const depthValues = new Float32Array(COUNT);
    const seedValues = new Float32Array(COUNT * 3); // x, y, length

    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.7 + Math.random() * 3.6;
      seedValues[i * 3] = Math.cos(angle) * radius;
      seedValues[i * 3 + 1] = Math.sin(angle) * radius * 0.7;
      seedValues[i * 3 + 2] = 1.6 + Math.random() * 3.4;
      depthValues[i] = -2 - Math.random() * SPAN;
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute('position', new BufferAttribute(positions, 3));
    return { geometry: buffer, depths: depthValues, seeds: seedValues };
  }, []);

  useFrame((_, delta) => {
    const lines = linesRef.current;
    const material = materialRef.current;
    if (!lines || !material) return;

    const speed = gameState.player.speed;
    const strength = MathUtils.clamp((speed - FADE_IN) / (FADE_FULL - FADE_IN), 0, 1);
    material.opacity = strength * 0.42;
    lines.visible = strength > 0.01;
    if (!lines.visible) return;

    // Ride along with the camera so the streaks are a screen-space effect.
    lines.position.copy(camera.position);
    lines.quaternion.copy(camera.quaternion);

    const dt = Math.min(delta, 0.05);
    const scroll = (12 + speed * 1.7) * dt;
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const array = positions.array as Float32Array;

    for (let i = 0; i < COUNT; i++) {
      let z = depths[i] + scroll;
      if (z > -1) z -= SPAN; // wrap back out to the far edge of the shell
      depths[i] = z;

      const x = seeds[i * 3];
      const y = seeds[i * 3 + 1];
      const length = seeds[i * 3 + 2] * (0.5 + strength);
      const o = i * 6;
      array[o] = x;
      array[o + 1] = y;
      array[o + 2] = z;
      array[o + 3] = x;
      array[o + 4] = y;
      array[o + 5] = z - length;
    }
    positions.needsUpdate = true;
  });

  return (
    <lineSegments ref={linesRef} geometry={geometry} frustumCulled={false} renderOrder={20}>
      <lineBasicMaterial
        ref={materialRef}
        color="#ffffff"
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
