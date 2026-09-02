import { BufferAttribute, BufferGeometry, CanvasTexture, Color, LinearFilter, SRGBColorSpace } from 'three';
import { ENTRANCES } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import type { LocalPoint } from '../osm/coordinates';
import type { CityData, SubwayEntrance } from '../osm/types';

/**
 * Gangnam Station's street entrances, built from `railway=subway_entrance`.
 *
 * OSM carries all twelve with their real `ref` numbers and positions, so exit 11
 * comes out on the corner exit 11 is actually on. Each one is a walled stairwell
 * with a numbered totem beside it — the shape you navigate by at street level.
 *
 * The stair opening is drawn as a dark inset panel a few centimetres *above*
 * the pavement rather than as a real hole: the ground is a single opaque plane
 * with nothing below it, so anything sunk under it would simply be hidden.
 */

export interface SubwayEntranceGeometry {
  /** Walls, totems and the stair opening — one vertex-coloured mesh. */
  structure: BufferGeometry | null;
  /** Exit-number panels, sharing one canvas atlas. */
  signs: BufferGeometry | null;
  signTexture: CanvasTexture | null;
  /** Triangle soup for a static collider, so the railings are solid. */
  collider: { vertices: Float32Array; indices: Uint32Array };
  count: number;
  dispose: () => void;
}

const EMPTY: SubwayEntranceGeometry = {
  structure: null,
  signs: null,
  signTexture: null,
  collider: { vertices: new Float32Array(0), indices: new Uint32Array(0) },
  count: 0,
  dispose: () => undefined,
};

/* -------------------------------------------------------------------------- */
/* Emitters                                                                    */
/* -------------------------------------------------------------------------- */

interface Surface {
  position: number[];
  normal: number[];
  color: number[];
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

function emitQuad(surface: Surface, a: Point3, b: Point3, c: Point3, d: Point3, color: Color): void {
  const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  let nx = e1.y * e2.z - e1.z * e2.y;
  let ny = e1.z * e2.x - e1.x * e2.z;
  let nz = e1.x * e2.y - e1.y * e2.x;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-9) return;
  nx /= length;
  ny /= length;
  nz /= length;

  for (const p of [a, b, c, a, c, d]) {
    surface.position.push(p.x, p.y, p.z);
    surface.normal.push(nx, ny, nz);
    surface.color.push(color.r, color.g, color.b);
  }
}

/**
 * A box in the entrance's own frame: `u` runs along the stair, `v` across it.
 * `origin` is the entrance's position and `(ux, uz)` its forward direction.
 */
interface Frame {
  origin: LocalPoint;
  ux: number;
  uz: number;
}

function place(frame: Frame, u: number, v: number, y: number): Point3 {
  return {
    x: frame.origin.x + frame.ux * u - frame.uz * v,
    y,
    z: frame.origin.z + frame.uz * u + frame.ux * v,
  };
}

/** An axis-aligned box in frame space, without its underside. */
function emitBox(
  surface: Surface,
  frame: Frame,
  u0: number, u1: number,
  v0: number, v1: number,
  y0: number, y1: number,
  color: Color,
): void {
  const a = place(frame, u0, v0, y0);
  const b = place(frame, u1, v0, y0);
  const c = place(frame, u1, v1, y0);
  const d = place(frame, u0, v1, y0);
  const e = place(frame, u0, v0, y1);
  const f = place(frame, u1, v0, y1);
  const g = place(frame, u1, v1, y1);
  const h = place(frame, u0, v1, y1);

  emitQuad(surface, e, f, g, h, color); // top
  emitQuad(surface, a, b, f, e, color);
  emitQuad(surface, b, c, g, f, color);
  emitQuad(surface, c, d, h, g, color);
  emitQuad(surface, d, a, e, h, color);
}

/** A horizontal panel in frame space. */
function emitPanel(
  surface: Surface,
  frame: Frame,
  u0: number, u1: number,
  v0: number, v1: number,
  y: number,
  color: Color,
): void {
  emitQuad(
    surface,
    place(frame, u0, v0, y),
    place(frame, u1, v0, y),
    place(frame, u1, v1, y),
    place(frame, u0, v1, y),
    color,
  );
}

/* -------------------------------------------------------------------------- */
/* Sign atlas                                                                  */
/* -------------------------------------------------------------------------- */

const FONT_STACK =
  "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

/** Seoul Metro Line 2, which is the line Gangnam Station is on. */
const LINE_COLOUR = '#00a84d';

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/** Direction of the nearest road, so an entrance lines up with its pavement. */
function nearestRoadDirection(city: CityData, point: LocalPoint): { ux: number; uz: number } {
  let best = Infinity;
  let ux = 1;
  let uz = 0;

  for (const road of city.roads) {
    if (road.crossing) continue;
    const points = road.points.map(latLonToLocal);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-6) continue;
      const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
      const distance = Math.hypot(a.x + dx * t - point.x, a.z + dz * t - point.z);
      if (distance < best) {
        best = distance;
        const length = Math.sqrt(lengthSq);
        ux = dx / length;
        uz = dz / length;
      }
    }
  }

  return { ux, uz };
}

export function buildSubwayEntrances(city: CityData): SubwayEntranceGeometry {
  if (typeof document === 'undefined' || city.entrances.length === 0) return EMPTY;

  const structure: Surface = { position: [], normal: [], color: [] };
  const signPositions: number[] = [];
  const signUvs: number[] = [];

  const columns = Math.max(1, Math.floor(ENTRANCES.atlasWidth / ENTRANCES.cellWidth));
  const canvas = document.createElement('canvas');
  canvas.width = ENTRANCES.atlasWidth;
  canvas.height = ENTRANCES.atlasHeight;
  const context = canvas.getContext('2d');
  if (!context) return EMPTY;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const railing = new Color(ENTRANCES.railingColor).convertSRGBToLinear();
  const totem = new Color(ENTRANCES.totemColor).convertSRGBToLinear();
  const mouth = new Color(ENTRANCES.mouthColor).convertSRGBToLinear();
  const tread = new Color(ENTRANCES.treadColor).convertSRGBToLinear();

  const {
    halfLength: L,
    halfWidth: W,
    wallHeight: H,
    wallThickness: T,
    totemHeight,
    totemSize,
  } = ENTRANCES;

  let placed = 0;

  for (const entrance of city.entrances as SubwayEntrance[]) {
    if (placed >= columns * Math.floor(ENTRANCES.atlasHeight / ENTRANCES.cellHeight)) break;

    const origin = latLonToLocal(entrance.position);
    const { ux, uz } = nearestRoadDirection(city, origin);
    const frame: Frame = { origin, ux, uz };

    /* Stairwell: walls down both sides and across the back, open at the front. */
    emitBox(structure, frame, -L, L, W - T, W, 0, H, railing);
    emitBox(structure, frame, -L, L, -W, -W + T, 0, H, railing);
    emitBox(structure, frame, -L, -L + T, -W, W, 0, H, railing);

    /* The opening, plus a few treads so it reads as stairs from above. */
    emitPanel(structure, frame, -L + T, L, -W + T, W - T, ENTRANCES.mouthY, mouth);
    const runStart = -L + T + 0.25;
    const runEnd = L - 0.25;
    for (let i = 0; i < ENTRANCES.treadCount; i++) {
      const u = runStart + ((runEnd - runStart) * i) / (ENTRANCES.treadCount - 1);
      emitPanel(
        structure, frame,
        u, u + ENTRANCES.treadWidth,
        -W + T + 0.1, W - T - 0.1,
        ENTRANCES.mouthY + 0.008,
        tread,
      );
    }

    /* Totem beside the mouth, carrying the exit number. */
    const totemU = L - totemSize;
    const totemV = W + ENTRANCES.totemOffset;
    emitBox(structure, frame, totemU, totemU + totemSize, totemV, totemV + totemSize, 0, totemHeight, totem);

    /* Atlas cell for this exit. */
    const column = placed % columns;
    const row = Math.floor(placed / columns);
    const cellX = column * ENTRANCES.cellWidth;
    const cellY = row * ENTRANCES.cellHeight;

    context.fillStyle = ENTRANCES.totemColor;
    context.fillRect(cellX, cellY, ENTRANCES.cellWidth, ENTRANCES.cellHeight);
    context.fillStyle = LINE_COLOUR;
    context.fillRect(cellX, cellY, ENTRANCES.cellWidth, ENTRANCES.cellHeight * 0.16);
    context.fillStyle = '#ffffff';
    context.font = `600 ${Math.round(ENTRANCES.cellHeight * 0.18)}px ${FONT_STACK}`;
    context.fillText('강남역', cellX + ENTRANCES.cellWidth / 2, cellY + ENTRANCES.cellHeight * 0.34);
    context.font = `800 ${Math.round(ENTRANCES.cellHeight * 0.34)}px ${FONT_STACK}`;
    context.fillText(
      entrance.ref ? `${entrance.ref}번출구` : '출구',
      cellX + ENTRANCES.cellWidth / 2,
      cellY + ENTRANCES.cellHeight * 0.68,
    );

    const insetU = 0.5 / ENTRANCES.atlasWidth;
    const insetV = 0.5 / ENTRANCES.atlasHeight;
    const u0 = cellX / ENTRANCES.atlasWidth + insetU;
    const u1 = (cellX + ENTRANCES.cellWidth) / ENTRANCES.atlasWidth - insetU;
    // CanvasTexture flips Y, so canvas row 0 is v = 1.
    const vTop = 1 - cellY / ENTRANCES.atlasHeight - insetV;
    const vBottom = 1 - (cellY + ENTRANCES.cellHeight) / ENTRANCES.atlasHeight + insetV;

    /* A panel on each broad face of the totem, readable from both directions. */
    const panelY0 = ENTRANCES.signBottom;
    const panelY1 = ENTRANCES.signBottom + ENTRANCES.signHeight;
    const stand = 0.012;
    for (const side of [1, -1]) {
      const v = side > 0 ? totemV + totemSize + stand : totemV - stand;
      // Wind so the face looks outward along `side`.
      const a = place(frame, side > 0 ? totemU : totemU + totemSize, v, panelY0);
      const b = place(frame, side > 0 ? totemU + totemSize : totemU, v, panelY0);
      const c = place(frame, side > 0 ? totemU + totemSize : totemU, v, panelY1);
      const d = place(frame, side > 0 ? totemU : totemU + totemSize, v, panelY1);
      for (const p of [a, b, c, a, c, d]) signPositions.push(p.x, p.y, p.z);
      signUvs.push(u0, vBottom, u1, vBottom, u1, vTop, u0, vBottom, u1, vTop, u0, vTop);
    }

    placed += 1;
  }

  if (placed === 0) return EMPTY;

  const structureGeometry = new BufferGeometry();
  structureGeometry.setAttribute('position', new BufferAttribute(new Float32Array(structure.position), 3));
  structureGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(structure.normal), 3));
  structureGeometry.setAttribute('color', new BufferAttribute(new Float32Array(structure.color), 3));

  const signGeometry = new BufferGeometry();
  signGeometry.setAttribute('position', new BufferAttribute(new Float32Array(signPositions), 3));
  signGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(signUvs), 2));
  signGeometry.computeVertexNormals();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;

  const vertices = new Float32Array(structure.position);
  const indices = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;

  return {
    structure: structureGeometry,
    signs: signGeometry,
    signTexture: texture,
    collider: { vertices, indices },
    count: placed,
    dispose: () => {
      structureGeometry.dispose();
      signGeometry.dispose();
      texture.dispose();
    },
  };
}
