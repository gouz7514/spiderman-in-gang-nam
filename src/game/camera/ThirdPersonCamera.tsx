import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Raycaster, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { CAMERA } from '../config';
import { cameraForward, gameState } from '../state/gameState';
import { liftAboveFloor } from './cameraFraming';
import '../world/bvh';

/**
 * Third-person follow camera.
 *
 * The camera's *orientation* comes straight from the mouse yaw/pitch, and its
 * *position* is derived from that — never the other way round. This separation
 * is load-bearing: the older version pointed the camera at the player with
 * `lookAt`, which meant that any time the position had to be moved (pulled out
 * of a building, or lifted off the street) the aim moved with it. Standing on
 * the road, where the camera is floor-clamped, that pinned the view within a
 * few degrees of horizontal and made it impossible to web the top of a
 * building. Setting the rotation directly means the crosshair always points
 * exactly where the mouse says, whatever has had to happen to the camera body.
 *
 * When the camera is not being constrained, `pivot - forward * distance` puts
 * it on the orbit line anyway, so it behaves identically to a look-at camera
 * for the great majority of play.
 *
 * Speed drives three things at once — FOV widens, the camera pulls back, and
 * the orbit pivot leads in the direction of travel — which together are most of
 * the sensation of going fast.
 */

const pivot = new Vector3();
const forward = new Vector3();
const desired = new Vector3();
const offset = new Vector3();
const leadTarget = new Vector3();
const DOWN = new Vector3(0, -1, 0);

/** Frame-rate independent interpolation factor. */
function smoothing(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function ThirdPersonCamera() {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  const raycaster = useMemo(() => {
    const instance = new Raycaster();
    instance.firstHitOnly = true;
    return instance;
  }, []);
  const groundRay = useMemo(() => {
    const instance = new Raycaster();
    instance.firstHitOnly = true;
    return instance;
  }, []);

  const smoothPosition = useRef(new Vector3());
  const smoothLead = useRef(new Vector3());
  const initialized = useRef(false);
  const lastRespawn = useRef(-1);

  useLayoutEffect(() => {
    // Yaw about world up, then pitch about the camera's own right axis.
    camera.rotation.order = 'YXZ';
  }, [camera]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { player, camera: cameraState } = gameState;
    const cityMeshes = gameState.world.cityMeshes;

    const speedFactor = MathUtils.clamp(player.speed / CAMERA.speedReference, 0, 1);
    const selfie = cameraState.selfie;

    /* Orbit pivot, leading in the direction of travel ---------------------- */
    // No lead in selfie view: the point is a steady shot of the player, not a
    // look at where they are going. None in a photo pause either — the lead is
    // what pushes the player off-centre, and a paused frame is a photograph, so
    // it wants the subject centred rather than the road ahead.
    leadTarget.set(0, 0, 0);
    if (!selfie && !gameState.paused && player.speed > 3) {
      leadTarget
        .copy(player.velocity)
        .divideScalar(player.speed)
        .multiplyScalar(CAMERA.lookAhead * speedFactor);
    }
    smoothLead.current.lerp(leadTarget, smoothing(CAMERA.targetDamp, dt));

    pivot.copy(player.position);
    pivot.y += selfie ? CAMERA.selfiePivotHeight : CAMERA.pivotHeight;
    pivot.add(smoothLead.current);

    /* Orbit position ------------------------------------------------------- */
    // Selfie view puts the camera on the *far* side of the pivot — out in front
    // of the player, along the direction they face — instead of behind them.
    const distance =
      (selfie
        ? CAMERA.selfieDistance
        : MathUtils.lerp(CAMERA.minDistance, CAMERA.maxDistance, speedFactor)) *
      cameraState.zoom;
    cameraForward(cameraState.yaw, cameraState.pitch, forward);
    desired.copy(pivot).addScaledVector(forward, selfie ? distance : -distance);

    /* Never let the camera sink through the floor -------------------------- */
    // Orbiting the view upwards swings the camera downwards, so looking up while
    // standing on the street would put it several metres underground. Find the
    // surface the player is over — the road, or the roof they are on — and keep
    // the camera above it. The aim is unaffected: only the body moves.
    let floor = 0;
    if (cityMeshes.length > 0) {
      groundRay.set(pivot, DOWN);
      groundRay.near = 0;
      groundRay.far = CAMERA.groundProbeDistance;
      const below = groundRay.intersectObjects(cityMeshes, false);
      if (below.length > 0) floor = Math.max(floor, below[0].point.y);
    }
    liftAboveFloor(desired, pivot, distance, floor + CAMERA.groundClearance, forward);

    /* Keep the camera out of buildings ------------------------------------- */
    if (cityMeshes.length > 0) {
      offset.subVectors(desired, pivot);
      const reach = offset.length();
      if (reach > 0.01) {
        offset.divideScalar(reach);
        raycaster.set(pivot, offset);
        raycaster.near = 0;
        raycaster.far = reach;
        const hits = raycaster.intersectObjects(cityMeshes, false);
        if (hits.length > 0) {
          const pulled = Math.max(1.5, hits[0].distance - CAMERA.collisionPadding);
          desired.copy(pivot).addScaledVector(offset, pulled);
        }
      }
    }

    /* Smoothing (snapped on the first frame and after every respawn) -------- */
    const respawned = lastRespawn.current !== gameState.respawnCount;
    if (!initialized.current || respawned) {
      smoothPosition.current.copy(desired);
      smoothLead.current.set(0, 0, 0);
      initialized.current = true;
      lastRespawn.current = gameState.respawnCount;
    } else {
      smoothPosition.current.lerp(desired, smoothing(CAMERA.positionDamp, dt));
    }
    camera.position.copy(smoothPosition.current);

    // Aim: exactly the mouse angles, independent of where the body ended up.
    // Selfie view turns the camera to look back down the same axis, which is
    // the yaw/pitch pair whose forward vector is the negation of this one.
    if (selfie) {
      camera.rotation.set(-cameraState.pitch, cameraState.yaw + Math.PI, 0);
    } else {
      camera.rotation.set(cameraState.pitch, cameraState.yaw, 0);
    }

    /* Speed FOV ------------------------------------------------------------ */
    const targetFov = MathUtils.lerp(
      CAMERA.fovBase,
      CAMERA.fovMax,
      Math.pow(speedFactor, 1.25),
    );
    const nextFov = MathUtils.damp(camera.fov, targetFov, CAMERA.fovDamp, dt);
    if (Math.abs(nextFov - camera.fov) > 0.01) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }

    cameraState.fov = camera.fov;
    cameraState.position.copy(camera.position);
    // Published as the *actual* view direction, which the web raycast and the
    // debug overlay both rely on being truthful.
    cameraState.forward.copy(forward);
    if (selfie) cameraState.forward.negate();
  });

  return null;
}
