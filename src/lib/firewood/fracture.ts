// Multi-piece fracture wrapper. Iteratively slices the largest active piece
// with a random plane that passes near the impact point. After K cuts the
// mesh is broken into up to K+1 fragments — visually equivalent to a small
// Voronoi shatter without the cost of building a real cell complex.

import * as THREE from "three";

import { clampSlicePoint, sliceGeometry } from "./slice";
import { INCH } from "./units";

// Original's gT enforces a 2.5" minimum slice offset from any edge — same
// number reproduced here.
const MIN_EDGE_OFFSET_M = 2.5 * INCH;
// If either half's bbox is thinner than this on any axis, we treat the
// slice as degenerate and skip it (prevents the "thin wafer" artefact).
const MIN_HALF_THICKNESS_M = 0.012;

export interface FractureOptions {
  /** How many extra cuts to apply (1 -> 2 pieces, 2 -> up to 3, etc). */
  cuts: number;
  /** World-space impact point — random planes pivot around this. */
  impactPoint: THREE.Vector3;
  /** Bias direction for the FIRST plane normal (e.g. camera right). */
  primaryNormal: THREE.Vector3;
  /** Spread of subsequent planes (radians, 0 = identical to primary). */
  spread?: number;
  /** Distance from the impact point each plane may shift. */
  jitterMeters?: number;
  /** Material slot to use for the cut face. */
  innerMaterialIndex?: number;
}

export interface FracturePiece {
  geometry: THREE.BufferGeometry;
  /** World-space centroid of the piece's local bounding box. */
  worldCenter: THREE.Vector3;
}

/**
 * Slice `source` into multiple pieces. Returns at least one piece per call;
 * if the slicing fails on every attempt, the input geometry is returned
 * untouched (wrapped as a single piece).
 */
export function fractureMesh(
  source: THREE.Mesh,
  options: FractureOptions,
): FracturePiece[] {
  source.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(source.matrixWorld).invert();
  const localImpact = options.impactPoint.clone().applyMatrix4(inv);
  const localPrimary = options.primaryNormal
    .clone()
    .transformDirection(inv)
    .normalize();
  const innerIdx = options.innerMaterialIndex ?? 2;
  const spread = options.spread ?? Math.PI / 6;
  const jitter = options.jitterMeters ?? 0.04;

  const cuts = Math.max(1, Math.floor(options.cuts));

  // Working set of geometries in the source's local space.
  const pieces: THREE.BufferGeometry[] = [
    source.geometry.index
      ? source.geometry.toNonIndexed()
      : source.geometry.clone(),
  ];

  for (let c = 0; c < cuts; c++) {
    // Pick the largest piece by AABB volume.
    let pickIndex = 0;
    let bestVol = -1;
    for (let i = 0; i < pieces.length; i++) {
      pieces[i].computeBoundingBox();
      const box = pieces[i].boundingBox!;
      const size = new THREE.Vector3();
      box.getSize(size);
      const vol = size.x * size.y * size.z;
      if (vol > bestVol) {
        bestVol = vol;
        pickIndex = i;
      }
    }
    const target = pieces[pickIndex];

    // Plane normal: tilt the primary normal by a random small spread.
    const t = c / cuts;
    const tilt = (Math.random() - 0.5) * 2 * spread * (0.4 + 0.6 * t);
    const yaw = (Math.random() - 0.5) * 2 * spread;
    const normal = localPrimary.clone();
    const axisU = new THREE.Vector3(0, 1, 0);
    const axisV = new THREE.Vector3()
      .crossVectors(normal, axisU)
      .normalize();
    if (axisV.lengthSq() < 1e-6) axisV.set(1, 0, 0);
    normal.applyAxisAngle(axisU, yaw);
    normal.applyAxisAngle(axisV, tilt).normalize();

    // Plane origin: jitter around the impact point …
    const jitterVec = new THREE.Vector3(
      (Math.random() - 0.5),
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5),
    )
      .normalize()
      .multiplyScalar(jitter * (0.4 + Math.random() * 0.8));
    const rawOrigin = localImpact.clone().add(jitterVec);

    // …then clamp it toward the centre so a near-edge impact never produces
    // a paper-thin sliver. Matches the original gT helper's behaviour.
    const safeOrigin = clampSlicePoint(
      target,
      rawOrigin,
      normal,
      MIN_EDGE_OFFSET_M,
    );

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      safeOrigin,
    );

    const halves = sliceGeometry(target, plane, { innerMaterialIndex: innerIdx });
    if (!halves.above || !halves.below) continue;

    // Reject slices that leave either half with too few triangles…
    const aboveTris = halves.above.attributes.position.count / 3;
    const belowTris = halves.below.attributes.position.count / 3;
    if (aboveTris < 6 || belowTris < 6) {
      halves.above.dispose();
      halves.below.dispose();
      continue;
    }
    // …or with a bbox that's degenerate on any axis. A "shell" produced by
    // an off-piece slice has zero thickness on the slice-normal axis.
    halves.above.computeBoundingBox();
    halves.below.computeBoundingBox();
    const sa = new THREE.Vector3();
    const sb = new THREE.Vector3();
    halves.above.boundingBox?.getSize(sa);
    halves.below.boundingBox?.getSize(sb);
    const tooThin =
      Math.min(sa.x, sa.y, sa.z) < MIN_HALF_THICKNESS_M ||
      Math.min(sb.x, sb.y, sb.z) < MIN_HALF_THICKNESS_M;
    if (tooThin) {
      halves.above.dispose();
      halves.below.dispose();
      continue;
    }

    pieces.splice(pickIndex, 1, halves.above, halves.below);
    target.dispose();
  }

  // Centre each fragment on its bounding-box centroid so position/quaternion
  // can be set freely afterwards.
  return pieces.map((g) => {
    g.computeBoundingBox();
    const center = new THREE.Vector3();
    g.boundingBox?.getCenter(center);
    g.translate(-center.x, -center.y, -center.z);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const worldCenter = center.clone().applyMatrix4(source.matrixWorld);
    return { geometry: g, worldCenter };
  });
}
