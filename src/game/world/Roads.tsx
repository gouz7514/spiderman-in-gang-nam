import type { CanvasTexture } from 'three';
import type { RoadGeometry } from './buildRoadGeometry';

/**
 * Street surface colours.
 *
 * `centreLine` is yellow because that is what a Korean 중앙선 is; set it to
 * `WHITE_MARKING` for a white centre line instead.
 */
const WHITE_MARKING = '#c9ccc4';
const COLORS = {
  /** Multiplied over the paving-block texture, so kept near white. */
  sidewalk: '#e8e6e0',
  /**
   * Mid-grey, not near-black. The pavement beside it is #e8e6e0, and at 16%
   * grey the carriageway had so much less light to reflect that no amount of
   * street lighting made it read as lit — the pools landed on it and stayed
   * brown. Real tarmac is a mid grey in daylight anyway.
   */
  asphalt: '#3a404a',
  footpath: '#4a5261',
  /** 가장자리선 and 차선. */
  whiteMarking: WHITE_MARKING,
  /** 중앙선. */
  centreLine: '#d8b23f',
} as const;

interface RoadsProps {
  roads: RoadGeometry;
  sidewalkTexture: CanvasTexture | null;
  tactileTexture: CanvasTexture | null;
}

/**
 * The street surface, drawn as a stack of flat layers.
 *
 * `polygonOffset` does the real work of keeping them apart: a 24-bit depth
 * buffer resolves only a few centimetres at the far edge of the map, so the
 * small height differences alone would z-fight badly at distance.
 *
 * None of this has a collider, and none of it is a valid web anchor.
 */
export function Roads({ roads, sidewalkTexture, tactileTexture }: RoadsProps) {
  return (
    <>
      {roads.sidewalks && (
        <mesh geometry={roads.sidewalks} receiveShadow dispose={null}>
          <meshLambertMaterial
            color={COLORS.sidewalk}
            map={sidewalkTexture ?? undefined}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}

      {roads.asphalt && (
        <mesh geometry={roads.asphalt} receiveShadow dispose={null}>
          <meshLambertMaterial
            color={COLORS.asphalt}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}

      {roads.footpaths && (
        <mesh geometry={roads.footpaths} receiveShadow dispose={null}>
          <meshLambertMaterial
            color={COLORS.footpath}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}

      {/* 점자블록: in front of its own pavement, but *behind* the carriageway.
          Ahead of the tarmac and the strip would be painted straight across
          every junction it passes through. */}
      {roads.tactile && (
        <mesh geometry={roads.tactile} receiveShadow dispose={null}>
          <meshLambertMaterial
            map={tactileTexture ?? undefined}
            color={tactileTexture ? '#ffffff' : '#c9a63a'}
            polygonOffset
            polygonOffsetFactor={-1.5}
            polygonOffsetUnits={-1.5}
          />
        </mesh>
      )}

      {roads.whiteMarkings && (
        <mesh geometry={roads.whiteMarkings} receiveShadow dispose={null}>
          <meshLambertMaterial
            color={COLORS.whiteMarking}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
      )}

      {roads.yellowMarkings && (
        <mesh geometry={roads.yellowMarkings} receiveShadow dispose={null}>
          <meshLambertMaterial
            color={COLORS.centreLine}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
      )}
    </>
  );
}
