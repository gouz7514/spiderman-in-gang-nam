import type { Vector3 } from 'three';
import { PLAYER } from '../config';

/**
 * The speed envelope, applied every tick the player is airborne or swinging.
 *
 * Everything here is a *soft* limit: quadratic drag bleeds speed the faster you
 * go, and the horizontal cap eases the excess away over a few tenths of a
 * second rather than snapping. A hard clamp would kill the sensation of having
 * built momentum at exactly the moment the player is enjoying it most.
 *
 * Not applied while grounded, where the ground friction model takes over.
 */
export function applySpeedLimits(velocity: Vector3, dt: number): void {
  const speed = velocity.length();
  if (speed > 1) {
    const drop = PLAYER.airDrag * speed * speed * dt;
    velocity.multiplyScalar(Math.max(0, speed - drop) / speed);
  }

  const flat = Math.hypot(velocity.x, velocity.z);
  if (flat > PLAYER.maxHorizontalSpeed) {
    const eased = Math.max(
      PLAYER.maxHorizontalSpeed,
      flat - (flat - PLAYER.maxHorizontalSpeed) * 6 * dt,
    );
    const scale = eased / flat;
    velocity.x *= scale;
    velocity.z *= scale;
  }

  const total = velocity.length();
  if (total > PLAYER.maxTotalSpeed) {
    velocity.multiplyScalar(PLAYER.maxTotalSpeed / total);
  }
}
