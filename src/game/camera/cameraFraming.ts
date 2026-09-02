import { Vector3 } from 'three';

/**
 * Camera framing maths, kept out of the component so it can be reasoned about
 * (and tested) without a render loop.
 */

const flat = new Vector3();

/**
 * Lifts a desired camera position so it never sits below `minimumY`.
 *
 * The third-person camera orbits: pitching the view *up* swings the camera
 * *down*. Standing on the street the pivot is only about two metres up, so
 * looking up would put the camera several metres below the road — and since the
 * ground plane is deliberately not part of the occlusion raycast (that is what
 * keeps it from being a valid web anchor), nothing else catches it.
 *
 * Rather than clamping Y alone, which would yank the camera towards the player,
 * the height that has to be given up is traded for horizontal distance. The
 * camera slides along a plane just above the floor at a constant radius, so the
 * shot stays framed and the transition is continuous as the pitch changes.
 *
 * @param desired mutated in place.
 * @param forward unit camera forward, used only if the horizontal offset is degenerate.
 */
export function liftAboveFloor(
  desired: Vector3,
  pivot: Vector3,
  distance: number,
  minimumY: number,
  forward: Vector3,
): void {
  if (desired.y >= minimumY) return;

  flat.set(desired.x - pivot.x, 0, desired.z - pivot.z);
  const flatLength = flat.length();

  // Right-angled triangle: radius^2 = drop^2 + horizontal^2.
  const drop = pivot.y - minimumY;
  const horizontal = Math.sqrt(Math.max(0.25, distance * distance - drop * drop));

  if (flatLength > 1e-4) {
    flat.multiplyScalar(horizontal / flatLength);
  } else {
    // Looking straight up: fall back to the camera's own facing.
    flat.set(-forward.x, 0, -forward.z);
    if (flat.lengthSq() < 1e-8) flat.set(0, 0, 1);
    flat.setLength(horizontal);
  }

  desired.set(pivot.x + flat.x, minimumY, pivot.z + flat.z);
}
