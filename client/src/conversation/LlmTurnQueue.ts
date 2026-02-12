export interface QueuedTurn {
  text: string;
  attempts: number;
  queued_at_ms: number;
}

interface QueueOptions {
  min_backoff_ms?: number;
  max_backoff_ms?: number;
}

export class LlmTurnQueue {
  private pending: QueuedTurn | null = null;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: QueueOptions = {}) {
    this.minBackoffMs = options.min_backoff_ms ?? 600;
    this.maxBackoffMs = options.max_backoff_ms ?? 8000;
  }

  enqueueLatest(text: string): QueuedTurn {
    const trimmed = text.trim();
    this.pending = {
      text: trimmed,
      attempts: this.pending ? this.pending.attempts : 0,
      queued_at_ms: Date.now(),
    };
    return this.pending;
  }

  peek(): QueuedTurn | null {
    if (!this.pending) return null;
    return { ...this.pending };
  }

  updateAttempts(nextAttempts: number): void {
    if (!this.pending) return;
    this.pending.attempts = Math.max(0, Math.floor(nextAttempts));
  }

  clear(): void {
    this.pending = null;
  }

  hasPending(): boolean {
    return Boolean(this.pending);
  }

  getNextDelayMs(): number {
    if (!this.pending) return this.minBackoffMs;
    const expo = this.minBackoffMs * Math.pow(2, this.pending.attempts);
    return Math.min(this.maxBackoffMs, expo);
  }
}
