export class FrameRateSafety {
  private lowFpsDurationMs = 0;
  private stableDurationMs = 0;
  private reducedEffectsProfile = false;
  private fpsEstimate = 60;

  constructor(
    private readonly lowFpsThreshold = 25,
    private readonly lowFpsWindowMs = 5000,
    private readonly recoverFpsThreshold = 30,
    private readonly recoverWindowMs = 3000,
  ) {}

  sampleFrame(frameDeltaMs: number): boolean {
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs <= 0) {
      return this.reducedEffectsProfile;
    }

    this.fpsEstimate = 1000 / frameDeltaMs;

    if (this.fpsEstimate < this.lowFpsThreshold) {
      this.lowFpsDurationMs += frameDeltaMs;
      this.stableDurationMs = 0;
    } else {
      this.lowFpsDurationMs = 0;
      if (this.reducedEffectsProfile && this.fpsEstimate >= this.recoverFpsThreshold) {
        this.stableDurationMs += frameDeltaMs;
      } else {
        this.stableDurationMs = 0;
      }
    }

    if (!this.reducedEffectsProfile && this.lowFpsDurationMs >= this.lowFpsWindowMs) {
      this.reducedEffectsProfile = true;
      this.stableDurationMs = 0;
    }

    if (this.reducedEffectsProfile && this.stableDurationMs >= this.recoverWindowMs) {
      this.reducedEffectsProfile = false;
      this.lowFpsDurationMs = 0;
      this.stableDurationMs = 0;
    }

    return this.reducedEffectsProfile;
  }

  isReducedEffectsProfileActive(): boolean {
    return this.reducedEffectsProfile;
  }

  currentFpsEstimate(): number {
    return this.fpsEstimate;
  }
}
