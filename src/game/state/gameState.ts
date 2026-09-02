import { Vector3 } from 'three';
import type { Mesh } from 'three';
import { CAMERA } from '../config';
import type { SkyMode } from '../world/skyState';

/**
 * Per-frame game state lives in this plain mutable singleton, deliberately
 * *outside* React.
 *
 * Physics runs at 60 Hz and touches these values several times per frame.
 * Routing that through React state would re-render the scene graph every tick;
 * instead the systems read and write here, and the HUD samples it on a slow
 * timer (see `ui/useHudSnapshot.ts`). Only coarse things — which screen is
 * showing — are real React state.
 */

export interface WebRuntimeState {
  attached: boolean;
  /** World-space point the rope is fixed to. Meaningless when detached. */
  anchor: Vector3;
  /** Current maximum allowed distance to the anchor, in metres. */
  ropeLength: number;
  /** Length the rope is being reeled down to so its arc clears the street. */
  targetRopeLength: number;
  /** Actual player-to-anchor distance, for the debug overlay. */
  anchorDistance: number;
  /** Whether the rope is currently taut; carried across ticks by the solver. */
  taut: boolean;
  /** True when a valid building is under the crosshair and in range. */
  hasTarget: boolean;
  /** 0 -> 1 while the rope visually flies out to the anchor. */
  shootProgress: number;
}

export interface GameState {
  player: {
    position: Vector3;
    velocity: Vector3;
    /** Cached |velocity|, metres per second. */
    speed: number;
    grounded: boolean;
    /** Clinging to a building wall. */
    climbing: boolean;
    /** Outward normal of the wall being climbed; stale unless `climbing`. */
    wallNormal: Vector3;
  };
  camera: {
    yaw: number;
    pitch: number;
    /** Selfie view: camera in front of the player, looking back at them. */
    selfie: boolean;
    /** Wheel zoom, as a multiplier on the orbit distance. 1 is the default. */
    zoom: number;
    /** Live FOV, driven by speed. */
    fov: number;
    /** Unit forward vector of the camera, refreshed every frame. */
    forward: Vector3;
    position: Vector3;
  };
  web: WebRuntimeState;
  world: {
    /**
     * Building surfaces: facade, podium and roof. These are the only valid web
     * anchors and camera occluders — roads, signs and the ground are excluded
     * on purpose.
     */
    cityMeshes: Mesh[];
    /** Camera orientation applied on spawn, aimed at a good first target. */
    spawnAim: { yaw: number; pitch: number };
  };
  sky: {
    /** `auto` follows the real Korean clock; the others pin it. */
    mode: SkyMode;
    /** Sun altitude in radians; negative after sunset. */
    sunAltitude: number;
    /** 0 at night, 1 in full daylight. Drives the lit windows. */
    dayFactor: number;
  };
  debug: {
    enabled: boolean;
    fps: number;
  };
  /** Number of respawns so far; the HUD uses it to flash a message. */
  respawnCount: number;
  /**
   * Photo pause (P). Owned by `state/input.ts`; mirrored here so the camera can
   * read it without importing the input module.
   */
  paused: boolean;
}

export const gameState: GameState = {
  player: {
    position: new Vector3(),
    velocity: new Vector3(),
    speed: 0,
    grounded: false,
    climbing: false,
    wallNormal: new Vector3(0, 0, 1),
  },
  camera: {
    yaw: 0,
    pitch: 0.12,
    selfie: false,
    zoom: 1,
    fov: CAMERA.fovBase,
    forward: new Vector3(0, 0, -1),
    position: new Vector3(),
  },
  web: {
    attached: false,
    anchor: new Vector3(),
    ropeLength: 0,
    targetRopeLength: 0,
    anchorDistance: 0,
    taut: false,
    hasTarget: false,
    shootProgress: 0,
  },
  world: {
    cityMeshes: [],
    spawnAim: { yaw: 0, pitch: 0.12 },
  },
  sky: {
    mode: 'auto',
    sunAltitude: 0.6,
    dayFactor: 1,
  },
  debug: {
    enabled: false,
    fps: 0,
  },
  respawnCount: 0,
  paused: false,
};

/** Restores the mutable state to a clean slate (used on respawn). */
export function resetRuntimeState(): void {
  gameState.web.attached = false;
  gameState.web.hasTarget = false;
  gameState.web.ropeLength = 0;
  gameState.web.targetRopeLength = 0;
  gameState.web.anchorDistance = 0;
  gameState.web.taut = false;
  gameState.web.shootProgress = 0;
  gameState.player.velocity.set(0, 0, 0);
  gameState.player.speed = 0;
  gameState.player.climbing = false;
}

/**
 * Writes the camera forward vector for the given yaw/pitch.
 *
 * Convention (shared by the camera, the web raycast and the aim hint):
 *   yaw = 0, pitch = 0  ->  (0, 0, -1), i.e. facing north.
 *   Increasing yaw turns left; increasing pitch looks up.
 */
export function cameraForward(yaw: number, pitch: number, target: Vector3): Vector3 {
  const cosPitch = Math.cos(pitch);
  return target.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
}
