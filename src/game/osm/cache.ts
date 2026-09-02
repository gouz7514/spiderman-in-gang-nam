import { WORLD } from '../config';
import type { CityData } from './types';

/**
 * Bump whenever the parser output shape or the height rules change, so old
 * entries are ignored instead of producing a subtly wrong city.
 */
const CACHE_VERSION = 3;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** The key encodes the query area, so changing the area cannot reuse old data. */
function cacheKey(): string {
  const { lat, lon } = WORLD.center;
  return `city-spidy:osm:v${CACHE_VERSION}:${lat},${lon}:r${WORLD.radiusMeters}`;
}

interface CacheEntry {
  savedAt: number;
  data: CityData;
}

export function readCache(): CityData | null {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry?.data?.buildings?.length) return null;
    if (Date.now() - entry.savedAt > TTL_MS) {
      localStorage.removeItem(cacheKey());
      return null;
    }
    return entry.data;
  } catch {
    // Corrupt entry or storage disabled — behave as a cache miss.
    return null;
  }
}

export function writeCache(data: CityData): void {
  try {
    const entry: CacheEntry = { savedAt: Date.now(), data };
    localStorage.setItem(cacheKey(), JSON.stringify(entry));
  } catch {
    // Quota exceeded or private mode. Caching is an optimisation, not a
    // requirement, so this is deliberately silent.
  }
}

export function clearCache(): void {
  try {
    localStorage.removeItem(cacheKey());
  } catch {
    /* nothing to do */
  }
}
