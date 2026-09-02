import { Vector3 } from 'three';
import type { Camera } from 'three';
import type { RapierRigidBody, useRapier } from '@react-three/rapier';
import { PLAYER, WEB, WORLD } from '../config';
import { applySpeedLimits } from '../physics/movement';
import { solveSwing } from '../physics/swingPhysics';
import { consumeJumpPress, consumeRespawnPress, input } from '../state/input';
import { cameraForward, gameState, resetRuntimeState } from '../state/gameState';
import { attachWeb, detachWeb, findWebTarget } from '../web/webSwing';

type RapierContext = ReturnType<typeof useRapier>;
type RapierWorld = RapierContext['world'];
type RapierModule = RapierContext['rapier'];

export interface PlayerStepContext {
  body: RapierRigidBody;
  world: RapierWorld;
  rapier: RapierModule;
  camera: Camera;
  dt: number;
}

const ZERO = { x: 0, y: 0, z: 0 };

/**
 * Everything that reads or writes the player's rigid body each physics tick:
 * locomotion, the web state machine, the swing solver and respawning.
 *
 * Kept out of the React component so the hot path is plain functions and
 * pre-allocated vectors — nothing here allocates or triggers a render.
 */
export function createPlayerController() {
  const position = new Vector3();
  const velocity = new Vector3();
  const wishDir = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const horizontal = new Vector3();
  const anchorCandidate = new Vector3();

  const wallNormal = new Vector3();
  const wallUp = new Vector3();
  const wallRight = new Vector3();
  const planar = new Vector3();
  const climbWish = new Vector3();
  const probeDir = new Vector3();
  const camForward = new Vector3();
  const UP = new Vector3(0, 1, 0);

  let airBoostTimer = 0;
  let frame = 0;
  let climbing = false;
  let wallGrace = 0;
  let wallJumpTimer = 0;
  // rapier.Ray needs the wasm module, which is only available once we step.
  let groundRay: InstanceType<RapierModule['Ray']> | null = null;
  let wallRay: InstanceType<RapierModule['Ray']> | null = null;

  function respawn(body: RapierRigidBody): void {
    const [x, y, z] = PLAYER.spawn;
    body.setTranslation({ x, y, z }, true);
    body.setLinvel(ZERO, true);
    body.setAngvel(ZERO, true);
    resetRuntimeState();
    gameState.camera.yaw = gameState.world.spawnAim.yaw;
    gameState.camera.pitch = gameState.world.spawnAim.pitch;
    gameState.respawnCount += 1;
    airBoostTimer = 0;
    releaseWall(body);
    wallJumpTimer = 0;
  }

  /**
   * Stops clinging and hands the body back to gravity.
   *
   * Gravity is switched off outright while climbing rather than cancelled with
   * an opposing velocity: the controller writes `linvel` *before* the step, so
   * gravity would still be integrated afterwards and the player would sag by
   * `g * dt` every tick — a visible slide down every wall.
   */
  function releaseWall(body: RapierRigidBody): void {
    if (!climbing) return;
    climbing = false;
    wallGrace = 0;
    body.setGravityScale(1, true);
  }

  /** Short downward ray from the capsule centre; excludes the player's own body. */
  function isGrounded(ctx: PlayerStepContext): boolean {
    if (velocity.y > 0.6) return false;
    if (!groundRay) {
      groundRay = new ctx.rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    }
    groundRay.origin.x = position.x;
    groundRay.origin.y = position.y;
    groundRay.origin.z = position.z;

    const reach = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius + PLAYER.groundProbe;
    const hit = ctx.world.castRay(
      groundRay,
      reach,
      true,
      undefined,
      undefined,
      undefined,
      ctx.body,
    );
    return hit !== null;
  }

  /**
   * Looks for a climbable wall next to the capsule and writes its outward
   * normal into `wallNormal`.
   *
   * Several directions are tried in order of how likely they are to be the wall
   * the player means: the one already being climbed (so contact survives a
   * bumpy facade), then where they are steering, then where they are actually
   * travelling, then where the camera points. The first steep hit wins.
   */
  function findWall(ctx: PlayerStepContext, hasInput: boolean): boolean {
    if (!wallRay) {
      wallRay = new ctx.rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    }
    const reach = PLAYER.capsuleRadius + PLAYER.wallProbe;
    wallRay.origin.x = position.x;
    wallRay.origin.y = position.y;
    wallRay.origin.z = position.z;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt === 0) {
        if (!climbing) continue;
        probeDir.copy(wallNormal).negate();
      } else if (attempt === 1) {
        if (!hasInput) continue;
        probeDir.copy(wishDir);
      } else if (attempt === 2) {
        probeDir.set(velocity.x, 0, velocity.z);
        if (probeDir.lengthSq() < 1) continue;
        probeDir.normalize();
      } else {
        probeDir.set(forward.x, 0, forward.z).normalize();
      }

      wallRay.dir.x = probeDir.x;
      wallRay.dir.y = probeDir.y;
      wallRay.dir.z = probeDir.z;

      const hit = ctx.world.castRayAndGetNormal(
        wallRay,
        reach,
        true,
        undefined,
        undefined,
        undefined,
        ctx.body,
      );
      if (!hit) continue;

      const normal = hit.normal;
      if (Math.abs(normal.y) > PLAYER.wallMaxNormalY) continue;
      wallNormal.set(normal.x, normal.y, normal.z).normalize();
      // A back face would point away from the player and invert the stick.
      if (wallNormal.dot(probeDir) > 0) wallNormal.negate();
      return true;
    }
    return false;
  }

  /**
   * Movement while stuck to a facade.
   *
   * The wall gets its own 2D basis — "up the wall" and "along the wall" — and
   * the camera's own forward/right are projected onto it, so W is whatever
   * direction the player is looking on that surface rather than a fixed climb.
   * Looking up the building and holding W climbs; looking sideways traverses.
   */
  function climbMove(dt: number, hasInput: boolean): void {
    wallUp.copy(UP).addScaledVector(wallNormal, -wallNormal.y).normalize();
    wallRight.crossVectors(wallUp, wallNormal).normalize();

    climbWish.set(0, 0, 0);
    if (hasInput) {
      cameraForward(gameState.camera.yaw, gameState.camera.pitch, camForward);
      // Project the camera axes onto the wall. Staring straight at the facade
      // leaves nothing of the forward axis, so fall back to climbing upwards.
      camForward.addScaledVector(wallNormal, -camForward.dot(wallNormal));
      if (camForward.lengthSq() < 0.04) camForward.copy(wallUp);
      else camForward.normalize();
      planar.copy(right).addScaledVector(wallNormal, -right.dot(wallNormal));
      if (planar.lengthSq() < 0.04) planar.copy(wallRight);
      else planar.normalize();

      if (input.forward) climbWish.add(camForward);
      if (input.back) climbWish.sub(camForward);
      if (input.right) climbWish.add(planar);
      if (input.left) climbWish.sub(planar);
      if (climbWish.lengthSq() > 1e-6) climbWish.normalize();
    }

    const cap = input.sprint ? PLAYER.climbSprintSpeed : PLAYER.climbSpeed;
    climbWish.multiplyScalar(cap);

    // Only the in-plane part of the velocity carries over; whatever the player
    // arrived with perpendicular to the wall is absorbed by sticking to it.
    planar.copy(velocity).addScaledVector(wallNormal, -velocity.dot(wallNormal));
    climbWish.sub(planar);
    const gap = climbWish.length();
    if (gap > 1e-6) planar.addScaledVector(climbWish, Math.min(1, (PLAYER.climbAccel * dt) / gap));

    velocity.copy(planar).addScaledVector(wallNormal, -PLAYER.wallStickSpeed);
  }

  /**
   * Quake-style ground movement: friction bleeds current speed, then a top-up
   * along the input direction limited to the walk cap. Landing at swing speed
   * therefore slides to a stop instead of snapping to walking pace.
   */
  function groundMove(dt: number, hasInput: boolean): void {
    horizontal.set(velocity.x, 0, velocity.z);

    const speed = horizontal.length();
    if (speed > 0.001) {
      const drop = Math.max(speed, PLAYER.groundStopSpeed) * PLAYER.groundFriction * dt;
      horizontal.multiplyScalar(Math.max(0, speed - drop) / speed);
    }

    if (hasInput) {
      const accel = input.sprint ? PLAYER.sprintAccel : PLAYER.groundAccel;
      const cap = input.sprint ? PLAYER.sprintMaxSpeed : PLAYER.groundMaxSpeed;
      const along = horizontal.dot(wishDir);
      const add = Math.min(accel * dt, cap - along);
      if (add > 0) horizontal.addScaledVector(wishDir, add);
    }

    velocity.x = horizontal.x;
    velocity.z = horizontal.z;
  }

  /**
   * Air control only tops up the velocity *component along the input*, so it
   * can steer a 70 m/s dive without ever capping the overall speed.
   */
  function airMove(dt: number, hasInput: boolean): void {
    if (!hasInput) return;
    horizontal.set(velocity.x, 0, velocity.z);
    const along = horizontal.dot(wishDir);
    const add = Math.min(PLAYER.airAccel * dt, PLAYER.airControlSpeedCap - along);
    if (add > 0) {
      velocity.x += wishDir.x * add;
      velocity.z += wishDir.z * add;
    }
  }

  function step(ctx: PlayerStepContext): void {
    const { body, camera, dt } = ctx;
    const web = gameState.web;

    const translation = body.translation();
    position.set(translation.x, translation.y, translation.z);
    const linvel = body.linvel();
    velocity.set(linvel.x, linvel.y, linvel.z);

    /* Respawn ------------------------------------------------------------- */
    const outOfBounds =
      position.y < WORLD.killY ||
      Math.hypot(position.x, position.z) > WORLD.boundsRadius ||
      !Number.isFinite(position.x + position.y + position.z);

    if (consumeRespawnPress() || outOfBounds) {
      respawn(body);
      return;
    }

    /* Movement intent, in camera space ------------------------------------ */
    const yaw = gameState.camera.yaw;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    wishDir.set(0, 0, 0);
    if (input.forward) wishDir.add(forward);
    if (input.back) wishDir.sub(forward);
    if (input.right) wishDir.add(right);
    if (input.left) wishDir.sub(right);
    const hasInput = wishDir.lengthSq() > 1e-6;
    if (hasInput) wishDir.normalize();

    const jumpPressed = consumeJumpPress();

    /* Web state machine ---------------------------------------------------- */
    if (!web.attached) {
      // While the button is held we keep re-testing every tick, so sweeping the
      // crosshair across a facade catches as soon as it lines up. Otherwise we
      // only refresh the reticle every other tick — it is purely cosmetic.
      frame += 1;
      if (input.firing || frame % 2 === 0) {
        web.hasTarget = findWebTarget(
          camera,
          position,
          gameState.world.cityMeshes,
          anchorCandidate,
        );
        if (input.firing && web.hasTarget) {
          attachWeb(anchorCandidate, position);
        }
      }
    } else if (!input.firing) {
      detachWeb(velocity);
    }

    const grounded = isGrounded(ctx);

    /* Wall crawling -------------------------------------------------------- */
    // The web wins: firing one while stuck to a facade lets go and swings.
    if (web.attached) releaseWall(body);
    wallJumpTimer = Math.max(0, wallJumpTimer - dt);

    if (!web.attached && wallJumpTimer <= 0) {
      // In the air, brushing a facade is enough. From the pavement the player
      // has to walk deliberately *into* it — otherwise standing beside a
      // building would glue them to it, and running along a street would end
      // with them stuck to the shopfront they clipped.
      const found = findWall(ctx, hasInput);
      const wants =
        found &&
        (climbing || !grounded || (hasInput && wishDir.dot(wallNormal) < -0.5));

      if (wants) {
        if (!climbing) {
          climbing = true;
          body.setGravityScale(0, true);
        }
        wallGrace = PLAYER.wallGraceTime;
      } else if (climbing) {
        // Rounding a corner or crossing a window reveal briefly loses contact;
        // dropping instantly would make every real facade unclimbable.
        wallGrace -= dt;
        if (wallGrace <= 0) releaseWall(body);
      }
    } else {
      releaseWall(body);
    }

    gameState.player.grounded = grounded && !web.attached && !climbing;
    gameState.player.climbing = climbing;
    if (climbing) gameState.player.wallNormal.copy(wallNormal);

    /* Locomotion ----------------------------------------------------------- */
    if (web.attached) {
      web.hasTarget = true;
      web.shootProgress = Math.min(1, web.shootProgress + dt / WEB.shootTime);

      const result = solveSwing({
        position,
        velocity,
        anchor: web.anchor,
        ropeLength: web.ropeLength,
        dt,
        wishDir,
        pumping: input.forward,
        sprinting: input.sprint,
        reeling: input.jump,
        targetRopeLength: web.targetRopeLength,
        taut: web.taut,
      });
      web.ropeLength = result.ropeLength;
      web.anchorDistance = result.distance;
      web.taut = result.taut;

      if (result.correction) {
        body.setTranslation(
          {
            x: position.x + result.correction.x,
            y: position.y + result.correction.y,
            z: position.z + result.correction.z,
          },
          true,
        );
      }
      applySpeedLimits(velocity, dt);
    } else if (climbing) {
      if (jumpPressed) {
        // Push off the facade, not just upwards, so a wall jump crosses a
        // street instead of scraping back up the same building.
        releaseWall(body);
        velocity.copy(wallNormal).multiplyScalar(PLAYER.wallJumpOut);
        velocity.y += PLAYER.wallJumpUp;
        wallJumpTimer = PLAYER.wallJumpCooldown;
        gameState.player.climbing = false;
      } else {
        climbMove(dt, hasInput);
      }
    } else if (gameState.player.grounded) {
      groundMove(dt, hasInput);
      if (jumpPressed) velocity.y = PLAYER.jumpSpeed;
    } else {
      airMove(dt, hasInput);
      if (jumpPressed && airBoostTimer <= 0) {
        // Aerial dash: along the input if there is one, otherwise straight ahead.
        const dashDir = hasInput ? wishDir : forward;
        velocity.addScaledVector(dashDir, PLAYER.airBoost);
        velocity.y += PLAYER.airBoost * 0.25;
        airBoostTimer = PLAYER.airBoostCooldown;
      }
      applySpeedLimits(velocity, dt);
    }

    airBoostTimer = Math.max(0, airBoostTimer - dt);
    body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
  }

  /** Publishes the post-step body state for the camera, HUD and debug overlay. */
  function sync(body: RapierRigidBody): void {
    const translation = body.translation();
    const linvel = body.linvel();
    gameState.player.position.set(translation.x, translation.y, translation.z);
    gameState.player.velocity.set(linvel.x, linvel.y, linvel.z);
    gameState.player.speed = gameState.player.velocity.length();
    if (gameState.web.attached) {
      gameState.web.anchorDistance = gameState.player.position.distanceTo(gameState.web.anchor);
    }
  }

  return { step, sync, respawn };
}

export type PlayerController = ReturnType<typeof createPlayerController>;
