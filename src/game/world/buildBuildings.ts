import { BufferAttribute, BufferGeometry, Color, SRGBColorSpace, ShapeUtils, Vector2 } from 'three';
import { BUILDINGS, FACADE } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import { hashUnit } from '../osm/parseBuildings';
import type { BuildingFootprint, Ring } from '../osm/types';

/**
 * Building surfaces.
 *
 * Rather than extruding each footprint with `ExtrudeGeometry`, every face is
 * emitted by hand. That costs a little code and buys three things a plain
 * extrusion cannot give:
 *
 *  1. **Real UVs.** `u` follows the distance along each wall and `v` follows
 *     absolute height, so the window texture keeps a constant bay width however
 *     long the facade is, and floor lines run level across neighbouring
 *     buildings instead of stretching to fit each box.
 *  2. **A separate shopfront band.** The bottom few metres go into their own
 *     buffer with their own texture, which is what stops a tower from looking
 *     like a filing cabinet standing directly on the tarmac.
 *  3. **Roofs that are roofs.** A recessed deck behind a parapet, with water
 *     tanks and plant on top. This game is played from above, so the roof is
 *     the surface the player actually looks at most.
 *
 * It is also *cheaper*: the invisible floor cap an extrusion always generates is
 * simply never emitted.
 *
 * Output is split by material — textured facade, textured podium, untextured
 * roof — so the whole city is still only three draw calls.
 */

export interface BuildingBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxHeight: number;
}

export interface BuildingSurfaces {
  facade: BufferGeometry | null;
  podium: BufferGeometry | null;
  roof: BufferGeometry | null;
  edges: BufferGeometry;
  bounds: BuildingBounds;
  buildingCount: number;
  triangleCount: number;
  collider: { vertices: Float32Array; indices: Uint32Array };
  dispose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Accumulators                                                                */
/* -------------------------------------------------------------------------- */

interface Surface {
  position: number[];
  normal: number[];
  uv: number[] | null;
  color: number[];
}

function createSurface(textured: boolean): Surface {
  return { position: [], normal: [], uv: textured ? [] : null, color: [] };
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

const edgeA = { x: 0, y: 0, z: 0 };
const edgeB = { x: 0, y: 0, z: 0 };

/**
 * Emits a quad as two triangles, flat-shaded from its own winding.
 * `a -> b -> c -> d` must run counter-clockwise seen from the visible side.
 */
function emitQuad(
  surface: Surface,
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  color: Color,
  uvs?: [number, number][],
): void {
  edgeA.x = b.x - a.x;
  edgeA.y = b.y - a.y;
  edgeA.z = b.z - a.z;
  edgeB.x = c.x - a.x;
  edgeB.y = c.y - a.y;
  edgeB.z = c.z - a.z;

  let nx = edgeA.y * edgeB.z - edgeA.z * edgeB.y;
  let ny = edgeA.z * edgeB.x - edgeA.x * edgeB.z;
  let nz = edgeA.x * edgeB.y - edgeA.y * edgeB.x;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-9) return;
  nx /= length;
  ny /= length;
  nz /= length;

  const corners = [a, b, c, a, c, d];
  const uvOrder = uvs ? [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]] : null;

  for (let i = 0; i < 6; i++) {
    const p = corners[i];
    surface.position.push(p.x, p.y, p.z);
    surface.normal.push(nx, ny, nz);
    surface.color.push(color.r, color.g, color.b);
    if (surface.uv && uvOrder) surface.uv.push(uvOrder[i][0], uvOrder[i][1]);
  }
}

function emitTriangle(
  surface: Surface,
  a: Point3,
  b: Point3,
  c: Point3,
  nx: number,
  ny: number,
  nz: number,
  color: Color,
): void {
  for (const p of [a, b, c]) {
    surface.position.push(p.x, p.y, p.z);
    surface.normal.push(nx, ny, nz);
    surface.color.push(color.r, color.g, color.b);
  }
}

function toGeometry(surface: Surface): BufferGeometry | null {
  if (surface.position.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(surface.position), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(surface.normal), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(surface.color), 3));
  if (surface.uv) {
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(surface.uv), 2));
  }
  return geometry;
}

/* -------------------------------------------------------------------------- */
/* Rings                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Footprints are handled in a 2D "shape space" of `(x, -z)` so that Earcut's
 * counter-clockwise convention lines up with the world. Mapping back is
 * `world = (u, y, -v)`.
 */
function ringToShape(ring: Ring): Vector2[] {
  const points: Vector2[] = [];
  for (const coordinate of ring) {
    const { x, z } = latLonToLocal(coordinate);
    const point = new Vector2(x, -z);
    const previous = points[points.length - 1];
    // Repeated vertices triangulate into zero-area faces that Rapier rejects.
    if (previous && previous.distanceToSquared(point) < 1e-6) continue;
    points.push(point);
  }
  while (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 1e-6) {
    points.pop();
  }
  return points;
}

/** Positive when the ring winds counter-clockwise. */
function signedArea(points: Vector2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return area / 2;
}

/**
 * Shrinks a ring inwards by `amount` using mitred joins.
 *
 * @returns null when the inset would collapse or invert the outline, which is
 * the guard that keeps narrow or awkward footprints from turning inside out.
 */
function insetRing(points: Vector2[], amount: number): Vector2[] | null {
  const count = points.length;
  if (count < 3) return null;
  const result: Vector2[] = [];

  for (let i = 0; i < count; i++) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];

    const d1x = current.x - previous.x;
    const d1y = current.y - previous.y;
    const l1 = Math.hypot(d1x, d1y) || 1;
    const d2x = next.x - current.x;
    const d2y = next.y - current.y;
    const l2 = Math.hypot(d2x, d2y) || 1;

    // Inward normal of a counter-clockwise ring is to the left of travel.
    const n1x = -d1y / l1;
    const n1y = d1x / l1;
    const n2x = -d2y / l2;
    const n2y = d2x / l2;

    let mx = n1x + n2x;
    let my = n1y + n2y;
    const length = Math.hypot(mx, my);
    if (length < 1e-6) {
      mx = n2x;
      my = n2y;
    } else {
      mx /= length;
      my /= length;
    }

    const scale = amount / Math.max(0.4, mx * n2x + my * n2y);
    result.push(new Vector2(current.x + mx * scale, current.y + my * scale));
  }

  const original = signedArea(points);
  const shrunk = signedArea(result);
  if (shrunk <= 0 || shrunk < original * 0.3) return null;
  return result;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                      */
/* -------------------------------------------------------------------------- */

const scratchColor = new Color();
const podiumColor = new Color();
const roofColor = new Color();
const partColor = new Color();

/** Neutral stone tone the podium is blended towards. */
const PODIUM_STONE = new Color().setHSL(0.09, 0.05, 0.42, SRGBColorSpace);

function buildingBaseColor(id: string, height: number, target: Color): Color {
  const warm = hashUnit(id, 3) < 0.16;
  const hue = warm ? 0.075 + hashUnit(id, 4) * 0.03 : 0.55 + hashUnit(id, 4) * 0.08;
  const saturation = warm ? 0.13 + hashUnit(id, 5) * 0.07 : 0.03 + hashUnit(id, 5) * 0.08;
  const heightLift = Math.min(height / 160, 1) * 0.1;
  const lightness = 0.45 + hashUnit(id, 6) * 0.2 + heightLift;
  return target.setHSL(hue, saturation, lightness, SRGBColorSpace);
}

const ROOF_GREENS = [
  new Color().setHSL(0.42, 0.46, 0.3, SRGBColorSpace),
  new Color().setHSL(0.4, 0.4, 0.35, SRGBColorSpace),
  new Color().setHSL(0.45, 0.52, 0.27, SRGBColorSpace),
  new Color().setHSL(0.36, 0.38, 0.33, SRGBColorSpace),
];
const ROOF_CONCRETE = new Color().setHSL(0.6, 0.05, 0.34, SRGBColorSpace);
const ROOF_TERRACOTTA = new Color().setHSL(0.045, 0.34, 0.32, SRGBColorSpace);
const ROOF_TOWER = new Color().setHSL(0.6, 0.05, 0.24, SRGBColorSpace);
const PARAPET = new Color().setHSL(0.09, 0.04, 0.52, SRGBColorSpace);

/**
 * Korean low-rise roofs are painted with green urethane waterproofing, which is
 * the most recognisable thing about the city from the air. Towers get a grey
 * mechanical deck instead.
 */
function pickRoofColor(id: string, height: number, target: Color): Color {
  if (height > BUILDINGS.greenRoofMaxHeight) return target.copy(ROOF_TOWER);

  const roll = hashUnit(id, 7);
  if (roll < BUILDINGS.greenRoofChance) {
    target.copy(ROOF_GREENS[Math.floor(hashUnit(id, 8) * ROOF_GREENS.length) % ROOF_GREENS.length]);
  } else if (roll < BUILDINGS.greenRoofChance + 0.13) {
    target.copy(ROOF_CONCRETE);
  } else {
    target.copy(ROOF_TERRACOTTA);
  }
  return target.multiplyScalar(0.82 + hashUnit(id, 9) * 0.36);
}

/* -------------------------------------------------------------------------- */
/* Rooftop clutter                                                             */
/* -------------------------------------------------------------------------- */

const CLUTTER_COLORS = [
  new Color().setHSL(0.09, 0.08, 0.72, SRGBColorSpace), // water tank
  new Color().setHSL(0.58, 0.04, 0.55, SRGBColorSpace), // plant / aircon
  new Color().setHSL(0.05, 0.22, 0.44, SRGBColorSpace), // rusted steel
];

function pointInRing(points: Vector2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const yi = points[i].y;
    const yj = points[j].y;
    if (
      yi > y !== yj > y &&
      x < ((points[j].x - points[i].x) * (y - yi)) / (yj - yi) + points[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** An axis-aligned box with no bottom face — nothing ever sees underneath. */
function emitBox(
  surface: Surface,
  cx: number,
  cz: number,
  baseY: number,
  halfX: number,
  halfZ: number,
  height: number,
  color: Color,
): void {
  const x0 = cx - halfX;
  const x1 = cx + halfX;
  const z0 = cz - halfZ;
  const z1 = cz + halfZ;
  const y0 = baseY;
  const y1 = baseY + height;

  emitQuad(surface,
    { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 },
    { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }, color);
  emitQuad(surface,
    { x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z0 },
    { x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, color);
  emitQuad(surface,
    { x: x1, y: y0, z: z1 }, { x: x1, y: y0, z: z0 },
    { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, color);
  emitQuad(surface,
    { x: x0, y: y0, z: z0 }, { x: x0, y: y0, z: z1 },
    { x: x0, y: y1, z: z1 }, { x: x0, y: y1, z: z0 }, color);
  emitQuad(surface,
    { x: x0, y: y1, z: z1 }, { x: x1, y: y1, z: z1 },
    { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 }, color);
}

/**
 * Water tanks, aircon plant and rooftop huts.
 *
 * Low-rise only: this is 옥탑 clutter, and a glass tower has a screened
 * mechanical penthouse rather than a blue water tank. It is allowed to stand
 * proud of the parapet, because in reality it does.
 */
function emitRoofClutter(
  surface: Surface,
  id: string,
  deck: Vector2[],
  area: number,
  y: number,
  buildingHeight: number,
): void {
  if (buildingHeight > BUILDINGS.greenRoofMaxHeight) return;
  if (area < FACADE.clutterMinRoofArea) return;
  if (hashUnit(id, 20) > FACADE.clutterChance) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of deck) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  const count = 1 + Math.floor(hashUnit(id, 21) * FACADE.clutterMaxPerRoof);
  for (let i = 0; i < count; i++) {
    const u = 0.15 + hashUnit(id, 30 + i * 4) * 0.7;
    const v = 0.15 + hashUnit(id, 31 + i * 4) * 0.7;
    const sx = minX + (maxX - minX) * u;
    const sy = minY + (maxY - minY) * v;

    const halfX = 0.7 + hashUnit(id, 32 + i * 4) * 1.1;
    const halfZ = 0.7 + hashUnit(id, 33 + i * 4) * 1.1;
    // The whole footprint of the box has to land on the deck, corners included.
    if (
      !pointInRing(deck, sx, sy) ||
      !pointInRing(deck, sx + halfX, sy + halfZ) ||
      !pointInRing(deck, sx - halfX, sy - halfZ) ||
      !pointInRing(deck, sx + halfX, sy - halfZ) ||
      !pointInRing(deck, sx - halfX, sy + halfZ)
    ) {
      continue;
    }

    const tall = hashUnit(id, 34 + i * 4);
    partColor.copy(CLUTTER_COLORS[Math.floor(tall * CLUTTER_COLORS.length) % CLUTTER_COLORS.length]);
    // Shape space maps to world as (u, y, -v).
    emitBox(surface, sx, -sy, y, halfX, halfZ, 0.9 + tall * 1.6, partColor);
  }
}

/* -------------------------------------------------------------------------- */
/* One building                                                                */
/* -------------------------------------------------------------------------- */

const FACADE_TILE_W = FACADE.bayWidth * FACADE.baysPerTile;
const FACADE_TILE_H = FACADE.floorHeight * FACADE.floorsPerTile;

interface Surfaces {
  facade: Surface;
  podium: Surface;
  roof: Surface;
  edges: number[];
}

/**
 * Per-building offset into the facade tile.
 *
 * `u` shifts continuously, but `v` only ever shifts by whole floors, so floor
 * lines still run level across neighbouring buildings while the pattern of lit
 * windows differs between them. Without this every tower on a block lights the
 * same windows at the same heights, which is what makes a repeating tile
 * obvious at night.
 */
function facadePhase(id: string): { u: number; v: number } {
  return {
    u: hashUnit(id, 14),
    v: Math.round(hashUnit(id, 15) * FACADE.floorsPerTile) / FACADE.floorsPerTile,
  };
}

/** Emits every wall of one ring, split into a podium band and a facade band. */
function emitWalls(
  surfaces: Surfaces,
  ring: Vector2[],
  outward: number,
  base: number,
  podiumTop: number,
  top: number,
  facadeTint: Color,
  podiumTint: Color,
  phase: { u: number; v: number },
): void {
  const count = ring.length;

  for (let i = 0; i < count; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % count];
    // Shape (u, v) -> world (u, y, -v).
    const ax = p.x;
    const az = -p.y;
    const bx = q.x;
    const bz = -q.y;

    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) continue;

    const tx = dx / length;
    const tz = dz / length;

    // Projecting the world position onto the wall tangent keeps `u` continuous
    // across collinear segments, so a long facade does not restart its window
    // pattern at every OSM vertex.
    const ua = (ax * tx + az * tz) / FACADE_TILE_W + phase.u;
    const ub = (bx * tx + bz * tz) / FACADE_TILE_W + phase.u;
    const pa = (ax * tx + az * tz) / FACADE.podiumBayWidth;
    const pb = (bx * tx + bz * tz) / FACADE.podiumBayWidth;

    const flip = outward < 0;
    const a0 = { x: ax, y: base, z: az };
    const b0 = { x: bx, y: base, z: bz };

    if (podiumTop > base + 0.05) {
      const a1 = { x: ax, y: podiumTop, z: az };
      const b1 = { x: bx, y: podiumTop, z: bz };
      if (flip) {
        emitQuad(surfaces.podium, b0, a0, a1, b1, podiumTint,
          [[pb, 0], [pa, 0], [pa, 1], [pb, 1]]);
      } else {
        emitQuad(surfaces.podium, a0, b0, b1, a1, podiumTint,
          [[pa, 0], [pb, 0], [pb, 1], [pa, 1]]);
      }
    }

    if (top > podiumTop + 0.05) {
      const lower = Math.max(base, podiumTop);
      const c0 = { x: ax, y: lower, z: az };
      const d0 = { x: bx, y: lower, z: bz };
      const c1 = { x: ax, y: top, z: az };
      const d1 = { x: bx, y: top, z: bz };
      const v0 = lower / FACADE_TILE_H + phase.v;
      const v1 = top / FACADE_TILE_H + phase.v;
      if (flip) {
        emitQuad(surfaces.facade, d0, c0, c1, d1, facadeTint,
          [[ub, v0], [ua, v0], [ua, v1], [ub, v1]]);
      } else {
        emitQuad(surfaces.facade, c0, d0, d1, c1, facadeTint,
          [[ua, v0], [ub, v0], [ub, v1], [ua, v1]]);
      }
    }
  }
}

/** Triangulates a horizontal cap and emits it facing straight up. */
function emitDeck(
  surface: Surface,
  contour: Vector2[],
  holes: Vector2[][],
  y: number,
  color: Color,
): void {
  let faces: number[][];
  try {
    faces = ShapeUtils.triangulateShape(contour, holes);
  } catch {
    return;
  }
  if (faces.length === 0) return;

  const all = [...contour, ...holes.flat()];
  const world = (index: number): Point3 => ({ x: all[index].x, y, z: -all[index].y });

  // Decide the winding once: every face from one triangulation shares it.
  const first = faces[0];
  const f0 = world(first[0]);
  const f1 = world(first[1]);
  const f2 = world(first[2]);
  const upward =
    (f1.z - f0.z) * (f2.x - f0.x) - (f1.x - f0.x) * (f2.z - f0.z) > 0;

  for (const face of faces) {
    const a = world(face[0]);
    const b = world(face[1]);
    const c = world(face[2]);
    if (upward) emitTriangle(surface, a, b, c, 0, 1, 0, color);
    else emitTriangle(surface, a, c, b, 0, 1, 0, color);
  }
}

function buildOne(
  footprint: BuildingFootprint,
  surfaces: Surfaces,
  bounds: BuildingBounds,
): boolean {
  const outer = ringToShape(footprint.outer);
  if (outer.length < 3) return false;

  const area = signedArea(outer);
  if (Math.abs(area) < 6) return false;
  if (area < 0) outer.reverse();

  const holes: Vector2[][] = [];
  for (const hole of footprint.holes) {
    const points = ringToShape(hole);
    if (points.length < 3) continue;
    const holeArea = signedArea(points);
    if (Math.abs(holeArea) < 4) continue;
    if (holeArea > 0) points.reverse(); // holes wind the other way
    holes.push(points);
  }

  const base = footprint.minHeight;
  const top = footprint.height;
  if (top - base <= 0.1) return false;

  // The OSM height is the top of the parapet, not the roof deck, so the deck is
  // recessed *below* it rather than the parapet being stacked on top. Keeping
  // this the right way round matters: the deck is what the player lands on and
  // webs to, and buildings must not silently grow by the parapet height.
  const footprintArea = Math.abs(area);
  const walled = footprintArea >= FACADE.parapetMinArea && top - base > FACADE.parapetHeight + 1.5;
  const deckY = walled ? top - FACADE.parapetHeight : top;
  const podiumTop = Math.min(base + FACADE.podiumHeight, deckY);

  const facadeTint = buildingBaseColor(footprint.id, top, scratchColor);
  podiumColor.copy(facadeTint).lerp(PODIUM_STONE, 0.45);
  const deckColor = pickRoofColor(footprint.id, top, roofColor);

  const phase = facadePhase(footprint.id);
  emitWalls(surfaces, outer, 1, base, podiumTop, deckY, facadeTint, podiumColor, phase);
  for (const hole of holes) {
    emitWalls(surfaces, hole, -1, base, podiumTop, deckY, facadeTint, podiumColor, phase);
  }

  /* Roof: a deck recessed behind a parapet ------------------------------- */
  const inset = walled ? insetRing(outer, FACADE.parapetInset) : null;
  const parapetTop = top;

  if (inset) {
    partColor.copy(PARAPET).multiplyScalar(0.85 + hashUnit(footprint.id, 12) * 0.3);
    const count = outer.length;
    for (let i = 0; i < count; i++) {
      const p = outer[i];
      const q = outer[(i + 1) % count];
      const ip = inset[i];
      const iq = inset[(i + 1) % count];

      // Outer face of the parapet.
      emitQuad(surfaces.roof,
        { x: p.x, y: deckY, z: -p.y }, { x: q.x, y: deckY, z: -q.y },
        { x: q.x, y: parapetTop, z: -q.y }, { x: p.x, y: parapetTop, z: -p.y },
        partColor);
      // Coping running inwards and down to the deck.
      emitQuad(surfaces.roof,
        { x: p.x, y: parapetTop, z: -p.y }, { x: q.x, y: parapetTop, z: -q.y },
        { x: iq.x, y: deckY, z: -iq.y }, { x: ip.x, y: deckY, z: -ip.y },
        partColor);
    }
    emitDeck(surfaces.roof, inset, [], deckY, deckColor);
    emitRoofClutter(surfaces.roof, footprint.id, inset, footprintArea, deckY, top);
  } else {
    emitDeck(surfaces.roof, outer, holes, top, deckColor);
  }

  /* Outlines and bounds --------------------------------------------------- */
  const outlineY = parapetTop;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const q = outer[(i + 1) % outer.length];
    surfaces.edges.push(p.x, outlineY, -p.y, q.x, outlineY, -q.y);
    surfaces.edges.push(p.x, outlineY, -p.y, p.x, base, -p.y);

    if (p.x < bounds.minX) bounds.minX = p.x;
    if (p.x > bounds.maxX) bounds.maxX = p.x;
    if (-p.y < bounds.minZ) bounds.minZ = -p.y;
    if (-p.y > bounds.maxZ) bounds.maxZ = -p.y;
  }
  if (top > bounds.maxHeight) bounds.maxHeight = top;

  return true;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function buildBuildings(footprints: BuildingFootprint[]): BuildingSurfaces {
  const surfaces: Surfaces = {
    facade: createSurface(true),
    podium: createSurface(true),
    roof: createSurface(false),
    edges: [],
  };
  const bounds: BuildingBounds = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    maxHeight: 0,
  };

  let buildingCount = 0;
  for (const footprint of footprints) {
    if (buildOne(footprint, surfaces, bounds)) buildingCount += 1;
  }

  if (!Number.isFinite(bounds.minX)) {
    bounds.minX = -100;
    bounds.maxX = 100;
    bounds.minZ = -100;
    bounds.maxZ = 100;
  }

  const facade = toGeometry(surfaces.facade);
  const podium = toGeometry(surfaces.podium);
  const roof = toGeometry(surfaces.roof);

  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(new Float32Array(surfaces.edges), 3));

  // One collider covering every surface. All three buffers are non-indexed, so
  // the index list is simply 0, 1, 2, ...
  const total =
    surfaces.facade.position.length + surfaces.podium.position.length + surfaces.roof.position.length;
  const vertices = new Float32Array(total);
  vertices.set(surfaces.facade.position, 0);
  vertices.set(surfaces.podium.position, surfaces.facade.position.length);
  vertices.set(
    surfaces.roof.position,
    surfaces.facade.position.length + surfaces.podium.position.length,
  );
  const indices = new Uint32Array(total / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;

  return {
    facade,
    podium,
    roof,
    edges,
    bounds,
    buildingCount,
    triangleCount: total / 9,
    collider: { vertices, indices },
    dispose: () => {
      facade?.dispose();
      podium?.dispose();
      roof?.dispose();
      edges.dispose();
    },
  };
}
