import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, MathUtils } from 'three';
import type { Group } from 'three';
import { HERO } from '../config';
import { gameState } from '../state/gameState';
import { DEFAULT_CROP } from './customFace';
import type { CustomFace } from './customFace';
import { createHeadTexture } from './suitTexture';

/**
 * The player avatar, built entirely from primitives.
 *
 * The silhouette is a gingerbread figure — a head over a tall torso, with arms
 * and legs that grow out of the torso — rather than a ball with stubs beside
 * it. Every part is a primitive paired with a back-faced shell grown by
 * `HERO.inkWidth`, which is what draws the inked outline: growing it by a
 * fixed width rather than scaling it by a ratio is what keeps the line the
 * same weight on a thin arm as on the head. `meshBasicMaterial` on the shell
 * keeps that weight even instead of fading out on whichever side faces away
 * from the sun.
 *
 * Each limb's pivot is sunk *inside* the torso on purpose. Only the part of a
 * shell that clears the torso survives the depth test, so a buried joint loses
 * its ink and the limb reads as continuous with the body — park it against the
 * torso instead and it keeps a full ring of ink and reads as a separate blob.
 * The limbs are therefore drawn *before* the torso, and the torso before the
 * head, so each one paints over the joint below it.
 *
 * The animation is procedural and driven straight from `gameState`: the body
 * turns to face its own velocity, leans into the wind as it speeds up, throws
 * both arms forward while a web is attached, and paddles its legs on the
 * ground.
 */

/** Frame-rate independent damping towards an angle, taking the short way round. */
function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

/**
 * One limb, plus the shell that inks its outline. It hangs straight down from
 * the group's origin, so the parent group's origin *is* the shoulder or hip
 * joint and rotating it swings the limb about that joint.
 */
function Limb({ radius, length, color }: { radius: number; length: number; color: string }) {
  return (
    <group position={[0, -(length / 2 + radius), 0]}>
      <mesh castShadow>
        <capsuleGeometry args={[radius, length, 6, 16]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh>
        <capsuleGeometry args={[radius + HERO.inkWidth, length, 6, 16]} />
        <meshBasicMaterial color={HERO.ink} side={BackSide} />
      </mesh>
    </group>
  );
}

interface HeroProps {
  face: CustomFace | null;
  /** Decoded once by `useFaceImage`, so the avatar and the preview share it. */
  faceImage: HTMLImageElement | null;
}

export function Hero({ face, faceImage }: HeroProps) {
  const root = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);

  const yaw = useRef(0);
  const lean = useRef(0);
  const reach = useRef(0);
  const stride = useRef(0);

  const crop = face ?? DEFAULT_CROP;
  const { texture } = useMemo(
    () =>
      createHeadTexture(faceImage, {
        offsetX: crop.offsetX,
        offsetY: crop.offsetY,
        zoom: crop.zoom,
      }),
    [faceImage, crop.offsetX, crop.offsetY, crop.zoom],
  );

  useEffect(() => () => texture?.dispose(), [texture]);

  useLayoutEffect(() => {
    // Yaw first, then lean, so the lean always tips "forwards" for the body.
    if (root.current) root.current.rotation.order = 'YXZ';
  }, []);

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.1);
    const { player, camera, web } = gameState;
    const velocity = player.velocity;
    const flatSpeed = Math.hypot(velocity.x, velocity.z);

    // Face the direction of travel once actually moving; otherwise face the way
    // the camera is looking, so standing still still feels controlled. On a
    // wall the facade wins outright: the hero turns to face into it, which is
    // `-wallNormal` under the same `atan2(-x, -z)` convention.
    const climbing = player.climbing;
    const targetYaw = climbing
      ? Math.atan2(player.wallNormal.x, player.wallNormal.z)
      : flatSpeed > 2
        ? Math.atan2(-velocity.x, -velocity.z)
        : camera.yaw;
    yaw.current = dampAngle(yaw.current, targetYaw, climbing ? 10 : 8, dt);

    const speedFactor = MathUtils.clamp(player.speed / 45, 0, 1);
    const diveFactor = MathUtils.clamp(-velocity.y / 35, 0, 1);
    // Climbing needs only a slight press into the facade. The yaw above already
    // turns the hero to face it, and someone clinging to a wall stands *along*
    // it — a big pitch here plants the head in the brickwork and points the
    // soles of the feet at the camera.
    const targetLean = climbing
      ? 0.35
      : player.grounded
        ? Math.min(flatSpeed * 0.025, 0.3)
        : speedFactor * 0.85 + diveFactor * 0.55;
    lean.current = MathUtils.damp(lean.current, targetLean, climbing ? 9 : 6, dt);

    if (root.current) {
      root.current.rotation.set(-lean.current, yaw.current, 0);
    }

    // Arms swing about the shoulder: down and slightly out at rest, thrown
    // forward while a web is out. `flare` is negated on the left arm, because a
    // positive Z rotation tips a hanging limb towards +X on both sides — the
    // same angle on both would fold one arm across the chest.
    reach.current = MathUtils.damp(reach.current, web.attached || climbing ? 1 : 0, 11, dt);
    const armRaise = MathUtils.lerp(0.12, climbing ? 1.15 : 1.55, reach.current);
    const armFlare = MathUtils.lerp(0.16, 0.5, 1 - reach.current) + speedFactor * 0.08;
    if (leftArm.current) leftArm.current.rotation.set(armRaise, 0, -armFlare);
    if (rightArm.current) rightArm.current.rotation.set(armRaise, 0, armFlare);

    // Legs: a paddling cycle on the ground, a loose tuck in the air, splayed
    // against the wall — a tucked ball plastered on a facade reads as stuck to
    // it by accident rather than gripping it.
    if (climbing) {
      const splay = 0.55;
      if (leftLeg.current) leftLeg.current.rotation.x = MathUtils.damp(leftLeg.current.rotation.x, splay, 8, dt);
      if (rightLeg.current) rightLeg.current.rotation.x = MathUtils.damp(rightLeg.current.rotation.x, splay, 8, dt);
    } else if (player.grounded) {
      stride.current += flatSpeed * dt * 3.4;
      const swing = Math.sin(stride.current) * Math.min(flatSpeed / 9, 1) * 0.7;
      if (leftLeg.current) leftLeg.current.rotation.x = swing;
      if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    } else {
      const tuck = 0.3 + speedFactor * 0.5;
      if (leftLeg.current) {
        leftLeg.current.rotation.x = MathUtils.damp(leftLeg.current.rotation.x, -tuck, 5, dt);
      }
      if (rightLeg.current) {
        rightLeg.current.rotation.x = MathUtils.damp(
          rightLeg.current.rotation.x,
          -tuck * 0.55,
          5,
          dt,
        );
      }
    }
  });

  const { head, torso, arm, leg } = HERO;

  return (
    <group ref={root}>
      {/* Limbs first: their joints are buried, and drawing the torso over them
          is what removes the ink from the joint. */}
      <group ref={leftArm} position={[-arm.x, arm.pivotY, 0]}>
        <Limb radius={arm.radius} length={arm.length} color={HERO.suit} />
      </group>
      <group ref={rightArm} position={[arm.x, arm.pivotY, 0]}>
        <Limb radius={arm.radius} length={arm.length} color={HERO.suit} />
      </group>

      {/* The legs carry a fixed outward splay on Z; `useFrame` only ever writes
          rotation.x, so it survives. */}
      <group ref={leftLeg} position={[-leg.x, leg.pivotY, 0]} rotation={[0, 0, -leg.splay]}>
        <Limb radius={leg.radius} length={leg.length} color={HERO.suit} />
      </group>
      <group ref={rightLeg} position={[leg.x, leg.pivotY, 0]} rotation={[0, 0, leg.splay]}>
        <Limb radius={leg.radius} length={leg.length} color={HERO.suit} />
      </group>

      {/* The torso: bare `HERO.suit`, no texture — the body carries no markings. */}
      <group position={[0, torso.y, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[torso.radius, torso.length, 8, 32]} />
          <meshLambertMaterial color={HERO.suit} />
        </mesh>
        <mesh>
          <capsuleGeometry args={[torso.radius + HERO.inkWidth, torso.length, 8, 32]} />
          <meshBasicMaterial color={HERO.ink} side={BackSide} />
        </mesh>
      </group>

      {/* The head, wearing the mask — web, colour and lenses — as one wrap. */}
      <group position={[0, head.y, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[head.radius, 48, 32]} />
          <meshLambertMaterial map={texture} color={texture ? '#ffffff' : HERO.suitRed} />
        </mesh>
        <mesh>
          <sphereGeometry args={[head.radius + HERO.inkWidth, 48, 32]} />
          <meshBasicMaterial color={HERO.ink} side={BackSide} />
        </mesh>
      </group>
    </group>
  );
}
