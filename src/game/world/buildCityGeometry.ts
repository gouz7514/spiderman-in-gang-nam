import type { CanvasTexture } from 'three';
import { PLAYER } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import type { BuildingFootprint, CityData } from '../osm/types';
import { buildBuildings } from './buildBuildings';
import type { BuildingBounds, BuildingSurfaces } from './buildBuildings';
import { buildRoadGeometry } from './buildRoadGeometry';
import type { RoadGeometry } from './buildRoadGeometry';
import { buildSignGeometry } from './buildSignGeometry';
import { buildStreetLights } from './buildStreetLights';
import type { StreetLightGeometry } from './buildStreetLights';
import { buildSubwayEntrances } from './buildSubwayEntrances';
import type { SubwayEntranceGeometry } from './buildSubwayEntrances';
import type { SignGeometry } from './buildSignGeometry';
import { buildMinimap } from './buildMinimap';
import type { MinimapImage } from './buildMinimap';
import { createFacadeTexture, createPodiumTexture, createWindowLightTexture } from './facadeTextures';
import { createSidewalkTexture, createTactileTexture } from './roadTextures';
import './bvh';

/**
 * Assembles every piece of the world from parsed OSM data.
 *
 * The heavy lifting lives in the three builders this calls; what happens here
 * is the wiring they share — the BVH used for web targeting and camera
 * occlusion, the single static collider, and the opening camera angle.
 */

export type CityBounds = BuildingBounds;

export interface CityGeometry {
  buildings: BuildingSurfaces;
  /** Street surfaces: pavements, carriageways, footpaths and lane markings. */
  roads: RoadGeometry;
  /** Shopfront signboards hung on real buildings, as one atlas-textured mesh. */
  signs: SignGeometry;
  /** The station's numbered street exits. */
  entrances: SubwayEntranceGeometry;
  /** Kerbside lamp posts, lit after dark. */
  streetLights: StreetLightGeometry;
  /** Tiling window texture for the upper facades. Null without a DOM. */
  facadeTexture: CanvasTexture | null;
  /** Tiling shopfront texture for the base of every building. */
  podiumTexture: CanvasTexture | null;
  /** Emissive mask of lit windows, faded in after dark. */
  windowLightTexture: CanvasTexture | null;
  /** Tiling paving-block texture for the pavements. */
  sidewalkTexture: CanvasTexture | null;
  /** Tiling 점자블록 texture for the tactile strips. */
  tactileTexture: CanvasTexture | null;
  /** Pre-rendered top-down city plan the HUD minimap blits from. */
  minimap: MinimapImage | null;
  bounds: CityBounds;
  buildingCount: number;
  triangleCount: number;
  /** Camera orientation that starts the player looking at a good first target. */
  suggestedAim: { yaw: number; pitch: number };
  dispose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Aim hint                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Picks a chunky building near the spawn and returns the yaw/pitch that points
 * at it, so a first-time player is already looking at a valid web target.
 */
function computeSuggestedAim(footprints: BuildingFootprint[]): { yaw: number; pitch: number } {
  const [sx, sy, sz] = PLAYER.spawn;
  let best: { x: number; y: number; z: number; score: number } | null = null;

  for (const footprint of footprints) {
    let cx = 0;
    let cz = 0;
    for (const point of footprint.outer) {
      const local = latLonToLocal(point);
      cx += local.x;
      cz += local.z;
    }
    cx /= footprint.outer.length;
    cz /= footprint.outer.length;

    const distance = Math.hypot(cx - sx, cz - sz);
    if (distance < 45 || distance > 170) continue;

    // Prefer tall and close.
    const score = footprint.height - distance * 0.35;
    if (!best || score > best.score) {
      best = { x: cx, y: footprint.height * 0.85, z: cz, score };
    }
  }

  if (!best) return { yaw: 0, pitch: 0.12 };

  const dx = best.x - sx;
  const dz = best.z - sz;
  const dy = best.y - sy;
  const horizontal = Math.hypot(dx, dz);

  // Matches the camera basis: forward is
  // (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)).
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.max(-0.4, Math.min(0.6, Math.atan2(dy, horizontal))),
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function buildCityGeometry(city: CityData): CityGeometry {
  const buildings = buildBuildings(city.buildings);

  // Every building surface is a valid web anchor and camera occluder, so each
  // gets an accelerated raycast structure. Roads, signs and the ground plane
  // deliberately get none — that is what keeps them un-webbable.
  for (const geometry of [buildings.facade, buildings.podium, buildings.roof]) {
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    geometry.computeBoundsTree();
  }

  const roads = buildRoadGeometry(city);
  const signs = buildSignGeometry(city);
  const entrances = buildSubwayEntrances(city);
  const streetLights = buildStreetLights(city);
  const facadeTexture = createFacadeTexture();
  const podiumTexture = createPodiumTexture();
  const windowLightTexture = createWindowLightTexture();
  const sidewalkTexture = createSidewalkTexture();
  const tactileTexture = createTactileTexture();
  const minimap = buildMinimap(city);

  return {
    buildings,
    roads,
    signs,
    entrances,
    streetLights,
    facadeTexture,
    podiumTexture,
    windowLightTexture,
    sidewalkTexture,
    tactileTexture,
    minimap,
    bounds: buildings.bounds,
    buildingCount: buildings.buildingCount,
    triangleCount: buildings.triangleCount,
    suggestedAim: computeSuggestedAim(city.buildings),
    dispose: () => {
      for (const geometry of [buildings.facade, buildings.podium, buildings.roof]) {
        geometry?.disposeBoundsTree?.();
      }
      buildings.dispose();
      roads.dispose();
      signs.dispose();
      entrances.dispose();
      streetLights.dispose();
      facadeTexture?.dispose();
      podiumTexture?.dispose();
      windowLightTexture?.dispose();
      sidewalkTexture?.dispose();
      tactileTexture?.dispose();
    },
  };
}
