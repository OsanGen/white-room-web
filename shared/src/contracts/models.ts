import {
  DoctrineSourceFile,
  EndingId,
  PlayerClassification,
  ProgressFlag,
  RabbitPhase,
  RabbitTone,
  WeightCurve,
} from "./enums";

export interface PsychVector {
  uncertainty: number;
  control: number;
  arousal: number;
  threat_anticipation: number;
  self_salience: number;
  cognitive_dissonance: number;
}

export interface MemoryItem {
  turn: number;
  raw_text: string;
  short_quote: string;
  tags: string[];
  classification: PlayerClassification;
}

export interface RabbitState {
  phase: RabbitPhase;
  tone: RabbitTone;
  trust: number;
  threat: number;
  curiosity: number;
  memory: MemoryItem[];
  last_tags: string[];
  active_goals: string[];
  psych: PsychVector;
  elapsed_ms: number;
  turn_index: number;
  llm_reject_count: number;
  calm_mode: boolean;
  silence_count: number;
  psilo_confirm_step: 0 | 1 | 2;
  final_question_asked: boolean;
}

export interface NodeCondition {
  min_trust?: number;
  min_threat?: number;
  min_curiosity?: number;
  requires_tags?: string[];
  requires_flags?: ProgressFlag[];
}

export interface NodeEffect {
  trust_delta: number;
  threat_delta: number;
  curiosity_delta: number;
  psych_delta: Partial<PsychVector>;
  recipe_bias_ids: string[];
}

export interface DialogueNode {
  id: string;
  phase: RabbitPhase;
  goal: string;
  prompt_hint: string;
  reply_templates: string[];
  conditions: NodeCondition[];
  effects: NodeEffect[];
  set_flags: ProgressFlag[];
  next_node_ids: string[];
}

export interface DoctrineChunk {
  id: string;
  source_file: DoctrineSourceFile;
  line_start: number;
  line_end: number;
  module: string;
  text: string;
  tags: string[];
  priority: number;
}

export interface MorphSignal {
  classification: PlayerClassification;
  phase: RabbitPhase;
  tone: RabbitTone;
  psych_delta: Partial<PsychVector>;
  keywords: string[];
  beat_trigger?: string;
}

export type WorldDirectiveType = "spawn_prop" | "animate_prop" | "space_distortion" | "despawn_prop";
export type WorldDirectiveAnchor = "rabbit" | "player" | "room";
export type WorldPropKind = "orb" | "pillar" | "shard" | "ribbon" | "echo_cube";
export type WorldAnimationKind = "pulse" | "oscillate" | "float";
export type SpaceDistortionKind = "wave" | "skew" | "ripple";

export interface SpawnPropPayload {
  prop_kind: WorldPropKind;
  color?: string;
  scale?: number;
  offset_x?: number;
  offset_y?: number;
  offset_z?: number;
}

export interface AnimatePropPayload {
  target_id: string;
  animation: WorldAnimationKind;
  amplitude?: number;
  speed?: number;
}

export interface SpaceDistortionPayload {
  distortion: SpaceDistortionKind;
  radius?: number;
}

export interface DespawnPropPayload {
  target_id: string;
}

export type WorldDirectivePayload =
  | SpawnPropPayload
  | AnimatePropPayload
  | SpaceDistortionPayload
  | DespawnPropPayload;

export interface WorldDirective {
  id: string;
  type: WorldDirectiveType;
  ttl_ms: number;
  intensity: number;
  anchor: WorldDirectiveAnchor;
  payload: WorldDirectivePayload;
  rationale_modules: string[];
}

export interface RabbitResponse {
  reply_text: string;
  tone: RabbitTone;
  selected_node_id: string;
  set_flags: ProgressFlag[];
  memory_quote_used: string;
  morph_signal: MorphSignal;
  world_directives: WorldDirective[];
  safety: {
    fiction_intact: boolean;
    no_meta_language: boolean;
  };
}

export interface EffectRecipe {
  id: string;
  duration_ms: number;
  intensity: number;
  channels: {
    light: Record<string, number>;
    geometry: Record<string, number>;
    props: Record<string, number>;
    audio: Record<string, number>;
    ui: Record<string, number>;
  };
  weight_curve: WeightCurve;
}

export interface TurnInputPacket {
  utterance_text: string;
  classification: PlayerClassification;
  tags: string[];
  elapsed_ms: number;
  phase: RabbitPhase;
}

export interface EnrichmentStateSnapshot {
  phase: RabbitPhase;
  tone: RabbitTone;
  trust: number;
  threat: number;
  curiosity: number;
  calm_mode: boolean;
  elapsed_ms: number;
}

export interface LlmEnrichmentRequest {
  turn_id: string;
  state_snapshot_min: EnrichmentStateSnapshot;
  packet: TurnInputPacket;
  provisional_reply_text: string;
}

export interface LlmEnrichmentResponse {
  ok: boolean;
  turn_id: string;
  enrichment_text?: string;
  world_directives?: WorldDirective[];
  source?: string;
  fallback_reason?: string;
  model_name?: string | null;
  attempt_status?: string;
  attempt_latency_ms?: number;
  cache_hit?: boolean;
  cache_key_version?: number;
  cache_ttl_remaining_ms?: number;
}

export interface LlmTurnRequest {
  state: RabbitState;
  packet: TurnInputPacket;
  prompt: string;
  schema: object;
}

export interface LlmTurnResponse {
  ok: boolean;
  response?: RabbitResponse;
  fallback_reason?: string;
}

export interface LlmStateSnapshotMin {
  phase: RabbitPhase;
  tone: RabbitTone;
  trust: number;
  threat: number;
  curiosity: number;
  calm_mode: boolean;
}

export interface LlmEnrichRequest {
  turn_id: string;
  state_snapshot_min: LlmStateSnapshotMin;
  packet: TurnInputPacket;
  provisional_reply_text: string;
  bridge_session_id?: string;
  bridge_client_token?: string;
}

export interface LlmEnrichResponse {
  ok: boolean;
  turn_id: string;
  enrichment_text?: string;
  world_directives?: WorldDirective[];
  source: string;
  fallback_reason?: string;
  model_name?: string | null;
  attempt_status?: string;
  attempt_latency_ms?: number;
  cache_hit?: boolean;
  cache_key_version?: number;
  cache_ttl_remaining_ms?: number;
  doctrine_sources?: string[];
  doctrine_modules?: string[];
}

export interface SessionResolution {
  ending: EndingId;
  reason: string;
}

export interface SessionMetrics {
  turn_latencies_ms: number[];
  llm_timeouts: number;
  stt_failures: number;
  tts_failures: number;
}
