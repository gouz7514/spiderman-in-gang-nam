import { Vector3 } from 'three';

/**
 * Where the sun actually is over Seoul, right now.
 *
 * Standard low-precision solar position (the same series SunCalc uses), good to
 * a fraction of a degree — far beyond what a sky gradient needs. Everything is
 * in radians.
 *
 * Korea keeps a fixed UTC+9 with no daylight saving, so the local clock is a
 * plain offset and there is nothing to look up.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
/** Obliquity of the ecliptic. */
const E = RAD * 23.4397;

function toDays(date: Date): number {
  return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(m: number): number {
  // Equation of centre, plus the perihelion of Earth's orbit.
  const centre = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + centre + RAD * 102.9372 + Math.PI;
}

function declination(longitude: number): number {
  return Math.asin(Math.sin(E) * Math.sin(longitude));
}

function rightAscension(longitude: number): number {
  return Math.atan2(Math.sin(longitude) * Math.cos(E), Math.cos(longitude));
}

function siderealTime(d: number, westLongitude: number): number {
  return RAD * (280.16 + 360.9856235 * d) - westLongitude;
}

export interface SunPosition {
  /** Height above the horizon. Negative after sunset. */
  altitude: number;
  /** Compass bearing, measured clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const d = toDays(date);

  const eclipticLon = eclipticLongitude(solarMeanAnomaly(d));
  const dec = declination(eclipticLon);
  const ra = rightAscension(eclipticLon);
  const h = siderealTime(d, lw) - ra;

  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h),
  );
  // atan2 here gives the bearing from *south*, positive towards west.
  const fromSouth = Math.atan2(
    Math.sin(h),
    Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  );

  return { altitude, azimuth: fromSouth + Math.PI };
}

/**
 * The sun's direction in world space.
 *
 * World axes are `+X` east, `-Z` north, `+Y` up (see `osm/coordinates.ts`), so a
 * compass bearing maps to `(sin, -cos)` across the ground plane.
 */
export function sunDirection(sun: SunPosition, target: Vector3): Vector3 {
  const horizontal = Math.cos(sun.altitude);
  return target
    .set(
      Math.sin(sun.azimuth) * horizontal,
      Math.sin(sun.altitude),
      -Math.cos(sun.azimuth) * horizontal,
    )
    .normalize();
}
