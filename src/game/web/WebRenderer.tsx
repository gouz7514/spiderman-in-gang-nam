import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Mesh } from 'three';
import { WEB } from '../config';
import { gameState } from '../state/gameState';

/**
 * The visible rope, plus a small marker at the anchor.
 *
 * A unit-height cylinder is stretched and oriented between the player's hands
 * and the anchor every frame. While `shootProgress` ramps up (about 70 ms) the
 * far end travels outward, so the line reads as being fired rather than just
 * appearing — the physics, meanwhile, is already live from frame one.
 */

const UP = new Vector3(0, 1, 0);
const start = new Vector3();
const end = new Vector3();
const direction = new Vector3();
const quaternion = new Quaternion();

export function WebRenderer() {
  const ropeRef = useRef<Mesh>(null);
  const anchorRef = useRef<Mesh>(null);

  useFrame(() => {
    const rope = ropeRef.current;
    const marker = anchorRef.current;
    if (!rope || !marker) return;

    const web = gameState.web;
    if (!web.attached) {
      rope.visible = false;
      marker.visible = false;
      return;
    }

    // Roughly where the hero's raised hands are.
    start.copy(gameState.player.position);
    start.y += 0.45;

    const travel = MathUtils.smoothstep(web.shootProgress, 0, 1);
    end.lerpVectors(start, web.anchor, travel);

    direction.subVectors(end, start);
    const length = direction.length();
    if (length < 0.05) {
      rope.visible = false;
      marker.visible = false;
      return;
    }

    rope.visible = true;
    rope.position.copy(start).addScaledVector(direction, 0.5);
    rope.scale.set(1, length, 1);
    quaternion.setFromUnitVectors(UP, direction.divideScalar(length));
    rope.quaternion.copy(quaternion);

    marker.visible = travel > 0.99;
    marker.position.copy(web.anchor);
  });

  return (
    <>
      <mesh ref={ropeRef} visible={false} frustumCulled={false}>
        <cylinderGeometry args={[WEB.ropeRadius, WEB.ropeRadius, 1, 6, 1]} />
        <meshBasicMaterial color="#f4f8ff" toneMapped={false} />
      </mesh>
      <mesh ref={anchorRef} visible={false}>
        <sphereGeometry args={[0.28, 12, 10]} />
        <meshBasicMaterial color="#8ff0ff" toneMapped={false} />
      </mesh>
    </>
  );
}
