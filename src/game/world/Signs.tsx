import type { SignGeometry } from './buildSignGeometry';

/**
 * Every shopfront signboard in the city: one mesh, one atlas texture, one draw
 * call. The material is unlit so the boards stay readable on facades that are
 * in deep shadow — which, in a street of towers, is most of them.
 */
export function Signs({ signs }: { signs: SignGeometry }) {
  if (!signs.geometry || !signs.texture) return null;

  return (
    <mesh geometry={signs.geometry} dispose={null}>
      <meshBasicMaterial map={signs.texture} toneMapped={false} />
    </mesh>
  );
}
