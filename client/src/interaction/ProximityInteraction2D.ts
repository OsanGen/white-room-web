import type { Vec2 } from "../player/TopDownController";

interface ProximityInteraction2DOptions {
  max_distance?: number;
}

export interface ProximityEvaluation2D {
  can_interact: boolean;
  distance: number;
}

export class ProximityInteraction2D {
  private readonly maxDistance: number;

  constructor(options: ProximityInteraction2DOptions = {}) {
    this.maxDistance = options.max_distance ?? 90;
  }

  evaluate(playerPosition: Vec2, targetPosition: Vec2): ProximityEvaluation2D {
    const dx = targetPosition.x - playerPosition.x;
    const dy = targetPosition.y - playerPosition.y;
    const distance = Math.hypot(dx, dy);
    return {
      can_interact: distance <= this.maxDistance,
      distance,
    };
  }
}
