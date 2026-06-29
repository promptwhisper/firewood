// Two video gobo planes act as depth-only occluders so the sun casts a
// dappled leaf shadow on the ground without the planes themselves being
// visible. The custom shader maps video luminance to alpha so the leaves
// stay opaque while gaps stay transparent.

import * as THREE from "three";

import { smoothNoise } from "./units";

interface GoboInstance {
  mesh: THREE.Mesh;
  baseQuat: THREE.Quaternion;
  seed: number;
}

const PLANES: ReadonlyArray<{
  scale: number;
  distance: number;
  lateral: number;
  vertical: number;
}> = [
  { scale: 12, distance: 3, lateral: -3.5, vertical: -3 },
  { scale: 12, distance: 5, lateral: 2.2, vertical: -1.8 },
];

const WAVE_HZ = 0.05;
const WAVE_AMPLITUDE_DEG = 1;

export interface GoboBundle {
  /** Promise that resolves once both videos start playing. */
  ready: Promise<unknown>;
  start(): void;
  update(): void;
  dispose(): void;
}

export function buildGoboPlanes(
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  preloadedVideos: HTMLVideoElement[],
): GoboBundle {
  const sunDir = sun.position.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, sunDir).normalize();
  const waveAxis = sunDir.clone();

  // Each plane already has its own video element preloaded by loader.ts.
  const videos: HTMLVideoElement[] = [];
  const meshes: THREE.Mesh[] = [];
  const instances: GoboInstance[] = [];

  function tweakShader(material: THREE.Material): void {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <alphatest_fragment>",
        `
        float lum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
        diffuseColor.a = 1.0 - lum;
        #include <alphatest_fragment>
        `,
      );
    };
  }

  for (let i = 0; i < PLANES.length; i++) {
    const cfg = PLANES[i];
    const v = preloadedVideos[i] ?? preloadedVideos[0];
    videos.push(v);

    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    tweakShader(material);

    const depthMaterial = new THREE.MeshBasicMaterial({
      map: tex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    tweakShader(depthMaterial);

    const geometry = new THREE.PlaneGeometry(cfg.scale, cfg.scale);
    geometry.translate(0, cfg.scale / 2, 0);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.customDepthMaterial = depthMaterial;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // The plane is a shadow-caster only; depth is what matters.
    mesh.material.colorWrite = false;

    const pos = sunDir
      .clone()
      .multiplyScalar(cfg.distance)
      .add(right.clone().multiplyScalar(cfg.lateral));
    pos.y = cfg.vertical;
    mesh.position.copy(pos);
    mesh.lookAt(0, mesh.position.y, 0);

    scene.add(mesh);
    meshes.push(mesh);
    instances.push({
      mesh,
      baseQuat: mesh.quaternion.clone(),
      seed: Math.random() * 1000,
    });
  }

  function start(): void {
    for (const v of videos) {
      if (v.paused) void v.play().catch(() => undefined);
    }
  }

  function update(): void {
    const t = (performance.now() / 1000) * WAVE_HZ * Math.PI * 2;
    const ampRad = THREE.MathUtils.degToRad(WAVE_AMPLITUDE_DEG);
    for (const inst of instances) {
      const angle = smoothNoise(t, inst.seed) * ampRad;
      const q = new THREE.Quaternion().setFromAxisAngle(waveAxis, angle);
      inst.mesh.quaternion.copy(inst.baseQuat).premultiply(q);
    }
  }

  function dispose(): void {
    for (const m of meshes) {
      scene.remove(m);
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    }
    for (const v of videos) v.pause();
  }

  // Videos are preloaded by loader.ts, so the bundle is ready immediately.
  return {
    ready: Promise.resolve(),
    start,
    update,
    dispose,
  };
}
