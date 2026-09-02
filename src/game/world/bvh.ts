import { BufferGeometry, Mesh } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

/**
 * Installs three-mesh-bvh's accelerated raycast on Three.js.
 *
 * The merged city mesh is ~20k triangles and we raycast it every frame (web
 * targeting) plus once more for camera collision. A brute-force raycast would
 * cost around a millisecond each; with a BVH it is a few microseconds.
 *
 * `acceleratedRaycast` transparently falls back to the stock implementation
 * for any geometry that has no `boundsTree`, so patching the prototype is safe
 * for every other mesh in the scene.
 */
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;
