// Loads the chopping stump environment and pinpoints the chopping block's
// flat top so the active log can sit on it.
//
// IMPORTANT geometry notes from the actual GLBs:
//   * stump_mesh.glb is a wide environment (≈7m × 11m) with multiple
//     decorative stumps already baked into one mesh — *not* a single
//     stump. We add it as-is.
//   * stump_data.glb contains a single low-poly `stump_collider` mesh that
//     wraps just the active chopping block at the world origin (y range
//     -0.33..0). Its top tells us where the log should rest.
//   * There is NO `instance` empty in stump_data.glb in this build, so we
//     only create a mirrored second stump if the empty actually shows up.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface StumpResult {
  group: THREE.Group;
  /** World Y of the chopping block's flat top (where the log sits). */
  primaryTopY: number;
  /** World XZ centre of the chopping block. */
  primaryCenter: THREE.Vector3;
  /** Optional collider mesh (not added to the scene). */
  collider: THREE.Mesh | null;
}

function tuneStump(material: THREE.MeshStandardMaterial): void {
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  if (material.emissiveMap)
    material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  material.color.set(0xffffff);
  material.metalness = 0;
  material.roughness = Math.max(material.roughness, 0.7);
}

export function buildStump(
  meshGltf: GLTF,
  dataGltf: GLTF,
  parent: THREE.Group | THREE.Scene,
): StumpResult {
  const group = new THREE.Group();
  group.name = "stumps";
  parent.add(group);

  const primary = meshGltf.scene;
  primary.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      const m = obj.material;
      if (m instanceof THREE.MeshStandardMaterial) tuneStump(m);
    }
  });
  group.add(primary);

  // Inspect the data glb for both the collider (chopping-block bounds) and
  // an optional mirror instance.
  let collider: THREE.Mesh | null = null;
  let instancePos: THREE.Vector3 | null = null;
  let instanceQuat: THREE.Quaternion | null = null;
  let instanceScale: THREE.Vector3 | null = null;
  dataGltf.scene.updateMatrixWorld(true);
  dataGltf.scene.traverse((obj) => {
    if (obj.name === "stump_collider" && obj instanceof THREE.Mesh) {
      collider = obj;
    }
    if (obj.name === "instance") {
      obj.updateWorldMatrix(true, false);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      obj.matrixWorld.decompose(p, q, s);
      instancePos = p;
      instanceQuat = q;
      instanceScale = s;
    }
  });

  if (instancePos && instanceQuat && instanceScale) {
    // Real instance node found — mirror the environment as the original does.
    const mirror = primary.clone(true);
    mirror.position.copy(instancePos);
    mirror.quaternion.copy(instanceQuat);
    mirror.scale.copy(instanceScale);
    mirror.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    group.add(mirror);
  }

  // Use the collider's bounding box if present — that's the chopping block.
  // Falling back to the full mesh bbox would point us at whichever stump in
  // the environment happens to be tallest, which is not where the log goes.
  let primaryTopY = 0;
  const primaryCenter = new THREE.Vector3(0, 0, 0);
  if (collider) {
    const box = new THREE.Box3().setFromObject(collider);
    primaryTopY = box.max.y;
    const c = new THREE.Vector3();
    box.getCenter(c);
    primaryCenter.set(c.x, primaryTopY, c.z);
  }

  return { group, primaryTopY, primaryCenter, collider };
}
