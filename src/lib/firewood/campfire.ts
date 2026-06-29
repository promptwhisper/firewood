import * as THREE from "three";
import { FireMesh } from "@wolffo/three-fire/vanilla";

import type { LoadedAssets } from "./loader";

interface Ember {
  sprite: THREE.Sprite;
  phase: number;
  speed: number;
  radius: number;
  lift: number;
}

interface Smoke {
  sprite: THREE.Sprite;
  phase: number;
  radius: number;
  speed: number;
}

function makeSoftTexture(
  inner: string,
  outer: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, outer);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export interface Campfire {
  addFuel(amount?: number): number;
  level(): number;
  setWinter(amount: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildCampfire(
  scene: THREE.Scene,
  assets: LoadedAssets,
): Campfire {
  const root = new THREE.Group();
  root.position.set(1.11, -0.35, -1.17);
  root.visible = false;
  scene.add(root);

  const stoneGeometry = new THREE.DodecahedronGeometry(0.075, 2);
  const stoneMaterial = new THREE.MeshStandardMaterial({
    map: assets.textures.gameplay.rockColor,
    normalMap: assets.textures.gameplay.rockNormal,
    roughnessMap: assets.textures.gameplay.rockRoughness,
    color: 0x777a70,
    roughness: 1,
    metalness: 0,
  });
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const variation = Math.sin(i * 12.9898) * 0.5 + 0.5;
    const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
    stone.position.set(
      Math.cos(angle) * (0.255 + variation * 0.012),
      0.012 + variation * 0.01,
      Math.sin(angle) * (0.255 + variation * 0.012),
    );
    stone.scale.set(
      1 + variation * 0.18,
      0.54 + variation * 0.12,
      0.8 + (1 - variation) * 0.16,
    );
    stone.rotation.set(i * 0.37, -angle + i * 0.17, i * 0.23);
    stone.castShadow = true;
    stone.receiveShadow = true;
    root.add(stone);
  }

  const charredLogMaterial = new THREE.MeshStandardMaterial({
    map: assets.textures.gameplay.barkColor,
    normalMap: assets.textures.gameplay.barkNormal,
    roughnessMap: assets.textures.gameplay.barkRoughness,
    color: 0x2a1b14,
    roughness: 1,
    metalness: 0,
  });
  const charredLogGeometry = new THREE.CylinderGeometry(
    0.035,
    0.043,
    0.38,
    12,
  );
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(charredLogGeometry, charredLogMaterial);
    const angle = (i / 3) * Math.PI;
    log.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
    );
    log.position.y = 0.07 + i * 0.015;
    log.castShadow = true;
    log.receiveShadow = true;
    root.add(log);
  }

  const emberTexture = makeSoftTexture(
    "rgba(255,245,180,1)",
    "rgba(255,90,10,.45)",
  );
  const fire = new FireMesh({
    fireTex: assets.textures.gameplay.fireDensity,
    color: 0xff7a18,
    iterations: 18,
    octaves: 4,
    noiseScale: [1.25, 2.35, 1.25, 0.42],
    magnitude: 1.28,
    lacunarity: 2.1,
    gain: 0.48,
  });
  fire.material.fragmentShader = fire.material.fragmentShader.replace(
    "gl_FragColor = col;",
    "gl_FragColor = col * 0.18;",
  );
  fire.material.needsUpdate = true;
  fire.position.set(0, 0.24, 0);
  fire.scale.set(0.29, 0.46, 0.29);
  fire.renderOrder = 4;
  root.add(fire);

  const smokeTexture = makeSoftTexture(
    "rgba(190,178,160,.32)",
    "rgba(80,72,64,.1)",
  );
  const smoke: Smoke[] = [];
  for (let i = 0; i < 7; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: smokeTexture,
        color: 0xc5b9a6,
        transparent: true,
        depthWrite: false,
      }),
    );
    root.add(sprite);
    smoke.push({
      sprite,
      phase: Math.random(),
      radius: 0.03 + Math.random() * 0.09,
      speed: 0.028 + Math.random() * 0.035,
    });
  }

  const embers: Ember[] = [];
  for (let i = 0; i < 22; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: emberTexture,
        color: 0xffa43a,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    root.add(sprite);
    embers.push({
      sprite,
      phase: Math.random(),
      speed: 0.34 + Math.random() * 0.55,
      radius: 0.04 + Math.random() * 0.16,
      lift: 0.42 + Math.random() * 0.48,
    });
  }

  const light = new THREE.PointLight(0xff8a42, 0, 1.25, 2);
  light.position.y = 0.26;
  light.castShadow = false;
  root.add(light);

  let fuel = 0.24;
  let flare = 0;
  let time = 0;
  let winter = 0;

  function level(): number {
    return THREE.MathUtils.clamp(fuel * winter, 0, 1);
  }

  function setWinter(amount: number): void {
    winter = THREE.MathUtils.clamp(amount, 0, 1);
    root.visible = winter > 0.01;
  }

  function addFuel(amount = 0.16): number {
    fuel = THREE.MathUtils.clamp(fuel + amount * 1.6, 0, 1);
    flare = Math.min(1, flare + 0.6 + amount);
    for (let i = 0; i < Math.min(7, embers.length); i++) {
      const ember = embers[(i * 7 + Math.floor(time * 10)) % embers.length];
      ember.phase = Math.random() * 0.18;
      ember.speed = 0.58 + Math.random() * 0.72;
    }
    return fuel;
  }

  function update(dt: number): void {
    time += dt;
    fuel = Math.max(0.14, fuel - dt * 0.024);
    flare = Math.max(0, flare - dt * 1.15);
    const power = THREE.MathUtils.clamp(fuel, 0, 1);
    const heat = THREE.MathUtils.clamp(power + flare * 0.62, 0, 1.2);
    const flicker =
      0.8 +
      Math.sin(time * 13.1) * 0.14 +
      Math.sin(time * 27.3 + 1.4) * 0.08 +
      Math.random() * 0.08;
    light.intensity = (0.04 + heat * 0.62) * flicker * winter;
    light.distance = 0.72 + heat * 0.52;

    const flamePulse =
      0.94 +
      Math.sin(time * 7.3) * 0.035 +
      Math.sin(time * 14.7 + 0.8) * 0.018;
    fire.scale.set(
      (0.14 + heat * 0.03) * flamePulse * winter,
      (0.21 + heat * 0.075 + flare * 0.035) * flamePulse * winter,
      (0.14 + heat * 0.03) * flamePulse * winter,
    );
    fire.position.y = fire.scale.y * 0.49;
    fire.magnitude = 1.12 + heat * 0.34;
    fire.update(time);

    for (const ember of embers) {
      ember.phase = (ember.phase + dt * ember.speed * (0.18 + heat)) % 1;
      const angle = ember.phase * Math.PI * 8.5 + ember.radius * 13 + time * 0.6;
      ember.sprite.position.set(
        Math.cos(angle) * ember.radius * ember.phase,
        0.16 + ember.phase * ember.lift * (0.45 + heat),
        Math.sin(angle) * ember.radius * ember.phase,
      );
      const size = (0.007 + heat * 0.014) * (1 - ember.phase);
      ember.sprite.scale.set(size, size, 1);
      ember.sprite.material.opacity = THREE.MathUtils.clamp(
        (power * 0.5 + flare * 0.55) * (1 - ember.phase),
        0,
        1,
      );
    }

    for (const puff of smoke) {
      puff.phase = (puff.phase + dt * puff.speed * (0.55 + power)) % 1;
      const angle = puff.phase * Math.PI * 2.4 + puff.radius * 14;
      puff.sprite.position.set(
        Math.cos(angle) * puff.radius * puff.phase,
        0.24 + puff.phase * (0.56 + power * 0.25),
        Math.sin(angle) * puff.radius * puff.phase,
      );
      const smokeSize = (0.08 + puff.phase * 0.15) * (0.7 + power);
      puff.sprite.scale.set(smokeSize, smokeSize, 1);
      puff.sprite.material.opacity =
        (0.08 + (1 - power) * 0.06) * (1 - puff.phase) * (1 - flare * 0.45);
    }
  }

  function dispose(): void {
    scene.remove(root);
    fire.dispose();
    stoneGeometry.dispose();
    stoneMaterial.dispose();
    charredLogGeometry.dispose();
    charredLogMaterial.dispose();
    emberTexture.dispose();
    smokeTexture.dispose();
    root.traverse((object) => {
      if (object instanceof THREE.Sprite) object.material.dispose();
    });
  }

  return { addFuel, level, setWinter, update, dispose };
}
