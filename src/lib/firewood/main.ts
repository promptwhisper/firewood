// Top-level orchestrator. Wires together:
//   - Renderer + scene + lights (scene.ts)
//   - Drag-orbit camera with wobble (camera.ts)
//   - EffectComposer + Bokeh DoF + OutputPass (composer.ts)
//   - Wind-animated grass field (grass.ts)
//   - Stump GLB + collider (stump.ts)
//   - Procedural log + materials (log.ts)
//   - Axe rig with GLTF animation (axe.ts)
//   - Plane-based mesh slicer + multi-cut fracture (slice.ts, fracture.ts)
//   - Cannon-es 3D rigid-body physics (physics.ts)
//   - Firewood pile slot manager (pile.ts)
//   - Pooled audio bus (audio.ts)
//
// Each strike calls fractureMesh with N cuts to produce 2..N+1 fragments.
// Each fragment gets a cannon-es body and an outward + upward throw impulse
// plus a strong spin along the camera-forward axis — the original's gentle
// "pop + tumble" feel, not an explosion. Once a piece's body sleeps it is
// removed from physics and smoothly lerped to its assigned pile slot so the
// final layout is the neat radial firewood pile the original game produces.

import * as THREE from "three";

import { AudioBus } from "./audio";
import { buildAxe, type AxeRig } from "./axe";
import { FirewoodCamera } from "./camera";
import { buildCampfire, type Campfire } from "./campfire";
import { buildComposer, type ComposerBundle } from "./composer";
import { fractureMesh } from "./fracture";
import { buildGoboPlanes, type GoboBundle } from "./gobo";
import { buildGrassField, GROUND_Y, type GrassField } from "./grass";
import { loadAll, type LoadedAssets } from "./loader";
import {
  buildLogMesh,
  buildWoodCatalog,
  type WoodSpecies,
} from "./log";
import { FirewoodPhysics, type PhysicsEntry } from "./physics";
import { FirewoodPile, type PileSlot } from "./pile";
import { buildScene, type SceneBundle } from "./scene";
import { clampSlicePoint } from "./slice";
import { buildStump, type StumpResult } from "./stump";
import { INCH } from "./units";
import { buildWinterSystem, type WinterSystem } from "./winter";

export interface SimHooks {
  onProgress?: (loaded: number, total: number) => void;
  onReady?: () => void;
  onFirstInteraction?: () => void;
  onGameplayUpdate?: (state: GameplayState) => void;
}

export interface GameplayState {
  score: number;
  streak: number;
  totalSplits: number;
  fireLevel: number;
  woodName: string;
  lastHit: "clean" | "good" | "off" | null;
  season: "lateAutumn" | "transition" | "winter";
  winterAmount: number;
}

export interface SimHandle {
  dispose(): void;
}

const LOG_SPAWN_INCH = 6;
const LOG_DROP_DURATION_S = 0.45;
const LOG_RESPAWN_DELAY_MS = 1200;
const PILE_MAX_PIECES = 36;
const WINTER_SPLIT_THRESHOLD = 8;

// The original always does a single plane slice per strike — vT() never
// fractures into more than two pieces at once. Multiple chunks build up
// across multiple swings instead.
const FRACTURE_CUTS = 1;

// Volume + aspect-ratio thresholds from the original vT firewood test.
const HARD_FIREWOOD_IN3 = 250; // always firewood at or below this
const SOFT_FIREWOOD_IN3 = 500; // firewood unless the piece is long & thin
const SPLITTABLE_ASPECT_RATIO = 3;

// Minimum span (in inches) of a piece along the slice normal for the cut
// to be physically meaningful — matches the original pT preflight which
// rejects strikes when the piece is thinner than 2 × Xu = 5 inches in the
// slice direction.
const MIN_SLICE_SPAN_IN = 5;
const MIN_EDGE_OFFSET_IN = 2.5;

function computeAspectRatio(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const max = Math.max(size.x, size.y, size.z);
  const min = Math.min(size.x, size.y, size.z);
  return max / Math.max(1e-4, min);
}

function isFirewoodSized(volumeIn3: number, aspectRatio: number): boolean {
  if (volumeIn3 <= HARD_FIREWOOD_IN3) return true;
  if (volumeIn3 <= SOFT_FIREWOOD_IN3 && aspectRatio <= SPLITTABLE_ASPECT_RATIO)
    return true;
  return false;
}

/**
 * Width of a piece along an arbitrary world-space direction. Used by the
 * onClick preflight to refuse slices that would produce a wafer.
 */
function spanAlongDirection(
  mesh: THREE.Mesh,
  worldDir: THREE.Vector3,
): number {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const proj = v.dot(worldDir);
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  return max - min;
}

function computeSafeImpact(
  mesh: THREE.Mesh,
  rawImpact: THREE.Vector3,
  worldNormal: THREE.Vector3,
): THREE.Vector3 {
  mesh.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const localImpact = rawImpact.clone().applyMatrix4(inverse);
  const localNormal = worldNormal
    .clone()
    .transformDirection(inverse)
    .normalize();
  return clampSlicePoint(
    mesh.geometry,
    localImpact,
    localNormal,
    MIN_EDGE_OFFSET_IN * INCH,
  ).applyMatrix4(mesh.matrixWorld);
}

// Splittable "slide outward on stump" animation.
const STUMP_SLIDE_MS = 260;

// Throw numbers ported from the original (bT.performSplit firewood loop).
// These give a gentle pop + a vigorous spin that tumbles the piece through
// the air, with heavy damping kicking in on first contact so it settles
// quickly afterwards.
const THROW_PREOFFSET_HORIZ = 3 * INCH;
const THROW_PREOFFSET_UP = 2 * INCH;
const THROW_HORIZ_IMPULSE = 6 * INCH * 4; // 0.6096 N·s on a 0.5 kg piece
const THROW_VERT_IMPULSE = 6 * INCH * 2; // 0.3048 N·s
const THROW_SPIN_MIN = 8;
const THROW_SPIN_MAX = 14;
const THROW_SPIN_Y_JITTER = 3;
const FIREWOOD_MASS = 0.5;
const SETTLE_VEL_SQ = 0.04;
const SETTLE_ANG_SQ = 0.6;
const SETTLE_TIMEOUT_MS = 2200; // forcibly drift to pile if physics drags

// Post-settle drift to the assigned pile slot.
const DRIFT_DURATION_MS = 600;

interface SplittablePiece {
  mesh: THREE.Mesh;
  volumeIn3: number;
  halfHeight: number;
  slideStart: number;
  slideDuration: number;
  slideFromPos: THREE.Vector3;
  slideToPos: THREE.Vector3;
  slideFromQuat: THREE.Quaternion;
  slideToQuat: THREE.Quaternion;
  done: boolean;
  species: WoodSpecies;
  precisionTarget: THREE.Vector3;
}

interface PieceAnim {
  mesh: THREE.Mesh;
  slot: PileSlot;
  body: PhysicsEntry | null;
  spawnTime: number;
  /** Set when the piece transitions from physics → drift to the pile slot. */
  driftStart: number;
  driftFromPos: THREE.Vector3;
  driftFromQuat: THREE.Quaternion;
  driftToQuat: THREE.Quaternion;
  /**
   * - `flying`: physics body active, tumbling through the air
   * - `landed`: physics body removed, sitting wherever it dropped, waiting
   *   for the batch arrange trigger
   * - `drifting`: lerping into the assigned pile slot
   * - `settled`: locked at the pile slot
   */
  state: "flying" | "landed" | "drifting" | "settled";
  landSoundPlayed: boolean;
}

function estimateVolumeIn3(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const volM3 = size.x * size.y * size.z * 0.7;
  return volM3 / (INCH * INCH * INCH);
}

function addPrecisionMarker(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const target = box
    ? new THREE.Vector3(
        THREE.MathUtils.lerp(box.min.x, box.max.x, 0.46 + Math.random() * 0.08),
        box.max.y + 0.002,
        THREE.MathUtils.lerp(box.min.z, box.max.z, 0.46 + Math.random() * 0.08),
      )
    : new THREE.Vector3(0, 0.1, 0);
  const span = box
    ? Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.68
    : 0.18;
  const angle = Math.random() * Math.PI;
  const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6 - 0.5;
    points.push(
      target
        .clone()
        .addScaledVector(dir, t * span)
        .addScaledVector(side, Math.sin(i * 2.4) * span * 0.035),
    );
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x2b160c,
    transparent: true,
    opacity: 0.78,
  });
  const crack = new THREE.Line(geometry, material);
  crack.name = "precision-crack";
  crack.renderOrder = 3;
  mesh.add(crack);
  return target;
}

function removePrecisionMarker(mesh: THREE.Mesh): void {
  const marker = mesh.getObjectByName("precision-crack");
  if (!marker) return;
  mesh.remove(marker);
  if (marker instanceof THREE.Line) {
    marker.geometry.dispose();
    marker.material.dispose();
  }
}

export async function startSimulator(
  canvas: HTMLCanvasElement,
  hooks: SimHooks = {},
): Promise<SimHandle> {
  const sceneBundle: SceneBundle = buildScene(canvas);
  const { renderer, scene, camera, sun, ambient } = sceneBundle;

  const wrap = canvas.parentElement ?? document.body;
  const syncSize = (): void => {
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    sceneBundle.setSize(w, h, window.devicePixelRatio);
    composer.setSize(w, h);
    controller.resize(w, h);
  };

  const composer: ComposerBundle = buildComposer(renderer, scene, camera);
  const controller = new FirewoodCamera(camera, canvas);

  syncSize();
  window.addEventListener("resize", syncSize);

  const onCtxMenu = (e: MouseEvent): void => e.preventDefault();
  const onSelectStart = (e: Event): void => e.preventDefault();
  document.addEventListener("contextmenu", onCtxMenu);
  document.addEventListener("selectstart", onSelectStart);

  const audio = new AudioBus();
  const physics = new FirewoodPhysics();

  let assets: LoadedAssets;
  try {
    assets = await loadAll(renderer, {
      onProgress: (loaded, total) => hooks.onProgress?.(loaded, total),
    });
  } catch (err) {
    audio.dispose();
    composer.dispose();
    sceneBundle.dispose();
    window.removeEventListener("resize", syncSize);
    throw err;
  }

  const stump: StumpResult = buildStump(
    assets.stumpMesh,
    assets.stumpData,
    scene,
  );
  scene.updateMatrixWorld(true);
  if (stump.collider) {
    physics.addStumpCollider(stump.collider);
  }

  const grass: GrassField = buildGrassField(scene);

  const dirtGeo = new THREE.CircleGeometry(12 * INCH + 0.02, 64);
  const dirtMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2b1d10),
    roughness: 0.95,
    metalness: 0,
  });
  const dirt = new THREE.Mesh(dirtGeo, dirtMat);
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = GROUND_Y + 0.001;
  dirt.receiveShadow = true;
  scene.add(dirt);

  const woodCatalog = buildWoodCatalog(assets);
  const campfire: Campfire = buildCampfire(scene, assets);
  const winterSystem: WinterSystem = buildWinterSystem(scene, sun, ambient);
  const forceWinter =
    new URLSearchParams(window.location.search).get("winter") === "1";
  winterSystem.setWinter(forceWinter);
  const gameplay: GameplayState = {
    score: 0,
    streak: 0,
    totalSplits: 0,
    fireLevel: campfire.level(),
    woodName: woodCatalog[0].name,
    lastHit: null,
    season: forceWinter ? "transition" : "lateAutumn",
    winterAmount: 0,
  };
  const publishGameplay = (): void => {
    gameplay.winterAmount = winterSystem.amount();
    gameplay.season =
      gameplay.winterAmount >= 0.995
        ? "winter"
        : gameplay.totalSplits >= WINTER_SPLIT_THRESHOLD || forceWinter
          ? "transition"
          : "lateAutumn";
    gameplay.fireLevel = campfire.level();
    hooks.onGameplayUpdate?.({ ...gameplay });
  };

  // Splittable pieces currently sitting on the stump. Each click raycasts
  // against these and slices the one that got hit. After a slice, larger
  // sub-pieces are re-added here (sliding outward gently); smaller ones
  // are sent to the pile as firewood. A fresh log only spawns once this
  // list goes empty.
  const splittables: SplittablePiece[] = [];
  let respawnTimer: number | null = null;

  function spawnLog(): void {
    const roll = Math.random();
    const species =
      roll < 0.46
        ? woodCatalog[0]
        : roll < 0.72
          ? woodCatalog[1]
          : roll < 0.9
            ? woodCatalog[2]
            : woodCatalog[3];
    const fresh = buildLogMesh(species.materials);
    const restY = stump.primaryTopY + fresh.heightInch * INCH * 0.5;
    const startY = restY + LOG_SPAWN_INCH * INCH;
    fresh.mesh.position.set(stump.primaryCenter.x, startY, stump.primaryCenter.z);
    fresh.mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(fresh.mesh);
    const precisionTarget = addPrecisionMarker(fresh.mesh);
    gameplay.woodName = species.name;
    gameplay.lastHit = null;
    publishGameplay();

    splittables.push({
      mesh: fresh.mesh,
      volumeIn3: estimateVolumeIn3(fresh.mesh.geometry),
      halfHeight: fresh.heightInch * INCH * 0.5,
      slideStart: performance.now(),
      slideDuration: LOG_DROP_DURATION_S * 1000,
      slideFromPos: fresh.mesh.position.clone(),
      slideToPos: new THREE.Vector3(
        stump.primaryCenter.x,
        restY,
        stump.primaryCenter.z,
      ),
      slideFromQuat: fresh.mesh.quaternion.clone(),
      slideToQuat: fresh.mesh.quaternion.clone(),
      done: false,
      species,
      precisionTarget,
    });
  }
  spawnLog();

  const axe: AxeRig = buildAxe(assets.axStatic, assets.axAnim, scene, controller);

  const onceUnlock = (): void => {
    audio.unlock();
    window.removeEventListener("pointerdown", onceUnlock);
  };
  window.addEventListener("pointerdown", onceUnlock);

  hooks.onReady?.();

  let firstFired = false;
  const firstInteractionListener = (): void => {
    if (firstFired) return;
    firstFired = true;
    hooks.onFirstInteraction?.();
    canvas.removeEventListener("pointerdown", firstInteractionListener);
  };
  canvas.addEventListener("pointerdown", firstInteractionListener);

  const raycaster = new THREE.Raycaster();
  const pile: PieceAnim[] = [];
  const firewoodPile = new FirewoodPile(
    new THREE.Vector3(stump.primaryCenter.x, 0, stump.primaryCenter.z),
  );
  let pendingSplit: {
    piece: SplittablePiece;
    impact: THREE.Vector3;
    sliceNormal: THREE.Vector3;
    hitQuality: GameplayState["lastHit"];
  } | null = null;

  function isAnyPieceMidSlide(): boolean {
    for (const p of splittables) if (!p.done) return true;
    return false;
  }

  function onClick(): void {
    if (axe.isPlaying() || splittables.length === 0) return;
    // Don't allow chopping while pieces are still settling into their drop
    // position; the raycast would be against moving targets and the swing
    // would feel desynced.
    if (isAnyPieceMidSlide()) return;
    const ndc = controller.lastClickPos;
    const target = ndc ? new THREE.Vector2(ndc.x, ndc.y) : new THREE.Vector2(0, 0);
    raycaster.setFromCamera(target, camera);
    const meshes = splittables.map((p) => p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length === 0) return;
    const hit = hits[0];
    const piece = splittables.find((p) => p.mesh === hit.object);
    if (!piece) return;

    // Preflight: if the piece is too thin along the prospective slice
    // direction (camera-right), refuse the strike so we don't manufacture
    // wafers. Mirrors the original pT() check (Xu × 2 = 5 inches).
    const sliceNormal = controller.getCameraRight();
    sliceNormal.y = 0;
    sliceNormal.normalize();
    const impact = computeSafeImpact(piece.mesh, hit.point, sliceNormal);
    const span = spanAlongDirection(piece.mesh, sliceNormal);
    if (span < MIN_SLICE_SPAN_IN * INCH) {
      // Nudge the camera azimuth a bit so the next click sees the piece
      // from a thicker angle — same fallback the original uses.
      controller.nudgeAzimuth?.(impact.x < piece.mesh.position.x ? -1 : 1);
      return;
    }

    const precisionWorld = piece.mesh.localToWorld(piece.precisionTarget.clone());
    precisionWorld.y = impact.y;
    const accuracyInches = precisionWorld.distanceTo(impact) / INCH;
    const hitQuality: GameplayState["lastHit"] =
      accuracyInches <= 1.1 ? "clean" : accuracyInches <= 2.25 ? "good" : "off";
    pendingSplit = {
      piece,
      impact,
      sliceNormal: sliceNormal.clone(),
      hitQuality,
    };
    axe.startStrike(impact);
  }

  function spawnFractureFrom(
    piece: SplittablePiece,
    impact: THREE.Vector3,
    sliceNormal: THREE.Vector3,
    hitQuality: GameplayState["lastHit"],
  ): void {
    const right = sliceNormal.clone().normalize();

    const fragments = fractureMesh(piece.mesh, {
      cuts: FRACTURE_CUTS,
      impactPoint: impact,
      primaryNormal: right,
      spread: Math.PI / 14, // a tiny bit of randomness, halves stay symmetric
      jitterMeters: 0.012,
      innerMaterialIndex: 2,
    });

    // Remove the original splittable.
    const idx = splittables.indexOf(piece);
    if (idx !== -1) splittables.splice(idx, 1);
    removePrecisionMarker(piece.mesh);
    scene.remove(piece.mesh);
    piece.mesh.geometry?.dispose();

    if (fragments.length === 0) return;

    const now = performance.now();
    let spawnedFirewood = false;
    let firewoodCount = 0;

    // Rank by bbox volume — the largest sub-pieces are most likely to stay
    // on the stump as the next splittable target.
    const ranked = fragments
      .map((frag) => ({
        frag,
        vol: estimateVolumeIn3(frag.geometry),
      }))
      .sort((a, b) => b.vol - a.vol);

    for (let i = 0; i < ranked.length; i++) {
      const { frag, vol } = ranked[i];
      const mesh = new THREE.Mesh(frag.geometry, [
        piece.species.materials.side,
        piece.species.materials.top,
        piece.species.materials.inner,
      ]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(frag.worldCenter);
      scene.add(mesh);

      // pushDir = which side of the axe blade the fragment is on (XZ plane).
      const pushDir = new THREE.Vector3().subVectors(frag.worldCenter, impact);
      pushDir.y = 0;
      if (pushDir.lengthSq() < 1e-6) {
        pushDir.copy(right).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
      } else {
        pushDir.normalize();
      }

      frag.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      frag.geometry.boundingBox?.getSize(size);
      const halfHeight = size.y * 0.5;
      const horizontalSpan = Math.max(size.x, size.z);

      // Only the largest fragment is even considered for staying. Even when
      // both halves are above the firewood threshold we still kick the
      // smaller one to the pile so the stump never accumulates more than
      // one upright piece (matches the user's reference image).
      const stumpRadius = 0.31;
      const fitsOnStump = horizontalSpan * 0.5 <= stumpRadius * 0.9;
      const aspect = computeAspectRatio(frag.geometry);
      const stayOnStump =
        i === 0 &&
        !isFirewoodSized(vol, aspect) &&
        fitsOnStump &&
        horizontalSpan >= MIN_SLICE_SPAN_IN * INCH;

      if (stayOnStump) {
        // Re-centre on the stump top and keep the piece upright. No tilt,
        // no outward push — successive strikes always have a clean centred
        // target.
        const slideTo = new THREE.Vector3(
          stump.primaryCenter.x,
          stump.primaryTopY + halfHeight + 0.001,
          stump.primaryCenter.z,
        );
        const precisionTarget = addPrecisionMarker(mesh);
        splittables.push({
          mesh,
          volumeIn3: vol,
          halfHeight,
          slideStart: now,
          slideDuration: STUMP_SLIDE_MS,
          slideFromPos: mesh.position.clone(),
          slideToPos: slideTo,
          slideFromQuat: mesh.quaternion.clone(),
          slideToQuat: mesh.quaternion.clone(), // keep current upright pose
          done: false,
          species: piece.species,
          precisionTarget,
        });
      } else {
        spawnedFirewood = true;
        firewoodCount += 1;
        // Becomes firewood. Launch with cannon-es so the user sees the
        // chunk actually tumble through the air and bounce off the
        // ground; once it sleeps we lerp it into the assigned pile slot.
        const slot = firewoodPile.next();

        // Pre-displace the mesh outward + up before the body is built so
        // physics doesn't start with the piece clipped into the stump
        // collider.
        mesh.position.x += pushDir.x * THROW_PREOFFSET_HORIZ;
        mesh.position.y += THROW_PREOFFSET_UP;
        mesh.position.z += pushDir.z * THROW_PREOFFSET_HORIZ;

        const body = physics.addBody(mesh, FIREWOOD_MASS);

        const impulse = new THREE.Vector3(
          pushDir.x * THROW_HORIZ_IMPULSE,
          THROW_VERT_IMPULSE,
          pushDir.z * THROW_HORIZ_IMPULSE,
        );
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        const sideSign =
          Math.sign(pushDir.x * right.x + pushDir.z * right.z) || 1;
        const spin =
          THROW_SPIN_MIN + Math.random() * (THROW_SPIN_MAX - THROW_SPIN_MIN);
        const angVel = new THREE.Vector3(
          camForward.x * spin * sideSign,
          camForward.y * spin * sideSign +
            (Math.random() - 0.5) * THROW_SPIN_Y_JITTER,
          camForward.z * spin * sideSign,
        );
        physics.applyThrowImpulse(body, impulse, angVel);

        pile.push({
          mesh,
          slot,
          body,
          spawnTime: now,
          driftStart: 0,
          driftFromPos: new THREE.Vector3(),
          driftFromQuat: new THREE.Quaternion(),
          driftToQuat: slot.quaternion.clone(),
          state: "flying",
          landSoundPlayed: false,
        });
      }
    }

    audio.playSplit(spawnedFirewood);
    controller.triggerShake();
    gameplay.totalSplits += 1;
    if (gameplay.totalSplits >= WINTER_SPLIT_THRESHOLD) {
      winterSystem.setWinter(true);
    }
    gameplay.lastHit = hitQuality;
    if (hitQuality === "clean") gameplay.streak += 1;
    else if (hitQuality === "off") gameplay.streak = 0;
    const hitScore =
      hitQuality === "clean" ? 100 : hitQuality === "good" ? 55 : 25;
    gameplay.score += Math.round(
      hitScore * piece.species.scoreMultiplier * Math.max(1, firewoodCount),
    );
    if (firewoodCount > 0) {
      campfire.addFuel(0.075 * firewoodCount);
      audio.setCampfireLevel(campfire.level());
    }
    publishGameplay();

    while (pile.length > PILE_MAX_PIECES) {
      const oldest = pile.shift();
      if (oldest) {
        scene.remove(oldest.mesh);
        oldest.mesh.geometry?.dispose();
      }
    }
  }

  function updateSplittables(now: number): void {
    for (const p of splittables) {
      if (p.done) continue;
      const elapsed = now - p.slideStart;
      if (elapsed < 0) continue;
      const t = Math.min(1, elapsed / p.slideDuration);
      const ease = t * t * (3 - 2 * t);
      p.mesh.position.lerpVectors(p.slideFromPos, p.slideToPos, ease);
      p.mesh.quaternion.slerpQuaternions(p.slideFromQuat, p.slideToQuat, ease);
      if (t >= 1) {
        p.done = true;
        p.mesh.position.copy(p.slideToPos);
        p.mesh.quaternion.copy(p.slideToQuat);
      }
    }
  }

  function updatePile(now: number): void {
    for (const e of pile) {
      if (e.state === "settled") continue;

      if (e.state === "flying") {
        const b = e.body;
        if (!b) {
          // Lost the body somehow — treat the piece as landed in place.
          e.state = "landed";
          continue;
        }
        const v = b.body.velocity;
        const av = b.body.angularVelocity;
        const restingNow =
          b.settled ||
          (v.lengthSquared() < SETTLE_VEL_SQ &&
            av.lengthSquared() < SETTLE_ANG_SQ);
        const elapsed = now - e.spawnTime;
        if (restingNow || elapsed > SETTLE_TIMEOUT_MS) {
          if (!e.landSoundPlayed) {
            e.landSoundPlayed = true;
            audio.playStack(0.35);
          }
          // Hand the pose back to plain Three.js and wait for the batch
          // arrange trigger to fire (controlled by maybeStartBatchArrange).
          physics.remove(b);
          e.body = null;
          e.state = "landed";
        }
        continue;
      }

      if (e.state === "drifting") {
        const t = Math.min(1, (now - e.driftStart) / DRIFT_DURATION_MS);
        const ease = t * t * (3 - 2 * t);
        e.mesh.position.lerpVectors(e.driftFromPos, e.slot.position, ease);
        e.mesh.quaternion.slerpQuaternions(
          e.driftFromQuat,
          e.driftToQuat,
          ease,
        );
        if (t >= 1) {
          e.state = "settled";
          e.mesh.position.copy(e.slot.position);
          e.mesh.quaternion.copy(e.driftToQuat);
        }
      }
    }
  }

  /**
   * Once the stump is empty AND every fired piece has come to rest, kick
   * off the batch drift that snaps them all into the firewood pile. This is
   * the only place pieces transition from "landed" to "drifting".
   */
  function maybeStartBatchArrange(now: number): void {
    if (pile.length === 0) return;
    if (splittables.length > 0) return;
    if (pendingSplit !== null) return;
    if (axe.isPlaying()) return;
    // Need at least one landed piece, and zero pieces still in the air.
    let anyLanded = false;
    for (const e of pile) {
      if (e.state === "flying") return;
      if (e.state === "landed") anyLanded = true;
    }
    if (!anyLanded) return;

    // Stagger the drift so pieces don't all teleport simultaneously.
    let stagger = 0;
    for (const e of pile) {
      if (e.state !== "landed") continue;
      e.state = "drifting";
      e.driftStart = now + stagger;
      e.driftFromPos.copy(e.mesh.position);
      e.driftFromQuat.copy(e.mesh.quaternion);
      stagger += 70;
    }
  }

  function allPileSettled(): boolean {
    if (pile.length === 0) return true;
    for (const e of pile) if (e.state !== "settled") return false;
    return true;
  }

  const gobo: GoboBundle = buildGoboPlanes(scene, sceneBundle.sun, assets.goboVideos);
  void gobo.ready;
  publishGameplay();

  let disposed = false;
  let lastT = performance.now();
  let lastGameplayPublish = lastT;
  let raf = 0;
  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    controller.update();

    if (controller.wasClick) {
      controller.consumeClick();
      onClick();
    }

    const landed = axe.update(dt);
    if (landed && pendingSplit) {
      const { piece, impact, sliceNormal, hitQuality } = pendingSplit;
      pendingSplit = null;
      spawnFractureFrom(piece, impact, sliceNormal, hitQuality);
    }

    // Spawn a fresh log only after:
    //   - the stump is empty (no splittable left)
    //   - no swing is in flight
    //   - the batch arrange has finished (or there was nothing to arrange)
    if (
      splittables.length === 0 &&
      !axe.isPlaying() &&
      allPileSettled() &&
      respawnTimer === null
    ) {
      respawnTimer = window.setTimeout(() => {
        respawnTimer = null;
        if (!disposed) spawnLog();
      }, LOG_RESPAWN_DELAY_MS);
    }

    physics.step(dt);
    updateSplittables(now);
    updatePile(now);
    maybeStartBatchArrange(now);
    grass.update(dt);
    gobo.update();
    winterSystem.update(dt);
    grass.setWinter(winterSystem.amount());
    composer.setWinter(winterSystem.amount());
    campfire.setWinter(winterSystem.amount());
    campfire.update(dt);
    audio.setCampfireLevel(campfire.level());
    if (now - lastGameplayPublish > 500) {
      lastGameplayPublish = now;
      publishGameplay();
    }

    composer.composer.render();
    raf = window.requestAnimationFrame(frame);
  }
  raf = window.requestAnimationFrame(frame);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", syncSize);
    document.removeEventListener("contextmenu", onCtxMenu);
    document.removeEventListener("selectstart", onSelectStart);
    canvas.removeEventListener("pointerdown", firstInteractionListener);
    window.removeEventListener("pointerdown", onceUnlock);
    controller.dispose();
    axe.dispose();
    gobo.dispose();
    campfire.dispose();
    winterSystem.dispose();
    grass.dispose();
    dirtGeo.dispose();
    dirtMat.dispose();
    if (respawnTimer !== null) {
      clearTimeout(respawnTimer);
      respawnTimer = null;
    }
    for (const p of splittables) {
      removePrecisionMarker(p.mesh);
      scene.remove(p.mesh);
      p.mesh.geometry?.dispose();
    }
    splittables.length = 0;
    for (const entry of pile) {
      scene.remove(entry.mesh);
      entry.mesh.geometry?.dispose();
      if (entry.body) {
        physics.remove(entry.body);
        entry.body = null;
      }
    }
    pile.length = 0;
    physics.dispose();
    for (const species of woodCatalog) {
      Object.values(species.materials).forEach((material) => material.dispose());
    }
    for (const texture of Object.values(assets.textures)) {
      if (texture instanceof THREE.Texture) texture.dispose();
      else Object.values(texture).forEach((nested) => nested.dispose());
    }
    audio.dispose();
    composer.dispose();
    sceneBundle.dispose();
  }

  return { dispose };
}
