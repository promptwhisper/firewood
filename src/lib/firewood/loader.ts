// Loads every binary asset the simulator needs and reports progress.
// Returns a single bag of THREE objects so the rest of the codebase doesn't
// need to know how each loader works.
//
// Progress event count matches the original game (44 ticks):
//   4 GLB models + 6 JPG textures + 32 audio files + 2 gobo video clones
// AudioBus and gobo.ts both receive the already-loaded blobs so they
// don't re-fetch.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

import { ASSETS } from "./assets";

export interface LoadedAssets {
  stumpMesh: GLTF;
  stumpData: GLTF;
  axStatic: GLTF;
  axAnim: GLTF;
  textures: {
    bark: THREE.Texture;
    barkN: THREE.Texture;
    top: THREE.Texture;
    topN: THREE.Texture;
    grain: THREE.Texture;
    grainN: THREE.Texture;
    gameplay: {
      barkColor: THREE.Texture;
      barkNormal: THREE.Texture;
      barkRoughness: THREE.Texture;
      treeEndDark: THREE.Texture;
      treeEndDarkNormal: THREE.Texture;
      treeEndWarm: THREE.Texture;
      treeEndWarmNormal: THREE.Texture;
      rockColor: THREE.Texture;
      rockNormal: THREE.Texture;
      rockRoughness: THREE.Texture;
      fireDensity: THREE.Texture;
    };
  };
  /** Pair of independent preloaded gobo videos — one per plane. */
  goboVideos: HTMLVideoElement[];
}

export interface LoaderHooks {
  onProgress?: (loaded: number, total: number) => void;
}

function loadTexture(
  loader: THREE.TextureLoader,
  url: string,
  isColor: boolean,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      (err) => reject(err),
    );
  });
}

function loadGoboVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.src = url;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    const onLoaded = () => {
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("error", onError);
      v.currentTime = Math.random() * Math.max(0.1, v.duration);
      void v.play().catch(() => undefined);
      resolve(v);
    };
    const onError = () => {
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("error", onError);
      reject(new Error(`Failed to load gobo video at ${url}`));
    };
    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("error", onError);
    v.load();
  });
}

function loadAudio(url: string): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.preload = "auto";
    a.crossOrigin = "anonymous";
    // Resolve on either canplaythrough OR a timeout — some browsers
    // are stingy about firing canplaythrough until first play attempt.
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      a.removeEventListener("canplaythrough", finish);
      a.removeEventListener("error", finish);
      clearTimeout(timer);
      resolve();
    };
    a.addEventListener("canplaythrough", finish, { once: true });
    a.addEventListener("error", finish, { once: true });
    const timer = setTimeout(finish, 4000);
    a.load();
  });
}

function flattenAudioUrls(): string[] {
  return [
    ASSETS.sounds.bg,
    ASSETS.sounds.drop,
    ...ASSETS.sounds.split,
    ...ASSETS.sounds.splitb,
    ...ASSETS.sounds.stack,
  ];
}

export async function loadAll(
  renderer: THREE.WebGLRenderer,
  hooks: LoaderHooks = {},
): Promise<LoadedAssets> {
  // KTX2 support is required for the stump (Basis-compressed textures).
  const ktx2 = new KTX2Loader()
    .setTranscoderPath(ASSETS.basis.transcoderPath)
    .detectSupport(renderer);

  const gltf = new GLTFLoader();
  gltf.setKTX2Loader(ktx2);

  const tex = new THREE.TextureLoader();

  const audioUrls = flattenAudioUrls();

  const tasks: Array<{
    label: string;
    promise: Promise<unknown>;
  }> = [
    { label: "stumpMesh", promise: gltf.loadAsync(ASSETS.models.stumpMesh) },
    { label: "stumpData", promise: gltf.loadAsync(ASSETS.models.stumpData) },
    { label: "axStatic", promise: gltf.loadAsync(ASSETS.models.axStatic) },
    { label: "axAnim", promise: gltf.loadAsync(ASSETS.models.axAnim) },
    { label: "bark", promise: loadTexture(tex, ASSETS.textures.bark, true) },
    { label: "barkN", promise: loadTexture(tex, ASSETS.textures.barkN, false) },
    { label: "top", promise: loadTexture(tex, ASSETS.textures.top, true) },
    { label: "topN", promise: loadTexture(tex, ASSETS.textures.topN, false) },
    { label: "grain", promise: loadTexture(tex, ASSETS.textures.grain, true) },
    {
      label: "grainN",
      promise: loadTexture(tex, ASSETS.textures.grainN, false),
    },
    {
      label: "gameBarkColor",
      promise: loadTexture(tex, ASSETS.textures.gameplay.barkColor, true),
    },
    {
      label: "gameBarkNormal",
      promise: loadTexture(tex, ASSETS.textures.gameplay.barkNormal, false),
    },
    {
      label: "gameBarkRoughness",
      promise: loadTexture(tex, ASSETS.textures.gameplay.barkRoughness, false),
    },
    {
      label: "treeEndDark",
      promise: loadTexture(tex, ASSETS.textures.gameplay.treeEndDark, true),
    },
    {
      label: "treeEndDarkNormal",
      promise: loadTexture(tex, ASSETS.textures.gameplay.treeEndDarkNormal, false),
    },
    {
      label: "treeEndWarm",
      promise: loadTexture(tex, ASSETS.textures.gameplay.treeEndWarm, true),
    },
    {
      label: "treeEndWarmNormal",
      promise: loadTexture(tex, ASSETS.textures.gameplay.treeEndWarmNormal, false),
    },
    {
      label: "rockColor",
      promise: loadTexture(tex, ASSETS.textures.gameplay.rockColor, true),
    },
    {
      label: "rockNormal",
      promise: loadTexture(tex, ASSETS.textures.gameplay.rockNormal, false),
    },
    {
      label: "rockRoughness",
      promise: loadTexture(tex, ASSETS.textures.gameplay.rockRoughness, false),
    },
    {
      label: "fireDensity",
      promise: loadTexture(tex, ASSETS.textures.gameplay.fireDensity, false),
    },
    { label: "gobo1", promise: loadGoboVideo(ASSETS.video.gobo) },
    { label: "gobo2", promise: loadGoboVideo(ASSETS.video.gobo) },
    ...audioUrls.map((url, i) => ({
      label: `audio${i}`,
      promise: loadAudio(url),
    })),
  ];

  let loaded = 0;
  const total = tasks.length;
  hooks.onProgress?.(0, total);

  const results: Record<string, unknown> = {};
  await Promise.all(
    tasks.map(async (t) => {
      const value = await t.promise;
      results[t.label] = value;
      loaded += 1;
      hooks.onProgress?.(loaded, total);
    }),
  );

  ktx2.dispose();

  return {
    stumpMesh: results.stumpMesh as GLTF,
    stumpData: results.stumpData as GLTF,
    axStatic: results.axStatic as GLTF,
    axAnim: results.axAnim as GLTF,
    textures: {
      bark: results.bark as THREE.Texture,
      barkN: results.barkN as THREE.Texture,
      top: results.top as THREE.Texture,
      topN: results.topN as THREE.Texture,
      grain: results.grain as THREE.Texture,
      grainN: results.grainN as THREE.Texture,
      gameplay: {
        barkColor: results.gameBarkColor as THREE.Texture,
        barkNormal: results.gameBarkNormal as THREE.Texture,
        barkRoughness: results.gameBarkRoughness as THREE.Texture,
        treeEndDark: results.treeEndDark as THREE.Texture,
        treeEndDarkNormal: results.treeEndDarkNormal as THREE.Texture,
        treeEndWarm: results.treeEndWarm as THREE.Texture,
        treeEndWarmNormal: results.treeEndWarmNormal as THREE.Texture,
        rockColor: results.rockColor as THREE.Texture,
        rockNormal: results.rockNormal as THREE.Texture,
        rockRoughness: results.rockRoughness as THREE.Texture,
        fireDensity: results.fireDensity as THREE.Texture,
      },
    },
    goboVideos: [
      results.gobo1 as HTMLVideoElement,
      results.gobo2 as HTMLVideoElement,
    ],
  };
}
