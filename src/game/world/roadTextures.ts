import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Procedural street-surface textures.
 *
 * Drawn to a canvas at load time and returned as null without a DOM, exactly
 * like the facade textures. Kept light where the surface shows through, because
 * the material's own colour is multiplied over the top.
 */

function createContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

/** Deterministic pseudo-random, so the texture is identical every run. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 보도블록: interlocking paving blocks in a running bond.
 *
 * Every second course is offset by half a block, which is what stops the
 * pattern reading as graph paper, and each block is tinted slightly
 * differently so a wide pavement does not look like one flat plane.
 */
export function createSidewalkTexture(): CanvasTexture | null {
  const size = 512;
  const context = createContext(size, size);
  if (!context) return null;

  const courses = 8;
  const blockH = size / courses;
  const blockW = size / courses;
  const random = makeRandom(0xb10c5);

  // Joint colour, showing through the gaps between blocks.
  context.fillStyle = '#867f72';
  context.fillRect(0, 0, size, size);

  for (let row = 0; row < courses; row++) {
    const offset = row % 2 === 0 ? 0 : blockW / 2;
    // One extra block per course so the half-offset still wraps seamlessly.
    for (let col = -1; col <= courses; col++) {
      const x = col * blockW + offset;
      const y = row * blockH;

      const tint = random();
      const base = 168 + Math.round(tint * 26);
      context.fillStyle = `rgb(${base}, ${base - 6}, ${base - 18})`;
      context.fillRect(x + 1.5, y + 1.5, blockW - 3, blockH - 3);

      // A lit top edge and a shaded bottom edge give each block some relief.
      context.fillStyle = 'rgba(255,255,255,0.16)';
      context.fillRect(x + 1.5, y + 1.5, blockW - 3, 2);
      context.fillStyle = 'rgba(60,56,50,0.16)';
      context.fillRect(x + 1.5, y + blockH - 3.5, blockW - 3, 2);

      // Sparse speckle: worn concrete is never a flat fill.
      if (tint > 0.55) {
        context.fillStyle = 'rgba(120,114,102,0.25)';
        for (let i = 0; i < 5; i++) {
          context.fillRect(x + 4 + random() * (blockW - 10), y + 4 + random() * (blockH - 10), 2, 2);
        }
      }
    }
  }

  const texture = new CanvasTexture(context.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/**
 * 점자블록: the raised-dot tactile strip. One texture repeat is one block, so
 * the dot grid keeps a constant real-world size however far the strip runs.
 */
export function createTactileTexture(): CanvasTexture | null {
  const size = 128;
  const context = createContext(size, size);
  if (!context) return null;

  context.fillStyle = '#c9a63a';
  context.fillRect(0, 0, size, size);

  // Block joints.
  context.fillStyle = 'rgba(120,96,30,0.5)';
  context.fillRect(0, 0, size, 3);
  context.fillRect(0, 0, 3, size);

  const dots = 4;
  const step = size / dots;
  for (let row = 0; row < dots; row++) {
    for (let col = 0; col < dots; col++) {
      const cx = (col + 0.5) * step;
      const cy = (row + 0.5) * step;
      context.fillStyle = '#d8b74e';
      context.beginPath();
      context.arc(cx, cy, step * 0.26, 0, Math.PI * 2);
      context.fill();
      // A shaded lower half reads as a raised dome rather than a flat disc.
      context.fillStyle = 'rgba(110,88,26,0.45)';
      context.beginPath();
      context.arc(cx, cy + step * 0.06, step * 0.26, 0.2, Math.PI - 0.2);
      context.fill();
    }
  }

  const texture = new CanvasTexture(context.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}
