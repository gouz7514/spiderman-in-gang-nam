import { Vector3 } from 'three';
import { WEB } from '../config';

/**
 * The web swing solver.
 * ---------------------------------------------------------------------------
 * The rope is a *maximum distance* constraint, not a rigid joint: the player is
 * free to move anywhere inside the sphere of radius `ropeLength` centred on the
 * anchor, and is only acted on when they try to leave it. That is what makes a
 * web feel like a rope rather than a stick — you fall freely after attaching,
 * pick up speed, and only then does the line snap taut and convert that fall
 * into a forward arc.
 *
 * Rapier integrates gravity and collisions as usual; this solver only edits the
 * player's velocity (and, when the rope is over-stretched, nudges the position
 * back onto the radius). Velocity is never reset, so momentum always carries
 * from one swing into the next.
 *
 * Three arcade liberties are taken over a textbook pendulum:
 *
 *  1. **Reeling.** The rope shortens continuously while attached. Shortening a
 *     rope conserves angular momentum, so the tangential speed is scaled by
 *     `oldLength / newLength` — swings visibly tighten and accelerate.
 *  2. **Radial-to-tangential transfer.** A real inextensible rope destroys the
 *     outward radial velocity when it snaps taut. We give a configurable slice
 *     of it back as *tangential* speed instead, which is the single biggest
 *     reason the swing feels like a superhero rather than a wrecking ball.
 *
 *     This fires *only on the frame the rope goes from slack to taut*, and that
 *     restriction is load-bearing rather than cosmetic. An already-taut rope
 *     still shows a small outward radial velocity every tick, purely because
 *     the player is integrated along a straight tangent line and so drifts off
 *     the sphere by O(v^2 dt^2 / L). Feeding *that* back as tangential speed
 *     adds energy proportional to v^2 on every single tick, and the swing
 *     diverges to thousands of m/s within seconds. Gating on the transition
 *     keeps the punch of the catch without the runaway.
 *  3. **Input forces on the tangent plane.** WASD accelerates the player around
 *     the anchor, and W adds an extra push along the current swing direction so
 *     the player can pump for height and speed.
 */

const rope = new Vector3();
const normal = new Vector3();
const radial = new Vector3();
const tangential = new Vector3();
const scratch = new Vector3();
/** Slack/taut hysteresis width, in metres. */
const TAUT_HYSTERESIS = 0.15;
/** Dedicated so the returned correction cannot be clobbered by later maths. */
const correctionVec = new Vector3();

export interface SwingSolveParams {
  /** Player position this tick (read only). */
  position: Vector3;
  /** Player velocity; **mutated in place**. */
  velocity: Vector3;
  anchor: Vector3;
  ropeLength: number;
  dt: number;
  /** World-space movement intent from WASD. Zero length means "no input". */
  wishDir: Vector3;
  /** W held: pump along the current swing direction. */
  pumping: boolean;
  /** Shift held: push harder on both the steering and the pump. */
  sprinting: boolean;
  /** Space held: reel the rope in hard. */
  reeling: boolean;
  /** Length to reel down to at {@link WEB.catchUpReelRate}; see `attachWeb`. */
  targetRopeLength: number;
  /** Whether the rope was already taut last tick. Feed `result.taut` back in. */
  taut: boolean;
}

export interface SwingSolveResult {
  /** Rope length after reeling. Feed this back in next tick. */
  ropeLength: number;
  /** Player-to-anchor distance at the start of this tick. */
  distance: number;
  /** Rope tautness after this tick, with hysteresis to stop it chattering. */
  taut: boolean;
  /**
   * Positional correction to add to the player's translation, or null when the
   * rope is slack. This is a soft constraint (see `WEB.positionalStiffness`),
   * not a teleport — it moves the player a few centimetres at most.
   */
  correction: Vector3 | null;
}

export function solveSwing(params: SwingSolveParams): SwingSolveResult {
  const { position, velocity, anchor, dt, wishDir } = params;
  let ropeLength = params.ropeLength;

  rope.subVectors(position, anchor);
  const distance = rope.length();
  if (distance < 1e-3) {
    return { ropeLength, distance, taut: params.taut, correction: null };
  }
  // Unit vector pointing from the anchor out towards the player.
  normal.copy(rope).divideScalar(distance);

  /* 1. Reel in ------------------------------------------------------------ */
  // While still above the clearance-limited target we reel fast and stop there;
  // once at it, the slow idle reel takes over (or the fast one on Space) and
  // may keep going all the way down to the minimum length.
  const catchingUp = ropeLength > params.targetRopeLength + 0.05;
  const reelRate = catchingUp
    ? WEB.catchUpReelRate
    : params.reeling
      ? WEB.boostReelRate
      : WEB.autoReelRate;
  const floor = Math.max(
    WEB.minRopeLength,
    catchingUp ? params.targetRopeLength : WEB.minRopeLength,
  );
  const nextLength = Math.max(floor, ropeLength - reelRate * dt);

  // Only convert reeling into speed while the line is actually taut; reeling in
  // slack rope should not accelerate a free-falling player.
  if (nextLength < ropeLength && distance >= ropeLength - 0.25) {
    const gain = Math.min(ropeLength / nextLength, 1 + WEB.reelGainCapPerStep);
    const radialSpeed = velocity.dot(normal);
    radial.copy(normal).multiplyScalar(radialSpeed);
    tangential.subVectors(velocity, radial).multiplyScalar(gain);
    velocity.addVectors(radial, tangential);
  }
  ropeLength = nextLength;

  const exertion = params.sprinting ? WEB.sprintBoost : 1;

  /* 2. Steering: accelerate on the tangent plane --------------------------- */
  if (wishDir.lengthSq() > 1e-6) {
    scratch.copy(wishDir).addScaledVector(normal, -wishDir.dot(normal));
    if (scratch.lengthSq() > 1e-6) {
      velocity.addScaledVector(scratch.normalize(), WEB.swingAccel * exertion * dt);
    }
  }

  /* 3. Pump along the current swing direction ------------------------------ */
  if (params.pumping) {
    tangential.copy(velocity).addScaledVector(normal, -velocity.dot(normal));
    if (tangential.lengthSq() > 0.25) {
      velocity.addScaledVector(tangential.normalize(), WEB.pumpAccel * exertion * dt);
    }
  }

  /* 4. Maximum-distance constraint ---------------------------------------- */
  // Hysteresis band: taut above the rope length, slack only once clearly inside
  // it. Without the gap the state would flip every tick near the boundary and
  // re-trigger the catch bonus over and over.
  const overExtended = distance > ropeLength;
  const taut = overExtended ? true : distance < ropeLength - TAUT_HYSTERESIS ? false : params.taut;
  const justCaught = overExtended && !params.taut;

  let correction: Vector3 | null = null;
  if (overExtended) {
    const radialSpeed = velocity.dot(normal);
    if (radialSpeed > 0) {
      // Remove the component pulling away from the anchor. On a continuously
      // taut rope this is all that happens, and it very slightly *removes*
      // energy — which is what keeps the simulation stable.
      velocity.addScaledVector(normal, -radialSpeed);

      // On the catch itself, hand part of the lost fall speed back along the
      // direction of travel. This is the whoosh at the bottom of a dive.
      if (justCaught) {
        const speed = velocity.length();
        if (speed > 1e-3) {
          velocity.addScaledVector(velocity, (radialSpeed * WEB.radialToTangential) / speed);
        }
      }
    }

    const excess = distance - ropeLength;
    correction = correctionVec.copy(normal).multiplyScalar(-excess * WEB.positionalStiffness);
  }

  return { ropeLength, distance, taut, correction };
}

/**
 * A small kick on release. Momentum is *preserved* — this only adds on top, so
 * letting go at the bottom of an arc still launches you forward on the speed
 * you built up, just with a little extra pop.
 */
export function applyReleaseBoost(velocity: Vector3): void {
  const speed = velocity.length();
  if (speed > 1) {
    velocity.addScaledVector(velocity, WEB.releaseBoost / speed);
  }
  if (velocity.y > 0) {
    velocity.y += WEB.releaseUpBoost;
  }
}
