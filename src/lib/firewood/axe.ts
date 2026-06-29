// Axe rig: ax_anim.glb provides the animation scene with an empty named
// "anim" plus animation clips, ax_static.glb is the visible axe mesh. We
// parent the static mesh under the "anim" empty so the clip drives it.
// On strike we orient the pivot to the camera-right axis and play the clip
// once, fading the axe out at the tail of the swing.

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { FirewoodCamera } from "./camera";

export interface AxeRig {
  pivot: THREE.Group;
  /** True between startStrike() and the moment the animation finishes. */
  isPlaying(): boolean;
  startStrike(impactPoint: THREE.Vector3): void;
  /** Advance the animation. Returns true on the frame the strike "lands". */
  update(dt: number): boolean;
  dispose(): void;
}

const PROCEDURAL_DURATION_S = 0.55;
// The source animation's blade reaches the wood at its 0.10 s keyframe.
// Keep fracture timing tied to that contact frame, not clip completion.
const IMPACT_TIME_S = 0.1;

/**
 * Build the axe rig. `controller` is consulted every frame for the camera
 * right vector so the axe always swings perpendicular to the user's view.
 */
export function buildAxe(
  staticGltf: GLTF,
  animGltf: GLTF,
  scene: THREE.Object3D,
  controller: FirewoodCamera,
): AxeRig {
  const pivot = new THREE.Group();
  pivot.name = "axePivot";
  pivot.visible = false;
  scene.add(pivot);

  // Anim scene contains the empty named "anim" and is what the clip targets.
  const animScene = animGltf.scene;
  animScene.visible = false;
  let animNull: THREE.Object3D | null = null;
  animScene.traverse((obj) => {
    if (obj.name === "anim") animNull = obj;
    if (obj instanceof THREE.Mesh) obj.visible = false;
  });
  const animTarget: THREE.Object3D = animNull ?? animScene;

  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  if (animGltf.animations && animGltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(animScene);
    action = mixer.clipAction(animGltf.animations[0]);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }

  pivot.add(animScene);

  const axeModel = staticGltf.scene;
  axeModel.position.set(0, 0, 0);
  axeModel.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  animTarget.add(axeModel);

  let playing = false;
  let proceduralT = 0;
  let elapsed = 0;
  let impactFired = false;

  function orientToCamera(): void {
    const right = controller.getCameraRight();
    // Forward in XZ, 90° rotated from right so the axe head leads.
    const fx = -right.z;
    const fz = right.x;
    const target = new THREE.Vector3(
      pivot.position.x + fx,
      pivot.position.y,
      pivot.position.z + fz,
    );
    pivot.lookAt(target);
  }

  function startStrike(impactPoint: THREE.Vector3): void {
    if (playing) return;
    playing = true;
    impactFired = false;
    proceduralT = 0;
    elapsed = 0;
    pivot.position.copy(impactPoint);
    orientToCamera();
    pivot.visible = true;
    animScene.visible = true;
    if (mixer && action) {
      action.reset();
      action.play();
      mixer.update(0);
    } else {
      animTarget.position.set(0, 0, 0);
      animTarget.rotation.set(0, 0, 0);
      animTarget.scale.setScalar(1);
    }
  }

  function finish(): void {
    playing = false;
    pivot.visible = false;
    animScene.visible = false;
    animTarget.position.set(0, 0, 0);
    animTarget.rotation.set(0, 0, 0);
    animTarget.scale.setScalar(1);
    axeModel.scale.setScalar(1);
  }

  function update(dt: number): boolean {
    if (!playing) return false;
    orientToCamera();
    elapsed += dt;

    let landed = false;
    if (!impactFired && elapsed >= IMPACT_TIME_S) {
      impactFired = true;
      landed = true;
    }

    if (mixer && action) {
      mixer.update(dt);
      const clip = action.getClip();
      const tailDuration = 5 / 30;
      const remaining = clip.duration - action.time;
      if (remaining <= tailDuration) {
        const k = Math.max(0, remaining / tailDuration);
        axeModel.scale.setScalar(k);
      } else {
        axeModel.scale.setScalar(1);
      }
      if (action.paused) finish();
    } else {
      proceduralT += dt / PROCEDURAL_DURATION_S;
      if (proceduralT <= 0.15) {
        animTarget.rotation.x = 0;
        animTarget.position.y = 0;
      } else if (proceduralT <= 1) {
        const e = (proceduralT - 0.15) / 0.85;
        const t = e * e;
        animTarget.rotation.x = -t * (Math.PI / 3);
        animTarget.position.y = t * 0.4;
        if (e > 0.7) {
          const k = (e - 0.7) / 0.3;
          animTarget.scale.setScalar(1 - k);
        }
      } else {
        finish();
      }
    }
    return landed;
  }

  function isPlaying(): boolean {
    return playing;
  }

  function dispose(): void {
    scene.remove(pivot);
    mixer?.stopAllAction();
    pivot.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose();
      }
    });
  }

  return { pivot, isPlaying, startStrike, update, dispose };
}
