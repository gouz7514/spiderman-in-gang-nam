import { Color, MathUtils, Vector3 } from 'three';
import { SKY, WORLD } from '../config';
import { sunDirection, sunPosition } from './sunPosition';

/**
 * Everything the sky looks like at a given moment, derived from where the sun
 * actually is over Gangnam Station.
 *
 * Kept out of the component so it can be reasoned about — and tested — without
 * a renderer. The sun's altitude drives all of it: palette, key light, fog, and
 * whether the daylight model or a dark sky with stars is drawn.
 */

const DAY = {
  sky: new Color('#cfe1ff'),
  ground: new Color('#5b6472'),
  key: new Color('#fff4e6'),
  fog: new Color('#9db4d0'),
};
const GOLDEN = {
  sky: new Color('#f3b98a'),
  ground: new Color('#4a3a35'),
  key: new Color('#ff8a3d'),
  fog: new Color('#c4816a'),
};
// Night is lifted well above true darkness on purpose — see SKY.moonIntensity.
const NIGHT = {
  sky: new Color('#5a6d9c'),
  // The hemisphere light's ground colour is what actually lights the road:
  // every street surface faces straight up, so this is the single biggest
  // lever on how dark the city reads after dark.
  ground: new Color('#5b6791'),
  key: new Color('#ccd8f2'),
  fog: new Color('#334370'),
};

/** Smooth 0..1 ramp between two altitudes. */
function ramp(value: number, from: number, to: number): number {
  return MathUtils.smoothstep(value, Math.min(from, to), Math.max(from, to));
}

function blend(night: Color, day: Color, golden: Color, dayFactor: number, goldenFactor: number) {
  return new Color()
    .copy(night)
    .lerp(day, dayFactor)
    .lerp(golden, goldenFactor);
}

export interface SkyState {
  altitude: number;
  dayFactor: number;
  sunPosition: [number, number, number];
  keyPosition: [number, number, number];
  keyColor: string;
  keyIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  fogDensity: number;
  showSky: boolean;
  showStars: boolean;
  castShadow: boolean;
}

const direction = new Vector3();

/** Which time of day the sky is showing. */
export type SkyMode = 'auto' | 'day' | 'night';

const STORAGE_KEY = 'city-spidy:sky-mode';

export function loadSkyMode(): SkyMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'day' || stored === 'night' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveSkyMode(mode: SkyMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode — the choice just will not persist */
  }
}

/** The same calendar day in Korea, pinned to a given local hour. */
function atKoreanHour(reference: Date, hour: number): Date {
  const korean = new Date(reference.valueOf() + 9 * 3_600_000);
  return new Date(
    Date.UTC(korean.getUTCFullYear(), korean.getUTCMonth(), korean.getUTCDate(), hour - 9),
  );
}

export function computeSky(now: Date, mode: SkyMode = 'auto'): SkyState {
  // Forcing a mode moves the clock, not the maths: the sun is still placed
  // properly for the date, so a forced day in December is still a low winter
  // sun rather than a flat noon.
  const when =
    mode === 'day' ? atKoreanHour(now, 14) : mode === 'night' ? atKoreanHour(now, 23) : now;
  const sun = sunPosition(when, WORLD.center.lat, WORLD.center.lon);
  const dayFactor = ramp(sun.altitude, SKY.nightAltitude, SKY.dayAltitude);
  // Peaks as the sun sits on the horizon and falls away either side of it.
  const goldenFactor =
    Math.max(0, 1 - Math.abs(sun.altitude - SKY.goldenAltitude) / SKY.goldenWidth) * 0.85;

  sunDirection(sun, direction);
  const sunVector: [number, number, number] = [direction.x, direction.y, direction.z];

  // After dark the key light becomes a moon: same bearing, but lifted above the
  // horizon so the city is still lit from above rather than from underneath.
  const isDay = sun.altitude > 0.01;
  const keyAltitude = isDay ? sun.altitude : SKY.moonElevation;
  const keyBearing = isDay ? sun.azimuth : sun.azimuth + Math.PI;
  sunDirection({ altitude: keyAltitude, azimuth: keyBearing }, direction);

  const warmth = ramp(sun.altitude, 0, 0.45);
  const keyColor = isDay
    ? new Color().copy(GOLDEN.key).lerp(DAY.key, warmth)
    : NIGHT.key.clone();

  return {
    altitude: sun.altitude,
    dayFactor,
    sunPosition: sunVector,
    keyPosition: [direction.x * 500, direction.y * 500, direction.z * 500],
    keyColor: `#${keyColor.getHexString()}`,
    keyIntensity: isDay
      ? SKY.sunIntensity * ramp(sun.altitude, -0.02, 0.2)
      : SKY.moonIntensity,
    hemiSky: `#${blend(NIGHT.sky, DAY.sky, GOLDEN.sky, dayFactor, goldenFactor).getHexString()}`,
    hemiGround: `#${blend(NIGHT.ground, DAY.ground, GOLDEN.ground, dayFactor, goldenFactor).getHexString()}`,
    hemiIntensity: MathUtils.lerp(SKY.nightAmbient, SKY.dayAmbient, dayFactor),
    fog: `#${blend(NIGHT.fog, DAY.fog, GOLDEN.fog, dayFactor, goldenFactor).getHexString()}`,
    fogDensity: MathUtils.lerp(SKY.fogDensityNight, SKY.fogDensityDay, dayFactor),
    showSky: sun.altitude > SKY.skyCutoffAltitude,
    showStars: sun.altitude < SKY.starsAltitude,
    // A shadow from a dim moon is just noise.
    castShadow: sun.altitude > 0.02,
  };
}

