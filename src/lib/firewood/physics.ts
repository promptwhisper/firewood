// 3D rigid-body physics for the firewood pile, using cannon-es (the same
// API the original ships in its bundle). Numbers come straight from the
// source's `jh` class:
//   * gravity (0, -15, 0)
//   * 5 solver iterations, ground at y = -0.33
//   * default friction 0.8, restitution 0.15
//   * box-shaped pieces with linearDamping 0.3 / angularDamping 0.3
//   * after first ground/stump contact, damping kicks up to 0.95 / 0.98
//   * sleepSpeedLimit 0.3, sleepTimeLimit 0.15
//   * force-sleep after 1 s of life if a piece hasn't found a resting pose
//
// We expose a small wrapper so the simulator only has to call addBody /
// applyThrowImpulse / step / sync.

import * as CANNON from "cannon-es";
import * as THREE from "three";

import { GROUND_Y } from "./grass";

const GRAVITY = new CANNON.Vec3(0, -15, 0);
const SOLVER_ITERATIONS = 5;
const FRICTION = 0.8;
const RESTITUTION = 0.15;
const FORCE_SLEEP_MS = 1000; // Ah
const SLEEP_SPEED_LIMIT = 0.3;
const SLEEP_TIME_LIMIT = 0.15;
const ACTIVE_LINEAR_DAMP = 0.3;
const ACTIVE_ANG_DAMP = 0.3;
const RESTING_LINEAR_DAMP = 0.95;
const RESTING_ANG_DAMP = 0.98;
const STEP_RATE = 1 / 60;
const STEP_SUBSTEPS = 3;

interface PhysicsEntry {
  body: CANNON.Body;
  mesh: THREE.Object3D;
  settled: boolean;
  spawnTime: number;
  bounced: boolean;
}

export class FirewoodPhysics {
  readonly world: CANNON.World;
  private readonly entries: PhysicsEntry[] = [];
  private readonly groundBody: CANNON.Body;
  private readonly defaultMaterial = new CANNON.Material("default");
  stumpBody: CANNON.Body | null = null;

  constructor() {
    const world = new CANNON.World({ gravity: GRAVITY, allowSleep: true });
    world.broadphase = new CANNON.NaiveBroadphase();
    (world.solver as CANNON.GSSolver).iterations = SOLVER_ITERATIONS;
    world.defaultContactMaterial.friction = FRICTION;
    world.defaultContactMaterial.restitution = RESTITUTION;
    this.world = world;

    const ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: this.defaultMaterial,
    });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.y = GROUND_Y;
    world.addBody(ground);
    this.groundBody = ground;
  }

  /** Wrap a static cylinder collider around the stump bounding box. */
  addStumpCollider(stumpMesh: THREE.Object3D): void {
    stumpMesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(stumpMesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.z) / 2;
    const height = size.y;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.defaultMaterial,
    });
    body.addShape(
      new CANNON.Cylinder(radius, radius, height, 16),
      new CANNON.Vec3(center.x, center.y, center.z),
    );
    this.world.addBody(body);
    this.stumpBody = body;
  }

  /** Add a falling firewood piece. The mesh is updated in place each step. */
  addBody(mesh: THREE.Object3D, mass = 1): PhysicsEntry {
    const aabb = new THREE.Box3();
    if ((mesh as THREE.Mesh).geometry) {
      (mesh as THREE.Mesh).geometry.computeBoundingBox();
      const local = (mesh as THREE.Mesh).geometry.boundingBox;
      if (local) aabb.copy(local).applyMatrix4(mesh.matrixWorld);
    } else {
      aabb.setFromObject(mesh);
    }
    const size = new THREE.Vector3();
    aabb.getSize(size);
    const halfExtents = new CANNON.Vec3(
      Math.max(size.x / 2, 0.005),
      Math.max(size.y / 2, 0.005),
      Math.max(size.z / 2, 0.005),
    );

    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Box(halfExtents),
      material: this.defaultMaterial,
      linearDamping: ACTIVE_LINEAR_DAMP,
      angularDamping: ACTIVE_ANG_DAMP,
      allowSleep: true,
      sleepSpeedLimit: SLEEP_SPEED_LIMIT,
      sleepTimeLimit: SLEEP_TIME_LIMIT,
    });

    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    mesh.getWorldPosition(wp);
    mesh.getWorldQuaternion(wq);
    body.position.set(wp.x, wp.y, wp.z);
    body.quaternion.set(wq.x, wq.y, wq.z, wq.w);
    this.world.addBody(body);

    const entry: PhysicsEntry = {
      body,
      mesh,
      settled: false,
      spawnTime: performance.now(),
      bounced: false,
    };

    body.addEventListener("collide", (ev: { body?: CANNON.Body }) => {
      const other = ev.body;
      if (!other) return;
      if (other === this.groundBody || other === this.stumpBody) {
        if (!entry.bounced) {
          entry.bounced = true;
          body.linearDamping = RESTING_LINEAR_DAMP;
          body.angularDamping = RESTING_ANG_DAMP;
        }
      }
    });
    this.entries.push(entry);
    return entry;
  }

  applyThrowImpulse(
    entry: PhysicsEntry,
    impulse: THREE.Vector3,
    angularVelocity?: THREE.Vector3,
  ): void {
    entry.body.wakeUp();
    entry.settled = false;
    entry.bounced = false;
    entry.body.linearDamping = ACTIVE_LINEAR_DAMP;
    entry.body.angularDamping = ACTIVE_ANG_DAMP;
    entry.body.applyImpulse(
      new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
      new CANNON.Vec3(0, 0, 0),
    );
    if (angularVelocity) {
      entry.body.angularVelocity.set(
        angularVelocity.x,
        angularVelocity.y,
        angularVelocity.z,
      );
    }
  }

  step(dt: number): void {
    if (this.entries.length === 0) return;
    this.world.step(STEP_RATE, dt, STEP_SUBSTEPS);
    const now = performance.now();
    for (const e of this.entries) {
      if (!e.settled) {
        if (now - e.spawnTime > FORCE_SLEEP_MS) {
          e.body.velocity.set(0, 0, 0);
          e.body.angularVelocity.set(0, 0, 0);
          e.body.sleep();
          e.settled = true;
        } else if (e.body.sleepState === CANNON.Body.SLEEPING) {
          e.settled = true;
        }
      }
      const p = e.body.position;
      const q = e.body.quaternion;
      e.mesh.position.set(p.x, p.y, p.z);
      e.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  remove(entry: PhysicsEntry): void {
    this.world.removeBody(entry.body);
    const idx = this.entries.indexOf(entry);
    if (idx !== -1) this.entries.splice(idx, 1);
  }

  /** Drop the oldest settled body so the pile doesn't grow without bound. */
  trimSettled(maxSettled: number): void {
    let count = 0;
    for (const e of this.entries) if (e.settled) count++;
    while (count > maxSettled) {
      for (let i = 0; i < this.entries.length; i++) {
        if (this.entries[i].settled) {
          const e = this.entries[i];
          this.world.removeBody(e.body);
          this.entries.splice(i, 1);
          count--;
          break;
        }
      }
    }
  }

  iter(): PhysicsEntry[] {
    return this.entries;
  }

  dispose(): void {
    while (this.entries.length > 0) {
      const e = this.entries.pop()!;
      this.world.removeBody(e.body);
    }
    this.world.removeBody(this.groundBody);
    if (this.stumpBody) this.world.removeBody(this.stumpBody);
  }
}

export type { PhysicsEntry };
