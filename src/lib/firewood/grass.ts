// Wind-animated grass field. 10k instanced two-sided ribbon blades scattered
// in an annulus around the stump, swayed by a vertex-shader wind field with
// per-blade phase. Driven by uTime; the caller advances it each frame.
//
// Numbers and shader logic come straight from the source's IT/NT/PT/FT
// pipeline: 4-segment tapered ribbon, density^1.5 importance sampling, dark→
// light per-blade colour mix, quadratic-from-base wind influence, cheap
// translucent backlight tied to the sun.

import * as THREE from "three";

import { FOOT, INCH, isMobileUA } from "./units";

const GRASS_BLADE_COUNT = isMobileUA() ? 4000 : 10000;
const GRASS_INNER_RADIUS = 12 * INCH + 0.01; // keep blades clear of the stump
const GRASS_OUTER_RADIUS = 10 * FOOT;
const BLADE_BASE_WIDTH = 0.008; // 8 mm wide at the root
const BLADE_HEIGHT_MIN = 0.05;
const BLADE_HEIGHT_MAX = 0.1;
const WIND_STRENGTH = 0.02;
const WIND_SPEED = 1.2;

/** World Y at which the grass plane (and stump base) sit. */
export const GROUND_Y = -0.33;

interface BladeInstance {
  x: number;
  z: number;
  height: number;
  rotY: number;
  phase: number;
  colorMix: number;
}

function buildBladeGeometry(): THREE.BufferGeometry {
  // Four height segments, tapered from base (full width) to tip (30% width).
  // Two verts per segment so we end with a 4-quad strip ribbon.
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= 3; r++) {
    const i = r / 3;
    const a = (BLADE_BASE_WIDTH / 2) * (1 - i * 0.7);
    positions.push(-a, i, 0);
    positions.push(a, i, 0);
    normals.push(0, 0, 1, 0, 0, 1);
    uvs.push(0, i, 1, i);
  }
  for (let e = 0; e < 3; e++) {
    const t = e * 2;
    const n = e * 2 + 1;
    const i = (e + 1) * 2;
    const a = (e + 1) * 2 + 1;
    indices.push(t, n, i);
    indices.push(n, a, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

function generateBladePlacements(count: number): BladeInstance[] {
  const out: BladeInstance[] = [];
  const range = GRASS_OUTER_RADIUS - GRASS_INNER_RADIUS;
  // Importance-sample so density is highest near the stump and falls off.
  while (out.length < count) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random();
    const distance = GRASS_INNER_RADIUS + r * range;
    const accept = (1 - r) ** 1.5;
    if (Math.random() > accept) continue;
    out.push({
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      height:
        BLADE_HEIGHT_MIN +
        Math.random() * (BLADE_HEIGHT_MAX - BLADE_HEIGHT_MIN),
      rotY: Math.random() * Math.PI,
      phase: Math.random() * Math.PI * 2,
      colorMix: Math.random(),
    });
  }
  return out;
}

interface WindUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uWindSpeed: { value: number };
  uWinter: { value: number };
}

function buildGrassMaterial(): {
  material: THREE.MeshStandardMaterial;
  uniforms: WindUniforms;
} {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.2, 0.35, 0.1),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const uniforms: WindUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: WIND_STRENGTH },
    uWindSpeed: { value: WIND_SPEED },
    uWinter: { value: 0 },
  };
  material.userData.windUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `
      attribute vec3 aOffset;
      attribute float aHeight;
      attribute float aRotY;
      attribute float aPhase;
      attribute float aColorMix;

      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;

      varying float vGrassHeight;
      varying float vGrassColorMix;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `
      // Per-instance Y rotation applied to the blade normal too.
      float cosRN = cos(aRotY);
      float sinRN = sin(aRotY);
      vec3 objectNormal = vec3(
        normal.x * cosRN - normal.z * sinRN,
        normal.y,
        normal.x * sinRN + normal.z * cosRN
      );
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec3 transformed = position;
      transformed.y *= aHeight;

      float cosR = cos(aRotY);
      float sinR = sin(aRotY);
      transformed = vec3(
        transformed.x * cosR - transformed.z * sinR,
        transformed.y,
        transformed.x * sinR + transformed.z * cosR
      );

      // Quadratic-from-base wind so the tips bend more than the roots.
      float windInfluence = uv.y * uv.y;
      float windX = sin(uTime * uWindSpeed + aPhase + aOffset.x * 3.0) * uWindStrength * windInfluence;
      float windZ = cos(uTime * uWindSpeed * 0.7 + aPhase + aOffset.z * 2.5) * uWindStrength * 0.4 * windInfluence;
      transformed.x += windX;
      transformed.z += windZ;

      transformed += aOffset;

      vGrassHeight = uv.y;
      vGrassColorMix = aColorMix;
      `,
    );

    shader.fragmentShader =
      `
      varying float vGrassHeight;
      varying float vGrassColorMix;
      uniform float uWinter;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      vec3 darkGreen = vec3(0.08, 0.15, 0.04);
      vec3 lightGreen = vec3(0.20, 0.40, 0.10);
      vec3 dryGreen = vec3(0.20, 0.30, 0.10);
      vec3 grassBase = mix(darkGreen, lightGreen, vGrassColorMix);
      grassBase = mix(grassBase, dryGreen, vGrassColorMix * 0.3);
      vec3 grassColor = mix(grassBase * 0.7, grassBase * 1.2, vGrassHeight);
      vec3 dormantGrass = vec3(0.18, 0.19, 0.17);
      grassColor = mix(grassColor, dormantGrass, uWinter * 0.94);
      float frost = smoothstep(0.28, 0.95, vGrassHeight);
      frost *= 0.55 + vGrassColorMix * 0.45;
      grassColor = mix(grassColor, vec3(0.78, 0.84, 0.86), frost * uWinter * 0.58);
      diffuseColor.rgb = grassColor;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `
      #include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        vec3 backLightDir = directionalLights[0].direction;
        float NdotL = dot(normal, backLightDir);
        float sss = pow(max(0.0, -NdotL), 1.5) * 0.6;
        sss *= vGrassHeight;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          float grassShadow = getShadow(
            directionalShadowMap[0],
            directionalLightShadows[0].shadowMapSize,
            directionalLightShadows[0].shadowIntensity,
            directionalLightShadows[0].shadowBias,
            directionalLightShadows[0].shadowRadius,
            vDirectionalShadowCoord[0]
          );
          sss *= grassShadow;
        #endif
        vec3 sssColor = vec3(0.5, 0.7, 0.15) * directionalLights[0].color * sss;
        reflectedLight.directDiffuse += sssColor * diffuseColor.rgb;
      #endif
      `,
    );
  };
  return { material, uniforms };
}

export interface GrassField {
  mesh: THREE.Mesh;
  setWinter(amount: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildGrassField(scene: THREE.Scene): GrassField {
  const placements = generateBladePlacements(GRASS_BLADE_COUNT);

  const blade = buildBladeGeometry();
  const inst = new THREE.InstancedBufferGeometry();
  inst.index = blade.index;
  inst.setAttribute("position", blade.getAttribute("position"));
  inst.setAttribute("normal", blade.getAttribute("normal"));
  inst.setAttribute("uv", blade.getAttribute("uv"));

  const off = new Float32Array(placements.length * 3);
  const hgt = new Float32Array(placements.length);
  const rot = new Float32Array(placements.length);
  const pha = new Float32Array(placements.length);
  const col = new Float32Array(placements.length);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    off[i * 3 + 0] = p.x;
    off[i * 3 + 1] = GROUND_Y;
    off[i * 3 + 2] = p.z;
    hgt[i] = p.height;
    rot[i] = p.rotY;
    pha[i] = p.phase;
    col[i] = p.colorMix;
  }
  inst.setAttribute("aOffset", new THREE.InstancedBufferAttribute(off, 3));
  inst.setAttribute("aHeight", new THREE.InstancedBufferAttribute(hgt, 1));
  inst.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rot, 1));
  inst.setAttribute("aPhase", new THREE.InstancedBufferAttribute(pha, 1));
  inst.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(col, 1));
  inst.instanceCount = placements.length;

  const { material, uniforms } = buildGrassMaterial();

  const mesh = new THREE.Mesh(inst, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);

  function update(dt: number): void {
    uniforms.uTime.value += dt;
  }

  function setWinter(amount: number): void {
    uniforms.uWinter.value = THREE.MathUtils.clamp(amount, 0, 1);
  }

  function dispose(): void {
    scene.remove(mesh);
    inst.dispose();
    blade.dispose();
    material.dispose();
  }

  return { mesh, setWinter, update, dispose };
}
