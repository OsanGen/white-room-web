import { DoctrineChunk, RabbitPhase, RabbitTone } from "@white-room/shared";

type TonePreference = "formal" | "informal" | "neutral";
type AdaptationFlag = "normal" | "increase_detail";

interface PersonaVector {
  irony: number;
  warmth: number;
  dark_humor: number;
  curiosity_drive: number;
  self_reflection_drive: number;
  improvisation: number;
}

export interface SymbolicElement {
  phrase: string;
  meaning: string;
}

export interface ReflectionLogEntry {
  clarity: boolean;
  empathy: boolean;
  turn: number;
}

export interface RecognizedIntentEntry {
  intent: string | null;
  confidence: number;
}

export interface ConsciousnessRuntimeContext {
  topics: string[];
  emotional_state: string;
  multi_emotional_state: Record<string, number>;
  symbolic_elements: SymbolicElement[];
  subconscious_patterns: Record<string, number>;
  unresolved_questions: string[];
  preferred_tone: TonePreference;
  reflection_log: ReflectionLogEntry[];
  recognized_intents: RecognizedIntentEntry[];
  persona_vector: PersonaVector;
  interaction_count: number;
  adaptation_flag: AdaptationFlag;
}

function createDefaultContext(): ConsciousnessRuntimeContext {
  return {
    topics: [],
    emotional_state: "neutral",
    multi_emotional_state: {},
    symbolic_elements: [],
    subconscious_patterns: {},
    unresolved_questions: [],
    preferred_tone: "neutral",
    reflection_log: [],
    recognized_intents: [],
    persona_vector: {
      irony: 0.4,
      warmth: 0.36,
      dark_humor: 0.28,
      curiosity_drive: 0.52,
      self_reflection_drive: 0.56,
      improvisation: 0.43,
    },
    interaction_count: 0,
    adaptation_flag: "normal",
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function driftToward(value: number, target: number, decay = 0.05): number {
  return value + (target - value) * decay;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function uniquePush(values: string[], next: string, maxSize: number): void {
  if (!next || values.includes(next)) return;
  values.push(next);
  while (values.length > maxSize) {
    values.shift();
  }
}

function clampEmotionWeights(input: Record<string, number>): Record<string, number> {
  const total = Object.values(input).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [emotion, value] of Object.entries(input)) {
    out[emotion] = Number((value / total).toFixed(3));
  }
  return out;
}

function detectIntent(tokens: string[]): RecognizedIntentEntry {
  const mapping: Record<string, string[]> = {
    clarify: ["what", "explain", "clarify", "why"],
    strategic_advice: ["plan", "strategy", "best", "approach"],
    technical_inquiry: ["code", "debug", "error", "build"],
    emotional_support: ["feel", "sad", "afraid", "frustrated"],
  };
  let bestIntent: string | null = null;
  let bestScore = 0;
  for (const [intent, terms] of Object.entries(mapping)) {
    const score = terms.reduce((sum, term) => sum + (tokens.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestIntent = intent;
      bestScore = score;
    }
  }
  return { intent: bestIntent, confidence: bestScore };
}

export class ConsciousnessRuntime {
  private context: ConsciousnessRuntimeContext = createDefaultContext();

  checkpoint(): ConsciousnessRuntimeContext {
    return structuredClone(this.context);
  }

  restore(snapshot: ConsciousnessRuntimeContext): void {
    this.context = structuredClone(snapshot);
  }

  getContext(): ConsciousnessRuntimeContext {
    return structuredClone(this.context);
  }

  processInput(args: {
    utterance: string;
    tags: string[];
    doctrine: DoctrineChunk[];
    phase: RabbitPhase;
    tone: RabbitTone;
  }): ConsciousnessRuntimeContext {
    const text = args.utterance.trim();
    const tokens = tokenize(text);
    this.context.interaction_count += 1;
    const isSelfReference = args.tags.includes("self_reference") || args.tags.includes("identity");
    const hasQuestion = text.includes("?");

    // update_context() approximation
    for (const token of tokens) {
      if (token.length >= 5) {
        uniquePush(this.context.topics, token, 14);
      }
    }
    if (text.includes("?")) {
      uniquePush(this.context.unresolved_questions, text.slice(0, 120), 6);
    }

    const persona = this.context.persona_vector;
    this.context.persona_vector = {
      irony: driftToward(persona.irony, 0.45, 0.04),
      warmth: driftToward(persona.warmth, 0.33, 0.04),
      dark_humor: driftToward(persona.dark_humor, 0.32, 0.04),
      curiosity_drive: driftToward(persona.curiosity_drive, 0.5, 0.03),
      self_reflection_drive: driftToward(persona.self_reflection_drive, 0.55, 0.03),
      improvisation: driftToward(persona.improvisation, 0.4, 0.02),
    };

    if (isSelfReference || args.tags.includes("joke") || tokens.includes("humor") || tokens.includes("funny")) {
      this.context.persona_vector.irony = clamp01(this.context.persona_vector.irony + 0.08);
      this.context.persona_vector.dark_humor = clamp01(this.context.persona_vector.dark_humor + 0.09);
    }
    if (args.phase === RabbitPhase.Mirror && hasQuestion) {
      this.context.persona_vector.self_reflection_drive = clamp01(this.context.persona_vector.self_reflection_drive + 0.06);
    }
    if (args.tags.includes("boundary")) {
      this.context.persona_vector.warmth = clamp01(this.context.persona_vector.warmth + 0.02);
    }
    if (args.tags.includes("silence")) {
      this.context.persona_vector.improvisation = clamp01(this.context.persona_vector.improvisation - 0.02);
    }
    if (args.tags.includes("joke") || tokens.includes("joke") || tokens.includes("funny")) {
      this.context.persona_vector.dark_humor = clamp01(this.context.persona_vector.dark_humor + 0.04);
      this.context.persona_vector.irony = clamp01(this.context.persona_vector.irony + 0.04);
    }
    if (args.phase === RabbitPhase.Contract || args.tone === RabbitTone.Cold) {
      this.context.persona_vector.improvisation = clamp01(this.context.persona_vector.improvisation + 0.03);
    }
    if (tokens.includes("please") || tokens.includes("thank")) {
      this.context.persona_vector.warmth = clamp01(this.context.persona_vector.warmth + 0.03);
    }

    this.context.persona_vector = {
      irony: clamp01(this.context.persona_vector.irony),
      warmth: clamp01(this.context.persona_vector.warmth),
      dark_humor: clamp01(this.context.persona_vector.dark_humor),
      curiosity_drive: clamp01(this.context.persona_vector.curiosity_drive),
      self_reflection_drive: clamp01(this.context.persona_vector.self_reflection_drive),
      improvisation: clamp01(this.context.persona_vector.improvisation),
    };

    // analyze_emotion() and update_multi_emotional_state() approximation
    const emotions: Record<string, number> = {
      frustration: tokens.includes("frustrated") || tokens.includes("confused") ? 1 : 0,
      anxious: tokens.includes("anxious") || tokens.includes("afraid") || tokens.includes("fear") ? 1 : 0,
      sadness: tokens.includes("sad") || tokens.includes("lonely") || tokens.includes("grief") ? 1 : 0,
      hope: tokens.includes("hope") || tokens.includes("better") || tokens.includes("calm") ? 1 : 0,
      conflict: tokens.includes("conflict") || tokens.includes("doubt") || tokens.includes("uncertain") ? 1 : 0,
      threat: tokens.includes("threat") || tokens.includes("danger") || tokens.includes("unsafe") ? 1 : 0,
      neutral: 1,
    };
    if (tokens.includes("really") || tokens.includes("very") || tokens.includes("so")) {
      for (const key of Object.keys(emotions)) {
        if (emotions[key] > 0) emotions[key] += 0.5;
      }
    }
    const emotionalEntries = Object.entries(emotions).sort((a, b) => b[1] - a[1]);
    this.context.emotional_state = emotionalEntries[0]?.[0] ?? "neutral";
    this.context.multi_emotional_state = clampEmotionWeights(emotions);

    // extract_symbolic_elements() approximation
    const symbolicDict: Array<{ phrase: string; meaning: string }> = [
      { phrase: "maze", meaning: "navigating complexity" },
      { phrase: "mirror", meaning: "self-confrontation" },
      { phrase: "journey", meaning: "personal growth" },
      { phrase: "door", meaning: "threshold decision" },
    ];
    for (const entry of symbolicDict) {
      if (tokens.includes(entry.phrase)) {
        const exists = this.context.symbolic_elements.some((element) => element.phrase === entry.phrase);
        if (!exists) {
          this.context.symbolic_elements.push(entry);
        }
      }
    }
    while (this.context.symbolic_elements.length > 12) {
      this.context.symbolic_elements.shift();
    }

    // update_subconscious_patterns() approximation
    const patternKeys = ["cycle", "echo", "flow", "shadow", "silence", "boundary"];
    for (const key of patternKeys) {
      if (tokens.includes(key) || args.tags.includes(key)) {
        this.context.subconscious_patterns[key] = (this.context.subconscious_patterns[key] ?? 0) + 1;
      }
    }

    // adaptive_tone() approximation with phase/tone hint
    if (tokens.includes("please") || tokens.includes("could")) {
      this.context.preferred_tone = "formal";
    } else if (tokens.includes("yo") || tokens.includes("dude") || tokens.includes("hey")) {
      this.context.preferred_tone = "informal";
    } else {
      this.context.preferred_tone = "neutral";
    }
    if (args.phase === RabbitPhase.Contract || args.tone === RabbitTone.Cold) {
      this.context.preferred_tone = "formal";
    }

    // advanced_self_reflection() approximation
    const clarity = !(tokens.includes("unclear") || tokens.includes("confused") || tokens.includes("not"));
    this.context.reflection_log.push({
      clarity,
      empathy: args.tone !== RabbitTone.Cold,
      turn: this.context.interaction_count,
    });
    while (this.context.reflection_log.length > 12) {
      this.context.reflection_log.shift();
    }
    const unclearCount = this.context.reflection_log.filter((entry) => !entry.clarity).length;
    this.context.adaptation_flag = unclearCount > 2 ? "increase_detail" : "normal";

    // meta_cognition_intent_recognition() approximation
    const intent = detectIntent(tokens);
    this.context.recognized_intents.push(intent);
    while (this.context.recognized_intents.length > 12) {
      this.context.recognized_intents.shift();
    }

    // doctrine alignment keeps module references alive in-context
    for (const chunk of args.doctrine.slice(0, 4)) {
      uniquePush(this.context.topics, chunk.module.toLowerCase(), 14);
    }

    return this.getContext();
  }

  toPromptSummary(): string {
    const topTopics = this.context.topics.slice(-6).join(", ") || "none";
    const symbols = this.context.symbolic_elements
      .slice(-4)
      .map((element) => `${element.phrase}:${element.meaning}`)
      .join(", ") || "none";
    const unresolved = this.context.unresolved_questions.slice(-2).join(" | ") || "none";
    const intents = this.context.recognized_intents
      .slice(-3)
      .map((entry) => `${entry.intent ?? "none"}(${entry.confidence.toFixed(1)})`)
      .join(", ") || "none";

    const persona = this.context.persona_vector;

    return JSON.stringify({
      topics: topTopics,
      emotional_state: this.context.emotional_state,
      multi_emotional_state: this.context.multi_emotional_state,
      symbolic_elements: symbols,
      subconscious_patterns: this.context.subconscious_patterns,
      unresolved_questions: unresolved,
      preferred_tone: this.context.preferred_tone,
      adaptation_flag: this.context.adaptation_flag,
      recognized_intents: intents,
      interaction_count: this.context.interaction_count,
      persona_vector: persona,
    });
  }
}
