import { WORLD } from '../config';
import type { LatLon } from './types';

/**
 * Local Cartesian projection ("east-north-up" tangent plane).
 * ---------------------------------------------------------------------------
 * Latitude/longitude are angles on an ellipsoid and are useless as Three.js
 * coordinates — one degree of longitude is a very different distance from one
 * degree of latitude, and both change with where you are on the planet.
 *
 * Because the playable area is tiny (a ~1.1 km box), we can treat the Earth as
 * flat over it and use a plain equirectangular projection anchored at Gangnam
 * Station. The only thing we need is an accurate metres-per-degree scale at
 * that latitude, which the two series below give to well under a centimetre
 * over this area.
 *
 * The resulting axis convention (right-handed, matching Three.js defaults):
 *
 *     +X = east        -X = west
 *     +Y = up          (altitude, metres above street level)
 *     -Z = north       +Z = south
 *
 * Gangnam Station itself is exactly (0, 0, 0). One world unit is one metre, so
 * every physics constant in `config.ts` can be read as a real-world quantity.
 *
 * North maps to -Z (rather than +Z) so that a camera with the default Three.js
 * orientation — looking down its own -Z axis — starts out facing north.
 */

const DEG = Math.PI / 180;

/**
 * Metres per degree of latitude at latitude `lat`.
 * Standard WGS84 series expansion.
 */
function metresPerDegreeLat(lat: number): number {
  const p = lat * DEG;
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
}

/** Metres per degree of longitude at latitude `lat`. */
function metresPerDegreeLon(lat: number): number {
  const p = lat * DEG;
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
}

/** Scale factors are constant across our small area, so compute them once. */
const ORIGIN = WORLD.center;
const M_PER_LAT = metresPerDegreeLat(ORIGIN.lat);
const M_PER_LON = metresPerDegreeLon(ORIGIN.lat);

/** A point on the ground plane, in metres, relative to Gangnam Station. */
export interface LocalPoint {
  /** East(+) / west(-) offset in metres. */
  x: number;
  /** South(+) / north(-) offset in metres. */
  z: number;
}

/** Project WGS84 -> local metres. */
export function latLonToLocal(p: LatLon): LocalPoint {
  return {
    x: (p.lon - ORIGIN.lon) * M_PER_LON,
    z: -(p.lat - ORIGIN.lat) * M_PER_LAT,
  };
}

/** Inverse of {@link latLonToLocal}; used by the debug overlay. */
export function localToLatLon(x: number, z: number): LatLon {
  return {
    lat: ORIGIN.lat - z / M_PER_LAT,
    lon: ORIGIN.lon + x / M_PER_LON,
  };
}

/** Horizontal distance in metres from the world origin. */
export function distanceFromOrigin(p: LatLon): number {
  const local = latLonToLocal(p);
  return Math.hypot(local.x, local.z);
}
