import { BLOCKED_META_TOKENS, RabbitPhase } from "@white-room/shared";

export interface QualityAssessmentInput {
  reply_text: string;
  reply_tags: string[];
  context_tags_last3: string[];
  selected_node_goal: string;
  active_goals: string[];
  phase: RabbitPhase;
  allow_intentional_contradiction: boolean;
  memory_quote_used: string;
}

export interface QualitySnapshot {
  coherence: number;
  contradiction_rate: number;
  repetition: number;
  memory_callback_frequency: number;
  goal_alignment: number;
  no_meta_leakage: number;
  meta_leak_strikes: number;
  remediation: string[];
}

interface QualityMonitorState {
  turnCount: number;
  contradictionCount: number;
  mirrorContractTurns: number;
  memoryCallbackCount: number;
  metaLeakStrikeCount: number;
  replyHistory: string[];
}

function uniqueLower(values: string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function overlapScore(a: string[], b: string[]): number {
  const aa = uniqueLower(a);
  const bb = uniqueLower(b);
  if (aa.length === 0 || bb.length === 0) return 0;
  const bSet = new Set(bb);
  const overlap = aa.filter((value) => bSet.has(value)).length;
  return overlap / Math.max(1, Math.min(aa.length, bb.length));
}

function ngrams(text: string, n = 2): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function ngramOverlap(current: string, previous: string[]): number {
  const currentNgrams = ngrams(current, 2);
  if (currentNgrams.length === 0) return 0;

  const previousSet = new Set(previous.flatMap((text) => ngrams(text, 2)));
  const hits = currentNgrams.filter((gram) => previousSet.has(gram)).length;
  return hits / currentNgrams.length;
}

function hasMetaLeak(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_META_TOKENS.some((token) => lower.includes(token));
}

function accidentalContradiction(phase: RabbitPhase, current: string, history: string[], allowIntentional: boolean): boolean {
  if (allowIntentional) {
    return false;
  }

  const lower = current.toLowerCase();
  const prior = history.join(" ").toLowerCase();

  if (phase !== RabbitPhase.Exit && (lower.includes("door opens") || lower.includes("session complete"))) {
    return true;
  }

  if (prior.includes("no doors yet") && lower.includes("door is open") && phase !== RabbitPhase.Exit) {
    return true;
  }

  return false;
}

export class ConversationalQualityMonitor {
  private turnCount = 0;
  private contradictionCount = 0;
  private mirrorContractTurns = 0;
  private memoryCallbackCount = 0;
  private metaLeakStrikeCount = 0;
  private replyHistory: string[] = [];

  assess(input: QualityAssessmentInput): QualitySnapshot {
    const goalAlignment = input.active_goals.includes(input.selected_node_goal) ? 1 : 0;
    const coherence = overlapScore(input.reply_tags, input.context_tags_last3) * 0.6 + goalAlignment * 0.4;
    const repetition = ngramOverlap(input.reply_text, this.replyHistory.slice(-3));

    const contradictionEvent = accidentalContradiction(
      input.phase,
      input.reply_text,
      this.replyHistory.slice(-3),
      input.allow_intentional_contradiction,
    );
    if (contradictionEvent) {
      this.contradictionCount += 1;
    }

    if (input.phase === RabbitPhase.Mirror || input.phase === RabbitPhase.Contract) {
      this.mirrorContractTurns += 1;
      if (input.memory_quote_used.trim()) {
        this.memoryCallbackCount += 1;
      }
    }

    this.turnCount += 1;
    this.replyHistory.push(input.reply_text);
    while (this.replyHistory.length > 6) {
      this.replyHistory.shift();
    }

    const noMetaLeakage = hasMetaLeak(input.reply_text) ? 0 : 1;
    if (noMetaLeakage === 0) {
      this.metaLeakStrikeCount += 1;
    }
    const contradictionRate = this.turnCount > 0 ? this.contradictionCount / this.turnCount : 0;
    const memoryCallbackFrequency =
      this.mirrorContractTurns === 0 ? 0 : this.memoryCallbackCount > 0 ? 1 : 0;

    const remediation: string[] = [];
    if (coherence < 0.6) {
      remediation.push("clarify_and_stabilize");
    }
    if (repetition > 0.35) {
      remediation.push("creative_reframing_next_turn");
    }
    if (contradictionEvent) {
      remediation.push("error_anticipation_next_turn");
    }
    if (noMetaLeakage < 1) {
      remediation.push("fallback_immediate");
    }

    return {
      coherence,
      contradiction_rate: contradictionRate,
      repetition,
      memory_callback_frequency: memoryCallbackFrequency,
      goal_alignment: goalAlignment,
      no_meta_leakage: noMetaLeakage,
      meta_leak_strikes: this.metaLeakStrikeCount,
      remediation,
    };
  }

  hasMemoryCallback(): boolean {
    return this.memoryCallbackCount > 0;
  }

  checkpoint(): QualityMonitorState {
    return {
      turnCount: this.turnCount,
      contradictionCount: this.contradictionCount,
      mirrorContractTurns: this.mirrorContractTurns,
      memoryCallbackCount: this.memoryCallbackCount,
      metaLeakStrikeCount: this.metaLeakStrikeCount,
      replyHistory: [...this.replyHistory],
    };
  }

  restore(state: QualityMonitorState): void {
    this.turnCount = state.turnCount;
    this.contradictionCount = state.contradictionCount;
    this.mirrorContractTurns = state.mirrorContractTurns;
    this.memoryCallbackCount = state.memoryCallbackCount;
    this.metaLeakStrikeCount = state.metaLeakStrikeCount;
    this.replyHistory = [...state.replyHistory];
  }
}
