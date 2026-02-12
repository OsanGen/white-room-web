export class RuntimeClock {
  private readonly startedAt = performance.now();

  elapsedMs(): number {
    return Math.max(0, Math.floor(performance.now() - this.startedAt));
  }
}
