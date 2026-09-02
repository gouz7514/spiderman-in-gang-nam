import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils } from 'three';
import type { MeshBasicMaterial } from 'three';
import { gameState } from '../state/gameState';
import type { StreetLightGeometry } from './buildStreetLights';

/**
 * Lamp posts whose heads come on after dark.
 *
 * The heads fade with `gameState.sky.dayFactor`, driven from the frame loop so
 * the sky's own slow timer never forces a scene re-render. The posts themselves
 * are always there — they are street furniture, and the light they appear to
 * cast is the sky's ambient floor, not anything these meshes do.
 */
export function StreetLights({ lights }: { lights: StreetLightGeometry }) {
  const lampRef = useRef<MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    const night = 1 - gameState.sky.dayFactor;
    const dt = Math.min(delta, 0.1);
    if (lampRef.current) {
      lampRef.current.opacity = MathUtils.damp(lampRef.current.opacity, night, 3, dt);
      lampRef.current.visible = lampRef.current.opacity > 0.01;
    }
  });

  if (!lights.structure) return null;

  return (
    <>
      <mesh geometry={lights.structure} castShadow receiveShadow dispose={null}>
        <meshLambertMaterial vertexColors />
      </mesh>

      {lights.lamps && (
        <mesh geometry={lights.lamps} dispose={null}>
          <meshBasicMaterial ref={lampRef} vertexColors transparent opacity={0} toneMapped={false} />
        </mesh>
      )}
    </>
  );
}
