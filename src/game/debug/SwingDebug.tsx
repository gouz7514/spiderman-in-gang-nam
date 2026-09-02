import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { gameState } from '../state/gameState';

/**
 * Debug-only visualisation of the swing constraint: a marker on the anchor and
 * a wireframe sphere of exactly `ropeLength` around it. The player should
 * always be on or inside that sphere — if they drift outside it, the distance
 * constraint is not converging.
 *
 * Also samples the frame rate into `gameState.debug` for the HTML overlay.
 */
export function SwingDebug() {
  const anchorRef = useRef<Mesh>(null);
  const sphereRef = useRef<Mesh>(null);
  const frames = useRef(0);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    frames.current += 1;
    elapsed.current += delta;
    if (elapsed.current >= 0.5) {
      gameState.debug.fps = Math.round(frames.current / elapsed.current);
      frames.current = 0;
      elapsed.current = 0;
    }

    const anchor = anchorRef.current;
    const sphere = sphereRef.current;
    if (!anchor || !sphere) return;

    const visible = gameState.debug.enabled && gameState.web.attached;
    anchor.visible = visible;
    sphere.visible = visible;
    if (!visible) return;

    anchor.position.copy(gameState.web.anchor);
    sphere.position.copy(gameState.web.anchor);
    sphere.scale.setScalar(Math.max(0.01, gameState.web.ropeLength));
  });

  return (
    <>
      <mesh ref={anchorRef} visible={false}>
        <sphereGeometry args={[0.6, 12, 10]} />
        <meshBasicMaterial color="#ff3860" wireframe toneMapped={false} />
      </mesh>
      <mesh ref={sphereRef} visible={false}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshBasicMaterial color="#3fd0ff" wireframe transparent opacity={0.12} toneMapped={false} />
      </mesh>
    </>
  );
}
