import { CanvasTexture, SRGBColorSpace } from 'three';
import { HERO } from '../config';
import type { FaceCrop } from './customFace';

/**
 * The head, baked as one equirectangular wrap of the sphere.
 *
 * Drawing the web this way is the whole trick: a sphere's own longitude lines
 * radiate from the crown and its latitude lines ring it, so a plain grid on
 * this canvas lands on the head as radials and orbitals with no projection
 * maths — and the orbitals only need sagging between radials to read as spun
 * web rather than as a globe's graticule.
 *
 * The body carries none of this. Torso and limbs are flat `HERO.suit`, so this
 * wrap is the head's alone.
 *
 * The mask goes on the same canvas rather than on a separate decal, so there is
 * no seam to hide and the web keeps running across the face exactly as it does
 * on the real mask. An uploaded photo takes the lenses' place.
 */

/** Fraction of the face square left clear around an uploaded photo. */
const PHOTO_INSET = 0.02;
/** A photo is untouched inside this radius and fully faded out by this one. */
const FADE_START = 0.38;
const FADE_END = 0.5;

/** Where the crop square lands in source-image pixels, clamped to the image. */
function cropRect(image: HTMLImageElement, crop: FaceCrop) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const short = Math.min(width, height);
  const size = short / Math.max(crop.zoom, 0.2);
  const x = width / 2 + crop.offsetX * short - size / 2;
  const y = height / 2 + crop.offsetY * short - size / 2;
  return {
    size,
    x: Math.max(0, Math.min(width - size, x)),
    y: Math.max(0, Math.min(height - size, y)),
  };
}

/**
 * One mask lens: a teardrop with a point at the inner corner, a long sweep out
 * over the brow, and a fat round outer edge.
 */
function lensPath(context: CanvasRenderingContext2D, size: number, mirrored: boolean): void {
  const x = (t: number) => (mirrored ? 1 - t : t) * size;
  const y = (t: number) => t * size;
  context.beginPath();
  // The mirrored lens maps t to 1 - t, so *every* coordinate here must stay
  // above 0.5: a t below it lands past the centre line once mirrored, and the
  // two lenses merge into a single smear. Larger t = further from the nose.
  context.moveTo(x(0.56), y(0.56));
  context.bezierCurveTo(x(0.61), y(0.34), x(0.74), y(0.27), x(0.86), y(0.32));
  context.bezierCurveTo(x(0.95), y(0.37), x(0.96), y(0.52), x(0.88), y(0.6));
  context.bezierCurveTo(x(0.78), y(0.67), x(0.64), y(0.65), x(0.56), y(0.56));
  context.closePath();
}

/**
 * Paints the face onto a *transparent* square of side `size`: the mask lenses,
 * or an uploaded photo in their place. Transparent because this is composited
 * over the suit, which supplies the red and the web behind it.
 *
 * Shared with the title screen's preview, which is what makes the crop the
 * player lines up there identical to the one they wear in the city.
 */
export function drawFace(
  context: CanvasRenderingContext2D,
  size: number,
  image: HTMLImageElement | null,
  crop: FaceCrop,
): void {
  context.clearRect(0, 0, size, size);

  if (!image) {
    context.fillStyle = HERO.lens;
    context.strokeStyle = HERO.ink;
    context.lineWidth = size * 0.045;
    context.lineJoin = 'round';
    for (const mirrored of [false, true]) {
      lensPath(context, size, mirrored);
      context.fill();
      context.stroke();
    }
    return;
  }

  const inset = size * PHOTO_INSET;
  const span = size - inset * 2;
  const rect = cropRect(image, crop);

  context.save();
  context.beginPath();
  context.ellipse(size / 2, size / 2, span / 2, span / 2, 0, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, inset, inset, span, span);

  // Fade the photo's edge to nothing, so the suit shows through around it
  // instead of the photo sitting on the mask as a hard disc.
  const fade = context.createRadialGradient(
    size / 2,
    size / 2,
    size * FADE_START,
    size / 2,
    size / 2,
    size * FADE_END,
  );
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = fade;
  context.fillRect(0, 0, size, size);
  context.restore();
}

/** The mask's ground colour and the web spun over it. */
function drawSuit(context: CanvasRenderingContext2D, width: number, height: number): void {
  const { webRadials, webOrbitals } = HERO;

  context.fillStyle = HERO.suitRed;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = HERO.ink;
  context.lineCap = 'round';

  // Radials: the sphere's longitude lines, so they meet at the crown.
  context.lineWidth = Math.max(1.5, width * 0.0035);
  for (let i = 0; i < webRadials; i++) {
    const x = ((i + 0.5) / webRadials) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  // Orbitals: latitude rings, sagging between each pair of radials the way a
  // spun web does. Straight lines here would read as a globe, not a web.
  context.lineWidth = Math.max(1.2, width * 0.003);
  const step = width / webRadials;
  for (let j = 1; j <= webOrbitals; j++) {
    const y = (j / (webOrbitals + 1)) * height;
    const sag = step * 0.22;
    context.beginPath();
    context.moveTo(0, y);
    for (let i = 0; i < webRadials; i++) {
      const from = (i - 0.5) * step + step;
      context.quadraticCurveTo(from - step / 2, y + sag, from, y);
    }
    context.stroke();
  }
}

export interface SuitRender {
  texture: CanvasTexture | null;
}

/**
 * Bakes the mask into a `CanvasTexture` for the head sphere. Returns a null
 * texture without a DOM, matching `facadeTextures.ts` and `roadTextures.ts` so
 * the module stays runnable in plain node.
 */
export function createHeadTexture(image: HTMLImageElement | null, crop: FaceCrop): SuitRender {
  if (typeof document === 'undefined') return { texture: null };

  const width = HERO.suitTextureWidth;
  const height = HERO.suitTextureHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return { texture: null };

  drawSuit(context, width, height);

  // The face square, composited at u = 0.75 — the sphere's -Z, which is the
  // character's front.
  const faceSize = HERO.faceTextureSize;
  const face = document.createElement('canvas');
  face.width = faceSize;
  face.height = faceSize;
  const faceContext = face.getContext('2d');
  if (faceContext) {
    drawFace(faceContext, faceSize, image, crop);
    const spanU = (HERO.faceSpanDegrees / 360) * width;
    const spanV = (HERO.faceSpanDegrees / 180) * height;
    context.drawImage(
      face,
      0.75 * width - spanU / 2,
      (1 - HERO.faceCentreV) * height - spanV / 2,
      spanU,
      spanV,
    );
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture };
}
