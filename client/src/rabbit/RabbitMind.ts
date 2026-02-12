import {
  DEFAULT_RABBIT_STATE,
  EndingId,
  MemoryItem,
  PlayerClassification,
  ProgressFlag,
  RabbitPhase,
  RabbitResponse,
  RabbitState,
  RabbitTone,
  SESSION_HARD_LIMIT_MS,
} from "@white-room/shared";
import { clamp } from "../utils/math";
import { Interpretation } from "../conversation/IntentClassifier";

const GOALS: Record<RabbitPhase, string[]> = {
  [RabbitPhase.Intake]: ["establish_frame", "obtain_name_or_refusal", "assess_baseline_state"],
  [RabbitPhase.Destabilize]: ["probe_contradiction", "detect_fear_boundary", "test_humor_defense"],
  [RabbitPhase.Mirror]: ["force_self_reference", "quote_player_memory", "reveal_door_outline_hint"],
  [RabbitPhase.Contract]: ["offer_bargain", "test_boundary_commitment", "run_guided_sequence"],
  [RabbitPhase.Exit]: ["ask_final_answer", "assign_ending", "close_with_consequence"],
};

const ENDING_A: ProgressFlag[] = [
  ProgressFlag.AdmittedFear,
  ProgressFlag.ContradictionAcknowledged,
  ProgressFlag.TruthStatementAccepted,
];
const ENDING_B: ProgressFlag[] = [ProgressFlag.BoundaryDeclared, ProgressFlag.BargainRejected, ProgressFlag.BoundaryMaintained];
const ENDING_C: ProgressFlag[] = [ProgressFlag.BreathDone, ProgressFlag.CountDone, ProgressFlag.RecallDone, ProgressFlag.NameDone, ProgressFlag.ChoiceDone];

interface RabbitMindCheckpoint {
  state: RabbitState;
  flags: ProgressFlag[];
  doorVisible: boolean;
}

export class RabbitMind {
  private state: RabbitState = structuredClone(DEFAULT_RABBIT_STATE);
  private flags = new Set<ProgressFlag>();
  private doorVisible = false;

  getState(): RabbitState {
    return structuredClone(this.state);
  }

  markLlmReject(): void {
    this.state.llm_reject_count += 1;
  }

  clearLlmRejects(): void {
    this.state.llm_reject_count = 0;
  }

  listFlags(): ProgressFlag[] {
    return Array.from(this.flags);
  }

  checkpoint(): RabbitMindCheckpoint {
    return {
      state: structuredClone(this.state),
      flags: Array.from(this.flags),
      doorVisible: this.doorVisible,
    };
  }

  restore(checkpoint: RabbitMindCheckpoint): void {
    this.state = structuredClone(checkpoint.state);
    this.flags = new Set(checkpoint.flags);
    this.doorVisible = checkpoint.doorVisible;
  }

  endingProgress(): {
    A: { met: number; total: number; ratio: number };
    B: { met: number; total: number; ratio: number };
    C: { met: number; total: number; ratio: number };
  } {
    const metA = ENDING_A.filter((f) => this.flags.has(f)).length;
    const metB = ENDING_B.filter((f) => this.flags.has(f)).length;
    const metC = ENDING_C.filter((f) => this.flags.has(f)).length;
    return {
      A: { met: metA, total: ENDING_A.length, ratio: metA / ENDING_A.length },
      B: { met: metB, total: ENDING_B.length, ratio: metB / ENDING_B.length },
      C: { met: metC, total: ENDING_C.length, ratio: metC / ENDING_C.length },
    };
  }

  getFlags(): Set<ProgressFlag> {
    return new Set(this.flags);
  }

  isDoorVisible(): boolean {
    return this.doorVisible;
  }

  isPsiloUnlocked(): boolean {
    return this.state.psilo_confirm_step === 2;
  }

  shouldForceFinalQuestion(): boolean {
    return this.state.elapsed_ms >= 270000 && !this.state.final_question_asked;
  }

  markFinalQuestionAsked(): void {
    this.state.final_question_asked = true;
  }

  turnHardCapReached(): boolean {
    return this.state.turn_index >= 20;
  }

  setCalmMode(enabled: boolean): void {
    this.state.calm_mode = enabled;
  }

  ingestPlayer(interpretation: Interpretation, elapsedMs: number): void {
    this.state.turn_index += 1;
    this.state.elapsed_ms = clamp(elapsedMs, 0, SESSION_HARD_LIMIT_MS);

    this.state.trust = clamp(this.state.trust + interpretation.trust_delta, 0, 100);
    this.state.threat = clamp(this.state.threat + interpretation.threat_delta, 0, 100);
    this.state.curiosity = clamp(this.state.curiosity + interpretation.curiosity_delta, 0, 100);

    if (interpretation.classification === PlayerClassification.Silence) {
      this.state.silence_count += 1;
      this.state.last_tags = ["silence", ...interpretation.tags];
    } else {
      this.state.silence_count = 0;
      this.state.last_tags = interpretation.tags;
    }

    this.applyPsychDelta(interpretation.psych_delta);
    this.updatePsiloState(interpretation.raw_text);
    this.pushMemory(interpretation);
    this.applyPhaseTransitions();
    this.state.tone = this.selectTone(interpretation.classification);
    this.state.active_goals = GOALS[this.state.phase].slice(0, 3);

    if (this.state.phase === RabbitPhase.Mirror) {
      this.doorVisible = true;
    }
  }

  applyResponse(response: RabbitResponse): void {
    for (const flag of response.set_flags) {
      this.flags.add(flag);
    }

    this.applyPsychDelta(response.morph_signal.psych_delta);

    if (response.selected_node_id === "N14_FinalQuestion") {
      this.state.final_question_asked = true;
    }

    if (response.selected_node_id === "N10_DoorOutlineHint") {
      this.doorVisible = this.state.phase === RabbitPhase.Mirror || this.state.phase === RabbitPhase.Contract || this.state.phase === RabbitPhase.Exit;
    }

    if (this.state.phase === RabbitPhase.Contract && (this.isEndingSatisfied() || this.state.elapsed_ms >= 270000)) {
      this.state.phase = RabbitPhase.Exit;
    }
  }

  quoteCandidate(): string {
    const window = [...this.state.memory].reverse();
    for (const item of window) {
      if (item.short_quote.trim()) {
        return item.short_quote;
      }
    }
    return "";
  }

  resolveEnding(elapsedMs: number): EndingId | null {
    if (elapsedMs < 270000 && !this.isEndingSatisfied()) {
      return null;
    }

    const ratioA = ENDING_A.filter((f) => this.flags.has(f)).length / ENDING_A.length;
    const ratioB = ENDING_B.filter((f) => this.flags.has(f)).length / ENDING_B.length;
    const ratioC = ENDING_C.filter((f) => this.flags.has(f)).length / ENDING_C.length;

    const ordered: Array<{ id: EndingId; ratio: number; rank: number }> = [
      { id: "ESCAPE_A", ratio: ratioA, rank: 0 },
      { id: "ESCAPE_B", ratio: ratioB, rank: 1 },
      { id: "ESCAPE_C", ratio: ratioC, rank: 2 },
    ];

    ordered.sort((a, b) => b.ratio - a.ratio || a.rank - b.rank);
    return ordered[0]?.id ?? "ESCAPE_A";
  }

  private applyPsychDelta(delta: Partial<RabbitState["psych"]>): void {
    const next = { ...this.state.psych };
    const keys = Object.keys(next) as Array<keyof typeof next>;
    const noiseSeed = this.state.turn_index * 9301 + 49297;
    const deterministicNoise = ((noiseSeed % 1000) / 1000 - 0.5) * 0.04;

    for (const key of keys) {
      const base = next[key] + (delta[key] ?? 0) + deterministicNoise;
      next[key] = clamp(base, -1, 1);
    }

    this.state.psych = next;
  }

  private pushMemory(interpretation: Interpretation): void {
    const short = interpretation.raw_text
      .trim()
      .split(/\s+/)
      .slice(0, 12)
      .join(" ")
      .slice(0, 120);

    const item: MemoryItem = {
      turn: this.state.turn_index,
      raw_text: interpretation.raw_text,
      short_quote: short,
      tags: interpretation.tags,
      classification: interpretation.classification,
    };

    this.state.memory.push(item);
    while (this.state.memory.length > 8) {
      this.state.memory.shift();
    }
  }

  private applyPhaseTransitions(): void {
    if (this.state.phase === RabbitPhase.Intake && (this.state.curiosity >= 30 || this.state.turn_index >= 3)) {
      this.state.phase = RabbitPhase.Destabilize;
    }

    if (
      this.state.phase === RabbitPhase.Destabilize &&
      (this.state.trust >= 45 || this.state.threat >= 50 || this.state.elapsed_ms >= 150000)
    ) {
      this.state.phase = RabbitPhase.Mirror;
    }

    if (this.state.elapsed_ms > 150000 && this.state.phase === RabbitPhase.Intake) {
      this.state.phase = RabbitPhase.Mirror;
    }

    if (this.state.elapsed_ms > 240000 && (this.state.phase === RabbitPhase.Intake || this.state.phase === RabbitPhase.Destabilize || this.state.phase === RabbitPhase.Mirror)) {
      this.state.phase = RabbitPhase.Contract;
    }

    if (this.state.phase === RabbitPhase.Mirror && this.doorVisible && this.state.turn_index >= 8) {
      this.state.phase = RabbitPhase.Contract;
    }

    if (this.state.elapsed_ms >= 270000 && this.state.phase !== RabbitPhase.Exit) {
      this.state.phase = RabbitPhase.Exit;
    }

    if (this.state.turn_index >= 20) {
      this.state.phase = RabbitPhase.Exit;
    }
  }

  private selectTone(classification: PlayerClassification): RabbitTone {
    if (this.state.phase === RabbitPhase.Intake) {
      return RabbitTone.Clinical;
    }

    if (this.state.phase === RabbitPhase.Destabilize) {
      if (classification === PlayerClassification.Humor) return RabbitTone.Amused;
      if (this.state.threat > 55) return RabbitTone.Cold;
      return RabbitTone.Clinical;
    }

    if (this.state.phase === RabbitPhase.Mirror) {
      return this.state.trust > 55 && this.state.psych.arousal < 0.2 ? RabbitTone.Gentle : RabbitTone.Cold;
    }

    if (this.state.phase === RabbitPhase.Contract) {
      if (classification === PlayerClassification.Defiance) return RabbitTone.Cold;
      if (classification === PlayerClassification.Compliance) return RabbitTone.Gentle;
      return RabbitTone.Clinical;
    }

    return this.resolveEnding(this.state.elapsed_ms) === "ESCAPE_B" ? RabbitTone.Cold : RabbitTone.Gentle;
  }

  private isEndingSatisfied(): boolean {
    const a = ENDING_A.every((flag) => this.flags.has(flag));
    const b = ENDING_B.every((flag) => this.flags.has(flag));
    const c = ENDING_C.every((flag) => this.flags.has(flag));
    return a || b || c;
  }

  private updatePsiloState(rawText: string): void {
    const text = rawText.toLowerCase();
    const mentionsPsilo = text.includes("psilo");
    const confirmsIdentity =
      text.includes("confirm") ||
      text.includes("yes") ||
      text.includes("i mean psilo") ||
      text.includes("that is me");

    if (this.state.psilo_confirm_step === 0 && mentionsPsilo) {
      this.state.psilo_confirm_step = 1;
      return;
    }

    if (this.state.psilo_confirm_step === 1 && mentionsPsilo && confirmsIdentity) {
      this.state.psilo_confirm_step = 2;
      return;
    }

    if (this.state.psilo_confirm_step === 1 && !mentionsPsilo) {
      // Stay CET-facing unless explicitly reconfirmed.
      this.state.psilo_confirm_step = 1;
    }
  }
}
