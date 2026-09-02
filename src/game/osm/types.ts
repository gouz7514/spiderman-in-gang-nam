/** A WGS84 coordinate as returned by Overpass. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A single closed ring of a building footprint, in WGS84. */
export type Ring = LatLon[];

/**
 * One extrudable building: an outer ring, optional holes, and a resolved
 * height in metres. This is the only shape the renderer/physics ever sees.
 */
export interface BuildingFootprint {
  /** Stable OSM identifier (`w123` / `r456`), used for deterministic variation. */
  id: string;
  outer: Ring;
  holes: Ring[];
  /** Absolute roof height above ground, metres. */
  height: number;
  /** Height of the underside above ground, metres. Usually 0. */
  minHeight: number;
  /** Where the height came from — surfaced in the debug overlay. */
  heightSource: 'height' | 'levels' | 'fallback';
  /** OSM `name`, e.g. `강남N타워`. Tall named buildings get a crown sign. */
  name: string | null;
}

/** A road centreline. Decorative only — roads carry no collider. */
export interface RoadPath {
  id: string;
  points: LatLon[];
  /** OSM `highway` value, e.g. `primary`, `service`, `footway`. */
  kind: string;
  /** Carriageway width in metres, from `lanes` when tagged. */
  width: number;
  /** Tagged lane count, or 0 when OSM does not say. */
  lanes: number;
  oneway: boolean;
  /** True for `footway=crossing`: rendered as zebra bars instead of a ribbon. */
  crossing: boolean;
  /** Pedestrian ways are drawn as pale paving rather than asphalt. */
  footpath: boolean;
}

/** A named point of interest, rendered as a signboard on its building. */
export interface PoiLabel {
  id: string;
  /** The shop or venue name as tagged in OSM, e.g. `루덴치과 강남점`. */
  name: string;
  /** `shop=hairdresser`, `amenity=restaurant`, ... — drives the board colour. */
  category: string;
  /** OSM `brand`/`operator`, e.g. `GS25`. Chains get signage priority. */
  brand: string | null;
  position: LatLon;
}

/** A subway entrance, from `railway=subway_entrance`. */
export interface SubwayEntrance {
  id: string;
  /** OSM `ref`: the exit number as signed on the street, e.g. `11`. */
  ref: string | null;
  position: LatLon;
}

/** Everything the game needs from OpenStreetMap. */
export interface CityData {
  buildings: BuildingFootprint[];
  roads: RoadPath[];
  pois: PoiLabel[];
  entrances: SubwayEntrance[];
}

/** The subset of the Overpass JSON response we actually read. */
export interface OverpassElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  /** Present on nodes. */
  lat?: number;
  lon?: number;
  members?: {
    type: string;
    role?: string;
    geometry?: LatLon[];
  }[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
}
