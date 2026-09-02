import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { FACADE } from '../config';

/**
 * Procedural facade textures.
 *
 * Both are drawn to a canvas at load time — no downloads, no asset pipeline —
 * and are deliberately near-white where the wall shows through, because the
 * material multiplies them by the per-building vertex colour. The texture
 * supplies structure (glazing, mullions, floor slabs, shopfronts); the vertex
 * colour supplies each building's identity.
 *
 * Returns null when there is no DOM, so the geometry pipeline stays runnable in
 * plain node.
 */

function createCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

/** Deterministic pseudo-random so the textures are identical every run. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Upper facade: one storey of windows                                         */
/* -------------------------------------------------------------------------- */

/**
 * A tile of `baysPerTile x floorsPerTile` window bays, wrapped in both axes.
 * Each cell is a floor slab band, a spandrel, and a glazed opening.
 */
export function createFacadeTexture(): CanvasTexture | null {
  const size = FACADE.textureSize;
  const context = createCanvas(size, size);
  if (!context) return null;

  const cols = FACADE.baysPerTile;
  const rows = FACADE.floorsPerTile;
  const cellW = size / cols;
  const cellH = size / rows;
  const random = makeRandom(0x5eed1);

  // Wall base. Kept bright: it is multiplied by the building colour.
  context.fillStyle = '#e4e4e2';
  context.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW;
      const y = row * cellH;

      // Floor slab: a band across the bottom of the storey.
      const slabH = cellH * 0.13;
      context.fillStyle = '#c8c7c3';
      context.fillRect(x, y + cellH - slabH, cellW, slabH);
      context.fillStyle = 'rgba(90,92,96,0.35)';
      context.fillRect(x, y + cellH - slabH, cellW, 2);

      // Pier between bays.
      context.fillStyle = '#d6d5d1';
      context.fillRect(x, y, cellW * 0.1, cellH);

      /* Glazing ---------------------------------------------------------- */
      const winX = x + cellW * 0.16;
      const winW = cellW * 0.7;
      const winY = y + cellH * 0.16;
      const winH = cellH * 0.62;

      // Reveal, so the glass reads as recessed.
      context.fillStyle = '#b9b8b4';
      context.fillRect(winX - 3, winY - 3, winW + 6, winH + 6);

      const glass = context.createLinearGradient(0, winY, 0, winY + winH);
      // Sky reflection at the top, room shadow at the bottom.
      const tint = random();
      if (tint > 0.86) {
        glass.addColorStop(0, '#8d8163'); // blinds down
        glass.addColorStop(1, '#4a4132');
      } else if (tint > 0.7) {
        glass.addColorStop(0, '#6f8296');
        glass.addColorStop(1, '#2f3b48');
      } else {
        glass.addColorStop(0, '#5d6f83');
        glass.addColorStop(1, '#252d38');
      }
      context.fillStyle = glass;
      context.fillRect(winX, winY, winW, winH);

      // A single diagonal highlight sells it as glass rather than a hole.
      context.save();
      context.beginPath();
      context.rect(winX, winY, winW, winH);
      context.clip();
      context.fillStyle = 'rgba(255,255,255,0.1)';
      context.beginPath();
      context.moveTo(winX, winY + winH * 0.75);
      context.lineTo(winX + winW * 0.55, winY);
      context.lineTo(winX + winW, winY);
      context.lineTo(winX + winW, winY + winH * 0.2);
      context.closePath();
      context.fill();
      context.restore();

      // Mullions.
      context.fillStyle = '#cfcecb';
      context.fillRect(winX + winW / 2 - 1.5, winY, 3, winH);
      context.fillRect(winX, winY + winH * 0.52 - 1.5, winW, 3);
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
 * The same tile again, but as an emissive mask: lit windows only, everything
 * else black.
 *
 * Applied as `emissiveMap` and faded in as the sun sets, which is what turns a
 * night skyline from black slabs into a lived-in city. Cell geometry has to
 * match `createFacadeTexture` exactly, since both are sampled with the same UVs.
 */
export function createWindowLightTexture(): CanvasTexture | null {
  const size = FACADE.textureSize;
  const context = createCanvas(size, size);
  if (!context) return null;

  const cols = FACADE.baysPerTile;
  const rows = FACADE.floorsPerTile;
  const cellW = size / cols;
  const cellH = size / rows;
  // A different seed from the facade, so which windows are lit is unrelated to
  // which ones have their blinds down.
  const random = makeRandom(0x11ee7);

  context.fillStyle = '#000000';
  context.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const roll = random();
      const warm = random();
      const dim = random();
      if (roll > FACADE.windowLitChance) continue; // an unlit office

      const x = col * cellW;
      const y = row * cellH;
      // Inset well inside the pane: the light is a room glowing through glass,
      // not the whole window turned into a lamp.
      const winX = x + cellW * 0.24;
      const winW = cellW * 0.54;
      const winY = y + cellH * 0.24;
      const winH = cellH * 0.44;

      // Warm office light, a cooler cast in a few units, never quite uniform.
      const level = 0.55 + dim * 0.45;
      const glow = context.createLinearGradient(0, winY, 0, winY + winH);
      if (warm > 0.82) {
        glow.addColorStop(0, `rgba(190, 214, 255, ${level})`);
        glow.addColorStop(1, `rgba(130, 158, 205, ${level * 0.7})`);
      } else {
        glow.addColorStop(0, `rgba(255, 214, 150, ${level})`);
        glow.addColorStop(1, `rgba(214, 165, 95, ${level * 0.7})`);
      }
      context.fillStyle = glow;
      context.fillRect(winX, winY, winW, winH);

      // A dark mullion keeps it reading as panes rather than one bright slab.
      context.fillStyle = '#000000';
      context.fillRect(winX + winW / 2 - 1, winY, 2, winH);
    }
  }

  const texture = new CanvasTexture(context.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/* -------------------------------------------------------------------------- */
/* Podium: the shopfront storey                                                */
/* -------------------------------------------------------------------------- */

/**
 * The base of every building, mapped 0..1 vertically over `podiumHeight` and
 * repeated horizontally. A dark signage band at the top, full-height shop
 * glazing below, and a kick plate at pavement level.
 */
export function createPodiumTexture(): CanvasTexture | null {
  const width = FACADE.podiumTextureWidth;
  const height = FACADE.podiumTextureHeight;
  const context = createCanvas(width, height);
  if (!context) return null;

  context.fillStyle = '#dedcd8';
  context.fillRect(0, 0, width, height);

  // Canvas y = 0 is the *top* of the podium once the texture is flipped, which
  // is where the signage band belongs.
  const bandH = height * 0.2;
  context.fillStyle = '#3a3d44';
  context.fillRect(0, 0, width, bandH);
  context.fillStyle = 'rgba(255,255,255,0.14)';
  context.fillRect(0, bandH - 4, width, 4);

  // Shopfront glazing.
  const glassTop = bandH + height * 0.04;
  const glassBottom = height * 0.9;
  const glass = context.createLinearGradient(0, glassTop, 0, glassBottom);
  glass.addColorStop(0, '#4d5964');
  glass.addColorStop(0.55, '#2b333d');
  glass.addColorStop(1, '#3b444e');
  context.fillStyle = glass;
  context.fillRect(width * 0.06, glassTop, width * 0.88, glassBottom - glassTop);

  // Frames: one central mullion plus the surround.
  context.strokeStyle = '#cbc9c5';
  context.lineWidth = 5;
  context.strokeRect(width * 0.06, glassTop, width * 0.88, glassBottom - glassTop);
  context.beginPath();
  context.moveTo(width * 0.5, glassTop);
  context.lineTo(width * 0.5, glassBottom);
  context.stroke();

  // Interior glow, so shops do not read as black holes at street level.
  context.fillStyle = 'rgba(255, 236, 200, 0.14)';
  context.fillRect(width * 0.1, glassTop + 8, width * 0.8, (glassBottom - glassTop) * 0.34);

  // Kick plate / pavement line.
  context.fillStyle = '#9d9b97';
  context.fillRect(0, glassBottom, width, height - glassBottom);
  context.fillStyle = 'rgba(40,42,46,0.45)';
  context.fillRect(0, height - 6, width, 6);

  const texture = new CanvasTexture(context.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}
