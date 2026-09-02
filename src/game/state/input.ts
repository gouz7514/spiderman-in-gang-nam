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

/**
 * Photo pause (P): the simulation stops and the cursor comes back, but no menu
 * is drawn over the city — which is the whole point, since the pause exists so
 * the player can take a screenshot. It lives here rather than in React because
 * pointer lock may only be requested from inside a real user gesture, so the
 * key handler has to call for it directly.
 */
let photoPaused = false;
let notifyPause: (paused: boolean) => void = () => {};
/** Left button held during a photo pause: the view is being dragged round. */
let dragging = false;

export function isPhotoPaused(): boolean {
  return photoPaused;
}

/** Enters or leaves the photo pause, taking pointer lock with it. */
export function setPhotoPaused(next: boolean): void {
  if (next === photoPaused) return;
  photoPaused = next;
  gameState.paused = next;
  dragging = false;
  if (next) exitPointerLock();
  else requestPointerLock();
  notifyPause(next);
}

/**
 * Ends the pause *without* asking for the lock back, which is what leaves the
 * title card up: Esc during a photo pause is the way to the menu, since the
 * usual route (Esc while playing) is not available once the lock is gone.
 */
function endPauseWithoutLock(): void {
  if (!photoPaused) return;
  photoPaused = false;
  gameState.paused = false;
  dragging = false;
  notifyPause(false);
}

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
export function attachInput(
  onPointerLockChange: (locked: boolean) => void,
  onPauseChange: (paused: boolean) => void,
): () => void {
  notifyPause = onPauseChange;

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
    if (event.code === 'Escape' && photoPaused) {
      endPauseWithoutLock();
      return;
    }
    if (event.code === 'KeyP') {
      // Only ever a toggle *within* play: on the title card there is no lock to
      // give up, and grabbing one here would drop the player into the city.
      if (photoPaused) setPhotoPaused(false);
      else if (isPointerLocked()) setPhotoPaused(true);
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

  const applyLook = (dx: number, dy: number) => {
    gameState.camera.yaw -= dx * CAMERA.sensitivity;
    gameState.camera.pitch = Math.min(
      CAMERA.pitchMax,
      Math.max(CAMERA.pitchMin, gameState.camera.pitch - dy * CAMERA.sensitivity),
    );
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (isPointerLocked()) {
      input.firing = true;
      return;
    }
    // Paused, so there is no lock and no relative mouse: dragging is how the
    // shot gets framed. A drag that starts on the badge is left alone, or its
    // click — the way back into the game — would never land.
    const target = event.target as Element | null;
    if (photoPaused && !target?.closest?.('.pause-notice')) {
      dragging = true;
      // Without this the drag selects the badge's text as it sweeps past.
      event.preventDefault();
    }
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return;
    input.firing = false;
    dragging = false;
  };

  const handleMouseMove = (event: MouseEvent) => {
    // `movementX/Y` is reported with or without pointer lock, so the paused
    // drag uses the same relative deltas — and therefore the same sensitivity —
    // as playing does.
    if (!isPointerLocked() && !dragging) return;
    applyLook(event.movementX, event.movementY);
  };

  // Zoom stays live through a photo pause: framing the shot is most of what
  // the pause is for.
  const handleWheel = (event: WheelEvent) => {
    if (!isPointerLocked() && !photoPaused) return;
    event.preventDefault();
    const next = gameState.camera.zoom * Math.exp(event.deltaY * CAMERA.zoomSensitivity);
    gameState.camera.zoom = Math.min(CAMERA.zoomMax, Math.max(CAMERA.zoomMin, next));
  };

  const handleLockChange = () => {
    const locked = isPointerLocked();
    if (!locked) clearInput(); // never leave a key stuck down while paused
    // Clicking back into the city ends a photo pause without going through P.
    if (locked) endPauseWithoutLock();
    if (!locked) dragging = false;
    onPointerLockChange(locked);
  };

  const handleBlur = () => {
    dragging = false;
    clearInput();
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('mousemove', handleMouseMove);
  // Not passive: the wheel must not scroll the page behind the canvas.
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('blur', handleBlur);
  document.addEventListener('pointerlockchange', handleLockChange);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('wheel', handleWheel);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('pointerlockchange', handleLockChange);
    notifyPause = () => {};
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
