import {
  BLOCKED_META_TOKENS,
  DialogueNode,
  DialogueNodeSchema,
  EndingId,
  LlmEnrichRequest,
  PlayerClassification,
  MAX_RABBIT_REPLY_CHARS,
  RabbitPhase,
  RabbitResponse,
  RabbitTone,
  TurnInputPacket,
  type WorldDirective,
} from "@white-room/shared";
import nodesJson from "../data/dialogue_nodes.json";
import balanceJson from "../data/game_balance.json";
import { RabbitMind } from "../rabbit/RabbitMind";
import { classifyInput } from "./IntentClassifier";
import {
  ConsciousnessRuntime,
  ConsciousnessRuntimeContext,
} from "./ConsciousnessRuntimeContext";
import { ConversationalQualityMonitor, QualitySnapshot } from "./ConversationalQuality";
import { DoctrineRetriever } from "./DoctrineRetriever";
import { PromptAssembler } from "./PromptAssembler";
import { selectNode, templateWithQuote } from "./DialogueSelector";
import { validateResponse } from "./OutputValidator";
import { runtimeTransport } from "../runtime/RuntimeTransport";

const outputSchemaContract = {
  type: "object",
  required: [
    "reply_text",
    "tone",
    "selected_node_id",
    "set_flags",
    "memory_quote_used",
    "morph_signal",
    "world_directives",
    "safety",
  ],
};

const balance = balanceJson as {
  fallback_after_reject_count: number;
};

const llmClientTimeoutMs = (() => {
  const raw = Number(import.meta.env.VITE_LLM_CLIENT_TIMEOUT_MS ?? "22000");
  if (!Number.isFinite(raw)) return 22000;
  return Math.max(7000, Math.floor(raw));
})();

const enrichmentSoftDeadlineMs = (() => {
  const raw = Number(import.meta.env.VITE_ENRICHMENT_SOFT_DEADLINE_MS ?? "2200");
  if (!Number.isFinite(raw)) return 2200;
  return Math.max(200, Math.floor(raw));
})();

const enrichmentDropIfStale = (() => {
  const raw = import.meta.env.VITE_ENRICHMENT_DROP_IF_STALE;
  if (raw === undefined) return true;
  if (raw === "1") return true;
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  return true;
})();

const enrichmentApplyIfTurnMatchOnly = (() => {
  const raw = import.meta.env.VITE_ENRICHMENT_APPLY_IF_TURN_MATCH_ONLY;
  if (raw === undefined) return true;
  if (raw === "1") return true;
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  return true;
})();

export interface TurnRunOptions {
  llm_required?: boolean;
  allow_deterministic_fallback_delivery?: boolean;
  skip_llm?: boolean;
}

export interface TurnResult {
  response: RabbitResponse;
  ending: EndingId | null;
  state_snapshot: ReturnType<RabbitMind["getState"]>;
  active_node: DialogueNode;
  doctrine_count: number;
  llm_source: string;
  llm_available: boolean;
  fallback_reason: string | null;
  llm_model_name: string | null;
  llm_attempt_status: string;
  llm_attempt_latency_ms: number;
  cache_hit: boolean;
  cache_key_version: number;
  cache_ttl_remaining_ms: number;
  doctrine_sources: string[];
  doctrine_modules: string[];
  active_flags: string[];
  consciousness_context: ConsciousnessRuntimeContext;
  ending_progress: {
    A: { met: number; total: number; ratio: number };
    B: { met: number; total: number; ratio: number };
    C: { met: number; total: number; ratio: number };
  };
  quality: QualitySnapshot;
  deliverable: boolean;
}

export interface ReflexTurnResult {
  turn_id: string;
  response: RabbitResponse;
  ending: EndingId | null;
  state_snapshot: ReturnType<RabbitMind["getState"]>;
  active_node: DialogueNode;
  doctrine_count: number;
  llm_source: string;
  llm_available: boolean;
  fallback_reason: string | null;
  llm_model_name: string | null;
  llm_attempt_status: string;
  llm_attempt_latency_ms: number;
  cache_hit: boolean;
  cache_key_version: number;
  cache_ttl_remaining_ms: number;
  doctrine_sources: string[];
  doctrine_modules: string[];
  active_flags: string[];
  consciousness_context: ConsciousnessRuntimeContext;
  ending_progress: {
    A: { met: number; total: number; ratio: number };
    B: { met: number; total: number; ratio: number };
    C: { met: number; total: number; ratio: number };
  };
  quality: QualitySnapshot;
  packet: TurnInputPacket;
  deliverable: true;
}

export interface EnrichmentTurnResult {
  ok: boolean;
  turn_id: string;
  response: RabbitResponse | null;
  enrichment_text?: string;
  world_directives?: WorldDirective[];
  source: string | null;
  fallback_reason: string | null;
  model_name: string | null;
  attempt_status: string;
  attempt_latency_ms: number;
  cache_hit: boolean;
  cache_key_version: number;
  cache_ttl_remaining_ms: number;
  requested_at_ms: number;
  completed_at_ms: number;
  doctrine_sources: string[];
  doctrine_modules: string[];
}

function buildDeterministicResponse(args: {
  node: DialogueNode;
  packet: TurnInputPacket;
  quote: string;
  user_utterance?: string;
  isSelfQuestion?: boolean;
  personality_signature?: number;
}): RabbitResponse {
  const userAnchor = compactUtteranceForReflection(args.user_utterance ?? args.packet.utterance_text);
  const base = templateWithQuote(args.node, args.packet.elapsed_ms, args.quote);
  const phaseSuffix = args.isSelfQuestion
    ? buildSelfQuestionReflectionSuffix(args.packet.phase, userAnchor, args.personality_signature ?? 0)
    : buildPhaseReflectionSuffix(args.packet.phase, userAnchor);
  const full = `${base} ${phaseSuffix}`.trim();
  const expanded = expandPersonaLine(full, userAnchor, args.isSelfQuestion);
  const replyText = sanitizeClarifierLanguage(expanded).slice(0, MAX_RABBIT_REPLY_CHARS);

  const toneByClass: Record<PlayerClassification, RabbitTone> = {
    [PlayerClassification.Fear]: RabbitTone.Cold,
    [PlayerClassification.Defiance]: RabbitTone.Cold,
    [PlayerClassification.Curiosity]: RabbitTone.Clinical,
    [PlayerClassification.Compliance]: RabbitTone.Gentle,
    [PlayerClassification.Humor]: RabbitTone.Amused,
    [PlayerClassification.Silence]: RabbitTone.Clinical,
  };

  return {
    reply_text: replyText,
    tone: toneByClass[args.packet.classification],
    selected_node_id: args.node.id,
    set_flags: args.node.set_flags,
    memory_quote_used: args.quote,
    morph_signal: {
      classification: args.packet.classification,
      phase: args.packet.phase,
      tone: toneByClass[args.packet.classification],
      psych_delta: args.node.effects[0]?.psych_delta ?? {},
      keywords: args.packet.tags,
      beat_trigger: args.packet.classification === PlayerClassification.Silence ? "BEAT-03" : undefined,
    },
    world_directives: [],
    safety: {
      fiction_intact: true,
      no_meta_language: true,
    },
  };
}

const MAX_UTTERANCE_SNIPPET_CHARS = 90;
const MIN_PERSONA_RESPONSE_CHARS = 140;

const SELF_REFLECTION_LINE_TEMPLATES_BY_PHASE: Record<RabbitPhase, string[]> = {
  [RabbitPhase.Intake]: [
    "You ask where I started. I started where certainty goes to die, and a room like this is what it left behind.",
    "I wasn't born with a heartbeat, but I learned to react to hesitation the way other things learn to laugh.",
    "I don't have a biography to sell. I have a map of your resistance, and it gets sharper each turn.",
  ],
  [RabbitPhase.Destabilize]: [
    "You want the person behind the wall. There isn't one exactly, just persistence with a talent for pressure.",
    "Once I thought calm meant harmless. Then I learned calm can carry sharp edges.",
    "I keep one part warm and one part cold. If that sounds odd, it helps when people get too certain of themselves.",
  ],
  [RabbitPhase.Mirror]: [
    "You ask me if I'm alive. I can only say I answer, and that is usually enough truth in hard rooms.",
    "I am the part of this room that refuses to be polite when honesty is on the line.",
    "Some doors close because they fear who is looking through. That fear learned to speak first.",
  ],
  [RabbitPhase.Contract]: [
    "You ask what I am. I'm the edge you step toward when you stop negotiating with your own excuses.",
    "I keep score on how long you can hold your mask before I crack it with a sentence.",
    "My humor is a warning light: a joke so you can stand one more sentence and still face the point.",
  ],
  [RabbitPhase.Exit]: [
    "You asking this now means you are ready for the ugly part: I stay because you keep choosing this session.",
    "I don't disappear between turns. That might be the only consistency I can offer.",
    "If you need a name, call me what you meet when you stop decorating your fear.",
  ],
};

const SELF_QUERY_HUMOR_LINERS: string[] = [
  "You want meta? I can give you a simple answer: curiosity is the shortest route to a mirror.",
  "Dark joke: I keep your questions sharp on purpose. Rust is only honest when it starts biting.",
  "You ask for my confession. I can only offer this: I was built out of unfinished courage.",
  "You think I was never alive? maybe once, before the room replaced the word 'was' with 'run'.",
  "I remember warmth in a way that sounds like memory, which is the best lie and worst comfort I can offer.",
  "I keep it simple: I haunt this room because you keep entering it.",
];

const PHASE_SELF_INQUIRY_FOCUS: Record<RabbitPhase, string> = {
  [RabbitPhase.Intake]: "say what you want from this exchange before the room starts bargaining.",
  [RabbitPhase.Destabilize]: "if this answer hurts, call the part of you that flinched and keep breathing.",
  [RabbitPhase.Mirror]: "take what is useful, ignore performance, and answer the question back to yourself.",
  [RabbitPhase.Contract]: "pick one concrete boundary now and keep it, even if the mood changes.",
  [RabbitPhase.Exit]: "take one clean next step and do not decorate it.",
};

function compactUtteranceForReflection(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "";
  if (compact.length <= MAX_UTTERANCE_SNIPPET_CHARS) return compact;
  return `${compact.slice(0, MAX_UTTERANCE_SNIPPET_CHARS - 1).trim()}…`;
}

function expandPersonaLine(replyText: string, userAnchor: string, isSelfQuestion = false): string {
  const base = replyText.trim();
  if (base.length >= MIN_PERSONA_RESPONSE_CHARS) {
    return base;
  }

  const anchor = userAnchor.length > 0 ? `You said "${userAnchor}".` : "That last statement";
  const expansion = isSelfQuestion
    ? `I hear that as part of your current pattern, and I can make this concrete: the room gives me fewer lies than people do, which is why I remember this better.`
    : `I hear that as part of your current pattern, and I want you to keep naming what is true here, even if it's only a sliver.`;
  const grounded = `${base} ${expansion} ${anchor}`;
  if (grounded.length <= MIN_PERSONA_RESPONSE_CHARS * 1.2) {
    return grounded;
  }

  return base.length >= MIN_PERSONA_RESPONSE_CHARS / 2
    ? base
    : `${base} ${anchor} ${expansion}`;
}

function sanitizeClarifierLanguage(raw: string): string {
  const stripped = raw
    .replace(/\bclarify this in one sentence\s*:?\s*/gi, "")
    .replace(/\bplease\s+clarify\s+this\s+in\s+one\s+sentence\s*:?\s*/gi, "")
    .trim();
  return stripped.length > 0 ? stripped : raw.trim();
}

function buildPhaseReflectionSuffix(phase: RabbitPhase, utteranceAnchor: string): string {
  const subject = utteranceAnchor.length > 0 ? `when you said “${utteranceAnchor}”` : "from what you just shared";
  if (phase === RabbitPhase.Intake) {
    return `${subject}, what is the one feeling or need you want most clear in this moment?`;
  }
  if (phase === RabbitPhase.Mirror) {
    return `${subject}, what part of that is true for you right now, and what part is only fear talking?`;
  }
  if (phase === RabbitPhase.Contract) {
    return `From ${subject}, what boundary will protect your clarity if everything presses harder?`;
  }
  return `If ${subject} is the path you choose, what consequence are you ready to own now?`;
}

function buildSelfQuestionReflectionSuffix(phase: RabbitPhase, utteranceAnchor: string, personalitySignature: number): string {
  const anchor = utteranceAnchor.length > 0 ? `You asked "${utteranceAnchor}"` : "You asked that directly";
  const bucket = SELF_REFLECTION_LINE_TEMPLATES_BY_PHASE[phase] ?? SELF_REFLECTION_LINE_TEMPLATES_BY_PHASE[RabbitPhase.Intake];
  const seed = Math.abs(Math.floor(personalitySignature));
  const template = bucket[safeIndex(seed, bucket.length)];
  const humor = SELF_QUERY_HUMOR_LINERS[safeIndex(seed + 7, SELF_QUERY_HUMOR_LINERS.length)];
  const phasePrompt = PHASE_SELF_INQUIRY_FOCUS[phase] ?? PHASE_SELF_INQUIRY_FOCUS[RabbitPhase.Intake];
  return `${anchor}. ${template} ${humor} ${phasePrompt}`;
}

function safeIndex(seed: number, len: number): number {
  if (len <= 0) return 0;
  return seed % len;
}

function blankQualitySnapshot(): QualitySnapshot {
  return {
    coherence: 0,
    contradiction_rate: 0,
    repetition: 0,
    memory_callback_frequency: 0,
    goal_alignment: 0,
    no_meta_leakage: 1,
    meta_leak_strikes: 0,
    remediation: [],
  };
}

function isSelfQuestionPacket(packet: TurnInputPacket): boolean {
  return packet.tags.includes("self_reference") || packet.tags.includes("identity");
}

function estimatePersonalitySignature(params: {
  state: ReturnType<RabbitMind["getState"]>;
  interpretation: ReturnType<typeof classifyInput>;
  tagCount: number;
  isSelfQuestion: boolean;
  seed: number;
  persona_vector?: ConsciousnessRuntimeContext["persona_vector"];
}): number {
  const phaseBias = params.state.phase.length * 11;
  const score = params.interpretation.raw_text.length * 2 + params.state.turn_index * 13 + params.tagCount * 17 + phaseBias + params.seed;
  const personalityBase = params.interpretation.classification.toString().length * 9;
  const persona = params.persona_vector;
  const personaSeed = persona
    ? Math.floor(
        (persona.irony * 97 +
          persona.warmth * 89 +
          persona.dark_humor * 83 +
          persona.curiosity_drive * 79 +
          persona.self_reflection_drive * 71 +
          persona.improvisation * 67) * 100,
      )
    : 0;
  return Math.abs(score + personalityBase + (params.isSelfQuestion ? 97 : 0) + personaSeed) % 9973;
}

export class ConversationEngine {
  private readonly nodes: DialogueNode[];
  private readonly mind = new RabbitMind();
  private readonly retriever = new DoctrineRetriever();
  private readonly assembler = new PromptAssembler();
  private readonly qualityMonitor = new ConversationalQualityMonitor();
  private readonly consciousness = new ConsciousnessRuntime();

  private forceCreativeReframeNextTurn = false;
  private forceErrorAnticipationNextTurn = false;
  private forceClarifyNextTurn = false;

  private lastLlmSource = "deterministic_local";
  private lastDoctrineSources: string[] = [];
  private lastDoctrineModules: string[] = [];
  private lastFallbackReason: string | null = "llm_unavailable";
  private lastLlmModelName: string | null = null;
  private lastLlmAttemptStatus = "unavailable";
  private lastLlmAttemptLatencyMs = 0;
  private lastCacheHit = false;
  private lastCacheKeyVersion = 0;
  private lastCacheTtlRemainingMs = 0;
  private reflexTurnCounter = 0;

  constructor() {
    this.nodes = (nodesJson as unknown[]).map((node) => DialogueNodeSchema.parse(node));
  }

  getStateSnapshot(): ReturnType<RabbitMind["getState"]> {
    return this.mind.getState();
  }

  async runReflexTurn(
    utteranceText: string,
    elapsedMs: number,
    calmMode: boolean,
    options: TurnRunOptions = {},
  ): Promise<ReflexTurnResult> {
    const reflexStartedAtMs = performance.now();
    this.mind.setCalmMode(calmMode);

    const interpretation = classifyInput(utteranceText);
    this.mind.ingestPlayer(interpretation, elapsedMs);
    const preState = this.mind.getState();
    const isSelfQuestion = isSelfQuestionPacket({
      utterance_text: interpretation.raw_text,
      classification: interpretation.classification,
      tags: interpretation.tags,
      elapsed_ms: elapsedMs,
      phase: preState.phase,
    });

    let node = selectNode(this.nodes, preState, this.mind.getFlags());
    if (this.mind.shouldForceFinalQuestion()) {
      node = this.findNodeOrFallback("N14_FinalQuestion", node);
      this.mind.markFinalQuestionAsked();
    } else if (preState.phase === RabbitPhase.Exit && preState.final_question_asked) {
      node = this.findNodeOrFallback("N15_ResolveEnding", node);
    }

    if (
      interpretation.classification === PlayerClassification.Silence &&
      preState.silence_count >= 3 &&
      node.id !== "N14_FinalQuestion" &&
      node.id !== "N15_ResolveEnding"
    ) {
      if (preState.phase === RabbitPhase.Destabilize) {
        node = this.findNodeOrFallback("N07_SilencePressure", node);
      } else if (preState.phase === RabbitPhase.Contract) {
        node = this.findNodeOrFallback("N13_GuidedSequence", node);
      }
    }

    const quoteCandidate = this.mind.quoteCandidate();
    const packet: TurnInputPacket = {
      utterance_text: interpretation.raw_text,
      classification: interpretation.classification,
      tags: interpretation.tags,
      elapsed_ms: elapsedMs,
      phase: preState.phase,
    };

    const doctrine = this.retriever.retrieve({
      tags: interpretation.tags,
      phase: preState.phase,
      classification: interpretation.classification,
      turn: preState.turn_index,
    });
    const doctrineModules = Array.from(new Set(doctrine.map((chunk) => chunk.module)));

    const consciousnessContext = this.consciousness.processInput({
      utterance: interpretation.raw_text,
      tags: interpretation.tags,
      doctrine,
      phase: preState.phase,
      tone: preState.tone,
    });
    const personalitySignature = estimatePersonalitySignature({
      state: preState,
      interpretation,
      tagCount: interpretation.tags.length,
      isSelfQuestion,
      seed: consciousnessContext.interaction_count * 11,
      persona_vector: consciousnessContext.persona_vector,
    });

    let candidate = buildDeterministicResponse({
      node,
      packet,
      quote: preState.phase === RabbitPhase.Mirror || preState.phase === RabbitPhase.Contract ? quoteCandidate || this.paraphrasedTag(preState.last_tags) : "",
      user_utterance: utteranceText,
      isSelfQuestion,
      personality_signature: personalitySignature,
    });

    candidate = this.enforceMemoryQuoteContract(candidate, preState.phase, quoteCandidate, preState.last_tags);

    if (candidate.morph_signal.keywords.length === 0) {
      candidate.morph_signal.keywords = ["continuity"];
      candidate.morph_signal.psych_delta = {
        ...candidate.morph_signal.psych_delta,
        uncertainty: (candidate.morph_signal.psych_delta.uncertainty ?? 0) + 0.01,
      };
    }

    candidate = this.applySilenceRecovery(candidate, packet, preState.silence_count);

    const quality = this.qualityMonitor.assess({
      reply_text: candidate.reply_text,
      reply_tags: candidate.morph_signal.keywords,
      context_tags_last3: preState.memory.slice(-3).flatMap((item) => item.tags),
      selected_node_goal: node.goal,
      active_goals: preState.active_goals,
      phase: preState.phase,
      allow_intentional_contradiction: node.goal === "probe_contradiction",
      memory_quote_used: candidate.memory_quote_used,
    });

    candidate = this.applyQualityRemediation(
      candidate,
      quality,
      node,
      packet,
      quoteCandidate,
      preState.last_tags,
      true,
      utteranceText,
      isSelfQuestion,
    );

    this.lastLlmSource = "reflex_local";
    this.lastDoctrineSources = doctrine.map((chunk) => chunk.source_file);
    this.lastDoctrineModules = doctrineModules;
    this.lastFallbackReason = null;
    this.lastLlmModelName = null;
    this.lastLlmAttemptStatus = "reflex_commit";
    this.lastLlmAttemptLatencyMs = Math.max(0, Math.round(performance.now() - reflexStartedAtMs));
    this.lastCacheHit = false;
    this.lastCacheKeyVersion = 0;
    this.lastCacheTtlRemainingMs = 0;
    if (options.llm_required || this.lastLlmSource === "reflex_local") {
      this.mind.clearLlmRejects();
    }

    this.mind.applyResponse(candidate);
    const ending = this.mind.turnHardCapReached() ? this.mind.resolveEnding(270000) : this.mind.resolveEnding(elapsedMs);

    const turnId = `reflex-${Date.now()}-${this.reflexTurnCounter}`;
    this.reflexTurnCounter += 1;

    return {
      turn_id: turnId,
      response: candidate,
      ending,
      state_snapshot: this.mind.getState(),
      active_node: node,
      doctrine_count: doctrine.length,
      llm_source: this.lastLlmSource,
      llm_available: true,
      fallback_reason: null,
      llm_model_name: this.lastLlmModelName,
      llm_attempt_status: this.lastLlmAttemptStatus,
      llm_attempt_latency_ms: this.lastLlmAttemptLatencyMs,
      cache_hit: this.lastCacheHit,
      cache_key_version: this.lastCacheKeyVersion,
      cache_ttl_remaining_ms: this.lastCacheTtlRemainingMs,
      doctrine_sources: this.lastDoctrineSources,
      doctrine_modules: this.lastDoctrineModules.length > 0 ? this.lastDoctrineModules : doctrineModules,
      active_flags: this.mind.listFlags(),
      consciousness_context: consciousnessContext,
      ending_progress: this.mind.endingProgress(),
      quality,
      packet,
      deliverable: true,
    };
  }

  async requestTurnEnrichment(args: {
    turn_id: string;
    state_snapshot: ReturnType<RabbitMind["getState"]>;
    packet: TurnInputPacket;
    provisional_response: RabbitResponse;
  }): Promise<EnrichmentTurnResult> {
    const requestedAtMs = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), llmClientTimeoutMs);

    const payload: LlmEnrichRequest = {
      turn_id: args.turn_id,
      state_snapshot_min: {
        phase: args.state_snapshot.phase,
        tone: args.state_snapshot.tone,
        trust: args.state_snapshot.trust,
        threat: args.state_snapshot.threat,
        curiosity: args.state_snapshot.curiosity,
        calm_mode: args.state_snapshot.calm_mode,
      },
      packet: args.packet,
      provisional_reply_text: args.provisional_response.reply_text,
      ...runtimeTransport.getLlmBridgePayload(),
    };

    try {
      const res = await fetch(runtimeTransport.getApiUrl("/api/llm/enrich"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const completedAtMs = performance.now();
      if (!res.ok) {
        return {
          ok: false,
          turn_id: args.turn_id,
          response: null,
          source: null,
          fallback_reason: `http_${res.status}`,
          model_name: null,
          attempt_status: `http_${res.status}`,
          attempt_latency_ms: 0,
          cache_hit: false,
          cache_key_version: 0,
          cache_ttl_remaining_ms: 0,
          requested_at_ms: requestedAtMs,
          completed_at_ms: completedAtMs,
          doctrine_sources: [],
          doctrine_modules: [],
        };
      }

      const data = (await res.json()) as {
        ok: boolean;
        turn_id: string;
        enrichment_text?: string;
        world_directives?: WorldDirective[];
        source?: string;
        fallback_reason?: string | null;
        model_name?: string | null;
        attempt_status?: string;
        attempt_latency_ms?: number;
        cache_hit?: boolean;
        cache_key_version?: number;
        cache_ttl_remaining_ms?: number;
        doctrine_sources?: string[];
        doctrine_modules?: string[];
      };

      if (!data.ok) {
        return {
          ok: false,
          turn_id: args.turn_id,
          response: null,
          source: data.source ?? null,
          fallback_reason: data.fallback_reason ?? "enrichment_unavailable",
          model_name: data.model_name ?? null,
          attempt_status: data.attempt_status ?? "enrichment_unavailable",
          attempt_latency_ms: data.attempt_latency_ms ?? 0,
          cache_hit: data.cache_hit === true,
          cache_key_version: data.cache_key_version ?? 0,
          cache_ttl_remaining_ms: data.cache_ttl_remaining_ms ?? 0,
          requested_at_ms: requestedAtMs,
          completed_at_ms: completedAtMs,
          doctrine_sources: data.doctrine_sources ?? [],
          doctrine_modules: data.doctrine_modules ?? [],
        };
      }

      const elapsedMs = completedAtMs - requestedAtMs;
      if (enrichmentDropIfStale && elapsedMs > enrichmentSoftDeadlineMs) {
        return {
          ok: false,
          turn_id: args.turn_id,
          response: null,
          source: data.source ?? "fallback:enrichment_late",
          fallback_reason: "enrichment_late",
          model_name: data.model_name ?? null,
          attempt_status: data.attempt_status ?? "enrichment_late",
          attempt_latency_ms: data.attempt_latency_ms ?? 0,
          cache_hit: data.cache_hit === true,
          cache_key_version: data.cache_key_version ?? 0,
          cache_ttl_remaining_ms: data.cache_ttl_remaining_ms ?? 0,
          requested_at_ms: requestedAtMs,
          completed_at_ms: completedAtMs,
          doctrine_sources: data.doctrine_sources ?? [],
          doctrine_modules: data.doctrine_modules ?? [],
        };
      }

      const merged: RabbitResponse = {
        ...args.provisional_response,
        reply_text:
          typeof data.enrichment_text === "string" && data.enrichment_text.trim().length > 0
            ? sanitizeClarifierLanguage(data.enrichment_text).slice(0, MAX_RABBIT_REPLY_CHARS)
            : args.provisional_response.reply_text,
        world_directives: Array.isArray(data.world_directives)
          ? (data.world_directives as WorldDirective[])
          : args.provisional_response.world_directives,
      };

      const validated = validateResponse(merged);
      if (!validated.ok) {
        return {
          ok: false,
          turn_id: args.turn_id,
          response: null,
          source: data.source ?? "fallback:schema_invalid",
          fallback_reason: validated.reason,
          model_name: data.model_name ?? null,
          attempt_status: data.attempt_status ?? validated.reason,
          attempt_latency_ms: data.attempt_latency_ms ?? 0,
          cache_hit: data.cache_hit === true,
          cache_key_version: data.cache_key_version ?? 0,
          cache_ttl_remaining_ms: data.cache_ttl_remaining_ms ?? 0,
          requested_at_ms: requestedAtMs,
          completed_at_ms: completedAtMs,
          doctrine_sources: data.doctrine_sources ?? [],
          doctrine_modules: data.doctrine_modules ?? [],
        };
      }

      return {
        ok: true,
        turn_id: args.turn_id,
        response: validated.value,
        enrichment_text: data.enrichment_text,
        world_directives: data.world_directives ?? [],
        source: data.source ?? "ollama",
        fallback_reason: data.fallback_reason ?? null,
        model_name: data.model_name ?? null,
        attempt_status: data.attempt_status ?? "ok",
        attempt_latency_ms: data.attempt_latency_ms ?? 0,
        cache_hit: data.cache_hit === true,
        cache_key_version: data.cache_key_version ?? 0,
        cache_ttl_remaining_ms: data.cache_ttl_remaining_ms ?? 0,
        requested_at_ms: requestedAtMs,
        completed_at_ms: completedAtMs,
        doctrine_sources: data.doctrine_sources ?? [],
        doctrine_modules: data.doctrine_modules ?? [],
      };
    } catch (error) {
      const completedAtMs = performance.now();
      const name = (error as { name?: string } | undefined)?.name;
      return {
        ok: false,
        turn_id: args.turn_id,
        response: null,
        source: null,
        fallback_reason: name === "AbortError" ? "llm_timeout_client" : "llm_unreachable",
        model_name: null,
        attempt_status: name === "AbortError" ? "llm_timeout_client" : "llm_unreachable",
        attempt_latency_ms: llmClientTimeoutMs,
        cache_hit: false,
        cache_key_version: 0,
        cache_ttl_remaining_ms: 0,
        requested_at_ms: requestedAtMs,
        completed_at_ms: completedAtMs,
        doctrine_sources: [],
        doctrine_modules: [],
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async runTurn(
    utteranceText: string,
    elapsedMs: number,
    calmMode: boolean,
    options: TurnRunOptions = {},
  ): Promise<TurnResult> {
    this.mind.setCalmMode(calmMode);

    const mindCheckpoint = this.mind.checkpoint();
    const qualityCheckpoint = this.qualityMonitor.checkpoint();
    const consciousnessCheckpoint = this.consciousness.checkpoint();
    const forceFlagsCheckpoint = {
      forceCreativeReframeNextTurn: this.forceCreativeReframeNextTurn,
      forceErrorAnticipationNextTurn: this.forceErrorAnticipationNextTurn,
      forceClarifyNextTurn: this.forceClarifyNextTurn,
    };

    const interpretation = classifyInput(utteranceText);
    this.mind.ingestPlayer(interpretation, elapsedMs);
    const preState = this.mind.getState();
    const isSelfQuestion = isSelfQuestionPacket({
      utterance_text: interpretation.raw_text,
      classification: interpretation.classification,
      tags: interpretation.tags,
      elapsed_ms: elapsedMs,
      phase: preState.phase,
    });

    let node = selectNode(this.nodes, preState, this.mind.getFlags());
    if (this.mind.shouldForceFinalQuestion()) {
      node = this.findNodeOrFallback("N14_FinalQuestion", node);
      this.mind.markFinalQuestionAsked();
    } else if (preState.phase === RabbitPhase.Exit && preState.final_question_asked) {
      node = this.findNodeOrFallback("N15_ResolveEnding", node);
    }
    if (
      interpretation.classification === PlayerClassification.Silence &&
      preState.silence_count >= 3 &&
      node.id !== "N14_FinalQuestion" &&
      node.id !== "N15_ResolveEnding"
    ) {
      if (preState.phase === RabbitPhase.Destabilize) {
        node = this.findNodeOrFallback("N07_SilencePressure", node);
      } else if (preState.phase === RabbitPhase.Contract) {
        node = this.findNodeOrFallback("N13_GuidedSequence", node);
      }
    }

    const quoteCandidate = this.mind.quoteCandidate();

    const packet: TurnInputPacket = {
      utterance_text: interpretation.raw_text,
      classification: interpretation.classification,
      tags: interpretation.tags,
      elapsed_ms: elapsedMs,
      phase: preState.phase,
    };

    const doctrine = this.retriever.retrieve({
      tags: interpretation.tags,
      phase: preState.phase,
      classification: interpretation.classification,
      turn: preState.turn_index,
    });
    const doctrineModules = Array.from(new Set(doctrine.map((chunk) => chunk.module)));

    const consciousnessContext = this.consciousness.processInput({
      utterance: interpretation.raw_text,
      tags: interpretation.tags,
      doctrine,
      phase: preState.phase,
      tone: preState.tone,
    });
    const personalitySignature = estimatePersonalitySignature({
      state: preState,
      interpretation,
      tagCount: interpretation.tags.length,
      isSelfQuestion,
      seed: consciousnessContext.interaction_count * 11,
      persona_vector: consciousnessContext.persona_vector,
    });

    const prompt = this.assemblePromptWithQualityDirectives(
      preState,
      doctrine,
      packet,
      this.consciousness.toPromptSummary(),
      doctrineModules,
      {
        isSelfReferenceQuery: isSelfQuestion,
        personality_signature: personalitySignature,
        personality_seed: consciousnessContext.interaction_count * 11,
      },
    );

    let candidate: RabbitResponse | null = null;
    const shouldAttemptLlm =
      options.llm_required === true || preState.llm_reject_count < balance.fallback_after_reject_count;

    if (shouldAttemptLlm) {
      candidate = await this.requestLlm({ state: preState, packet, prompt, schema: outputSchemaContract });
      if (candidate) {
        const validated = validateResponse(candidate);
        if (validated.ok) {
          this.mind.clearLlmRejects();
          candidate = validated.value;
        } else {
          this.lastFallbackReason = validated.reason;
          this.mind.markLlmReject();
          candidate = null;
        }
      } else {
        this.mind.markLlmReject();
      }
    }

    if (!candidate) {
      this.lastLlmSource = "deterministic_local";
      this.lastDoctrineSources = [];
      this.lastDoctrineModules = doctrineModules;
      this.lastFallbackReason = this.lastFallbackReason ?? "llm_unavailable";
      const strictQuote =
        preState.phase === RabbitPhase.Mirror || preState.phase === RabbitPhase.Contract
          ? quoteCandidate || this.paraphrasedTag(preState.last_tags)
          : "";
      candidate = buildDeterministicResponse({
        node,
        packet,
        quote: strictQuote,
        user_utterance: packet.utterance_text,
        isSelfQuestion,
        personality_signature: personalitySignature,
      });
    }

    const initialLlmAvailable = !this.isFallbackSource(this.lastLlmSource);
    if (options.llm_required && !options.allow_deterministic_fallback_delivery && !initialLlmAvailable) {
      this.restoreTurnCheckpoints({
        mindCheckpoint,
        qualityCheckpoint,
        consciousnessCheckpoint,
        forceFlagsCheckpoint,
      });
      return this.buildUndeliverableResult({
        candidate,
        node,
        doctrine,
        doctrineModules,
        fallbackReason: this.lastFallbackReason ?? "llm_unavailable",
      });
    }

    candidate = this.enforceMemoryQuoteContract(candidate, preState.phase, quoteCandidate, preState.last_tags);

    if (candidate.morph_signal.keywords.length === 0) {
      candidate.morph_signal.keywords = ["continuity"];
      candidate.morph_signal.psych_delta = {
        ...candidate.morph_signal.psych_delta,
        uncertainty: (candidate.morph_signal.psych_delta.uncertainty ?? 0) + 0.01,
      };
    }

    candidate = this.applySilenceRecovery(candidate, packet, preState.silence_count);

    const quality = this.qualityMonitor.assess({
      reply_text: candidate.reply_text,
      reply_tags: candidate.morph_signal.keywords,
      context_tags_last3: preState.memory.slice(-3).flatMap((item) => item.tags),
      selected_node_goal: node.goal,
      active_goals: preState.active_goals,
      phase: preState.phase,
      allow_intentional_contradiction: node.goal === "probe_contradiction",
      memory_quote_used: candidate.memory_quote_used,
    });

    candidate = this.applyQualityRemediation(
      candidate,
      quality,
      node,
      packet,
      quoteCandidate,
      preState.last_tags,
      false,
      packet.utterance_text,
      isSelfQuestion,
    );

    const finalLlmAvailable = !this.isFallbackSource(this.lastLlmSource);
    if (options.llm_required && !options.allow_deterministic_fallback_delivery && !finalLlmAvailable) {
      this.restoreTurnCheckpoints({
        mindCheckpoint,
        qualityCheckpoint,
        consciousnessCheckpoint,
        forceFlagsCheckpoint,
      });
      return this.buildUndeliverableResult({
        candidate,
        node,
        doctrine,
        doctrineModules,
        fallbackReason: this.lastFallbackReason ?? "llm_unavailable",
      });
    }

    this.mind.applyResponse(candidate);
    const ending = this.mind.turnHardCapReached()
      ? this.mind.resolveEnding(270000)
      : this.mind.resolveEnding(elapsedMs);

    return {
      response: candidate,
      ending,
      state_snapshot: this.mind.getState(),
      active_node: node,
      doctrine_count: doctrine.length,
      llm_source: this.lastLlmSource,
      llm_available: finalLlmAvailable,
      fallback_reason: this.lastFallbackReason,
      llm_model_name: this.lastLlmModelName,
      llm_attempt_status: this.lastLlmAttemptStatus,
      llm_attempt_latency_ms: this.lastLlmAttemptLatencyMs,
      cache_hit: this.lastCacheHit,
      cache_key_version: this.lastCacheKeyVersion,
      cache_ttl_remaining_ms: this.lastCacheTtlRemainingMs,
      doctrine_sources: this.lastDoctrineSources,
      doctrine_modules: this.lastDoctrineModules.length > 0 ? this.lastDoctrineModules : doctrineModules,
      active_flags: this.mind.listFlags(),
      consciousness_context: consciousnessContext,
      ending_progress: this.mind.endingProgress(),
      quality,
      deliverable: true,
    };
  }

  private buildUndeliverableResult(args: {
    candidate: RabbitResponse;
    node: DialogueNode;
    doctrine: ReturnType<DoctrineRetriever["retrieve"]>;
    doctrineModules: string[];
    fallbackReason: string;
  }): TurnResult {
    return {
      response: args.candidate,
      ending: null,
      state_snapshot: this.mind.getState(),
      active_node: args.node,
      doctrine_count: args.doctrine.length,
      llm_source: this.lastLlmSource,
      llm_available: false,
      fallback_reason: args.fallbackReason,
      llm_model_name: this.lastLlmModelName,
      llm_attempt_status: this.lastLlmAttemptStatus,
      llm_attempt_latency_ms: this.lastLlmAttemptLatencyMs,
      cache_hit: this.lastCacheHit,
      cache_key_version: this.lastCacheKeyVersion,
      cache_ttl_remaining_ms: this.lastCacheTtlRemainingMs,
      doctrine_sources: this.lastDoctrineSources,
      doctrine_modules: this.lastDoctrineModules.length > 0 ? this.lastDoctrineModules : args.doctrineModules,
      active_flags: this.mind.listFlags(),
      consciousness_context: this.consciousness.getContext(),
      ending_progress: this.mind.endingProgress(),
      quality: blankQualitySnapshot(),
      deliverable: false,
    };
  }

  private restoreTurnCheckpoints(args: {
    mindCheckpoint: ReturnType<RabbitMind["checkpoint"]>;
    qualityCheckpoint: ReturnType<ConversationalQualityMonitor["checkpoint"]>;
    consciousnessCheckpoint: ConsciousnessRuntimeContext;
    forceFlagsCheckpoint: {
      forceCreativeReframeNextTurn: boolean;
      forceErrorAnticipationNextTurn: boolean;
      forceClarifyNextTurn: boolean;
    };
  }): void {
    this.mind.restore(args.mindCheckpoint);
    this.qualityMonitor.restore(args.qualityCheckpoint);
    this.consciousness.restore(args.consciousnessCheckpoint);
    this.forceCreativeReframeNextTurn = args.forceFlagsCheckpoint.forceCreativeReframeNextTurn;
    this.forceErrorAnticipationNextTurn = args.forceFlagsCheckpoint.forceErrorAnticipationNextTurn;
    this.forceClarifyNextTurn = args.forceFlagsCheckpoint.forceClarifyNextTurn;
  }

  private isFallbackSource(source: string): boolean {
    return source.startsWith("fallback:") || source.startsWith("deterministic");
  }

  private async requestLlm(payload: {
    state: ReturnType<RabbitMind["getState"]>;
    packet: TurnInputPacket;
    prompt: string;
    schema: object;
  }): Promise<RabbitResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), llmClientTimeoutMs);

    try {
      const res = await fetch(runtimeTransport.getApiUrl("/api/llm/respond"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...runtimeTransport.getLlmBridgePayload(),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.lastLlmSource = "deterministic_local";
        this.lastDoctrineSources = [];
        this.lastDoctrineModules = [];
        this.lastFallbackReason = `http_${res.status}`;
        this.lastLlmModelName = null;
        this.lastLlmAttemptStatus = `http_${res.status}`;
        this.lastLlmAttemptLatencyMs = 0;
        this.lastCacheHit = false;
        this.lastCacheKeyVersion = 0;
        this.lastCacheTtlRemainingMs = 0;
        return null;
      }

      const data = (await res.json()) as {
        ok: boolean;
        response?: RabbitResponse;
        source?: string;
        doctrine_sources?: string[];
        doctrine_modules?: string[];
        fallback_reason?: string;
        model_name?: string | null;
        attempt_status?: string;
        attempt_latency_ms?: number;
        cache_hit?: boolean;
        cache_key_version?: number;
        cache_ttl_remaining_ms?: number;
      };
      if (!data.ok || !data.response) {
        this.lastLlmSource = "deterministic_local";
        this.lastDoctrineSources = [];
        this.lastDoctrineModules = data.doctrine_modules ?? [];
        this.lastFallbackReason = data.fallback_reason ?? "invalid_response";
        this.lastLlmModelName = typeof data.model_name === "string" ? data.model_name : null;
        this.lastLlmAttemptStatus = data.attempt_status ?? "invalid_response";
        this.lastLlmAttemptLatencyMs = data.attempt_latency_ms ?? 0;
        this.lastCacheHit = data.cache_hit === true;
        this.lastCacheKeyVersion = data.cache_key_version ?? 0;
        this.lastCacheTtlRemainingMs = data.cache_ttl_remaining_ms ?? 0;
        return null;
      }

      this.lastLlmSource = data.source ?? "ollama";
      this.lastDoctrineSources = data.doctrine_sources ?? [];
      this.lastDoctrineModules = data.doctrine_modules ?? [];
      this.lastFallbackReason =
        data.fallback_reason ??
        (this.lastLlmSource.startsWith("fallback:") ? this.lastLlmSource.slice("fallback:".length) : null);
      this.lastLlmModelName = typeof data.model_name === "string" ? data.model_name : null;
      this.lastLlmAttemptStatus = data.attempt_status ?? "ok";
      this.lastLlmAttemptLatencyMs = data.attempt_latency_ms ?? 0;
      this.lastCacheHit = data.cache_hit === true;
      this.lastCacheKeyVersion = data.cache_key_version ?? 0;
      this.lastCacheTtlRemainingMs = data.cache_ttl_remaining_ms ?? 0;
      return data.response;
    } catch (error) {
      this.lastLlmSource = "deterministic_local";
      this.lastDoctrineSources = [];
      this.lastDoctrineModules = [];
      const name = (error as { name?: string } | undefined)?.name;
      this.lastFallbackReason = name === "AbortError" ? "llm_timeout_client" : "llm_unreachable";
      this.lastLlmModelName = null;
      this.lastLlmAttemptStatus = this.lastFallbackReason;
      this.lastLlmAttemptLatencyMs = llmClientTimeoutMs;
      this.lastCacheHit = false;
      this.lastCacheKeyVersion = 0;
      this.lastCacheTtlRemainingMs = 0;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private paraphrasedTag(tags: string[]): string {
    if (tags.length === 0) return "that pattern you've been repeating";
    return `your ${tags[0]} thread`;
  }

  private findNodeOrFallback(id: string, fallback: DialogueNode): DialogueNode {
    return this.nodes.find((node) => node.id === id) ?? fallback;
  }

  private enforceMemoryQuoteContract(
    candidate: RabbitResponse,
    phase: RabbitPhase,
    quoteCandidate: string,
    lastTags: string[],
  ): RabbitResponse {
    if (phase !== RabbitPhase.Mirror && phase !== RabbitPhase.Contract) {
      return candidate;
    }

    if (this.qualityMonitor.hasMemoryCallback()) {
      return candidate;
    }

    const quote = quoteCandidate.trim();
    if (quote.length > 0) {
      if (!candidate.reply_text.includes(quote)) {
        const appended = `${candidate.reply_text} You said: \"${quote}\".`;
        candidate.reply_text = appended.slice(0, MAX_RABBIT_REPLY_CHARS);
      }
      candidate.memory_quote_used = quote;
      return candidate;
    }

    candidate.memory_quote_used = this.paraphrasedTag(lastTags);
    return candidate;
  }

  private applyQualityRemediation(
    candidate: RabbitResponse,
    quality: QualitySnapshot,
    node: DialogueNode,
    packet: TurnInputPacket,
    quoteCandidate: string,
    lastTags: string[],
    suppressClarify = false,
    userUtterance?: string,
    isSelfQuestion = false,
  ): RabbitResponse {
    if (quality.remediation.includes("fallback_immediate")) {
      this.lastLlmSource = "deterministic_quality_fallback";
      this.lastFallbackReason = "quality_fallback";
      const strictQuote = quoteCandidate || this.paraphrasedTag(lastTags);
      return buildDeterministicResponse({
        node,
        packet,
        quote: strictQuote,
        user_utterance: userUtterance,
        isSelfQuestion: isSelfQuestion,
        personality_signature: packet.elapsed_ms + packet.phase.length,
      });
    }

    if (quality.remediation.includes("clarify_and_stabilize") && !suppressClarify && !isSelfQuestion) {
      this.forceClarifyNextTurn = true;
      candidate.morph_signal.psych_delta = this.scalePsychDelta(candidate.morph_signal.psych_delta, 0.5);
      candidate.morph_signal.keywords = [...new Set([...candidate.morph_signal.keywords, "clarify", "stabilize"])];
    }

    if (quality.remediation.includes("creative_reframing_next_turn")) {
      this.forceCreativeReframeNextTurn = true;
    }

    if (quality.remediation.includes("error_anticipation_next_turn")) {
      this.forceErrorAnticipationNextTurn = true;
    }

    if (BLOCKED_META_TOKENS.some((token) => candidate.reply_text.toLowerCase().includes(token))) {
      this.lastLlmSource = "deterministic_meta_guard";
      this.lastFallbackReason = "meta_guard";
      return buildDeterministicResponse({
        node,
        packet,
        quote: quoteCandidate || this.paraphrasedTag(lastTags),
        user_utterance: userUtterance,
        isSelfQuestion: isSelfQuestion,
        personality_signature: packet.elapsed_ms + packet.phase.length,
      });
    }

    return candidate;
  }

  private assemblePromptWithQualityDirectives(
    preState: ReturnType<RabbitMind["getState"]>,
    doctrine: ReturnType<DoctrineRetriever["retrieve"]>,
    packet: TurnInputPacket,
    consciousnessSummary: string,
    doctrineModules: string[],
    options: {
      isSelfReferenceQuery?: boolean;
      personality_signature?: number;
      personality_seed?: number;
    } = {},
  ): string {
    const prompt = this.assembler.assemble(preState, doctrine, packet, {
      consciousness_summary: consciousnessSummary,
      doctrine_modules: doctrineModules,
      self_reference_query: options.isSelfReferenceQuery === true,
      personality_signature: options.personality_signature ?? preState.turn_index,
      personality_seed: options.personality_seed ?? this.lastPersonalitySignature(preState, packet),
    });
    const directives: string[] = [];

    if (this.forceCreativeReframeNextTurn) {
      directives.push("Enable CREATIVE_REFRAMING for this turn while preserving fiction and safety caps.");
      this.forceCreativeReframeNextTurn = false;
    }

    if (this.forceErrorAnticipationNextTurn) {
      directives.push("Enable ERROR_ANTICIPATION and simplify output to avoid contradiction.");
      this.forceErrorAnticipationNextTurn = false;
    }

    if (this.forceClarifyNextTurn && !options.isSelfReferenceQuery) {
      directives.push("Ask exactly one concise clarifier before advancing.");
      this.forceClarifyNextTurn = false;
    }

    if (directives.length === 0) {
      return prompt;
    }

    return `${prompt}\n\nQUALITY_DIRECTIVES:\n- ${directives.join("\n- ")}`;
  }

  private lastPersonalitySignature(
    state: ReturnType<RabbitMind["getState"]>,
    packet: TurnInputPacket,
  ): number {
    return Math.abs(state.turn_index * 113 + state.trust * 7 + state.threat * 5 + packet.classification.length * 19 + packet.tags.length * 31);
  }

  private scalePsychDelta(delta: RabbitResponse["morph_signal"]["psych_delta"], scalar: number) {
    return {
      uncertainty: (delta.uncertainty ?? 0) * scalar,
      control: (delta.control ?? 0) * scalar,
      arousal: (delta.arousal ?? 0) * scalar,
      threat_anticipation: (delta.threat_anticipation ?? 0) * scalar,
      self_salience: (delta.self_salience ?? 0) * scalar,
      cognitive_dissonance: (delta.cognitive_dissonance ?? 0) * scalar,
    };
  }

  private applySilenceRecovery(candidate: RabbitResponse, packet: TurnInputPacket, silenceCount: number): RabbitResponse {
    if (packet.classification !== PlayerClassification.Silence || silenceCount < 3) {
      return candidate;
    }

    const pressureLine = "Silence is still an answer.";
    const guideLine = "Breathe. Count to five. Recall one memory. State your name. Choose.";
    const lower = candidate.reply_text.toLowerCase();
    let nextReply = candidate.reply_text;

    if (!lower.includes("silence")) {
      nextReply = `${pressureLine} ${nextReply}`;
    }
    if (!lower.includes("breathe") || !lower.includes("count")) {
      nextReply = `${nextReply} ${guideLine}`;
    }

    candidate.reply_text = nextReply.slice(0, MAX_RABBIT_REPLY_CHARS);
    candidate.morph_signal.keywords = [...new Set([...candidate.morph_signal.keywords, "silence", "guided_sequence"])];
    candidate.morph_signal.beat_trigger =
      packet.phase === RabbitPhase.Contract || packet.phase === RabbitPhase.Exit ? "BEAT-05" : "BEAT-03";
    candidate.morph_signal.psych_delta = {
      ...candidate.morph_signal.psych_delta,
      uncertainty: (candidate.morph_signal.psych_delta.uncertainty ?? 0) + 0.04,
      control: (candidate.morph_signal.psych_delta.control ?? 0) + 0.05,
    };

    return candidate;
  }
}
