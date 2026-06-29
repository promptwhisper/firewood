// Single-plane mesh slicer for indexed BufferGeometry.
//
// Walks every triangle, classifies its vertices as "above" or "below" the cut
// plane, and emits two new geometries:
//   - one for the half above the plane
//   - one for the half below the plane
// Triangles that straddle the plane are split on the fly: their edges that
// cross the plane are interpolated, and the resulting points get fed into
// both halves plus a polygon for the cut face. The cut face is triangulated
// and merged in with a fresh material group so the caller can apply the
// inner-grain texture there.
//
// The implementation accepts the multi-group log geometry the simulator uses
// ([side, top, top]) and produces output of the form [side, top, inner].

import * as THREE from "three";

const EPS = 1e-6;

export interface SlicedHalves {
  above: THREE.BufferGeometry | null;
  below: THREE.BufferGeometry | null;
}

interface VertexBucket {
  positions: number[];
  uvs: number[];
  normals: number[];
  /** Per-output-triangle: the source material slot index (0=side, 1=top). */
  groupIndices: number[];
}

interface CutPoint {
  position: THREE.Vector3;
  uv: THREE.Vector2;
}

function newBucket(): VertexBucket {
  return { positions: [], uvs: [], normals: [], groupIndices: [] };
}

function addTri(
  bucket: VertexBucket,
  a: CutPoint,
  b: CutPoint,
  c: CutPoint,
  groupIndex: number,
): void {
  bucket.positions.push(
    a.position.x, a.position.y, a.position.z,
    b.position.x, b.position.y, b.position.z,
    c.position.x, c.position.y, c.position.z,
  );
  bucket.uvs.push(a.uv.x, a.uv.y, b.uv.x, b.uv.y, c.uv.x, c.uv.y);
  // Recompute a flat normal so reused vertices keep faceted shading on the
  // cut face. The bark/top groups still rely on the original normals which
  // we re-derive from the source positions (they're tangent-plane safe).
  const ab = new THREE.Vector3().subVectors(b.position, a.position);
  const ac = new THREE.Vector3().subVectors(c.position, a.position);
  const n = ab.cross(ac);
  if (n.lengthSq() > EPS * EPS) n.normalize();
  bucket.normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
  bucket.groupIndices.push(groupIndex);
}

function bucketToGeometry(bucket: VertexBucket): THREE.BufferGeometry | null {
  if (bucket.positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(bucket.positions, 3),
  );
  g.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(bucket.normals, 3),
  );
  // Build groups from groupIndices runs.
  let runStart = 0;
  let runIdx = bucket.groupIndices[0];
  for (let i = 1; i <= bucket.groupIndices.length; i++) {
    const idx = bucket.groupIndices[i];
    if (i === bucket.groupIndices.length || idx !== runIdx) {
      g.addGroup(runStart * 3, (i - runStart) * 3, runIdx);
      runStart = i;
      runIdx = idx;
    }
  }
  return g;
}

function lerpPoint(a: CutPoint, b: CutPoint, t: number): CutPoint {
  return {
    position: new THREE.Vector3().lerpVectors(a.position, b.position, t),
    uv: new THREE.Vector2().lerpVectors(a.uv, b.uv, t),
  };
}

function planeIntersect(
  a: CutPoint,
  b: CutPoint,
  da: number,
  db: number,
): CutPoint {
  const t = da / (da - db);
  return lerpPoint(a, b, THREE.MathUtils.clamp(t, 0, 1));
}

/**
 * Build a stable convex cut loop from triangle-plane intersections.
 *
 * The log and every piece produced from it are convex, so a plane intersection
 * is a single convex polygon. Sorting de-duplicated intersection points around
 * their centroid is much more robust than chaining raw triangle segments:
 * non-indexed geometry repeats edge vertices and tiny floating-point gaps can
 * otherwise leave the cap open.
 */
function buildCutLoop(
  points: CutPoint[],
  uAxis: THREE.Vector3,
  vAxis: THREE.Vector3,
): CutPoint[] | null {
  if (points.length < 3) return null;

  const unique: CutPoint[] = [];
  const mergeDistanceSq = 1e-8;
  for (const point of points) {
    const existing = unique.find(
      (candidate) =>
        candidate.position.distanceToSquared(point.position) <= mergeDistanceSq,
    );
    if (!existing) unique.push(point);
  }
  if (unique.length < 3) return null;

  const centroid = new THREE.Vector3();
  for (const point of unique) centroid.add(point.position);
  centroid.divideScalar(unique.length);

  unique.sort((a, b) => {
    const ar = a.position.clone().sub(centroid);
    const br = b.position.clone().sub(centroid);
    const aa = Math.atan2(ar.dot(vAxis), ar.dot(uAxis));
    const ba = Math.atan2(br.dot(vAxis), br.dot(uAxis));
    return aa - ba;
  });

  return unique;
}

function fanTriangulate(
  loop: CutPoint[],
  bucket: VertexBucket,
  flip: boolean,
  uvBuilder: (p: THREE.Vector3) => THREE.Vector2,
  groupIndex: number,
): void {
  if (loop.length < 3) return;
  // Use a centroid-fan so concave cuts don't produce overlapping tris.
  const centroid = new THREE.Vector3();
  for (const p of loop) centroid.add(p.position);
  centroid.divideScalar(loop.length);
  const c: CutPoint = {
    position: centroid,
    uv: uvBuilder(centroid),
  };
  for (let i = 0; i < loop.length; i++) {
    const a: CutPoint = {
      position: loop[i].position,
      uv: uvBuilder(loop[i].position),
    };
    const b: CutPoint = {
      position: loop[(i + 1) % loop.length].position,
      uv: uvBuilder(loop[(i + 1) % loop.length].position),
    };
    if (flip) addTri(bucket, c, b, a, groupIndex);
    else addTri(bucket, c, a, b, groupIndex);
  }
}

export interface SliceOptions {
  /**
   * Material slot to use for the new cut face on each half. Defaults to 2 so
   * the caller can wire `[sideMat, topMat, innerMat]`.
   */
  innerMaterialIndex?: number;
}

/**
 * Port of the original gT helper. Given an impact point in geometry-local
 * space and the desired slice-plane normal, return a point on the plane that
 * keeps both halves substantial — neither half ends up as a thin sliver
 * along an edge.
 *
 * Strategy mirrors the source:
 *   - Project every vertex onto `normal` to find the geometry's extent.
 *   - The impact point's projection determines an initial split ratio.
 *   - Clamp the ratio so the slice is at least `minEdgeOffsetMeters` away
 *     from both extremes.
 */
export function clampSlicePoint(
  geometry: THREE.BufferGeometry,
  localImpact: THREE.Vector3,
  localNormal: THREE.Vector3,
  minEdgeOffsetMeters: number,
): THREE.Vector3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return localImpact.clone();
  const center = new THREE.Vector3();
  box.getCenter(center);

  const positions = geometry.attributes.position;
  const tmp = new THREE.Vector3();
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    tmp.fromBufferAttribute(positions, i);
    const proj = tmp.clone().sub(center).dot(localNormal);
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const span = maxProj - minProj;
  if (span < 1e-4) return localImpact.clone();

  const impactProj = localImpact.clone().sub(center).dot(localNormal);
  let ratio = (impactProj - minProj) / span;

  // Force the slice to live in the middle 70% of the span when the piece is
  // small. Larger pieces use a metric-based clamp so the slice is always at
  // least `minEdgeOffsetMeters` from either rim.
  const metricMinRatio = Math.min(0.45, minEdgeOffsetMeters / span);
  const minRatio = Math.max(0.15, metricMinRatio);
  ratio = Math.max(minRatio, Math.min(1 - minRatio, ratio));

  const newProj = minProj + ratio * span;
  return center
    .clone()
    .add(localNormal.clone().multiplyScalar(newProj));
}

/**
 * Slice the geometry (assumed to be in object-local space) by `plane`. The
 * plane is also expressed in object-local space.
 */
export function sliceGeometry(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  opts: SliceOptions = {},
): SlicedHalves {
  const innerIdx = opts.innerMaterialIndex ?? 2;

  const src = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = src.attributes.position as THREE.BufferAttribute;
  const uv = src.attributes.uv as THREE.BufferAttribute | undefined;

  // Build per-triangle group lookup.
  const triCount = pos.count / 3;
  const triGroup: number[] = new Array(triCount).fill(0);
  if (src.groups.length > 0) {
    for (const g of src.groups) {
      const startTri = Math.floor(g.start / 3);
      const endTri = Math.floor((g.start + g.count) / 3);
      for (let i = startTri; i < endTri; i++) triGroup[i] = g.materialIndex ?? 0;
    }
  }

  const above = newBucket();
  const below = newBucket();
  const cutPoints: CutPoint[] = [];

  const tmp = new THREE.Vector3();
  const fallbackUv = new THREE.Vector2();

  function vertAt(i: number): CutPoint {
    tmp.fromBufferAttribute(pos, i);
    let u = 0;
    let v = 0;
    if (uv) {
      u = uv.getX(i);
      v = uv.getY(i);
    }
    return {
      position: tmp.clone(),
      uv: new THREE.Vector2(u, v),
    };
  }

  function classify(p: THREE.Vector3): number {
    const d = plane.distanceToPoint(p);
    return Math.abs(d) < EPS ? 0 : d;
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const a = vertAt(i0);
    const b = vertAt(i0 + 1);
    const c = vertAt(i0 + 2);
    const da = classify(a.position);
    const db = classify(b.position);
    const dc = classify(c.position);
    const groupIndex = triGroup[t];

    const aboveCount = (da > 0 ? 1 : 0) + (db > 0 ? 1 : 0) + (dc > 0 ? 1 : 0);
    const belowCount = (da < 0 ? 1 : 0) + (db < 0 ? 1 : 0) + (dc < 0 ? 1 : 0);

    if (belowCount === 0) {
      addTri(above, a, b, c, groupIndex);
      continue;
    }
    if (aboveCount === 0) {
      addTri(below, a, b, c, groupIndex);
      continue;
    }

    // Triangle straddles the plane. Categorise vertices.
    const verts = [a, b, c];
    const ds = [da, db, dc];

    if (aboveCount === 1) {
      // 1 above + 2 below
      const ai = ds.findIndex((d) => d > 0);
      const top = verts[ai];
      const m1 = verts[(ai + 1) % 3];
      const m2 = verts[(ai + 2) % 3];
      const dTop = ds[ai];
      const dM1 = ds[(ai + 1) % 3];
      const dM2 = ds[(ai + 2) % 3];
      const i1 = planeIntersect(top, m1, dTop, dM1);
      const i2 = planeIntersect(top, m2, dTop, dM2);
      addTri(above, top, i1, i2, groupIndex);
      addTri(below, m1, m2, i2, groupIndex);
      addTri(below, m1, i2, i1, groupIndex);
      cutPoints.push(i1, i2);
    } else {
      // 2 above + 1 below
      const bi = ds.findIndex((d) => d < 0);
      const bot = verts[bi];
      const m1 = verts[(bi + 1) % 3];
      const m2 = verts[(bi + 2) % 3];
      const dBot = ds[bi];
      const dM1 = ds[(bi + 1) % 3];
      const dM2 = ds[(bi + 2) % 3];
      const i1 = planeIntersect(bot, m1, dBot, dM1);
      const i2 = planeIntersect(bot, m2, dBot, dM2);
      addTri(below, bot, i1, i2, groupIndex);
      addTri(above, m1, m2, i2, groupIndex);
      addTri(above, m1, i2, i1, groupIndex);
      cutPoints.push(i1, i2);
    }
  }

  // Build the cut face on both halves. Project onto an orthonormal basis on
  // the plane to get UVs that wrap the inside-grain texture sensibly.
  const pn = plane.normal.clone().normalize();
  const helper =
    Math.abs(pn.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const uAxis = new THREE.Vector3().crossVectors(pn, helper).normalize();
  const vAxis = new THREE.Vector3().crossVectors(pn, uAxis).normalize();

  const cutOrigin = plane.coplanarPoint(new THREE.Vector3());
  const grainScale = 6; // inches per UV — gives a couple of growth rings per piece

  const uvForCut = (p: THREE.Vector3): THREE.Vector2 => {
    const rel = new THREE.Vector3().subVectors(p, cutOrigin);
    return new THREE.Vector2(
      rel.dot(uAxis) * grainScale,
      rel.dot(vAxis) * grainScale,
    );
  };

  const loop = buildCutLoop(cutPoints, uAxis, vAxis);
  if (!loop || loop.length < 3) {
    src.dispose();
    return { above: null, below: null };
  }
  // The sorted loop faces +pn. The positive half needs -pn as its outward
  // cap normal; the negative half needs +pn.
  fanTriangulate(loop, above, true, uvForCut, innerIdx);
  fanTriangulate(loop, below, false, uvForCut, innerIdx);

  src.dispose();
  void fallbackUv;

  return {
    above: bucketToGeometry(above),
    below: bucketToGeometry(below),
  };
}
