// Renderer + scene + lights tuned to the same values the original uses:
// NeutralToneMapping, exposure 1, sun (#FFEBCC, intensity 4) at azimuth 120
// elevation 30, AmbientLight (#BADDFF, intensity 2). Shadow map is 4096
// desktop / 2048 mobile and uses a tight orthographic frustum.

import * as THREE from "three";

import { isMobileUA } from "./units";

export const SUN_COLOR = 0xffebcc;
export const SUN_INTENSITY = 4;
export const SUN_AZIMUTH_DEG = 120;
export const SUN_ELEVATION_DEG = 30;
export const SUN_DISTANCE = 8;

export const AMBIENT_COLOR = 0xbaddff;
export const AMBIENT_INTENSITY = 2;

export const CAMERA_FOV = 55;
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 100;

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  /** Sun azimuth (XZ plane, radians) — gobo planes need this. */
  sunAzimuth: number;
  /** Sun elevation (above XZ plane, radians). */
  sunElevation: number;
  setSize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export function buildScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is flagged as deprecated in three r184 — use PCF
  // everywhere; the original toggles between PCF/PCFSoft purely for mobile
  // perf, and PCF is the supported path now.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_NEAR,
    CAMERA_FAR,
  );

  // Sun positioned via spherical coords — gobo planes reuse the same vector.
  const azRad = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  const elRad = THREE.MathUtils.degToRad(SUN_ELEVATION_DEG);
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.set(
    Math.cos(azRad) * Math.cos(elRad) * SUN_DISTANCE,
    Math.sin(elRad) * SUN_DISTANCE,
    Math.sin(azRad) * Math.cos(elRad) * SUN_DISTANCE,
  );
  sun.castShadow = true;
  const shadowSize = isMobileUA() ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = 0;
  sun.shadow.normalBias = 0.005;
  sun.shadow.radius = 4;
  if (!isMobileUA()) sun.shadow.blurSamples = 8;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
  scene.add(ambient);

  function setSize(width: number, height: number, dpr: number): void {
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function dispose(): void {
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose();
      }
    });
  }

  return {
    renderer,
    scene,
    camera,
    sun,
    ambient,
    sunAzimuth: azRad,
    sunElevation: elRad,
    setSize,
    dispose,
  };
}
