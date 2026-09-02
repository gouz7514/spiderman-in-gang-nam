import { CAMERA } from '../config';
import { gameState } from './gameState';
import { saveSkyMode } from '../world/skyState';

/**
 * Raw device input. Held keys are polled by the physics step; one-shot actions
 * (jump, respawn) are latched here and consumed exactly once so a single key
 * press cannot fire on several physics sub-steps.
 */
export const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  /** Shift held: sprint on the ground, harder swing input in the air. */
  sprint: false,
  /** Left mouse button held: the web is being fired / kept attached. */
  firing: false,
};

let jumpLatch = false;
let respawnLatch = false;

/** True exactly once per Space press. */
export function consumeJumpPress(): boolean {
  const value = jumpLatch;
  jumpLatch = false;
  return value;
}

/** True exactly once per R press. */
export function consumeRespawnPress(): boolean {
  const value = respawnLatch;
  respawnLatch = false;
  return value;
}

export function clearInput(): void {
  input.forward = false;
  input.back = false;
  input.left = false;
  input.right = false;
  input.jump = false;
  input.sprint = false;
  input.firing = false;
  jumpLatch = false;
}

function setKey(code: string, down: boolean): boolean {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      input.forward = down;
      return true;
    case 'KeyS':
    case 'ArrowDown':
      input.back = down;
      return true;
    case 'KeyA':
    case 'ArrowLeft':
      input.left = down;
      return true;
    case 'KeyD':
    case 'ArrowRight':
      input.right = down;
      return true;
    case 'Space':
      input.jump = down;
      if (down) jumpLatch = true;
      return true;
    case 'ShiftLeft':
    case 'ShiftRight':
      input.sprint = down;
      return true;
    default:
      return false;
  }
}

export function isPointerLocked(): boolean {
  return document.pointerLockElement !== null;
}

/**
 * Installs every window-level listener the game needs and returns a teardown
 * function. Mouse look accumulates straight into `gameState.camera` so no
 * movement is dropped between render frames.
 */
export function attachInput(onPointerLockChange: (locked: boolean) => void): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      if (setKey(event.code, true)) event.preventDefault();
      return;
    }

    if (event.code === 'Backquote') {
      gameState.debug.enabled = !gameState.debug.enabled;
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyR') {
      respawnLatch = true;
      return;
    }
    if (event.code === 'KeyF') {
      gameState.camera.selfie = !gameState.camera.selfie;
      return;
    }
    if (event.code === 'KeyN') {
      const order = ['auto', 'day', 'night'] as const;
      const next = order[(order.indexOf(gameState.sky.mode) + 1) % order.length];
      gameState.sky.mode = next;
      saveSkyMode(next);
      return;
    }
    if (setKey(event.code, true)) event.preventDefault();
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (setKey(event.code, false)) event.preventDefault();
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (!isPointerLocked() || event.button !== 0) return;
    input.firing = true;
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return;
    input.firing = false;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isPointerLocked()) return;
    gameState.camera.yaw -= event.movementX * CAMERA.sensitivity;
    gameState.camera.pitch = Math.min(
      CAMERA.pitchMax,
      Math.max(CAMERA.pitchMin, gameState.camera.pitch - event.movementY * CAMERA.sensitivity),
    );
  };

  const handleLockChange = () => {
    const locked = isPointerLocked();
    if (!locked) clearInput(); // never leave a key stuck down while paused
    onPointerLockChange(locked);
  };

  const handleBlur = () => clearInput();

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('blur', handleBlur);
  document.addEventListener('pointerlockchange', handleLockChange);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('pointerlockchange', handleLockChange);
  };
}

/**
 * Requests pointer lock.
 *
 * Browsers refuse a re-lock for about a second after the user pressed Esc, so a
 * rejection is retried once — otherwise clicking "Resume" straight after
 * pausing would silently do nothing.
 */
export function requestPointerLock(retry = true): void {
  const result = document.body.requestPointerLock?.() as unknown as Promise<void> | undefined;
  if (result && typeof result.catch === 'function') {
    result.catch(() => {
      if (retry) window.setTimeout(() => requestPointerLock(false), 1300);
    });
  }
}

export function exitPointerLock(): void {
  document.exitPointerLock?.();
}
