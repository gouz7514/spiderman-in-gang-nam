import { BufferAttribute, BufferGeometry } from 'three';
import { ROADS } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import type { LocalPoint } from '../osm/coordinates';
import type { CityData, RoadPath } from '../osm/types';

/**
 * Street surface geometry.
 *
 * Roads are pure decoration — they carry no collider and are deliberately not
 * part of the raycast target, which is what stops the player webbing onto the
 * tarmac. Everything is built into three merged, non-indexed geometries so the
 * whole street network costs three draw calls:
 *
 *   1. `sidewalks`      — a paved kerb ribbon under every carriageway,
 *   2. `asphalt`        — the carriageway itself,
 *   3. `footpaths`      — pale paving for pedestrian ways,
 *   4. `whiteMarkings`  — 가장자리선, 차선 and zebra crossings,
 *   5. `yellowMarkings` — 중앙선,
 *   6. `tactile`        — the 점자블록 strip running along each pavement.
 *
 * The markings are split by colour rather than by role because that is the only
 * thing that needs a separate material.
 *
 * They are stacked a couple of centimetres apart in Y so a flat ground plane
 * never z-fights with them.
 */

export interface RoadGeometry {
  /** Carries UVs: the pavement is textured with paving blocks. */
  sidewalks: BufferGeometry | null;
  /** Carries UVs: the yellow tactile strip along each pavement. */
  tactile: BufferGeometry | null;
  asphalt: BufferGeometry | null;
  footpaths: BufferGeometry | null;
  /** 가장자리선 (edge lines), 차선 (lane dividers) and pedestrian crossings. */
  whiteMarkings: BufferGeometry | null;
  /** 중앙선 (centre line), which is yellow on Korean roads. */
  yellowMarkings: BufferGeometry | null;
  dispose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Polyline helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Removes coincident vertices, which would produce NaN segment directions. */
function cleanPolyline(points: LocalPoint[]): LocalPoint[] {
  const out: LocalPoint[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.05) continue;
    out.push(point);
  }
  return out;
}

/**
 * Offsets a polyline sideways using mitred joins.
 *
 * The naive approach — emitting an independent quad per segment — leaves a
 * visible notch on the outside of every bend and a doubled-up dark patch on the
 * inside. Mitring solves the corner once, so a road reads as one continuous
 * ribbon however much it curves.
 *
 * The mitre length is clamped, because a hairpin would otherwise throw the
 * offset vertex off to infinity.
 */
function offsetPolyline(points: LocalPoint[], offset: number): LocalPoint[] {
  const count = points.length;
  const result: LocalPoint[] = [];

  for (let i = 0; i < count; i++) {
    const incoming = i > 0 ? direction(points[i - 1], points[i]) : direction(points[0], points[1]);
    const outgoing =
      i < count - 1
        ? direction(points[i], points[i + 1])
        : direction(points[count - 2], points[count - 1]);

    // Perpendicular in the XZ plane.
    const n1: LocalPoint = { x: -incoming.z, z: incoming.x };
    const n2: LocalPoint = { x: -outgoing.z, z: outgoing.x };

    let mx = n1.x + n2.x;
    let mz = n1.z + n2.z;
    const length = Math.hypot(mx, mz);
    if (length < 1e-6) {
      mx = n2.x;
      mz = n2.z;
    } else {
      mx /= length;
      mz /= length;
    }

    const projection = mx * n2.x + mz * n2.z;
    const scale = offset / Math.max(0.35, projection);
    result.push({ x: points[i].x + mx * scale, z: points[i].z + mz * scale });
  }

  return result;
}

function direction(a: LocalPoint, b: LocalPoint): LocalPoint {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** Requests UVs for a ribbon, tiled every `scale` metres. */
interface RibbonUv {
  out: number[];
  scale: number;
}

/**
 * Emits a ribbon between two signed sideways offsets of the same centreline.
 * Used for the carriageway (`-half`, `+half`) and for the thin edge lines.
 *
 * When `uv` is given, texture coordinates come from projecting each corner onto
 * the segment's own tangent and normal. That aligns paving blocks with the
 * street rather than with the world grid, and stays continuous across
 * collinear segments so a long pavement has no visible restart.
 */
function emitRibbon(
  out: number[],
  points: LocalPoint[],
  fromOffset: number,
  toOffset: number,
  y: number,
  uv?: RibbonUv,
  skip?: (x: number, z: number) => boolean,
): void {
  if (points.length < 2) return;
  const a = offsetPolyline(points, fromOffset);
  const b = offsetPolyline(points, toOffset);

  for (let i = 0; i < points.length - 1; i++) {
    if (skip) {
      const midX = (a[i].x + a[i + 1].x + b[i].x + b[i + 1].x) / 4;
      const midZ = (a[i].z + a[i + 1].z + b[i].z + b[i + 1].z) / 4;
      if (skip(midX, midZ)) continue;
    }

    const p0 = a[i];
    const p1 = b[i];
    const p2 = b[i + 1];
    const p3 = a[i + 1];

    const dir = uv ? direction(points[i], points[i + 1]) : null;

    // Wind so the face normal comes out as +Y. The other way round the surface
    // is back-facing, gets culled, and the ground plane shows through instead —
    // subtle enough to miss, because the ground is a similar grey.
    //
    // The sign is checked per *triangle*, not per quad: at a hairpin the mitred
    // offset lines cross over each other, and the resulting bow-tie quad has its
    // two halves wound in opposite directions.
    const emitTriangle = (q0: LocalPoint, q1: LocalPoint, q2: LocalPoint) => {
      const ny = (q1.z - q0.z) * (q2.x - q0.x) - (q1.x - q0.x) * (q2.z - q0.z);
      const order = ny >= 0 ? [q0, q1, q2] : [q0, q2, q1];
      for (const corner of order) {
        out.push(corner.x, y, corner.z);
        if (uv && dir) {
          uv.out.push(
            (corner.x * dir.x + corner.z * dir.z) / uv.scale,
            (corner.x * -dir.z + corner.z * dir.x) / uv.scale,
          );
        }
      }
    };

    emitTriangle(p0, p1, p2);
    emitTriangle(p0, p2, p3);
  }
}

/** Cumulative arc lengths, so we can walk a road at fixed metre intervals. */
function arcLengths(points: LocalPoint[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z),
    );
  }
  return lengths;
}

interface SamplePoint {
  x: number;
  z: number;
  dir: LocalPoint;
}

function sampleAt(points: LocalPoint[], lengths: number[], distance: number): SamplePoint {
  let index = 1;
  while (index < lengths.length - 1 && lengths[index] < distance) index++;

  const start = points[index - 1];
  const end = points[index];
  const span = lengths[index] - lengths[index - 1] || 1;
  const t = Math.min(1, Math.max(0, (distance - lengths[index - 1]) / span));

  return {
    x: start.x + (end.x - start.x) * t,
    z: start.z + (end.z - start.z) * t,
    dir: direction(start, end),
  };
}

/** A rectangle centred on `sample`, `length` along the road and `width` across. */
function emitBar(
  out: number[],
  sample: SamplePoint,
  length: number,
  width: number,
  y: number,
): void {
  const { dir } = sample;
  const hx = (dir.x * length) / 2;
  const hz = (dir.z * length) / 2;
  const nx = (-dir.z * width) / 2;
  const nz = (dir.x * width) / 2;

  const x0 = sample.x - hx;
  const z0 = sample.z - hz;
  const x1 = sample.x + hx;
  const z1 = sample.z + hz;

  out.push(
    x0 + nx, y, z0 + nz,
    x1 + nx, y, z1 + nz,
    x1 - nx, y, z1 - nz,

    x0 + nx, y, z0 + nz,
    x1 - nx, y, z1 - nz,
    x0 - nx, y, z0 - nz,
  );
}

/* -------------------------------------------------------------------------- */
/* Markings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Splits a polyline into steps of at most `step` metres.
 *
 * Pavements need this before they can be clipped: an OSM way often crosses a
 * whole junction in a single long segment, and per-segment clipping at that
 * granularity would drop the pavement for an entire block.
 */
function resamplePolyline(points: LocalPoint[], step: number): LocalPoint[] {
  const out: LocalPoint[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const pieces = Math.max(1, Math.ceil(length / step));
    for (let s = 1; s <= pieces; s++) {
      const t = s / pieces;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** A carriageway, reduced to what the clip tests need. */
interface Carriageway {
  id: string;
  points: LocalPoint[];
  half: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function buildCarriageways(city: CityData): Carriageway[] {
  const out: Carriageway[] = [];
  for (const road of city.roads) {
    if (road.crossing || road.footpath) continue;
    const points = cleanPolyline(road.points.map(latLonToLocal));
    if (points.length < 2) continue;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }
    const half = road.width / 2;
    out.push({
      id: road.id,
      points,
      half,
      minX: minX - half,
      maxX: maxX + half,
      minZ: minZ - half,
      maxZ: maxZ + half,
    });
  }
  return out;
}

interface CarriagewayQuery {
  /** Ignore carriageways narrower than this. */
  minHalf?: number;
  /** Shrinks (or, when negative, grows) the tested width. */
  inset?: number;
  /** Road that must not mask itself. */
  exclude?: string;
}

/**
 * True when the point lies on tarmac.
 *
 * Two jobs, separated by the query:
 *
 *  - Pavements ask about every carriageway. A pavement runs outside its *own*
 *    kerb, but at a junction it would otherwise carry straight on across the
 *    street it crosses.
 *  - Lane markings ask about every *other* road of comparable width. Where two
 *    real streets meet, the junction box is bare tarmac — neither road's lines
 *    run through it. Without this, every crossing pair paints a lattice over
 *    the intersection.
 */
function onCarriageway(
  ways: Carriageway[],
  x: number,
  z: number,
  query: CarriagewayQuery = {},
): boolean {
  const minHalf = query.minHalf ?? 0;
  const inset = query.inset ?? 0.05;

  for (const way of ways) {
    if (way.half < minHalf) continue;
    if (way.id === query.exclude) continue;
    if (x < way.minX || x > way.maxX || z < way.minZ || z > way.maxZ) continue;
    const limit = way.half - inset;
    for (let i = 0; i < way.points.length - 1; i++) {
      const a = way.points[i];
      const b = way.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-6) continue;

      // Deliberately *not* clamped to the segment. A carriageway is the swept
      // rectangle, not a capsule: clamping would add a half-width round cap at
      // each end, and OSM splits a long street into several ways, so every way
      // boundary would then mask its own continuation for half a road width.
      const t = ((x - a.x) * dx + (z - a.z) * dz) / lengthSq;
      if (t < 0 || t > 1) continue;
      if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < limit) return true;
    }
  }
  return false;
}

/**
 * A road line running parallel to the centreline at `offset`.
 *
 * Solid and broken lines share one path: both are laid down as a run of short
 * bars, a solid line simply using bars long enough to touch. That is what lets
 * a junction cut a hole in a solid edge line — a single long ribbon is
 * all-or-nothing.
 */
function emitLine(
  out: number[],
  points: LocalPoint[],
  offset: number,
  y: number,
  dashed: boolean,
  skip?: (x: number, z: number) => boolean,
): void {
  const line = offset === 0 ? points : offsetPolyline(points, offset);
  const lengths = arcLengths(line);
  const total = lengths[lengths.length - 1];

  const stride = dashed ? ROADS.dashLength + ROADS.dashGap : ROADS.solidStep;
  const barLength = dashed ? ROADS.dashLength : ROADS.solidStep * ROADS.solidOverlap;
  if (total < stride) return;

  for (let distance = stride / 2; distance < total; distance += stride) {
    const sample = sampleAt(line, lengths, distance);
    if (skip && skip(sample.x, sample.z)) continue;
    emitBar(out, sample, barLength, ROADS.markingWidth, y);
  }
}

/**
 * Korean road markings.
 *
 * The three line types are not interchangeable, and getting them right is most
 * of what makes a road read as Korean rather than generic:
 *
 *   - 가장자리선: a solid white line just inside each kerb.
 *   - 차선: broken white lines between lanes running the same way.
 *   - 중앙선: a solid *yellow* line between opposing traffic, doubled once the
 *     road is wide enough. One-way roads have no centre line at all.
 */
function emitLaneMarkings(
  white: number[],
  yellow: number[],
  road: RoadPath,
  points: LocalPoint[],
  skip: (x: number, z: number) => boolean,
): void {
  const half = road.width / 2;
  const y = ROADS.y.marking;

  const inner = half - ROADS.edgeInset;
  if (inner > ROADS.markingWidth) {
    emitLine(white, points, inner, y, false, skip);
    emitLine(white, points, -inner, y, false, skip);
  }

  if (road.width < ROADS.minWidthForCentreLine) return;

  const lanes =
    road.lanes > 0 ? road.lanes : Math.max(2, Math.round(road.width / ROADS.laneWidth));
  const laneWidth = road.width / lanes;
  // With an even lane count the middle boundary sits exactly on the centreline.
  const centreBoundary = lanes % 2 === 0 ? lanes / 2 : -1;

  for (let i = 1; i < lanes; i++) {
    if (!road.oneway && i === centreBoundary) continue;
    emitLine(white, points, -half + i * laneWidth, y, true, skip);
  }

  if (road.oneway) return;

  if (lanes >= ROADS.doubleCentreLineLanes) {
    emitLine(yellow, points, ROADS.centreLineGap, y, false, skip);
    emitLine(yellow, points, -ROADS.centreLineGap, y, false, skip);
  } else {
    emitLine(yellow, points, 0, y, false, skip);
  }
}

/** Zebra bars laid across a real OSM pedestrian crossing. */
function emitCrossing(out: number[], points: LocalPoint[]): void {
  const lengths = arcLengths(points);
  const total = lengths[lengths.length - 1];
  const stride = ROADS.crossingBarLength + ROADS.crossingBarGap;
  if (total < stride) return;

  for (let distance = stride / 2; distance < total; distance += stride) {
    const sample = sampleAt(points, lengths, distance);
    emitBar(out, sample, ROADS.crossingBarLength, ROADS.crossingWidth, ROADS.y.marking);
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

function toGeometry(positions: number[], uvs?: number[]): BufferGeometry | null {
  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  if (uvs && uvs.length > 0) {
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A predicate answering "is this point on tarmac?".
 *
 * Shared with the street lighting, which has the same problem the pavement has:
 * a lamp post placed by walking a road's centreline would otherwise land in the
 * middle of the junction it crosses.
 *
 * `exclude` is the road the point belongs to. It matters: the carriageway is
 * widened by the margin here, so without it a lamp standing just outside its
 * own kerb is masked by its own road and no lamp is ever placed.
 */
export function createCarriagewayMask(
  city: CityData,
): (x: number, z: number, exclude?: string) => boolean {
  const ways = buildCarriageways(city);
  return (x, z, exclude) =>
    // Every road but the point's own, with a margin, so a post keeps clear of
    // the junction it stands beside...
    onCarriageway(ways, x, z, { inset: -1, exclude }) ||
    // ...and then its own road too, at its true width. The exclusion above is
    // about the segment the post was measured from; a hairpin brings another
    // segment of the same way back round underneath it.
    onCarriageway(ways, x, z, { inset: 0.5 });
}

export function buildRoadGeometry(city: CityData): RoadGeometry {
  const sidewalkParts: number[] = [];
  const sidewalkUvs: number[] = [];
  const tactileParts: number[] = [];
  const tactileUvs: number[] = [];
  const asphaltParts: number[] = [];
  const footpathParts: number[] = [];
  const whiteParts: number[] = [];
  const yellowParts: number[] = [];

  const sidewalkClasses = new Set<string>(ROADS.sidewalkClasses);
  const carriageways = buildCarriageways(city);
  const offRoad = (x: number, z: number) => onCarriageway(carriageways, x, z);

  for (const road of city.roads) {
    const points = cleanPolyline(road.points.map(latLonToLocal));
    if (points.length < 2) continue;

    if (road.crossing) {
      emitCrossing(whiteParts, points);
      continue;
    }

    const half = road.width / 2;

    if (road.footpath) {
      emitRibbon(footpathParts, points, -half, half, ROADS.y.asphalt);
      continue;
    }

    if (sidewalkClasses.has(road.kind)) {
      // Two bands sitting *outside* the kerb, not one wide ribbon spanning the
      // whole street. The wide version relied on the carriageway being painted
      // over the top of it, which falls apart at a junction: the paving of one
      // road ends up laid across the tarmac of the other.
      // Resampled so the clip can cut a pavement at the kerb of every street it
      // crosses, rather than all-or-nothing over a whole OSM segment.
      const dense = resamplePolyline(points, ROADS.pavementStep);
      const kerb = half + ROADS.sidewalkWidth;
      const sidewalkUv = { out: sidewalkUvs, scale: ROADS.sidewalkTileSize };
      emitRibbon(sidewalkParts, dense, half, kerb, ROADS.y.sidewalk, sidewalkUv, offRoad);
      emitRibbon(sidewalkParts, dense, -kerb, -half, ROADS.y.sidewalk, sidewalkUv, offRoad);

      // 점자블록 down the middle of each pavement, on both sides.
      const strip = half + ROADS.sidewalkWidth * ROADS.tactileOffset;
      const halfStrip = ROADS.tactileWidth / 2;
      const tactileUv = { out: tactileUvs, scale: ROADS.tactileTileSize };
      emitRibbon(tactileParts, dense, strip - halfStrip, strip + halfStrip, ROADS.y.tactile, tactileUv, offRoad);
      emitRibbon(tactileParts, dense, -strip - halfStrip, -strip + halfStrip, ROADS.y.tactile, tactileUv, offRoad);
    }

    emitRibbon(asphaltParts, points, -half, half, ROADS.y.asphalt);

    // Markings stop inside any other comparable road, leaving the junction box
    // itself clean — which is what a real intersection looks like.
    const yieldTo = half * ROADS.markingYieldRatio;
    emitLaneMarkings(whiteParts, yellowParts, road, points, (x, z) =>
      onCarriageway(carriageways, x, z, {
        minHalf: yieldTo,
        inset: -ROADS.markingWidth,
        exclude: road.id,
      }),
    );
  }

  const sidewalks = toGeometry(sidewalkParts, sidewalkUvs);
  const tactile = toGeometry(tactileParts, tactileUvs);
  const asphalt = toGeometry(asphaltParts);
  const footpaths = toGeometry(footpathParts);
  const whiteMarkings = toGeometry(whiteParts);
  const yellowMarkings = toGeometry(yellowParts);

  return {
    sidewalks,
    tactile,
    asphalt,
    footpaths,
    whiteMarkings,
    yellowMarkings,
    dispose: () => {
      sidewalks?.dispose();
      tactile?.dispose();
      asphalt?.dispose();
      footpaths?.dispose();
      whiteMarkings?.dispose();
      yellowMarkings?.dispose();
    },
  };
}
