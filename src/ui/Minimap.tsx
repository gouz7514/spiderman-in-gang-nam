import { useEffect, useRef } from 'react';
import { MINIMAP } from '../game/config';
import { gameState } from '../game/state/gameState';
import type { MinimapImage } from '../game/world/buildMinimap';

/**
 * Heading-up minimap.
 *
 * The city plan is baked once into an offscreen canvas (see `buildMinimap`), so
 * each frame is a single rotated `drawImage` plus a handful of shapes — no
 * React state, no scene traversal. The whole thing is driven straight from the
 * animation frame for the same reason the speed vignette is: it has to be
 * smooth, and re-rendering React 60 times a second to move a triangle would be
 * absurd.
 */
export function Minimap({ image }: { image: MinimapImage | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = MINIMAP.size;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(dpr, dpr);

    const centre = size / 2;
    const radius = centre - 3;
    // Widget pixels per world metre, then per source-image pixel.
    const worldScale = size / MINIMAP.worldSpan;
    const imageScale = worldScale / image.pixelsPerMetre;
    const half = image.size / 2;

    let handle = 0;
    const draw = () => {
      handle = requestAnimationFrame(draw);

      const { position } = gameState.player;
      const heading = gameState.camera.yaw;

      context.clearRect(0, 0, size, size);
      context.save();
      // Clip first: the rotated blit is then only rasterised inside the dial.
      context.beginPath();
      context.arc(centre, centre, radius, 0, Math.PI * 2);
      context.clip();

      context.fillStyle = '#0d1119';
      context.fillRect(0, 0, size, size);

      context.save();
      context.translate(centre, centre);
      // Canvas +y is world +z (south), so rotating by the yaw puts the
      // player's facing at the top of the dial.
      context.rotate(heading);
      context.scale(imageScale, imageScale);
      context.drawImage(
        image.canvas,
        -(position.x * image.pixelsPerMetre + half),
        -(position.z * image.pixelsPerMetre + half),
      );
      context.restore();

      /* North marker, riding the rotation. */
      context.save();
      context.translate(centre, centre);
      context.rotate(heading);
      context.fillStyle = 'rgba(120,150,190,0.85)';
      context.beginPath();
      context.moveTo(0, -radius + 4);
      context.lineTo(-4, -radius + 12);
      context.lineTo(4, -radius + 12);
      context.closePath();
      context.fill();
      context.restore();

      context.restore();

      /* Player arrow: always upright, always dead centre. */
      context.fillStyle = '#4ee0ff';
      context.strokeStyle = 'rgba(8,12,18,0.9)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(centre, centre - 7);
      context.lineTo(centre + 5.5, centre + 6);
      context.lineTo(centre, centre + 3);
      context.lineTo(centre - 5.5, centre + 6);
      context.closePath();
      context.fill();
      context.stroke();

      /* Dial rim. */
      context.strokeStyle = 'rgba(120,160,200,0.35)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(centre, centre, radius, 0, Math.PI * 2);
      context.stroke();
    };

    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [image]);

  if (!image) return null;

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        style={{ width: MINIMAP.size, height: MINIMAP.size }}
        aria-hidden
      />
      <div className="minimap__altitude">
        <span className="minimap__altitude-mark">▲</span>
        <AltitudeReadout />
      </div>
    </div>
  );
}

/** Height above the street, sampled off the animation frame like the map. */
function AltitudeReadout() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let handle = 0;
    let shown = -1;
    const tick = () => {
      handle = requestAnimationFrame(tick);
      const element = ref.current;
      if (!element) return;
      const metres = Math.max(0, Math.round(gameState.player.position.y));
      if (metres !== shown) {
        shown = metres;
        element.textContent = `${metres} m`;
      }
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  return <span ref={ref}>0 m</span>;
}
