import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  CapsuleCollider,
  RigidBody,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRapier,
} from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
import { PHYSICS, PLAYER } from '../config';
import { gameState } from '../state/gameState';
import { createPlayerController } from './playerController';
import { Hero } from './Hero';
import type { CustomFace } from './customFace';

/**
 * The player's dynamic rigid body.
 *
 * Rotations are locked (a capsule that can topple is a capsule that gets stuck)
 * and CCD is on, because a 70 m/s dive would otherwise tunnel straight through
 * a building wall between two physics ticks. All of the behaviour lives in
 * `playerController`, driven from the Rapier step callbacks rather than the
 * render loop so it stays in lockstep with the fixed timestep.
 */
interface PlayerProps {
  face: CustomFace | null;
  faceImage: HTMLImageElement | null;
}

export function Player({ face, faceImage }: PlayerProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const { world, rapier } = useRapier();
  const camera = useThree((state) => state.camera);
  const controller = useMemo(() => createPlayerController(), []);

  useEffect(() => {
    gameState.camera.yaw = gameState.world.spawnAim.yaw;
    gameState.camera.pitch = gameState.world.spawnAim.pitch;
    gameState.player.position.set(...PLAYER.spawn);
  }, []);

  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    controller.step({ body, world, rapier, camera, dt: PHYSICS.timeStep });
  });

  useAfterPhysicsStep(() => {
    const body = bodyRef.current;
    if (body) controller.sync(body);
  });

  return (
    <RigidBody
      ref={bodyRef}
      position={PLAYER.spawn}
      colliders={false}
      enabledRotations={[false, false, false]}
      canSleep={false}
      ccd
      linearDamping={0}
      angularDamping={0}
    >
      <CapsuleCollider
        args={[PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius]}
        friction={0.15}
        restitution={0}
      />
      <Hero face={face} faceImage={faceImage} />
    </RigidBody>
  );
}
