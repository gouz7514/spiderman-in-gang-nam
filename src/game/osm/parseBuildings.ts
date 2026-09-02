import { BUILDINGS, ROADS } from '../config';
import type {
  BuildingFootprint,
  CityData,
  LatLon,
  OverpassElement,
  OverpassResponse,
  PoiLabel,
  SubwayEntrance,
  Ring,
  RoadPath,
} from './types';

/* -------------------------------------------------------------------------- */
/* Deterministic pseudo-randomness                                             */
/* -------------------------------------------------------------------------- */

/**
 * xmur3 string hash -> 32-bit unsigned int. Pure and stable, so a building
 * always gets the same fallback height and the same colour tint across
 * reloads, cache misses and machines.
 */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic float in [0, 1) derived from `id` and a channel `salt`. */
export function hashUnit(id: string, salt: number): number {
  return hashString(`${id}#${salt}`) / 4294967296;
}

/* -------------------------------------------------------------------------- */
/* Height resolution                                                           */
/* -------------------------------------------------------------------------- */

/** Parses "57", "57 m", "12.5m" and similar. Returns null when unusable. */
function parseMetres(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /-?\d+(\.\d+)?/.exec(raw);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

interface ResolvedHeight {
  height: number;
  minHeight: number;
  source: BuildingFootprint['heightSource'];
}

/**
 * Height priority, per the OSM tagging conventions:
 *   1. `height` in metres,
 *   2. `building:levels` x 3.2 m,
 *   3. a deterministic fallback in [10 m, 35 m] derived from the OSM id, so
 *      the skyline still varies instead of collapsing into one flat slab.
 */
function resolveHeight(id: string, tags: Record<string, string>): ResolvedHeight {
  const minHeight =
    parseMetres(tags['min_height']) ??
    (parseMetres(tags['building:min_level']) ?? 0) * BUILDINGS.levelHeight;

  const explicit = parseMetres(tags['height']);
  if (explicit !== null && explicit > 0) {
    return { height: explicit, minHeight, source: 'height' };
  }

  const levels = parseMetres(tags['building:levels']);
  if (levels !== null && levels > 0) {
    return { height: levels * BUILDINGS.levelHeight, minHeight, source: 'levels' };
  }

  const span = BUILDINGS.fallbackHeightMax - BUILDINGS.fallbackHeightMin;
  // Two hash channels multiplied together bias the distribution towards the
  // shorter end, which is what a real low-rise Gangnam block looks like.
  const t = hashUnit(id, 1) * (0.35 + 0.65 * hashUnit(id, 2));
  return {
    height: BUILDINGS.fallbackHeightMin + t * span,
    minHeight,
    source: 'fallback',
  };
}

/* -------------------------------------------------------------------------- */
/* Ring handling                                                               */
/* -------------------------------------------------------------------------- */

function coordKey(p: LatLon): string {
  return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
}

function isClosed(ring: Ring): boolean {
  return ring.length > 2 && coordKey(ring[0]) === coordKey(ring[ring.length - 1]);
}

/** Drops the repeated closing vertex, if present. */
function openRing(ring: Ring): Ring {
  return isClosed(ring) ? ring.slice(0, -1) : ring;
}

/**
 * Multipolygon relations hand us *fragments* of their outline as separate
 * member ways. Walk the fragments end-to-end to rebuild closed rings.
 */
function stitchRings(parts: Ring[]): Ring[] {
  const rings: Ring[] = [];
  const pending = parts.filter((p) => p.length >= 2);
  const used = new Array<boolean>(pending.length).fill(false);

  for (let i = 0; i < pending.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const ring: Ring = [...pending[i]];

    if (!isClosed(ring)) {
      // Keep appending whichever unused fragment touches our current tail.
      let extended = true;
      while (extended && !isClosed(ring)) {
        extended = false;
        const tail = coordKey(ring[ring.length - 1]);
        for (let j = 0; j < pending.length; j++) {
          if (used[j]) continue;
          const candidate = pending[j];
          const head = coordKey(candidate[0]);
          const end = coordKey(candidate[candidate.length - 1]);
          if (head === tail) {
            ring.push(...candidate.slice(1));
          } else if (end === tail) {
            ring.push(...candidate.slice(0, -1).reverse());
          } else {
            continue;
          }
          used[j] = true;
          extended = true;
          break;
        }
      }
    }

    if (ring.length >= 4 && isClosed(ring)) rings.push(ring);
    else if (ring.length >= 3) rings.push([...ring, ring[0]]); // tolerate a small gap
  }

  return rings;
}

/* -------------------------------------------------------------------------- */
/* Element filters                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Underground structures (the Gangnam Station shopping arcade, subway
 * concourses, tunnels) are tagged as buildings but must not be extruded — one
 * of them covers the entire main crossing, including the player spawn.
 */
function isUnderground(tags: Record<string, string>): boolean {
  if (tags['location'] === 'underground') return true;
  if (tags['tunnel'] && tags['tunnel'] !== 'no') return true;
  const layer = Number(tags['layer']);
  return Number.isFinite(layer) && layer < 0;
}

function isBuilding(tags: Record<string, string> | undefined): tags is Record<string, string> {
  return !!tags && !!tags['building'] && tags['building'] !== 'no' && !isUnderground(tags);
}

/* -------------------------------------------------------------------------- */
/* Roads                                                                       */
/* -------------------------------------------------------------------------- */

/** Ways we never draw: stairs, bus platforms, and anything below ground. */
const SKIPPED_HIGHWAYS = new Set(['steps', 'platform', 'elevator', 'construction', 'proposed']);

const FOOT_HIGHWAYS = new Set(['footway', 'path', 'pedestrian', 'living_street', 'steps']);

/**
 * Carriageway width. A tagged `lanes` count is far more truthful than a class
 * default — it is what makes Gangnam-daero (`lanes=8`) read as an eight-lane
 * road next to a 4.5 m service alley.
 */
function roadWidth(tags: Record<string, string>): number {
  const explicit = parseMetres(tags['width']);
  if (explicit !== null && explicit > 1) return Math.min(40, explicit);

  const lanes = parseMetres(tags['lanes']);
  if (lanes !== null && lanes >= 1) return Math.min(40, lanes * ROADS.laneWidth);

  return ROADS.width[tags['highway']] ?? ROADS.defaultWidth;
}

function parseRoad(element: OverpassElement, tags: Record<string, string>): RoadPath | null {
  const kind = tags['highway'];
  if (SKIPPED_HIGHWAYS.has(kind)) return null;
  if (isUnderground(tags)) return null;

  const points = element.geometry;
  if (!points || points.length < 2) return null;

  const crossing = tags['footway'] === 'crossing' || !!tags['crossing'];
  const lanes = parseMetres(tags['lanes']);
  return {
    id: `w${element.id}`,
    points,
    kind,
    width: crossing ? ROADS.crossingWidth : roadWidth(tags),
    lanes: lanes !== null && lanes >= 1 ? Math.round(lanes) : 0,
    oneway: tags['oneway'] === 'yes',
    crossing,
    footpath: FOOT_HIGHWAYS.has(kind),
  };
}

/* -------------------------------------------------------------------------- */
/* Points of interest                                                          */
/* -------------------------------------------------------------------------- */

/** Tag keys that make a named node a shopfront worth putting on a wall. */
const POI_KEYS = ['shop', 'amenity', 'office', 'tourism', 'leisure'] as const;

/** Named POIs that would be silly on a signboard. */
const POI_EXCLUDED = new Set([
  'bicycle_rental',
  'bicycle_parking',
  'parking',
  'parking_entrance',
  'waste_basket',
  'bench',
  'toilets',
  'vending_machine',
  'atm',
  'shelter',
  'drinking_water',
  'recycling',
  'car_sharing',
  'charging_station',
  'fountain',
  'clock',
]);

function parsePoi(element: OverpassElement, tags: Record<string, string>): PoiLabel | null {
  if (element.lat === undefined || element.lon === undefined) return null;

  const name = tags['name']?.trim();
  if (!name) return null;

  for (const key of POI_KEYS) {
    const value = tags[key];
    if (!value || value === 'no') continue;
    if (POI_EXCLUDED.has(value)) return null;
    return {
      id: `n${element.id}`,
      name,
      category: `${key}=${value}`,
      brand: tags['brand']?.trim() || tags['operator']?.trim() || null,
      position: { lat: element.lat, lon: element.lon },
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

function pushBuilding(
  out: BuildingFootprint[],
  id: string,
  outer: Ring,
  holes: Ring[],
  tags: Record<string, string>,
): void {
  const ring = openRing(outer);
  if (ring.length < 3) return;

  const { height, minHeight, source } = resolveHeight(id, tags);
  const clamped = Math.min(BUILDINGS.maxHeight, Math.max(BUILDINGS.minHeight, height));
  if (minHeight >= clamped) return;

  out.push({
    id,
    name: tags['name']?.trim() || null,
    outer: ring,
    holes: holes.map(openRing).filter((h) => h.length >= 3),
    height: clamped,
    minHeight: Math.max(0, minHeight),
    heightSource: source,
  });
}

/**
 * Converts a raw Overpass response into the flat, renderer-ready
 * {@link CityData} structure. Pure function: same input, same output.
 */
export function parseCity(response: OverpassResponse): CityData {
  const buildings: BuildingFootprint[] = [];
  const roads: RoadPath[] = [];
  const pois: PoiLabel[] = [];
  const entrances: SubwayEntrance[] = [];

  for (const element of response.elements as OverpassElement[]) {
    const tags = element.tags;

    if (element.type === 'node') {
      if (!tags || element.lat === undefined || element.lon === undefined) continue;

      if (tags['railway'] === 'subway_entrance') {
        entrances.push({
          id: `n${element.id}`,
          ref: tags['ref']?.trim() || null,
          position: { lat: element.lat, lon: element.lon },
        });
        continue;
      }

      const poi = parsePoi(element, tags);
      if (poi) pois.push(poi);
      continue;
    }

    if (element.type === 'way' && tags?.['highway']) {
      const road = parseRoad(element, tags);
      if (road) roads.push(road);
      continue;
    }

    if (!isBuilding(tags)) continue;

    if (element.type === 'way') {
      if (element.geometry && element.geometry.length >= 3) {
        pushBuilding(buildings, `w${element.id}`, element.geometry, [], tags);
      }
      continue;
    }

    if (element.type === 'relation') {
      const members = element.members ?? [];
      const outerParts = members
        .filter((m) => m.role !== 'inner' && m.geometry)
        .map((m) => m.geometry as Ring);
      const innerParts = members
        .filter((m) => m.role === 'inner' && m.geometry)
        .map((m) => m.geometry as Ring);

      const outerRings = stitchRings(outerParts);
      const innerRings = stitchRings(innerParts);

      // A relation may legitimately contain several disjoint outer rings; each
      // becomes its own building so the holes stay attached to the right one.
      outerRings.forEach((outer, index) => {
        const holes = outerRings.length === 1 ? innerRings : [];
        pushBuilding(buildings, `r${element.id}-${index}`, outer, holes, tags);
      });
    }
  }

  return { buildings, roads, pois, entrances };
}
