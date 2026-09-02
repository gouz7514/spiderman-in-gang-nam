import { useCallback, useEffect, useState } from 'react';
import { buildCityGeometry } from '../world/buildCityGeometry';
import type { CityGeometry } from '../world/buildCityGeometry';
import { clearCache } from './cache';
import { loadCityData } from './fetchBuildings';
import type { LoadSource } from './fetchBuildings';

export type LoadStage = 'fetching' | 'building' | 'ready' | 'error';

export interface CityLoadState {
  stage: LoadStage;
  city: CityGeometry | null;
  error: string | null;
  source: LoadSource | null;
  retry: () => void;
}

/**
 * Owns the whole world-loading pipeline: Overpass (or cache, or the bundled
 * snapshot) -> parsed footprints -> merged Three.js geometry and collider.
 *
 * Runs exactly once per attempt. The geometry is built off the React render
 * path and disposed on unmount or retry, so nothing leaks between attempts.
 */
export function useCityData(): CityLoadState {
  const [stage, setStage] = useState<LoadStage>('fetching');
  const [city, setCity] = useState<CityGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<LoadSource | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let geometry: CityGeometry | null = null;

    setStage('fetching');
    setError(null);
    setCity(null);

    const run = async () => {
      try {
        // A retry always goes back to the network: the most likely reason the
        // player pressed it is that the cached copy is the problem.
        const result = await loadCityData({ skipCache: attempt > 0 });
        if (cancelled) return;

        setSource(result.source);
        setStage('building');
        // Yield once so the "Building city..." message actually paints before
        // the synchronous extrude/merge pass blocks the main thread.
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (cancelled) return;

        geometry = buildCityGeometry(result.data);
        if (cancelled) {
          geometry.dispose();
          geometry = null;
          return;
        }

        setCity(geometry);
        setStage('ready');
      } catch (caught) {
        if (cancelled) return;
        setError((caught as Error).message);
        setStage('error');
      }
    };

    void run();

    return () => {
      cancelled = true;
      geometry?.dispose();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    clearCache();
    setAttempt((value) => value + 1);
  }, []);

  return { stage, city, error, source, retry };
}
