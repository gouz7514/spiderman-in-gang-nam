import { BufferAttribute, BufferGeometry, Color } from 'three';
import { STREET_LIGHTS } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import type { LocalPoint } from '../osm/coordinates';
import type { CityData } from '../osm/types';
import { createCarriagewayMask } from './buildRoadGeometry';

/**
 * Lamp posts along the kerb, whose heads glow after dark.
 *
 * Two buffers, because they are lit two different ways: the posts are ordinary
 * shaded geometry, and the lamp heads are unlit and fade in with the night.
 *
 * They are street furniture, *not* a light source. Earlier versions threw an
 * additive disc on the road and hung a cone of light above it; both are gone.
 * See the note in `skyState.ts` — after dark the city is lit by the ambient
 * floor, which is uniform and predictable, rather than by 1,580 overlapping
 * additive sprites that clip against each other and turn the tarmac brown.
 *
 * No colliders: a forest of 8 m poles along every kerb is a lot of thin things
 * for a player moving at 200 km/h to snag on, for very little in return.
 */

export interface StreetLightGeometry {
  /** Posts, arms and head housings. */
  structure: BufferGeometry | null;
  /** The lamps themselves, unlit geometry that glows at night. */
  lamps: BufferGeometry | null;
  count: number;
  dispose: () => void;
}

const EMPTY: StreetLightGeometry = {
  structure: null,
  lamps: null,
  count: 0,
  dispose: () => undefined,
};

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
 * A box, given a centre on the ground plane and a local frame where `u` runs
 * along the arm (out towards the road) and `v` across it.
 */
function emitBox(
  surface: Surface,
  origin: LocalPoint,
  ux: number, uz: number,
  u0: number, u1: number,
  v0: number, v1: number,
  y0: number, y1: number,
  color: Color,
): void {
  const at = (u: number, v: number, y: number): Point3 => ({
    x: origin.x + ux * u - uz * v,
    y,
    z: origin.z + uz * u + ux * v,
  });
  const a = at(u0, v0, y0), b = at(u1, v0, y0), c = at(u1, v1, y0), d = at(u0, v1, y0);
  const e = at(u0, v0, y1), f = at(u1, v0, y1), g = at(u1, v1, y1), h = at(u0, v1, y1);
  emitQuad(surface, e, f, g, h, color);
  emitQuad(surface, d, c, b, a, color);
  emitQuad(surface, a, b, f, e, color);
  emitQuad(surface, b, c, g, f, color);
  emitQuad(surface, c, d, h, g, color);
  emitQuad(surface, d, a, e, h, color);
}

/**
 * Rejects a post standing on top of one already placed. A hash grid keyed on
 * `minGap` means only the nine neighbouring cells are ever compared, so this
 * stays linear over the several hundred candidates.
 */
function createSpacingFilter(): (x: number, z: number) => boolean {
  const cell = STREET_LIGHTS.minGap;
  const grid = new Map<string, LocalPoint[]>();
  const gapSq = cell * cell;
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const bucket = grid.get(`${ix},${iz}`);
        if (!bucket) continue;
        for (const other of bucket) {
          const dx = other.x - x;
          const dz = other.z - z;
          if (dx * dx + dz * dz < gapSq) return false;
        }
      }
    }
    const key = `${cx},${cz}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push({ x, z });
    else grid.set(key, [{ x, z }]);
    return true;
  };
}

/** Cumulative arc lengths along a polyline. */
function arcLengths(points: LocalPoint[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  return lengths;
}

export function buildStreetLights(city: CityData): StreetLightGeometry {
  const structure: Surface = { position: [], normal: [], color: [] };
  const lamps: Surface = { position: [], normal: [], color: [] };

  const onRoad = createCarriagewayMask(city);
  const farEnough = createSpacingFilter();
  const lit = new Set<string>(STREET_LIGHTS.litClasses);
  const poleColor = new Color(STREET_LIGHTS.poleColor).convertSRGBToLinear();
  const lampColor = new Color(STREET_LIGHTS.lampColor).convertSRGBToLinear();

  /**
   * One post, its arm and head. `(ux, uz)` points from the post back towards
   * the road, which is the direction the arm reaches in.
   */
  const emitLamp = (origin: LocalPoint, ux: number, uz: number): void => {
    const s = STREET_LIGHTS.poleSize / 2;

    emitBox(structure, origin, ux, uz, -s, s, -s, s, 0, STREET_LIGHTS.poleHeight, poleColor);
    const armY = STREET_LIGHTS.poleHeight - STREET_LIGHTS.armSize;
    emitBox(
      structure, origin, ux, uz,
      0, STREET_LIGHTS.armLength,
      -STREET_LIGHTS.armSize / 2, STREET_LIGHTS.armSize / 2,
      armY, armY + STREET_LIGHTS.armSize,
      poleColor,
    );

    const headU = STREET_LIGHTS.armLength;
    const headTop = armY;
    emitBox(
      structure, origin, ux, uz,
      headU - STREET_LIGHTS.headLength / 2, headU + STREET_LIGHTS.headLength / 2,
      -STREET_LIGHTS.headWidth / 2, STREET_LIGHTS.headWidth / 2,
      headTop - STREET_LIGHTS.headDepth, headTop,
      poleColor,
    );
    // The lit underside of the lamp, as its own unlit geometry.
    emitBox(
      lamps, origin, ux, uz,
      headU - STREET_LIGHTS.headLength / 2 + 0.06, headU + STREET_LIGHTS.headLength / 2 - 0.06,
      -STREET_LIGHTS.headWidth / 2 + 0.05, STREET_LIGHTS.headWidth / 2 - 0.05,
      headTop - STREET_LIGHTS.headDepth - 0.05, headTop - STREET_LIGHTS.headDepth + 0.01,
      lampColor,
    );

  };

  let count = 0;

  for (const road of city.roads) {
    if (road.crossing || road.footpath) continue;
    if (!lit.has(road.kind) || road.width < STREET_LIGHTS.minRoadWidth) continue;

    const points = road.points.map(latLonToLocal);
    if (points.length < 2) continue;
    const lengths = arcLengths(points);
    const total = lengths[lengths.length - 1];
    // OSM splits a street into a new way at every junction and every tag
    // change, so plenty of perfectly ordinary kerbs arrive as 20 m fragments.
    // Skipping anything shorter than the spacing left long runs of the grid
    // completely unlit; a fragment gets one lamp at its midpoint instead.
    if (total < STREET_LIGHTS.minSegment) continue;

    const half = road.width / 2;
    let index = 0;

    for (let distance = STREET_LIGHTS.spacing / 2; distance < total; distance += STREET_LIGHTS.spacing) {
      // Sample the centreline and its direction.
      let segment = 1;
      while (segment < lengths.length - 1 && lengths[segment] < distance) segment++;
      const a = points[segment - 1];
      const b = points[segment];
      const span = lengths[segment] - lengths[segment - 1] || 1;
      const t = Math.min(1, Math.max(0, (distance - lengths[segment - 1]) / span));
      const cx = a.x + (b.x - a.x) * t;
      const cz = a.z + (b.z - a.z) * t;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      const tx = dx / length;
      const tz = dz / length;

      // A narrow street alternates sides, so it gets one lamp per spacing
      // rather than a double row. A wide one is lit from both kerbs at once,
      // because a single row cannot reach across 26 m of carriageway.
      const sides = road.width >= STREET_LIGHTS.bothSidesWidth ? [1, -1] : [index % 2 === 0 ? 1 : -1];
      index += 1;

      for (const side of sides) {
        // The post sits on the pavement; the arm reaches back over the road.
        const nx = -tz * side;
        const nz = tx * side;
        const offset = half + STREET_LIGHTS.kerbOffset;
        const origin: LocalPoint = { x: cx + nx * offset, z: cz + nz * offset };
        if (onRoad(origin.x, origin.z, road.id)) continue;
        if (!farEnough(origin.x, origin.z)) continue;
        emitLamp(origin, -nx, -nz);
        count += 1;
      }
    }
  }

  if (count === 0) return EMPTY;

  const toGeometry = (surface: Surface) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(surface.position), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(surface.normal), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(surface.color), 3));
    return geometry;
  };

  const structureGeometry = toGeometry(structure);
  const lampGeometry = toGeometry(lamps);

  return {
    structure: structureGeometry,
    lamps: lampGeometry,
    count,
    dispose: () => {
      structureGeometry.dispose();
      lampGeometry.dispose();
    },
  };
}
