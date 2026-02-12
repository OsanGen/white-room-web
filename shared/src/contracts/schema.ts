import { z } from "zod";
import {
  DoctrineSourceFile,
  PlayerClassification,
  ProgressFlag,
  RabbitPhase,
  RabbitTone,
  WeightCurve,
} from "./enums";
import { MAX_RABBIT_REPLY_CHARS } from "../constants/defaults";

export const PsychVectorSchema = z.object({
  uncertainty: z.number().min(-1).max(1),
  control: z.number().min(-1).max(1),
  arousal: z.number().min(-1).max(1),
  threat_anticipation: z.number().min(-1).max(1),
  self_salience: z.number().min(-1).max(1),
  cognitive_dissonance: z.number().min(-1).max(1),
});

export const MemoryItemSchema = z.object({
  turn: z.number().int().nonnegative(),
  raw_text: z.string(),
  short_quote: z.string(),
  tags: z.array(z.string()),
  classification: z.nativeEnum(PlayerClassification),
});

export const RabbitStateSchema = z.object({
  phase: z.nativeEnum(RabbitPhase),
  tone: z.nativeEnum(RabbitTone),
  trust: z.number().int().min(0).max(100),
  threat: z.number().int().min(0).max(100),
  curiosity: z.number().int().min(0).max(100),
  memory: z.array(MemoryItemSchema).max(8),
  last_tags: z.array(z.string()),
  active_goals: z.array(z.string()).max(3),
  psych: PsychVectorSchema,
  elapsed_ms: z.number().int().min(0).max(300000),
  turn_index: z.number().int().nonnegative(),
  llm_reject_count: z.number().int().nonnegative(),
  calm_mode: z.boolean(),
  silence_count: z.number().int().nonnegative(),
  psilo_confirm_step: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  final_question_asked: z.boolean(),
});

export const NodeConditionSchema = z.object({
  min_trust: z.number().int().min(0).max(100).optional(),
  min_threat: z.number().int().min(0).max(100).optional(),
  min_curiosity: z.number().int().min(0).max(100).optional(),
  requires_tags: z.array(z.string()).optional(),
  requires_flags: z.array(z.nativeEnum(ProgressFlag)).optional(),
});

export const NodeEffectSchema = z.object({
  trust_delta: z.number().int().min(-30).max(30),
  threat_delta: z.number().int().min(-30).max(30),
  curiosity_delta: z.number().int().min(-30).max(30),
  psych_delta: PsychVectorSchema.partial(),
  recipe_bias_ids: z.array(z.string()).max(4),
});

export const DialogueNodeSchema = z.object({
  id: z.string(),
  phase: z.nativeEnum(RabbitPhase),
  goal: z.string(),
  prompt_hint: z.string(),
  reply_templates: z.array(z.string()).min(1),
  conditions: z.array(NodeConditionSchema),
  effects: z.array(NodeEffectSchema),
  set_flags: z.array(z.nativeEnum(ProgressFlag)),
  next_node_ids: z.array(z.string()),
});

export const DoctrineChunkSchema = z.object({
  id: z.string(),
  source_file: z.nativeEnum(DoctrineSourceFile),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  module: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  priority: z.number().int().min(1).max(5),
});

export const MorphSignalSchema = z.object({
  classification: z.nativeEnum(PlayerClassification),
  phase: z.nativeEnum(RabbitPhase),
  tone: z.nativeEnum(RabbitTone),
  psych_delta: PsychVectorSchema.partial(),
  keywords: z.array(z.string()),
  beat_trigger: z.string().optional(),
});

export const TurnInputPacketSchema = z.object({
  utterance_text: z.string(),
  classification: z.nativeEnum(PlayerClassification),
  tags: z.array(z.string()),
  elapsed_ms: z.number().int().min(0),
  phase: z.nativeEnum(RabbitPhase),
});

export const WORLD_DIRECTIVE_MAX_PER_TURN = 3;
export const WORLD_DIRECTIVE_MAX_TTL_MS = 12000;

export const WorldDirectiveTypeSchema = z.enum(["spawn_prop", "animate_prop", "space_distortion", "despawn_prop"]);
export const WorldDirectiveAnchorSchema = z.enum(["rabbit", "player", "room"]);
export const WorldPropKindSchema = z.enum(["orb", "pillar", "shard", "ribbon", "echo_cube"]);
export const WorldAnimationKindSchema = z.enum(["pulse", "oscillate", "float"]);
export const SpaceDistortionKindSchema = z.enum(["wave", "skew", "ripple"]);

const SpawnPropPayloadSchema = z
  .object({
    prop_kind: WorldPropKindSchema,
    color: z.string().max(32).optional(),
    scale: z.number().min(0.3).max(2.5).optional(),
    offset_x: z.number().min(-2.2).max(2.2).optional(),
    offset_y: z.number().min(-0.6).max(2.4).optional(),
    offset_z: z.number().min(-2.2).max(2.2).optional(),
  })
  .strict();

const AnimatePropPayloadSchema = z
  .object({
    target_id: z.string().min(1).max(64),
    animation: WorldAnimationKindSchema,
    amplitude: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.05).max(4).optional(),
  })
  .strict();

const SpaceDistortionPayloadSchema = z
  .object({
    distortion: SpaceDistortionKindSchema,
    radius: z.number().min(0.6).max(4).optional(),
  })
  .strict();

const DespawnPropPayloadSchema = z
  .object({
    target_id: z.string().min(1).max(64),
  })
  .strict();

export const WorldDirectiveSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("spawn_prop"),
    ttl_ms: z.number().int().min(500).max(WORLD_DIRECTIVE_MAX_TTL_MS),
    intensity: z.number().min(0).max(1),
    anchor: WorldDirectiveAnchorSchema,
    payload: SpawnPropPayloadSchema,
    rationale_modules: z.array(z.string().min(1)).min(1).max(6),
  }).strict(),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("animate_prop"),
    ttl_ms: z.number().int().min(500).max(WORLD_DIRECTIVE_MAX_TTL_MS),
    intensity: z.number().min(0).max(1),
    anchor: WorldDirectiveAnchorSchema,
    payload: AnimatePropPayloadSchema,
    rationale_modules: z.array(z.string().min(1)).min(1).max(6),
  }).strict(),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("space_distortion"),
    ttl_ms: z.number().int().min(500).max(WORLD_DIRECTIVE_MAX_TTL_MS),
    intensity: z.number().min(0).max(1),
    anchor: WorldDirectiveAnchorSchema,
    payload: SpaceDistortionPayloadSchema,
    rationale_modules: z.array(z.string().min(1)).min(1).max(6),
  }).strict(),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("despawn_prop"),
    ttl_ms: z.number().int().min(500).max(WORLD_DIRECTIVE_MAX_TTL_MS),
    intensity: z.number().min(0).max(1),
    anchor: WorldDirectiveAnchorSchema,
    payload: DespawnPropPayloadSchema,
    rationale_modules: z.array(z.string().min(1)).min(1).max(6),
  }).strict(),
]);

export const RabbitResponseSchema = z.object({
  reply_text: z.string().min(3).max(MAX_RABBIT_REPLY_CHARS),
  tone: z.nativeEnum(RabbitTone),
  selected_node_id: z.string(),
  set_flags: z.array(z.nativeEnum(ProgressFlag)),
  memory_quote_used: z.string(),
  morph_signal: MorphSignalSchema,
  world_directives: z.array(WorldDirectiveSchema).max(WORLD_DIRECTIVE_MAX_PER_TURN),
  safety: z.object({
    fiction_intact: z.boolean(),
    no_meta_language: z.boolean(),
  }),
});

export const LlmStateSnapshotMinSchema = z.object({
  phase: z.nativeEnum(RabbitPhase),
  tone: z.nativeEnum(RabbitTone),
  trust: z.number().int().min(0).max(100),
  threat: z.number().int().min(0).max(100),
  curiosity: z.number().int().min(0).max(100),
  calm_mode: z.boolean(),
});

export const LlmEnrichRequestSchema = z.object({
  turn_id: z.string().min(1).max(64),
  state_snapshot_min: LlmStateSnapshotMinSchema,
  packet: TurnInputPacketSchema,
  provisional_reply_text: z.string().min(1).max(MAX_RABBIT_REPLY_CHARS),
  bridge_session_id: z.string().min(1).optional(),
  bridge_client_token: z.string().min(1).optional(),
});

export const EnrichmentStateSnapshotSchema = z.object({
  phase: z.nativeEnum(RabbitPhase),
  tone: z.nativeEnum(RabbitTone),
  trust: z.number().int().min(0).max(100),
  threat: z.number().int().min(0).max(100),
  curiosity: z.number().int().min(0).max(100),
  calm_mode: z.boolean(),
  elapsed_ms: z.number().int().min(0).max(300000),
});

export const LlmEnrichmentRequestSchema = z.object({
  turn_id: z.string().min(1),
  state_snapshot_min: EnrichmentStateSnapshotSchema,
  packet: z.object({
    utterance_text: z.string(),
    classification: z.nativeEnum(PlayerClassification),
    tags: z.array(z.string()),
    elapsed_ms: z.number().int().min(0),
    phase: z.nativeEnum(RabbitPhase),
  }),
  provisional_reply_text: z.string().min(1).max(MAX_RABBIT_REPLY_CHARS),
});

export const LlmEnrichmentResponseSchema = z.object({
  ok: z.boolean(),
  turn_id: z.string().min(1),
  enrichment_text: z.string().min(2).max(MAX_RABBIT_REPLY_CHARS).optional(),
  world_directives: z.array(WorldDirectiveSchema).max(WORLD_DIRECTIVE_MAX_PER_TURN).optional(),
  source: z.string().optional(),
  fallback_reason: z.string().optional(),
  model_name: z.string().nullable().optional(),
  attempt_status: z.string().optional(),
  attempt_latency_ms: z.number().nonnegative().optional(),
  cache_hit: z.boolean().optional(),
  cache_key_version: z.number().nonnegative().optional(),
  cache_ttl_remaining_ms: z.number().nonnegative().optional(),
});

export const EffectRecipeSchema = z.object({
  id: z.string(),
  duration_ms: z.number().int().positive(),
  intensity: z.number().min(0).max(1),
  channels: z.object({
    light: z.record(z.number().min(0).max(1)),
    geometry: z.record(z.number().min(0).max(1)),
    props: z.record(z.number().min(0).max(1)),
    audio: z.record(z.number().min(0).max(1)),
    ui: z.record(z.number().min(0).max(1)),
  }),
  weight_curve: z.nativeEnum(WeightCurve),
});
