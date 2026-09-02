import { RigidBody, TrimeshCollider } from '@react-three/rapier';
import type { SubwayEntranceGeometry } from './buildSubwayEntrances';

/**
 * The station's street exits: walled stairwells with numbered totems.
 *
 * Solid, so the railings can be walked around and landed on, but deliberately
 * not registered as a web anchor — that stays buildings-only.
 */
export function SubwayEntrances({ entrances }: { entrances: SubwayEntranceGeometry }) {
  if (!entrances.structure) return null;

  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.6} restitution={0}>
        <TrimeshCollider args={[entrances.collider.vertices, entrances.collider.indices]} />
      </RigidBody>

      <mesh geometry={entrances.structure} castShadow receiveShadow dispose={null}>
        <meshLambertMaterial vertexColors />
      </mesh>

      {entrances.signs && entrances.signTexture && (
        <mesh geometry={entrances.signs} dispose={null}>
          <meshBasicMaterial map={entrances.signTexture} toneMapped={false} />
        </mesh>
      )}
    </>
  );
}
