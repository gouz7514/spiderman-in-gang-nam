import { CuboidCollider, RigidBody } from '@react-three/rapier';

const GROUND_SIZE = 3400;
const GROUND_HALF = GROUND_SIZE / 2;

/**
 * The single flat street plane at y = 0, and the only thing the player can land
 * on outside of the buildings.
 *
 * The collider is a slab sunk one metre below the surface so its top face lines
 * up exactly with the visual plane. It is a separate object from the city mesh,
 * which is what stops the player webbing onto the pavement.
 */
export function Ground() {
  return (
    <>
      <RigidBody type="fixed" friction={0.9} restitution={0} colliders={false}>
        <CuboidCollider args={[GROUND_HALF, 1, GROUND_HALF]} position={[0, -1, 0]} />
      </RigidBody>

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshLambertMaterial color="#333944" />
      </mesh>
    </>
  );
}
