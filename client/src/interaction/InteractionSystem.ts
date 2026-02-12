import * as THREE from "three";

interface InteractionOptions {
  max_distance?: number;
  min_facing_dot?: number;
}

export interface InteractionEvaluation {
  can_interact: boolean;
  distance: number;
  facing_dot: number;
}

export class InteractionSystem {
  private readonly maxDistance: number;
  private readonly minFacingDot: number;
  private readonly toTarget = new THREE.Vector3();

  constructor(options: InteractionOptions = {}) {
    this.maxDistance = options.max_distance ?? 2.6;
    this.minFacingDot = options.min_facing_dot ?? 0.55;
  }

  evaluate(playerPosition: THREE.Vector3, forwardDirection: THREE.Vector3, targetPosition: THREE.Vector3): InteractionEvaluation {
    this.toTarget.copy(targetPosition).sub(playerPosition);
    const distance = this.toTarget.length();
    if (distance <= 0.0001) {
      return { can_interact: true, distance: 0, facing_dot: 1 };
    }

    this.toTarget.normalize();
    const facingDot = forwardDirection.dot(this.toTarget);
    const canInteract = distance <= this.maxDistance && facingDot >= this.minFacingDot;

    return {
      can_interact: canInteract,
      distance,
      facing_dot: facingDot,
    };
  }
}
