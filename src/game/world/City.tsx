import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils } from 'three';
import type { Mesh, MeshLambertMaterial } from 'three';
import { RigidBody, TrimeshCollider } from '@react-three/rapier';
import { FACADE } from '../config';
import type { CityGeometry } from './buildCityGeometry';
import { gameState } from '../state/gameState';

/**
 * The whole city: three textured/coloured surfaces and one static collider.
 *
 * The split is by material, not by building — facades and shopfronts each carry
 * their own tiling texture, roofs are plain vertex colour — so 760 buildings
 * still cost three draw calls and a single Rapier trimesh.
 */
export function City({ geometry }: { geometry: CityGeometry }) {
  const facadeRef = useRef<Mesh>(null);
  const podiumRef = useRef<Mesh>(null);
  const roofRef = useRef<Mesh>(null);
  const windowsRef = useRef<MeshLambertMaterial>(null);

  // Windows light up as the sun goes down. Driven from the frame loop rather
  // than React state: the sky updates on its own slow timer and there is no
  // reason for a scene re-render.
  useFrame((_, delta) => {
    const material = windowsRef.current;
    if (!material) return;
    const target = (1 - gameState.sky.dayFactor) * FACADE.nightWindowGlow;
    material.emissiveIntensity = MathUtils.damp(
      material.emissiveIntensity,
      target,
      3,
      Math.min(delta, 0.1),
    );
  });

  // Publish the surfaces so the web raycast and the camera occlusion test can
  // find them. Only buildings are registered here, which is exactly why the
  // ground, roads and signboards can never be used as web anchors.
  useEffect(() => {
    gameState.world.cityMeshes = [facadeRef.current, podiumRef.current, roofRef.current].filter(
      (mesh): mesh is Mesh => mesh !== null,
    );
    gameState.world.spawnAim = geometry.suggestedAim;
    return () => {
      gameState.world.cityMeshes = [];
    };
  }, [geometry]);

  const { buildings, facadeTexture, podiumTexture, windowLightTexture } = geometry;

  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.15} restitution={0}>
        <TrimeshCollider args={[buildings.collider.vertices, buildings.collider.indices]} />
      </RigidBody>

      {/* `dispose={null}`: the geometry outlives this component and is freed by
          the loader hook that built it. */}
      {buildings.facade && (
        <mesh ref={facadeRef} geometry={buildings.facade} castShadow receiveShadow dispose={null}>
          <meshLambertMaterial
            ref={windowsRef}
            vertexColors
            map={facadeTexture ?? undefined}
            emissiveMap={windowLightTexture ?? undefined}
            emissive="#ffd9a3"
            emissiveIntensity={0}
          />
        </mesh>
      )}

      {buildings.podium && (
        <mesh ref={podiumRef} geometry={buildings.podium} castShadow receiveShadow dispose={null}>
          <meshLambertMaterial vertexColors map={podiumTexture ?? undefined} />
        </mesh>
      )}

      {buildings.roof && (
        <mesh ref={roofRef} geometry={buildings.roof} castShadow receiveShadow dispose={null}>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}

      <lineSegments geometry={buildings.edges} dispose={null}>
        <lineBasicMaterial color="#0b1220" transparent opacity={0.2} />
      </lineSegments>
    </>
  );
}
