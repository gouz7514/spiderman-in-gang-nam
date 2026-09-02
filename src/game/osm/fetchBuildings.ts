import { WORLD } from '../config';
import type { CityData, OverpassResponse } from './types';
import { parseCity } from './parseBuildings';
import { readCache, writeCache } from './cache';

/**
 * Public Overpass instances. We only ever issue *one* query for the whole
 * playable area, once per 24 h (see cache.ts) — the world is fixed after load,
 * so there is never a reason to talk to Overpass again during play.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Shipped snapshot of the same query, used only if every endpoint fails. */
const OFFLINE_SNAPSHOT = `${import.meta.env.BASE_URL}gangnam-osm-snapshot.json`;

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * One bounded query covering everything the world needs: building outlines,
 * every drawable highway (including pavements and pedestrian crossings), named
 * shopfronts for the building signboards, and the numbered subway entrances.
 */
function buildQuery(): string {
  const { lat, lon } = WORLD.center;
  const r = WORLD.radiusMeters;
  const around = `(around:${r},${lat},${lon})`;

  return `[out:json][timeout:90];
(
  way["building"]${around};
  relation["building"]${around};
  way["highway"]${around};
  node["name"]["shop"]${around};
  node["name"]["amenity"]${around};
  node["name"]["office"]${around};
  node["name"]["tourism"]${around};
  node["name"]["leisure"]${around};
  node["railway"="subway_entrance"]${around};
);
out body geom;`;
}

async function postOverpass(endpoint: string, query: string): Promise<OverpassResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${endpoint} responded ${response.status}`);
    return (await response.json()) as OverpassResponse;
  } finally {
    clearTimeout(timer);
  }
}

export type LoadSource = 'cache' | 'overpass' | 'snapshot';

export interface LoadResult {
  data: CityData;
  source: LoadSource;
}

/**
 * Resolution order: 24 h localStorage cache -> primary Overpass -> fallback
 * Overpass -> bundled snapshot. Throws only if every one of those fails.
 */
export async function loadCityData(options: { skipCache?: boolean } = {}): Promise<LoadResult> {
  if (!options.skipCache) {
    const cached = readCache();
    if (cached) return { data: cached, source: 'cache' };
  }

  const query = buildQuery();
  const failures: string[] = [];

  for (const endpoint of ENDPOINTS) {
    try {
      const raw = await postOverpass(endpoint, query);
      const data = parseCity(raw);
      if (data.buildings.length === 0) throw new Error('no buildings returned');
      writeCache(data);
      return { data, source: 'overpass' };
    } catch (error) {
      failures.push(`${new URL(endpoint).host}: ${(error as Error).message}`);
    }
  }

  try {
    const response = await fetch(OFFLINE_SNAPSHOT);
    if (!response.ok) throw new Error(`snapshot responded ${response.status}`);
    const data = parseCity((await response.json()) as OverpassResponse);
    if (data.buildings.length === 0) throw new Error('snapshot contained no buildings');
    return { data, source: 'snapshot' };
  } catch (error) {
    failures.push(`snapshot: ${(error as Error).message}`);
  }

  throw new Error(`Could not load OpenStreetMap data.\n${failures.join('\n')}`);
}
