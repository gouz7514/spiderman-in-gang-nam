import { MINIMAP } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import type { CityData } from '../osm/types';

/**
 * The minimap's base image.
 *
 * The whole city is drawn once, top-down, into an offscreen canvas at load
 * time. Every frame the HUD then blits a rotated crop of it, which costs one
 * `drawImage` rather than any per-frame geometry work — and keeps the minimap
 * completely independent of the 3D scene.
 *
 * World `(0, 0)` sits at the centre of the image, and one world metre is
 * `pixelsPerMetre` image pixels.
 */
export interface MinimapImage {
  canvas: HTMLCanvasElement;
  pixelsPerMetre: number;
  /** The image is square; this is its side in pixels. */
  size: number;
}

/** Buildings are shaded by height, so the towers worth swinging to stand out. */
function buildingShade(height: number): string {
  const t = Math.min(height / 120, 1);
  const r = Math.round(42 + t * 92);
  const g = Math.round(50 + t * 96);
  const b = Math.round(66 + t * 100);
  return `rgb(${r},${g},${b})`;
}

export function buildMinimap(city: CityData): MinimapImage | null {
  if (typeof document === 'undefined') return null;

  const pixelsPerMetre = MINIMAP.pixelsPerMetre;
  const size = Math.round(MINIMAP.coverage * 2 * pixelsPerMetre);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const half = size / 2;
  /** World metres -> image pixels. */
  const px = (x: number) => half + x * pixelsPerMetre;
  const py = (z: number) => half + z * pixelsPerMetre;

  context.fillStyle = '#0d1119';
  context.fillRect(0, 0, size, size);

  /* Roads first: they run between the blocks, so buildings sit on top. */
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const road of city.roads) {
    if (road.crossing) continue;
    const points = road.points.map(latLonToLocal);
    if (points.length < 2) continue;

    context.strokeStyle = road.footpath ? '#252c39' : '#454f61';
    context.lineWidth = Math.max(1, road.width * pixelsPerMetre);
    context.beginPath();
    context.moveTo(px(points[0].x), py(points[0].z));
    for (let i = 1; i < points.length; i++) {
      context.lineTo(px(points[i].x), py(points[i].z));
    }
    context.stroke();
  }

  /* Building footprints, lightest where the city is tallest. */
  for (const building of city.buildings) {
    if (building.outer.length < 3) continue;
    const points = building.outer.map(latLonToLocal);

    context.beginPath();
    context.moveTo(px(points[0].x), py(points[0].z));
    for (let i = 1; i < points.length; i++) {
      context.lineTo(px(points[i].x), py(points[i].z));
    }
    context.closePath();
    context.fillStyle = buildingShade(building.height);
    context.fill();
  }

  return { canvas, pixelsPerMetre, size };
}
