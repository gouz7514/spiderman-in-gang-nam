import { useEffect, useState } from 'react';

/**
 * The player's uploaded face photo, and where it is cropped.
 *
 * The photo is kept as a data URL so it survives a reload through
 * localStorage, exactly like the hero preference it replaces. Everything here
 * is deliberately plain data: `Hero` and the title-screen preview both render
 * it through the same `drawFace` in `faceTexture.ts`, so what the player lines
 * up on the title card is what the avatar wears.
 */
export interface FaceCrop {
  /**
   * Crop centre, as a fraction of the source image's *short* side, measured
   * from the middle. 0 is centred; the range that keeps the crop inside the
   * image depends on the aspect ratio and is clamped when drawing.
   */
  offsetX: number;
  offsetY: number;
  /** 1 = the crop square spans the whole short side. Larger zooms in. */
  zoom: number;
}

export interface CustomFace extends FaceCrop {
  /** JPEG data URL, already resampled down to {@link MAX_SOURCE_SIZE}. */
  src: string;
}

export const DEFAULT_CROP: FaceCrop = { offsetX: 0, offsetY: 0, zoom: 1 };

/** Longest side kept when re-encoding an upload. Keeps localStorage well under quota. */
const MAX_SOURCE_SIZE = 512;
const JPEG_QUALITY = 0.85;

const STORAGE_KEY = 'city-spidy:face';

export function loadCustomFace(): CustomFace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const face = JSON.parse(raw) as Partial<CustomFace>;
    if (typeof face?.src !== 'string' || !face.src.startsWith('data:image/')) return null;
    return {
      src: face.src,
      offsetX: Number(face.offsetX) || 0,
      offsetY: Number(face.offsetY) || 0,
      zoom: Number(face.zoom) || 1,
    };
  } catch {
    return null;
  }
}

export function saveCustomFace(face: CustomFace | null): void {
  try {
    if (face) localStorage.setItem(STORAGE_KEY, JSON.stringify(face));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode or over quota — the face just will not persist */
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
    image.src = src;
  });
}

/**
 * Reads a picked file and re-encodes it down to {@link MAX_SOURCE_SIZE} on its
 * longest side. The aspect ratio is preserved — squashing to a square here
 * would distort the face before the player ever got to crop it.
 */
export async function readImageFile(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsDataURL(file);
  });

  const image = await loadImage(original);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= MAX_SOURCE_SIZE) return original;

  const scale = MAX_SOURCE_SIZE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) return original;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * Decodes a face's data URL once, so the avatar and the title-screen preview
 * share a single `HTMLImageElement` rather than each decoding their own.
 */
export function useFaceImage(src: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    loadImage(src)
      .then((image) => {
        if (!cancelled) setLoaded({ src, image });
      })
      .catch(() => {
        /* a corrupt or oversized data URL — the default face stands in */
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Derived rather than stored, so a new photo never shows the previous one for
  // a frame while it decodes.
  return loaded && loaded.src === src ? loaded.image : null;
}
