export class SessionMetricsStore {
  private turnLatencies: number[] = [];
  private llmTimeouts = 0;
  private sttFailures = 0;
  private ttsFailures = 0;

  recordTurnLatency(ms: number): void {
    this.turnLatencies.push(ms);
  }

  recordLlmTimeout(): void {
    this.llmTimeouts += 1;
  }

  recordSttFailure(): void {
    this.sttFailures += 1;
  }

  recordTtsFailure(): void {
    this.ttsFailures += 1;
  }

  snapshot() {
    return {
      turn_latencies_ms: [...this.turnLatencies],
      llm_timeouts: this.llmTimeouts,
      stt_failures: this.sttFailures,
      tts_failures: this.ttsFailures,
    };
  }
}
