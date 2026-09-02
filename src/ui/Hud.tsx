import { useEffect, useRef } from 'react';
import { gameState } from '../game/state/gameState';
import type { MinimapImage } from '../game/world/buildMinimap';
import { CONTROLS } from './controls';
import { Minimap } from './Minimap';
import { useHudSnapshot } from './useHudSnapshot';

const VIGNETTE_START = 22; // m/s
const VIGNETTE_FULL = 66; // m/s

const STATUS_LABEL = {
  attached: '웹 고정',
  target: '조준',
  idle: '대상 없음',
} as const;

export function Hud({ minimap }: { minimap: MinimapImage | null }) {
  const { speed, attached, hasTarget, selfie } = useHudSnapshot();
  const vignetteRef = useRef<HTMLDivElement>(null);

  // Driven straight from the animation frame rather than React state: this
  // needs to be smooth, and it is a single style write per frame.
  useEffect(() => {
    let handle = 0;
    const tick = () => {
      const element = vignetteRef.current;
      if (element) {
        const raw = (gameState.player.speed - VIGNETTE_START) / (VIGNETTE_FULL - VIGNETTE_START);
        const strength = Math.min(1, Math.max(0, raw));
        element.style.opacity = String(strength * 0.55);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  const state = attached ? 'attached' : hasTarget ? 'target' : 'idle';
  // In selfie view the crosshair is pointing back at the player, so say so
  // rather than leaving a reticle that looks like it is aimed at something.
  const status = selfie ? '셀카' : STATUS_LABEL[state];

  return (
    <div className="hud">
      <div ref={vignetteRef} className="speed-vignette" />

      <div
        className={`crosshair${state === 'idle' ? '' : ` crosshair--${state}`}${
          selfie ? ' crosshair--selfie' : ''
        }`}
      >
        <span className="crosshair__ring" />
        <span className="crosshair__dot" />
      </div>
      <div
        className={`web-status${state === 'idle' ? '' : ` web-status--${state}`}${
          selfie ? ' web-status--selfie' : ''
        }`}
      >
        {status}
      </div>

      <div className="speedo">
        <span className="speedo__value">{speed}</span>
        <span className="speedo__unit">KM/H</span>
      </div>

      <Minimap image={minimap} />

      {/* Always visible, so the controls never have to be memorised or looked
          up by pausing. Top-right, to leave the bottom-right for the minimap. */}
      <div className="controls-hud">
        <div className="controls-hud__title">조작</div>
        {CONTROLS.map(({ key, label }) => (
          <div className="controls-hud__row" key={key}>
            <span className="controls-hud__key">{key}</span>
            <span className="controls-hud__label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
