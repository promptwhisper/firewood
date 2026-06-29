// Drag-orbit camera identical in feel to the original Nd controller:
// inch-scale radius/height, 2deg pitch, FBM-noise wobble, click-vs-drag by
// total absolute pointer travel in pixels.

import * as THREE from "three";

import { INCH, smoothNoise } from "./units";

const RADIUS_INCH = 48;
const HEIGHT_INCH = 50;
const PITCH_DEG = 2;
const DRAG_SENSITIVITY = 0.004;
const AZIMUTH_DAMPING = 0.92;
const CLICK_THRESHOLD = 6; // total |dx|+|dy| in CSS pixels

const WOBBLE_PITCH_DEG = 0.3;
const WOBBLE_ROLL_DEG = 0.3;
const WOBBLE_HEIGHT_INCH = 0.2;

const SHAKE_DURATION_MS = 200;
const SHAKE_PITCH_DEG = 1.4;
const SHAKE_ROLL_DEG = 1.0;

export interface NDC {
  x: number;
  y: number;
}

export class FirewoodCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly target = new THREE.Vector3(0, 0, 0);

  private azimuth = 0;
  private azimuthVelocity = 0;
  private readonly radius = RADIUS_INCH * INCH;
  private readonly height = HEIGHT_INCH * INCH;
  private readonly pitch = THREE.MathUtils.degToRad(PITCH_DEG);

  private readonly wobbleSeedPitch = Math.random() * 1e4;
  private readonly wobbleSeedRoll = Math.random() * 1e4 + 5e3;
  private readonly wobbleSeedHeight = Math.random() * 1e4 + 9e3;

  private shakeEndTime = 0;
  private shakePitchDir = 1;
  private shakeRollDir = 1;

  private pointerDown = false;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerPrevX = 0;
  private pointerPrevY = 0;
  private totalDrag = 0;
  private dragging = false;

  private _wasClick = false;
  private _lastClickPos: NDC | null = null;

  private readonly listeners: Array<() => void> = [];

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.attach();
    this.updateCameraPosition();
  }

  get wasClick(): boolean {
    return this._wasClick;
  }

  consumeClick(): void {
    this._wasClick = false;
  }

  get lastClickPos(): NDC | null {
    return this._lastClickPos;
  }

  getCameraRight(): THREE.Vector3 {
    const m = this.camera.matrixWorld.elements;
    return new THREE.Vector3(m[0], m[1], m[2]).normalize();
  }

  triggerShake(): void {
    this.shakeEndTime = performance.now() + SHAKE_DURATION_MS;
    this.shakePitchDir = Math.random() < 0.5 ? 1 : -1;
    this.shakeRollDir = Math.random() < 0.5 ? 1 : -1;
  }

  /**
   * Spin the camera around by ~90° of damped azimuth. Used when the user
   * tried to chop a piece that's too thin along the current slice direction
   * — rotating gives them a thicker side to hit.
   */
  nudgeAzimuth(sign: number): void {
    this.azimuthVelocity =
      THREE.MathUtils.degToRad(90) * (1 - AZIMUTH_DAMPING) * sign;
  }

  update(): void {
    if (!this.pointerDown) {
      this.azimuth += this.azimuthVelocity;
      this.azimuthVelocity *= AZIMUTH_DAMPING;
      if (Math.abs(this.azimuthVelocity) < 1e-4) this.azimuthVelocity = 0;
    }
    this.updateCameraPosition();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const detach of this.listeners) detach();
    this.listeners.length = 0;
  }

  private attach(): void {
    const el = this.domElement;
    const onDown = (e: PointerEvent): void => this.onPointerDown(e);
    const onMove = (e: PointerEvent): void => this.onPointerMove(e);
    const onUp = (e: PointerEvent): void => this.onPointerUp(e);
    const onCancel = (e: PointerEvent): void => this.onPointerUp(e);
    const onContext = (e: MouseEvent): void => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("contextmenu", onContext);
    this.listeners.push(() => el.removeEventListener("pointerdown", onDown));
    this.listeners.push(() => el.removeEventListener("pointermove", onMove));
    this.listeners.push(() => el.removeEventListener("pointerup", onUp));
    this.listeners.push(() => el.removeEventListener("pointercancel", onCancel));
    this.listeners.push(() => el.removeEventListener("contextmenu", onContext));
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointerDown = true;
    this.dragging = false;
    this.totalDrag = 0;
    this._wasClick = false;
    this.pointerStartX = this.pointerPrevX = e.clientX;
    this.pointerStartY = this.pointerPrevY = e.clientY;
    this.pointerId = e.pointerId;
    this.domElement.setPointerCapture?.(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointerDown) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.pointerPrevX;
    this.totalDrag +=
      Math.abs(e.clientX - this.pointerStartX) +
      Math.abs(e.clientY - this.pointerStartY);
    if (this.totalDrag > CLICK_THRESHOLD) {
      this.dragging = true;
      this.azimuthVelocity = -dx * DRAG_SENSITIVITY;
      this.azimuth += this.azimuthVelocity;
    }
    this.pointerPrevX = e.clientX;
    this.pointerPrevY = e.clientY;
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    if (!this.dragging && this.pointerDown) {
      this._wasClick = true;
      this._lastClickPos = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };
    } else {
      this._wasClick = false;
    }
    this.pointerDown = false;
    this.dragging = false;
    this.pointerId = null;
    this.domElement.releasePointerCapture?.(e.pointerId);
  }

  private updateCameraPosition(): void {
    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.azimuth) * this.radius,
      this.target.y + this.height,
      this.target.z + Math.cos(this.azimuth) * this.radius,
    );
    c.lookAt(this.target);
    c.rotateX(this.pitch);

    const t = performance.now() / 1000;

    // FBM-style wobble — two octaves blended.
    const pitchN =
      smoothNoise(t, this.wobbleSeedPitch) * 0.7 +
      smoothNoise(t * 2.3, this.wobbleSeedPitch + 100) * 0.3;
    const rollN =
      smoothNoise(t, this.wobbleSeedRoll) * 0.7 +
      smoothNoise(t * 1.9, this.wobbleSeedRoll + 100) * 0.3;
    const heightN =
      smoothNoise(t, this.wobbleSeedHeight) * 0.7 +
      smoothNoise(t * 2.1, this.wobbleSeedHeight + 100) * 0.3;

    c.position.y += heightN * WOBBLE_HEIGHT_INCH * INCH;

    c.rotateX(THREE.MathUtils.degToRad(pitchN * WOBBLE_PITCH_DEG));
    c.rotateZ(THREE.MathUtils.degToRad(rollN * WOBBLE_ROLL_DEG));

    if (this.shakeEndTime > performance.now()) {
      const remaining =
        (this.shakeEndTime - performance.now()) / SHAKE_DURATION_MS;
      const decay = remaining; // linear
      const phase = (1 - remaining) * Math.PI * 6; // a few quick oscillations
      const sp = Math.sin(phase) * decay;
      const sr = Math.cos(phase) * decay;
      c.rotateX(THREE.MathUtils.degToRad(sp * SHAKE_PITCH_DEG * this.shakePitchDir));
      c.rotateZ(THREE.MathUtils.degToRad(sr * SHAKE_ROLL_DEG * this.shakeRollDir));
    }
  }
}
