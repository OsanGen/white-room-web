import { Router } from "express";
import {
  LlmEnrichRequest,
  LlmEnrichRequestSchema,
  LlmTurnRequest,
  PlayerClassification,
  MAX_RABBIT_REPLY_CHARS,
  ProgressFlag,
  RabbitPhase,
  RabbitResponse,
  RabbitStateSchema,
  RabbitTone,
  TurnInputPacket,
  WORLD_DIRECTIVE_MAX_PER_TURN,
  WORLD_DIRECTIVE_MAX_TTL_MS,
  WorldDirectiveSchema,
} from "@white-room/shared";
import { z } from "zod";
import { type LlmAttempt, type LlmAttemptStatus, OllamaAdapter } from "../adapters/OllamaAdapter";
import { BridgeBroker } from "../bridge/BridgeBroker";
import { LlmTurnCache } from "../cache/LlmTurnCache";
import { deterministicRabbit } from "../deterministic";
import { DoctrineIndexer } from "../doctrine/DoctrineIndexer";
import { validateEnrichmentPacket, validateRabbitOutput } from "../validators/RabbitOutputSchema";

const llmRequestSchema = z.object({
  state: RabbitStateSchema,
  packet: z.object({
    utterance_text: z.string(),
    classification: z.nativeEnum(PlayerClassification),
    tags: z.array(z.string()),
    elapsed_ms: z.number().int(),
    phase: z.nativeEnum(RabbitPhase),
  }),
  prompt: z.string(),
  schema: z.any(),
  bridge_session_id: z.string().optional(),
  bridge_client_token: z.string().optional(),
});

interface LlmRouteDependencies {
  llmRouteTimeoutMs?: number;
  doctrineTopK?: number;
  promptCharCap?: number;
  turnCache?: LlmTurnCache;
  bridgeBroker?: BridgeBroker;
  bridgeRequestTimeoutMs?: number;
}

const PSYCH_DELTA_KEYS = [
  "uncertainty",
  "control",
  "arousal",
  "threat_anticipation",
  "self_salience",
  "cognitive_dissonance",
] as const;

const ALLOWED_TONES = new Set(Object.values(RabbitTone));
const ALLOWED_FLAGS = new Set(Object.values(ProgressFlag));

const DEFAULT_NODE_BY_PHASE: Record<RabbitPhase, string> = {
  [RabbitPhase.Intake]: "N01_Orientation",
  [RabbitPhase.Destabilize]: "N05_FractureChallenge",
  [RabbitPhase.Mirror]: "N08_MirrorPrompt",
  [RabbitPhase.Contract]: "N12_NegotiationFrame",
  [RabbitPhase.Exit]: "N14_FinalQuestion",
};

interface AttemptDiagnostics {
  model_name: string | null;
  attempt_status: string;
  attempt_latency_ms: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRabbitTone(value: unknown): value is RabbitTone {
  return typeof value === "string" && ALLOWED_TONES.has(value as RabbitTone);
}

function isLikelyNodeId(value: string): boolean {
  return /^N\d{2}_[A-Za-z0-9]+$/.test(value);
}

function sanitizePsychDelta(raw: unknown): RabbitResponse["morph_signal"]["psych_delta"] {
  if (!isRecord(raw)) {
    return {};
  }

  const delta: RabbitResponse["morph_signal"]["psych_delta"] = {};
  for (const key of PSYCH_DELTA_KEYS) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      delta[key] = Math.max(-1, Math.min(1, value));
    }
  }
  return delta;
}

function sanitizeKeywords(raw: unknown, fallbackTags: string[]): string[] {
  const fromRaw = Array.isArray(raw)
    ? raw.filter((keyword): keyword is string => typeof keyword === "string").map((keyword) => keyword.trim())
    : [];
  const seed = fromRaw.length > 0 ? fromRaw : fallbackTags;
  const deduped = Array.from(new Set(seed.filter(Boolean)));
  if (deduped.length === 0) {
    return ["continuity"];
  }
  return deduped.slice(0, 8);
}

function sanitizeFlags(raw: unknown): ProgressFlag[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((flag): flag is ProgressFlag => typeof flag === "string" && ALLOWED_FLAGS.has(flag as ProgressFlag));
}

const REPLY_TEXT_KEYS = ["reply_text", "reply", "text", "answer", "message", "content", "response", "output"] as const;

function sanitizePersonaReply(raw: string): string {
  const cleaned = raw
    .replace(/\bclarify this in one sentence\s*:?\s*/gi, "")
    .replace(/\bplease clarify this in one sentence\s*:?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : raw.trim();
}

function extractReplyText(raw: unknown, depth = 0): string {
  if (depth > 3) {
    return "";
  }

  if (typeof raw === "string") {
    return raw.trim();
  }

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const nested = extractReplyText(entry, depth + 1);
      if (nested.length > 0) {
        return nested;
      }
    }
    return "";
  }

  if (!isRecord(raw)) {
    return "";
  }

  for (const key of REPLY_TEXT_KEYS) {
    const nested = extractReplyText(raw[key], depth + 1);
    if (nested.length > 0) {
      return nested;
    }
  }

  return "";
}

function sanitizeSelectedNodeId(raw: Record<string, unknown>, phase: RabbitPhase): string {
  const candidates = [raw.selected_node_id, raw.node_id, raw.node, raw.nodeId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && isLikelyNodeId(candidate.trim())) {
      return candidate.trim().slice(0, 96);
    }
  }
  return DEFAULT_NODE_BY_PHASE[phase];
}

function sanitizeMemoryQuote(raw: Record<string, unknown>): string {
  const candidates = [raw.memory_quote_used, raw.memory_quote, raw.quote];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate.slice(0, 140);
    }
  }
  return "";
}

function sanitizeWorldDirectives(raw: unknown, allowedModules: string[]): RabbitResponse["world_directives"] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const allowed = new Set(allowedModules);
  const directives: RabbitResponse["world_directives"] = [];
  for (const candidate of raw.slice(0, WORLD_DIRECTIVE_MAX_PER_TURN)) {
    const parsed = WorldDirectiveSchema.safeParse(candidate);
    if (!parsed.success) {
      continue;
    }
    if (parsed.data.rationale_modules.some((module) => !allowed.has(module))) {
      continue;
    }
    directives.push(parsed.data);
  }
  return directives;
}

function normalizeRabbitOutput(
  raw: unknown,
  packet: TurnInputPacket,
  fallbackTone: RabbitTone,
  allowedModules: string[],
): RabbitResponse | null {
  const replyText = extractReplyText(raw);
  if (replyText.length === 0) {
    return null;
  }

  const sanitizedReplyText = sanitizePersonaReply(replyText);
  const normalizedRecord = isRecord(raw) ? raw : { reply_text: sanitizedReplyText };

  const tone = isRabbitTone(normalizedRecord.tone) ? normalizedRecord.tone : fallbackTone;
  const selectedNodeId = sanitizeSelectedNodeId(normalizedRecord, packet.phase);

  const morphSignalRaw = isRecord(normalizedRecord.morph_signal)
    ? normalizedRecord.morph_signal
    : isRecord(normalizedRecord.morph)
      ? normalizedRecord.morph
      : {};
  const beatTrigger =
    typeof morphSignalRaw.beat_trigger === "string" && morphSignalRaw.beat_trigger.trim().length > 0
      ? morphSignalRaw.beat_trigger.trim().slice(0, 48)
      : undefined;
  const directiveSource = normalizedRecord.world_directives ?? normalizedRecord.directives ?? normalizedRecord.world_actions;

  return {
    reply_text: sanitizedReplyText.slice(0, MAX_RABBIT_REPLY_CHARS),
    tone,
    selected_node_id: selectedNodeId,
    set_flags: sanitizeFlags(normalizedRecord.set_flags ?? normalizedRecord.flags),
    memory_quote_used: sanitizeMemoryQuote(normalizedRecord),
    morph_signal: {
      classification: packet.classification,
      phase: packet.phase,
      tone,
      psych_delta: sanitizePsychDelta(morphSignalRaw.psych_delta),
      keywords: sanitizeKeywords(morphSignalRaw.keywords, packet.tags),
      beat_trigger: beatTrigger,
    },
    world_directives: sanitizeWorldDirectives(directiveSource, allowedModules),
    safety: {
      fiction_intact: true,
      no_meta_language: true,
    },
  };
}

function mapTransportFailure(status: LlmAttemptStatus): "llm_timeout" | "llm_error" {
  return status === "timeout" ? "llm_timeout" : "llm_error";
}

function summarizeAttempt(attempt: LlmAttempt | null): AttemptDiagnostics {
  if (!attempt) {
    return {
      model_name: null,
      attempt_status: "unknown",
      attempt_latency_ms: 0,
    };
  }

  return {
    model_name: attempt.model_name,
    attempt_status: attempt.attempt_status,
    attempt_latency_ms: attempt.attempt_latency_ms,
  };
}

function buildPromptWithBudget(basePrompt: string, doctrineBlock: string, promptCharCap: number): string {
  const budget = Math.max(1200, promptCharCap);
  if (basePrompt.length >= budget) {
    return basePrompt.slice(basePrompt.length - budget);
  }

  const remaining = budget - basePrompt.length;
  const appendix = doctrineBlock.length > remaining ? doctrineBlock.slice(0, remaining) : doctrineBlock;
  return `${basePrompt}${appendix}`;
}

function doctrineAppendix(doctrine: ReturnType<DoctrineIndexer["retrieveTopK"]>): string {
  return `\n\nDOCTRINE:\n${doctrine
    .map((chunk) => `[source=${chunk.source_file};module=${chunk.module};priority=${chunk.priority}] ${chunk.text}`)
    .join(
      "\n\n",
    )}\n\nNARRATIVE_CONSTRAINTS:\n- keep all guidance symbolic and introspective\n- no violent language, no combat framing, no physical harm instructions\n- avoid explicit religion/scripture labels in player-facing output\n\nWORLD_DIRECTIVE_CONTRACT:\n- world_directives length <= ${WORLD_DIRECTIVE_MAX_PER_TURN}\n- ttl_ms <= ${WORLD_DIRECTIVE_MAX_TTL_MS}\n- type must be one of spawn_prop|animate_prop|space_distortion|despawn_prop\n- payload keys must be type-safe only (no extra keys)\n- rationale_modules must only reference doctrine modules in this turn\n- avoid freeform/unbounded payloads`;
}

function enrichmentPrompt(
  payload: LlmEnrichRequest,
  doctrine: ReturnType<DoctrineIndexer["retrieveTopK"]>,
  promptCharCap: number,
): string {
  const state = payload.state_snapshot_min;
  const packet = payload.packet;
  const base = [
    "You are the rabbit in WHITE ROOM.",
    "Refine the provisional reply while preserving intent and symbolic ethics framing.",
    `STATE: phase=${state.phase}; tone=${state.tone}; trust=${state.trust}; threat=${state.threat}; curiosity=${state.curiosity}; calm_mode=${state.calm_mode}`,
    `PLAYER: ${packet.utterance_text}`,
    `PROVISIONAL_REPLY: ${payload.provisional_reply_text}`,
    "Return strict RabbitResponse JSON only.",
    `reply_text must be <= ${MAX_RABBIT_REPLY_CHARS} chars and safe.`,
    "Keep world_directives minimal and schema-valid.",
  ].join("\n");

  return buildPromptWithBudget(base, doctrineAppendix(doctrine), promptCharCap);
}

function bridgeRequested(payload: { bridge_session_id?: string; bridge_client_token?: string }, deps: LlmRouteDependencies): boolean {
  return (
    Boolean(deps.bridgeBroker) &&
    typeof payload.bridge_session_id === "string" &&
    payload.bridge_session_id.length > 0 &&
    typeof payload.bridge_client_token === "string" &&
    payload.bridge_client_token.length > 0
  );
}

function toEnrichState(payload: LlmEnrichRequest): LlmTurnRequest["state"] {
  return {
    phase: payload.state_snapshot_min.phase,
    tone: payload.state_snapshot_min.tone,
    trust: payload.state_snapshot_min.trust,
    threat: payload.state_snapshot_min.threat,
    curiosity: payload.state_snapshot_min.curiosity,
    memory: [],
    last_tags: payload.packet.tags,
    active_goals: ["refine_turn"],
    psych: {
      uncertainty: 0,
      control: 0,
      arousal: 0,
      threat_anticipation: 0,
      self_salience: 0,
      cognitive_dissonance: 0,
    },
    elapsed_ms: payload.packet.elapsed_ms,
    turn_index: 0,
    llm_reject_count: 0,
    calm_mode: payload.state_snapshot_min.calm_mode,
    silence_count: 0,
    psilo_confirm_step: 0,
    final_question_asked: false,
  };
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: "llm_timeout" | "llm_error" }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "llm_timeout" }), timeoutMs);
    work
      .then((value) => resolve({ ok: true, value }))
      .catch(() => resolve({ ok: false, reason: "llm_error" }))
      .finally(() => clearTimeout(timer));
  });
}

export function llmRouter(ollama: OllamaAdapter, indexer: DoctrineIndexer, deps: LlmRouteDependencies = {}): Router {
  const router = Router();
  const llmRouteTimeoutMs = deps.llmRouteTimeoutMs ?? 21000;
  const doctrineTopK = Math.max(1, Math.min(8, deps.doctrineTopK ?? 4));
  const promptCharCap = Math.max(1200, deps.promptCharCap ?? 6200);
  const bridgeRequestTimeoutMs = deps.bridgeRequestTimeoutMs ?? 21000;
  const turnCache = deps.turnCache;
  const cacheKeyVersion = turnCache?.keyVersion() ?? 0;

  router.post("/api/llm/respond", async (req, res) => {
    const parse = llmRequestSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }

    const payload = parse.data as LlmTurnRequest & {
      bridge_session_id?: string;
      bridge_client_token?: string;
    };

    const doctrine = indexer.retrieveTopK(
      {
        tags: payload.packet.tags,
        phase: payload.packet.phase,
        classification: payload.packet.classification,
        turn_index: payload.state.turn_index,
      },
      doctrineTopK,
    );
    const doctrineModules = Array.from(new Set(doctrine.map((chunk) => chunk.module)));
    const doctrineSources = Array.from(new Set(doctrine.map((chunk) => chunk.source_file)));

    const prompt = buildPromptWithBudget(payload.prompt, doctrineAppendix(doctrine), promptCharCap);
    const usingBridge = bridgeRequested(payload, deps);
    const modelNameForCache = usingBridge
      ? "bridge_local"
      : (ollama as { primaryModelName?: () => string }).primaryModelName?.() ?? "ollama_primary";
    const cacheKey =
      turnCache?.buildKey({
        model_name: modelNameForCache,
        phase: payload.packet.phase,
        classification: payload.packet.classification,
        utterance_text: payload.packet.utterance_text,
        tags: payload.packet.tags,
        trust: payload.state.trust,
        threat: payload.state.threat,
        curiosity: payload.state.curiosity,
        tone: payload.state.tone,
        doctrine_modules: doctrineModules,
        doctrine_sources: doctrineSources,
        doctrine_top_k: doctrineTopK,
        prompt_char_cap: promptCharCap,
        calm_mode: payload.state.calm_mode,
      }) ?? null;
    const cacheMissMeta = {
      cache_hit: false,
      cache_key_version: cacheKeyVersion,
      cache_ttl_remaining_ms: 0,
    };

    if (cacheKey) {
      const cached = turnCache?.read(cacheKey);
      if (cached?.hit && cached.response) {
        res.json({
          ok: true,
          response: cached.response,
          source: "cache",
          doctrine_sources: doctrineSources,
          doctrine_modules: doctrineModules,
          model_name: cached.model_name,
          attempt_status: "cache_hit",
          attempt_latency_ms: 0,
          prompt_chars: prompt.length,
          cache_hit: true,
          cache_key_version: cacheKeyVersion,
          cache_ttl_remaining_ms: cached.cache_ttl_remaining_ms,
        });
        return;
      }
    }

    const replyFromRaw = (
      raw: unknown,
      diagnostic: AttemptDiagnostics,
      sourceLabel: string,
      onInvalid: "fallback" | "continue" = "fallback",
    ) => {
      const normalized = normalizeRabbitOutput(raw, payload.packet as TurnInputPacket, payload.state.tone, doctrineModules);
      const validated = normalized ? validateRabbitOutput(normalized, { allowedModules: doctrineModules }) : null;
      if (validated?.ok) {
        if (cacheKey && !sourceLabel.startsWith("fallback:")) {
          turnCache?.write({
            key: cacheKey,
            response: validated.data,
            model_name: diagnostic.model_name,
            source: sourceLabel,
          });
        }
        res.json({
          ok: true,
          response: validated.data,
          source: sourceLabel,
          doctrine_sources: doctrineSources,
          doctrine_modules: doctrineModules,
          model_name: diagnostic.model_name,
          attempt_status: diagnostic.attempt_status,
          attempt_latency_ms: diagnostic.attempt_latency_ms,
          prompt_chars: prompt.length,
          ...cacheMissMeta,
        });
        return true;
      }

      const reason = validated ? validated.reason : "schema_invalid";
      // eslint-disable-next-line no-console
      console.warn(`[llm] output rejected: ${reason}; modules=${doctrineModules.join(",")}`);

      if (onInvalid === "continue") {
        return false;
      }

      const fallback = deterministicRabbit(payload.packet as TurnInputPacket);
      res.json({
        ok: true,
        response: fallback,
        source: `fallback:${reason}`,
        fallback_reason: reason,
        doctrine_sources: doctrineSources,
        doctrine_modules: doctrineModules,
        model_name: diagnostic.model_name,
        attempt_status: diagnostic.attempt_status,
        attempt_latency_ms: diagnostic.attempt_latency_ms,
        prompt_chars: prompt.length,
        ...cacheMissMeta,
      });
      return true;
    };

    if (usingBridge) {
      const bridgeResult = await deps.bridgeBroker!.requestLlm(
        payload.bridge_session_id!,
        payload.bridge_client_token!,
        { ...payload, prompt },
        bridgeRequestTimeoutMs,
      );
      if (bridgeResult.ok && bridgeResult.output !== undefined) {
        const accepted = replyFromRaw(bridgeResult.output, bridgeResult.diagnostics, "bridge_local", "continue");
        if (accepted) {
          return;
        }
      }
      // Continue to hosted/server-local model path on bridge failure.
    }

    const modelResult = await withTimeout(ollama.generate({ ...payload, prompt, schema: payload.schema }), llmRouteTimeoutMs);

    if (!modelResult.ok) {
      const fallback = deterministicRabbit(payload.packet as TurnInputPacket);
      res.json({
        ok: true,
        response: fallback,
        source: `fallback:${modelResult.reason}`,
        fallback_reason: modelResult.reason,
        doctrine_sources: doctrineSources,
        doctrine_modules: doctrineModules,
        model_name: null,
        attempt_status: modelResult.reason === "llm_timeout" ? "route_timeout" : "route_error",
        attempt_latency_ms: llmRouteTimeoutMs,
        prompt_chars: prompt.length,
        ...cacheMissMeta,
      });
      return;
    }

    const attempts = Array.isArray((modelResult.value as { attempts?: unknown }).attempts)
      ? ((modelResult.value as { attempts: LlmAttempt[] }).attempts ?? [])
      : [];
    if (attempts.length === 0) {
      const fallback = deterministicRabbit(payload.packet as TurnInputPacket);
      res.json({
        ok: true,
        response: fallback,
        source: "fallback:llm_error",
        fallback_reason: "llm_error",
        doctrine_sources: doctrineSources,
        doctrine_modules: doctrineModules,
        model_name: null,
        attempt_status: "llm_error",
        attempt_latency_ms: 0,
        prompt_chars: prompt.length,
        ...cacheMissMeta,
      });
      return;
    }

    const okAttempt = attempts.find((attempt) => attempt.attempt_status === "ok" && attempt.output !== undefined);
    if (okAttempt) {
      if (replyFromRaw(okAttempt.output, summarizeAttempt(okAttempt), "ollama")) {
        return;
      }
    }

    const repairAttempt = attempts.find((attempt) => attempt.attempt_status === "parse_error" && attempt.output !== undefined);
    if (repairAttempt) {
      if (replyFromRaw(repairAttempt.output, summarizeAttempt(repairAttempt), "ollama_repaired")) {
        return;
      }
    }

    const terminalAttempt = attempts[attempts.length - 1] ?? null;
    const fallbackReason = terminalAttempt ? mapTransportFailure(terminalAttempt.attempt_status) : "llm_error";
    const fallback = deterministicRabbit(payload.packet as TurnInputPacket);
    res.json({
      ok: true,
      response: fallback,
      source: `fallback:${fallbackReason}`,
      fallback_reason: fallbackReason,
      doctrine_sources: doctrineSources,
      doctrine_modules: doctrineModules,
      model_name: terminalAttempt?.model_name ?? null,
      attempt_status: terminalAttempt?.attempt_status ?? "unknown",
      attempt_latency_ms: terminalAttempt?.attempt_latency_ms ?? 0,
      prompt_chars: prompt.length,
      ...cacheMissMeta,
    });
  });

  router.post("/api/llm/enrich", async (req, res) => {
    const parse = LlmEnrichRequestSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }

    const payload = parse.data as LlmEnrichRequest;
    const doctrine = indexer.retrieveTopK(
      {
        tags: payload.packet.tags,
        phase: payload.packet.phase,
        classification: payload.packet.classification,
        turn_index: 0,
      },
      doctrineTopK,
    );
    const doctrineModules = Array.from(new Set(doctrine.map((chunk) => chunk.module)));
    const doctrineSources = Array.from(new Set(doctrine.map((chunk) => chunk.source_file)));
    const prompt = enrichmentPrompt(payload, doctrine, promptCharCap);

    const usingBridge = bridgeRequested(payload, deps);
    const modelNameForCache = usingBridge
      ? "bridge_local"
      : (ollama as { primaryModelName?: () => string }).primaryModelName?.() ?? "ollama_primary";
    const cacheKey =
      turnCache?.buildKey({
        model_name: `enrich:${modelNameForCache}`,
        phase: payload.state_snapshot_min.phase,
        classification: payload.packet.classification,
        utterance_text: `${payload.packet.utterance_text} || ${payload.provisional_reply_text}`,
        tags: payload.packet.tags,
        trust: payload.state_snapshot_min.trust,
        threat: payload.state_snapshot_min.threat,
        curiosity: payload.state_snapshot_min.curiosity,
        tone: payload.state_snapshot_min.tone,
        doctrine_modules: doctrineModules,
        doctrine_sources: doctrineSources,
        doctrine_top_k: doctrineTopK,
        prompt_char_cap: promptCharCap,
        calm_mode: payload.state_snapshot_min.calm_mode,
      }) ?? null;

    const cacheMissMeta = {
      cache_hit: false,
      cache_key_version: cacheKeyVersion,
      cache_ttl_remaining_ms: 0,
    };

    if (cacheKey) {
      const cached = turnCache?.read(cacheKey);
      if (cached?.hit && cached.response) {
        const cachedEnrichmentText =
          cached.response.reply_text.trim() === payload.provisional_reply_text.trim() ? "" : cached.response.reply_text;
        res.json({
          ok: true,
          turn_id: payload.turn_id,
          enrichment_text: cachedEnrichmentText,
          world_directives: cached.response.world_directives,
          source: "cache",
          fallback_reason: null,
          doctrine_sources: doctrineSources,
          doctrine_modules: doctrineModules,
          model_name: cached.model_name,
          attempt_status: "cache_hit",
          attempt_latency_ms: 0,
          cache_hit: true,
          cache_key_version: cacheKeyVersion,
          cache_ttl_remaining_ms: cached.cache_ttl_remaining_ms,
        });
        return;
      }
    }

    const llmPayload: LlmTurnRequest = {
      state: toEnrichState(payload),
      packet: payload.packet,
      prompt,
      schema: { type: "object" },
    };

    const cacheable = (response: RabbitResponse): RabbitResponse => ({
      ...deterministicRabbit(payload.packet as TurnInputPacket),
      reply_text: response.reply_text,
      world_directives: response.world_directives,
    });

    const respond = (
      source: string,
      diagnostic: AttemptDiagnostics,
      response: { enrichment_text: string; world_directives: RabbitResponse["world_directives"] } | null,
      fallbackReason: string | null,
    ) => {
      if (response && cacheKey && !source.startsWith("fallback:")) {
        const enrichResponse = cacheable({
          ...deterministicRabbit(payload.packet as TurnInputPacket),
          reply_text: response.enrichment_text,
          world_directives: response.world_directives,
          morph_signal: deterministicRabbit(payload.packet as TurnInputPacket).morph_signal,
          set_flags: deterministicRabbit(payload.packet as TurnInputPacket).set_flags,
          selected_node_id: deterministicRabbit(payload.packet as TurnInputPacket).selected_node_id,
          memory_quote_used: deterministicRabbit(payload.packet as TurnInputPacket).memory_quote_used,
          safety: deterministicRabbit(payload.packet as TurnInputPacket).safety,
        });

        turnCache?.write({
          key: cacheKey,
          response: enrichResponse,
          model_name: diagnostic.model_name,
          source,
        });
      }

      res.json({
        ok: true,
        turn_id: payload.turn_id,
        enrichment_text: response?.enrichment_text,
        world_directives: response?.world_directives,
        source,
        fallback_reason: fallbackReason,
        doctrine_sources: doctrineSources,
        doctrine_modules: doctrineModules,
        model_name: diagnostic.model_name,
        attempt_status: diagnostic.attempt_status,
        attempt_latency_ms: diagnostic.attempt_latency_ms,
        ...cacheMissMeta,
      });
    };

    const acceptRaw = (
      raw: unknown,
      diagnostic: AttemptDiagnostics,
      source: string,
      onInvalid: "continue" | "fallback" = "fallback",
    ): boolean => {
      const normalized = normalizeRabbitOutput(raw, payload.packet, payload.state_snapshot_min.tone, doctrineModules);
      const validated = normalized
        ? validateEnrichmentPacket(normalized.reply_text, normalized.world_directives, { allowedModules: doctrineModules })
        : null;
      if (validated?.ok) {
        const enrichmentText =
          validated.data.enrichment_text.trim() === payload.provisional_reply_text.trim() ? "" : validated.data.enrichment_text;
        const response = {
          enrichment_text: enrichmentText,
          world_directives: validated.data.world_directives,
        };
        respond(source, diagnostic, response, null);
        return true;
      }

      const reason = validated ? validated.reason : "schema_invalid";
      // eslint-disable-next-line no-console
      console.warn(`[llm] enrich output rejected: ${reason}; modules=${doctrineModules.join(",")}`);
      if (onInvalid === "continue") {
        return false;
      }
      respond(`fallback:${reason}`, diagnostic, null, reason);
      return true;
    };

    if (usingBridge && deps.bridgeBroker && payload.bridge_session_id && payload.bridge_client_token) {
      const bridgeResult = await deps.bridgeBroker.requestLlm(
        payload.bridge_session_id,
        payload.bridge_client_token,
        llmPayload,
        bridgeRequestTimeoutMs,
      );
      if (bridgeResult.ok && bridgeResult.output !== undefined) {
        const accepted = acceptRaw(bridgeResult.output, bridgeResult.diagnostics, "bridge_local", "continue");
        if (accepted) {
          return;
        }
      }
    }

    const modelResult = await withTimeout(ollama.generate(llmPayload), llmRouteTimeoutMs);
    if (!modelResult.ok) {
      respond(
        `fallback:${modelResult.reason}`,
        {
          model_name: null,
          attempt_status: modelResult.reason === "llm_timeout" ? "route_timeout" : "route_error",
          attempt_latency_ms: llmRouteTimeoutMs,
        },
        null,
        modelResult.reason,
      );
      return;
    }

    const attempts = Array.isArray((modelResult.value as { attempts?: unknown }).attempts)
      ? ((modelResult.value as { attempts: LlmAttempt[] }).attempts ?? [])
      : [];
    if (attempts.length === 0) {
      respond(
        "fallback:llm_error",
        { model_name: null, attempt_status: "llm_error", attempt_latency_ms: 0 },
        null,
        "llm_error",
      );
      return;
    }

    const okAttempt = attempts.find((attempt) => attempt.attempt_status === "ok" && attempt.output !== undefined);
    if (okAttempt && acceptRaw(okAttempt.output, summarizeAttempt(okAttempt), "ollama")) {
      return;
    }

    const repairAttempt = attempts.find((attempt) => attempt.attempt_status === "parse_error" && attempt.output !== undefined);
    if (repairAttempt && acceptRaw(repairAttempt.output, summarizeAttempt(repairAttempt), "ollama_repaired")) {
      return;
    }

    const terminal = attempts[attempts.length - 1] ?? null;
    const reason = terminal ? mapTransportFailure(terminal.attempt_status) : "llm_error";
    respond(
      `fallback:${reason}`,
      {
        model_name: terminal?.model_name ?? null,
        attempt_status: terminal?.attempt_status ?? "unknown",
        attempt_latency_ms: terminal?.attempt_latency_ms ?? 0,
      },
      null,
      reason,
    );
  });

  return router;
}
