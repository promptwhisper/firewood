// Procedural log mesh — cylinder with three multi-octave-noise vertex
// perturbations that make every spawn feel handmade. Sizes are in inches and
// match the original (4.5..8 inch radius, 12..16 inch height, 32x8 segments).

import * as THREE from "three";

import type { LoadedAssets } from "./loader";
import { INCH, woodNoise } from "./units";

export interface LogConfig {
  radiusInch: number;
  heightInch: number;
  radialSegments: number;
  heightSegments: number;
  /** Surface perturbation amplitude in inches. */
  perturbInch: number;
  /** Vertical taper of perturbation (top vs bottom). */
  taper: number;
}

const DEFAULTS = {
  radialSegments: 32,
  heightSegments: 8,
  perturbInch: 0.4,
  taper: 0.15,
};

export interface LogMaterials {
  side: THREE.MeshStandardMaterial;
  top: THREE.MeshStandardMaterial;
  /** Inside grain — used on freshly-cut faces. */
  inner: THREE.MeshStandardMaterial;
}

export interface WoodSpecies {
  id: "oak" | "birch" | "cedar" | "ash";
  name: string;
  materials: LogMaterials;
  scoreMultiplier: number;
}

export function buildLogMaterials(assets: LoadedAssets): LogMaterials {
  // The bark texture wraps both axes, so set the wrap mode again here in case
  // the loader didn't set a particular tiling.
  const bark = assets.textures.bark;
  bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
  const barkN = assets.textures.barkN;
  barkN.wrapS = barkN.wrapT = THREE.RepeatWrapping;
  const grain = assets.textures.grain;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  const grainN = assets.textures.grainN;
  grainN.wrapS = grainN.wrapT = THREE.RepeatWrapping;

  const side = new THREE.MeshStandardMaterial({
    map: bark,
    normalMap: barkN,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.95,
    metalness: 0,
  });
  const top = new THREE.MeshStandardMaterial({
    map: assets.textures.top,
    normalMap: assets.textures.topN,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.9,
    metalness: 0,
  });
  const inner = new THREE.MeshStandardMaterial({
    map: grain,
    normalMap: grainN,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.85,
    metalness: 0,
    // Sliced cut faces can end up either-side-winding depending on which
    // half of the plane the source triangle was on. Render both sides so
    // the inner grain texture is always visible.
    side: THREE.DoubleSide,
  });
  return { side, top, inner };
}

function materialSet(
  bark: THREE.Texture,
  barkNormal: THREE.Texture,
  barkRoughness: THREE.Texture | null,
  end: THREE.Texture,
  endNormal: THREE.Texture,
  tint: number,
): LogMaterials {
  for (const texture of [bark, barkNormal, end, endNormal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  }
  if (barkRoughness) {
    barkRoughness.wrapS = barkRoughness.wrapT = THREE.RepeatWrapping;
  }
  return {
    side: new THREE.MeshStandardMaterial({
      map: bark,
      normalMap: barkNormal,
      roughnessMap: barkRoughness,
      color: tint,
      roughness: 0.94,
    }),
    top: new THREE.MeshStandardMaterial({
      map: end,
      normalMap: endNormal,
      roughness: 0.88,
    }),
    inner: new THREE.MeshStandardMaterial({
      map: end,
      normalMap: endNormal,
      color: tint,
      roughness: 0.82,
      side: THREE.DoubleSide,
    }),
  };
}

export function buildWoodCatalog(assets: LoadedAssets): WoodSpecies[] {
  const original = buildLogMaterials(assets);
  const game = assets.textures.gameplay;
  return [
    { id: "oak", name: "橡木", materials: original, scoreMultiplier: 1 },
    {
      id: "birch",
      name: "桦木",
      materials: materialSet(
        game.barkColor,
        game.barkNormal,
        game.barkRoughness,
        game.treeEndWarm,
        game.treeEndWarmNormal,
        0xd7c7a5,
      ),
      scoreMultiplier: 1.1,
    },
    {
      id: "cedar",
      name: "雪松",
      materials: materialSet(
        game.barkColor,
        game.barkNormal,
        game.barkRoughness,
        game.treeEndDark,
        game.treeEndDarkNormal,
        0x9d6648,
      ),
      scoreMultiplier: 1.25,
    },
    {
      id: "ash",
      name: "白蜡木",
      materials: materialSet(
        game.barkColor,
        game.barkNormal,
        game.barkRoughness,
        game.treeEndWarm,
        game.treeEndWarmNormal,
        0xb5b8aa,
      ),
      scoreMultiplier: 1.4,
    },
  ];
}

export interface LogSpawn {
  mesh: THREE.Mesh;
  radiusInch: number;
  heightInch: number;
}

export function buildLogMesh(mats: LogMaterials, cfg?: Partial<LogConfig>): LogSpawn {
  const radiusInch = cfg?.radiusInch ?? (9 + Math.random() * 7) / 2;
  const heightInch = cfg?.heightInch ?? 12 + Math.random() * 4;
  const radialSegments = cfg?.radialSegments ?? DEFAULTS.radialSegments;
  const heightSegments = cfg?.heightSegments ?? DEFAULTS.heightSegments;
  const perturbInch = cfg?.perturbInch ?? DEFAULTS.perturbInch;
  const taper = cfg?.taper ?? DEFAULTS.taper;

  const radius = radiusInch * INCH;
  const height = heightInch * INCH;

  // CylinderGeometry produces 3 groups (side, top, bottom) which map cleanly
  // to [side, top, top].
  const geo = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    radialSegments,
    heightSegments,
    false,
  );

  const seed = Math.random() * 1000;
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.sqrt(v.x * v.x + v.z * v.z);
    if (r < 1e-6) continue; // top/bottom centre vertex
    const theta = Math.atan2(v.z, v.x);
    const yNorm = v.y / height + 0.5; // 0 (bottom) -> 1 (top)
    const a = woodNoise(theta * 3, seed);
    const b = woodNoise(theta * 3, seed + 42);
    const blend = THREE.MathUtils.lerp(b, a, yNorm);
    const offset = blend * (perturbInch * (1 + (1 - yNorm) * taper) * INCH);
    const scale = (r + offset) / r;
    pos.setXYZ(i, v.x * scale, v.y, v.z * scale);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Centre to bounding box so spawn placement is consistent regardless of
  // perturbation skew.
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox?.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);

  const mesh = new THREE.Mesh(geo, [mats.side, mats.top, mats.top]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    isLog: true,
    isSplittable: true,
    isFirewood: false,
    radiusInch,
    heightInch,
  };

  return { mesh, radiusInch, heightInch };
}
