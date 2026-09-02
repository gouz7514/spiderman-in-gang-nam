import { useEffect, useState } from 'react';
import { gameState } from '../game/state/gameState';

export interface HudSnapshot {
  /** Rounded speed in km/h. */
  speed: number;
  attached: boolean;
  hasTarget: boolean;
  /** Selfie view: the camera is in front, looking back at the player. */
  selfie: boolean;
}

/**
 * Samples the mutable game state on a slow timer instead of every frame.
 *
 * The HUD sits outside the <Canvas>, so a re-render here never touches the
 * scene graph — and by returning the previous object when nothing changed, the
 * component only re-renders when a displayed value actually moves.
 */
export function useHudSnapshot(intervalMs = 80): HudSnapshot {
  const [snapshot, setSnapshot] = useState<HudSnapshot>({
    speed: 0,
    attached: false,
    hasTarget: false,
    selfie: false,
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot((previous) => {
        const speed = Math.round(gameState.player.speed * 3.6);
        const { attached, hasTarget } = gameState.web;
        const { selfie } = gameState.camera;
        if (
          previous.speed === speed &&
          previous.attached === attached &&
          previous.hasTarget === hasTarget &&
          previous.selfie === selfie
        ) {
          return previous;
        }
        return { speed, attached, hasTarget, selfie };
      });
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [intervalMs]);

  return snapshot;
}
