// Firewood pile slot manager. Pieces accumulate as a long wall of stacked
// logs off to the left of the stump, matching the original game's visual.
// Each piece lies horizontally with its cylinder axis pointing along the
// cluster's tangent direction.

import * as THREE from "three";

import { GROUND_Y } from "./grass";
import { INCH } from "./units";

// Where the cluster sits relative to the stump (world units).
const PILE_OFFSET = new THREE.Vector3(-1.22, 0, 0.38);

// Long wall layout: many positions along the axis, shallow depth, then stack.
const COLUMNS = 8; // positions along the cylinder axis
const ROWS = 2; // positions perpendicular to the cylinder axis (depth)
const PIECE_LENGTH_INCH = 12; // along axis
const AXIS_SPACING_INCH = 7.4; // overlap pieces so the pile reads dense
const PIECE_DIAMETER_INCH = 6.2; // perpendicular / vertical thickness

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface PileSlot {
  position: THREE.Vector3;
  /** Quaternion that lays a Y-up cylinder into the pile depth. */
  quaternion: THREE.Quaternion;
  tier: number;
  arcIndex: number;
  layer: number;
}

export class FirewoodPile {
  private slotIndex = 0;
  private readonly pileCenter: THREE.Vector3;
  private readonly axisDir: THREE.Vector3;
  private readonly depthDir: THREE.Vector3;

  constructor(origin = new THREE.Vector3(0, 0, 0)) {
    this.pileCenter = origin.clone().add(PILE_OFFSET);

    // Cylinder axis = tangent to the circle around the stump that passes
    // through the pile centre. Depth = radial direction from stump to pile.
    const radial = PILE_OFFSET.clone();
    radial.y = 0;
    radial.normalize();
    this.depthDir = radial;
    this.axisDir = new THREE.Vector3()
      .crossVectors(Y_AXIS, radial)
      .normalize();
  }

  reset(): void {
    this.slotIndex = 0;
  }

  next(): PileSlot {
    const i = this.slotIndex++;
    const piecesPerLayer = COLUMNS * ROWS;
    const layer = Math.floor(i / piecesPerLayer);
    const inLayer = i % piecesPerLayer;
    const row = Math.floor(inLayer / COLUMNS);
    const col = inLayer % COLUMNS;

    const axisStep = AXIS_SPACING_INCH * INCH;
    const depthStep = PIECE_DIAMETER_INCH * INCH;
    const heightStep = PIECE_DIAMETER_INCH * INCH * 0.78;

    // Axis offset: centred, with every upper layer shifted half a slot so
    // pieces nestle into the gaps and form the staggered wall from the original.
    const axisOff =
      (col - (COLUMNS - 1) / 2) * axisStep +
      (layer % 2 === 1 ? axisStep * 0.5 : 0);
    const depthOff =
      (row - (ROWS - 1) / 2) * depthStep +
      (col % 2 === 1 ? depthStep * 0.16 : -depthStep * 0.08);
    const yOff = heightStep * (0.5 + layer);

    const position = this.pileCenter
      .clone()
      .add(this.axisDir.clone().multiplyScalar(axisOff))
      .add(this.depthDir.clone().multiplyScalar(depthOff));
    position.y = GROUND_Y + yOff;

    // Orientation: arrange the pile along axisDir, but point each log into
    // the pile depth so cut faces remain visible, like the original screen toy.
    const lieDown = new THREE.Quaternion().setFromUnitVectors(
      Y_AXIS,
      this.depthDir,
    );
    // Slight per-slot roll so adjacent pieces don't all show the cut face
    // from the same angle.
    const rollAngle = THREE.MathUtils.degToRad(
      (col * 37 + row * 71 + layer * 53) % 360,
    );
    const roll = new THREE.Quaternion().setFromAxisAngle(this.depthDir, rollAngle);
    const quaternion = roll.multiply(lieDown);

    return {
      position,
      quaternion,
      tier: 0,
      arcIndex: col,
      layer,
    };
  }
}

export const PILE_PIECE_LENGTH = PIECE_LENGTH_INCH * INCH;
