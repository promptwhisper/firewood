import * as THREE from "three";

import { GROUND_Y } from "./grass";
import { isMobileUA } from "./units";

const SNOW_COUNT = isMobileUA() ? 2600 : 5600;
const SNOW_AREA = 8;
const SNOW_HEIGHT = 3.2;
const TRANSITION_SECONDS = 5;

function makeSnowGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      const dx = x / canvas.width - 0.5;
      const dy = y / canvas.height - 0.5;
      const radius = Math.sqrt(dx * dx + dy * dy) * 2;
      const broad =
        Math.sin(x * 0.047) * 0.035 +
        Math.sin(y * 0.039) * 0.035 +
        Math.sin((x + y) * 0.018) * 0.025;
      const grain = (Math.random() - 0.5) * 0.035;
      const edge = 1 - THREE.MathUtils.smoothstep(radius, 0.78, 1);
      const shade = Math.round(238 + broad * 255 + grain * 255);
      image.data[index] = shade;
      image.data[index + 1] = Math.min(255, shade + 5);
      image.data[index + 2] = Math.min(255, shade + 9);
      image.data[index + 3] = Math.round(edge * 255);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildSnowfall(): {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
} {
  const positions = new Float32Array(SNOW_COUNT * 3);
  const speeds = new Float32Array(SNOW_COUNT);
  const phases = new Float32Array(SNOW_COUNT);
  const drifts = new Float32Array(SNOW_COUNT);
  const sizes = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SNOW_AREA;
    positions[i * 3 + 1] = Math.random() * SNOW_HEIGHT;
    positions[i * 3 + 2] = (Math.random() - 0.5) * SNOW_AREA;
    speeds[i] = 0.16 + Math.random() * 0.34;
    phases[i] = Math.random();
    drifts[i] = 0.025 + Math.random() * 0.09;
    sizes[i] = 2.2 + Math.random() * 3.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aDrift", new THREE.BufferAttribute(drifts, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uHeight: { value: SNOW_HEIGHT },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float aSpeed;
      attribute float aPhase;
      attribute float aDrift;
      attribute float aSize;
      uniform float uTime;
      uniform float uAmount;
      uniform float uHeight;
      uniform float uPixelRatio;
      varying float vAlpha;

      void main() {
        vec3 snow = position;
        float cycle = mod(aPhase + uTime * aSpeed / uHeight, 1.0);
        snow.y = uHeight * (1.0 - cycle);
        snow.x += sin(uTime * 0.72 + aPhase * 31.0 + position.z) * aDrift;
        snow.z += cos(uTime * 0.51 + aPhase * 23.0 + position.x) * aDrift * 0.7;
        vec4 mvPosition = modelViewMatrix * vec4(snow, 1.0);
        gl_PointSize = aSize * uPixelRatio * (1.1 / max(0.8, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = uAmount * mix(0.38, 0.9, aPhase);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float radius = length(point) * 2.0;
        float alpha = (1.0 - smoothstep(0.42, 1.0, radius)) * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vec3(0.94, 0.975, 1.0), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.position.y = GROUND_Y;
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 5;
  return { points, material };
}

export interface WinterSystem {
  amount(): number;
  setWinter(enabled: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildWinterSystem(
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  ambient: THREE.AmbientLight,
): WinterSystem {
  const snowfall = buildSnowfall();
  scene.add(snowfall.points);

  const groundTexture = makeSnowGroundTexture();
  const groundMaterial = new THREE.MeshStandardMaterial({
    map: groundTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    color: 0xe8f0f2,
  });
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(SNOW_AREA * 0.78, 96),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y + 0.02;
  ground.receiveShadow = true;
  ground.renderOrder = 1;
  scene.add(ground);

  const warmSun = sun.color.clone();
  const winterSun = new THREE.Color(0xd8e6ed);
  const warmAmbient = ambient.color.clone();
  const winterAmbient = new THREE.Color(0xc8dbe8);
  let winter = 0;
  let target = 0;
  let time = 0;

  function amount(): number {
    return winter;
  }

  function setWinter(enabled: boolean): void {
    target = enabled ? 1 : 0;
  }

  function update(dt: number): void {
    time += dt;
    const step = dt / TRANSITION_SECONDS;
    if (winter < target) winter = Math.min(target, winter + step);
    if (winter > target) winter = Math.max(target, winter - step);
    const snowAmount = THREE.MathUtils.smoothstep(winter, 0.12, 1);
    snowfall.points.visible = snowAmount > 0.005;
    snowfall.material.uniforms.uTime.value = time;
    snowfall.material.uniforms.uAmount.value = snowAmount;
    groundMaterial.opacity = snowAmount * 0.86;
    sun.color.copy(warmSun).lerp(winterSun, winter * 0.78);
    sun.intensity = THREE.MathUtils.lerp(4, 2.35, winter);
    ambient.color.copy(warmAmbient).lerp(winterAmbient, winter);
    ambient.intensity = THREE.MathUtils.lerp(2, 1.6, winter);
  }

  function dispose(): void {
    scene.remove(snowfall.points, ground);
    snowfall.points.geometry.dispose();
    snowfall.material.dispose();
    ground.geometry.dispose();
    groundMaterial.dispose();
    groundTexture.dispose();
  }

  return { amount, setWinter, update, dispose };
}
