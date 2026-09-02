import { Raycaster, Vector3 } from 'three';
import type { Camera, Mesh } from 'three';
import { WEB } from '../config';
import { applyReleaseBoost } from '../physics/swingPhysics';
import { gameState } from '../state/gameState';
import '../world/bvh';

/**
 * Web targeting and attachment.
 *
 * The ray is cast from the camera straight through the crosshair, so what you
 * see under the reticle is exactly what you get. Only the merged city mesh is
 * ever tested, which means buildings are the sole valid anchors — the ground
 * plane and the road decals are separate objects and simply cannot be hit.
 */

const raycaster = new Raycaster();
// three-mesh-bvh: stop at the first triangle instead of sorting every hit.
raycaster.firstHitOnly = true;

const rayDirection = new Vector3();
const rayOrigin = new Vector3();

/**
 * Finds the anchor point under the crosshair.
 *
 * The ray starts at the camera, which sits several metres *behind* the player,
 * so it is allowed to run a little past `WEB.maxRange`; the range limit is then
 * applied to the player-to-hit distance, which is the distance that matters.
 *
 * @returns true when `out` has been filled with a valid anchor.
 */
export function findWebTarget(
  camera: Camera,
  playerPosition: Vector3,
  cityMeshes: Mesh[],
  out: Vector3,
): boolean {
  if (cityMeshes.length === 0) return false;

  // Taken straight from the camera's own transform rather than from raw
  // yaw/pitch, because the third-person camera adds a velocity-based look-ahead
  // on top of the mouse angles. Using the real orientation is what makes the
  // crosshair truthful: whatever is under the reticle is what gets hit.
  rayOrigin.copy(camera.position);
  rayDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);

  raycaster.set(rayOrigin, rayDirection);
  raycaster.near = 0;
  raycaster.far = WEB.maxRange + WEB.rayPadding;

  const hits = raycaster.intersectObjects(cityMeshes, false);
  if (hits.length === 0) return false;

  const point = hits[0].point;
  if (point.distanceTo(playerPosition) > WEB.maxRange) return false;

  out.copy(point);
  return true;
}

/**
 * Fixes the rope to `anchor`. The rope length is the distance at the moment of
 * attachment, so the line is taut immediately and the arc begins at once.
 *
 * Velocity is deliberately untouched: whatever speed the player brought into
 * the attachment is carried straight through into the swing.
 */
export function attachWeb(anchor: Vector3, playerPosition: Vector3): void {
  const web = gameState.web;
  web.attached = true;
  web.anchor.copy(anchor);
  web.ropeLength = Math.min(
    WEB.maxRange,
    Math.max(WEB.minRopeLength, anchor.distanceTo(playerPosition)),
  );
  // The arc under the anchor bottoms out at `anchor.y - ropeLength`. Anything
  // longer than this would swing the player through the road, so the solver
  // reels quickly down to it instead of letting the first arc clip the ground.
  web.targetRopeLength = Math.min(
    web.ropeLength,
    Math.max(WEB.minRopeLength, anchor.y - WEB.groundClearance),
  );
  web.anchorDistance = web.ropeLength;
  // Starts slack so the first time the line pulls tight counts as a catch.
  web.taut = false;
  web.shootProgress = 0;
}

/** Releases the rope, keeping (and slightly boosting) the current momentum. */
export function detachWeb(velocity: Vector3): void {
  const web = gameState.web;
  if (!web.attached) return;
  web.attached = false;
  web.shootProgress = 0;
  applyReleaseBoost(velocity);
}
