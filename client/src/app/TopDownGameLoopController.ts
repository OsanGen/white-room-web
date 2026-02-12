import { RabbitPhase, RabbitState, RabbitTone } from "@white-room/shared";
import balanceJson from "../data/game_balance.json";
import { ConversationEngine, type EnrichmentTurnResult, type ReflexTurnResult } from "../conversation/ConversationEngine";
import type { ConsciousnessRuntimeContext } from "../conversation/ConsciousnessRuntimeContext";
import { LlmTurnQueue } from "../conversation/LlmTurnQueue";
import { FrameRateSafety } from "./FrameRateSafety";
import { RuntimeClock } from "./RuntimeClock";
import { TopDownController, type TopDownBounds, type Vec2 } from "../player/TopDownController";
import { ProximityInteraction2D } from "../interaction/ProximityInteraction2D";
import { WorldMorphEngine, type MorphFrame } from "../world/WorldMorphEngine";
import { DynamicWorldRuntime2D } from "../world/DynamicWorldRuntime2D";
import { DebugOverlay } from "../ui/DebugOverlay";
import { CalmModeToggle } from "../ui/CalmModeToggle";
import { InputController } from "../voice/InputController";
import { playTtsNonBlocking } from "../voice/TtsClient";
import { runtimeTransport } from "../runtime/RuntimeTransport";
import { composeTurnTrippyProfile } from "./RoomMoodTrippyMapper";

const balance = balanceJson as {
  session_hard_limit_ms: number;
  stt_failure_fallback_threshold: number;
};

const enrichmentSoftDeadlineMs = (() => {
  const raw = Number(import.meta.env.VITE_ENRICHMENT_SOFT_DEADLINE_MS ?? "2200");
  if (!Number.isFinite(raw)) return 2200;
  return Math.max(200, Math.floor(raw));
})();

const enrichmentApplyIfTurnMatchOnly = (() => {
  const raw = String(import.meta.env.VITE_ENRICHMENT_APPLY_IF_TURN_MATCH_ONLY ?? "true").toLowerCase();
  return raw === "1" || raw === "true";
})();

type EmotionLabel =
  | "neutral"
  | "anxious"
  | "threat"
  | "frustration"
  | "sadness"
  | "hope"
  | "conflict";

interface MoodColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface RoomMoodProfile {
  name: EmotionLabel | "base";
  confidence: number;
  background: MoodColor;
  room: MoodColor;
  room_stroke: MoodColor;
  rabbit: MoodColor;
  player: MoodColor;
  doorline: MoodColor;
  vignette: MoodColor;
  chroma: MoodColor;
  grain: MoodColor;
  prop_orb: string;
  prop_pillar: string;
  prop_shard: string;
  prop_ribbon: string;
  prop_echo_cube: string;
  distortion: string;
  chroma_opacity: number;
  grain_opacity: number;
  vignette_opacity: number;
  wave_speed: number;
  motion_amp: number;
  pulse_amp: number;
  turn_marker: number;
  scanline_power: number;
  chromatic_split: number;
  doom_bloom: number;
  temp_bias: number;
  heat_haze: number;
  phase_glow: number;
  entropy: number;
  scanline_phase: number;
}

type MoodScalarChannel = "scanline_power" | "chromatic_split" | "doom_bloom" | "temp_bias" | "heat_haze";

const MOOD_PRESETS: Record<EmotionLabel, Omit<RoomMoodProfile, "name" | "confidence">> = {
  neutral: {
    ...{
      turn_marker: 0,
      scanline_power: 0.22,
      chromatic_split: 0.19,
      doom_bloom: 0.11,
      temp_bias: -2,
      heat_haze: 0.06,
      phase_glow: 0.08,
      entropy: 0.12,
      scanline_phase: 0,
    },
    background: { r: 242, g: 246, b: 250, a: 1 },
    room: { r: 245, g: 249, b: 253, a: 1 },
    room_stroke: { r: 28, g: 44, b: 61, a: 0.14 },
    rabbit: { r: 236, g: 244, b: 250, a: 0.98 },
    player: { r: 92, g: 143, b: 183, a: 0.95 },
    doorline: { r: 255, g: 188, b: 158, a: 0.35 },
    vignette: { r: 30, g: 42, b: 59, a: 0.32 },
    chroma: { r: 92, g: 143, b: 183, a: 0.4 },
    grain: { r: 29, g: 44, b: 63, a: 0.055 },
    prop_orb: "rgba(124, 190, 240, 0.8)",
    prop_pillar: "rgba(235, 206, 168, 0.8)",
    prop_shard: "rgba(164, 228, 195, 0.82)",
    prop_ribbon: "rgba(212, 186, 247, 0.8)",
    prop_echo_cube: "rgba(255, 230, 148, 0.78)",
    distortion: "rgba(108, 150, 191, 0.33)",
    chroma_opacity: 0.12,
    grain_opacity: 0.028,
    vignette_opacity: 0.12,
    wave_speed: 1,
    motion_amp: 0.42,
    pulse_amp: 0.06,
  },
  anxious: {
    ...{
      turn_marker: 0,
      scanline_power: 0.34,
      chromatic_split: 0.31,
      doom_bloom: 0.18,
      temp_bias: -22,
      heat_haze: 0.14,
      phase_glow: 0.16,
      entropy: 0.31,
      scanline_phase: 0,
    },
    background: { r: 229, g: 236, b: 248, a: 1 },
    room: { r: 236, g: 243, b: 251, a: 1 },
    room_stroke: { r: 31, g: 48, b: 68, a: 0.17 },
    rabbit: { r: 234, g: 242, b: 252, a: 0.98 },
    player: { r: 79, g: 132, b: 183, a: 0.95 },
    doorline: { r: 214, g: 184, b: 236, a: 0.55 },
    vignette: { r: 29, g: 44, b: 68, a: 0.4 },
    chroma: { r: 127, g: 136, b: 208, a: 0.34 },
    grain: { r: 32, g: 46, b: 65, a: 0.075 },
    prop_orb: "rgba(129, 170, 235, 0.9)",
    prop_pillar: "rgba(188, 173, 235, 0.84)",
    prop_shard: "rgba(129, 196, 214, 0.84)",
    prop_ribbon: "rgba(184, 167, 247, 0.84)",
    prop_echo_cube: "rgba(205, 220, 255, 0.78)",
    distortion: "rgba(124, 144, 208, 0.4)",
    chroma_opacity: 0.18,
    grain_opacity: 0.05,
    vignette_opacity: 0.2,
    wave_speed: 1.35,
    motion_amp: 0.65,
    pulse_amp: 0.09,
  },
  threat: {
    ...{
      turn_marker: 0,
      scanline_power: 0.4,
      chromatic_split: 0.39,
      doom_bloom: 0.21,
      temp_bias: 14,
      heat_haze: 0.19,
      phase_glow: 0.12,
      entropy: 0.4,
      scanline_phase: 0,
    },
    background: { r: 237, g: 233, b: 244, a: 1 },
    room: { r: 243, g: 238, b: 249, a: 1 },
    room_stroke: { r: 43, g: 36, b: 55, a: 0.17 },
    rabbit: { r: 238, g: 241, b: 248, a: 0.98 },
    player: { r: 128, g: 84, b: 146, a: 0.95 },
    doorline: { r: 255, g: 176, b: 108, a: 0.62 },
    vignette: { r: 55, g: 34, b: 78, a: 0.42 },
    chroma: { r: 170, g: 88, b: 152, a: 0.28 },
    grain: { r: 61, g: 31, b: 63, a: 0.08 },
    prop_orb: "rgba(174, 117, 215, 0.86)",
    prop_pillar: "rgba(235, 181, 137, 0.84)",
    prop_shard: "rgba(186, 226, 198, 0.84)",
    prop_ribbon: "rgba(232, 173, 243, 0.84)",
    prop_echo_cube: "rgba(255, 212, 130, 0.76)",
    distortion: "rgba(176, 101, 188, 0.38)",
    chroma_opacity: 0.2,
    grain_opacity: 0.06,
    vignette_opacity: 0.24,
    wave_speed: 1.7,
    motion_amp: 0.72,
    pulse_amp: 0.1,
  },
  frustration: {
    ...{
      turn_marker: 0,
      scanline_power: 0.33,
      chromatic_split: 0.27,
      doom_bloom: 0.16,
      temp_bias: 8,
      heat_haze: 0.18,
      phase_glow: 0.12,
      entropy: 0.34,
      scanline_phase: 0,
    },
    background: { r: 243, g: 236, b: 230, a: 1 },
    room: { r: 249, g: 244, b: 238, a: 1 },
    room_stroke: { r: 58, g: 50, b: 42, a: 0.19 },
    rabbit: { r: 247, g: 243, b: 236, a: 0.98 },
    player: { r: 177, g: 122, b: 66, a: 0.95 },
    doorline: { r: 206, g: 109, b: 95, a: 0.58 },
    vignette: { r: 68, g: 46, b: 34, a: 0.42 },
    chroma: { r: 186, g: 118, b: 90, a: 0.28 },
    grain: { r: 74, g: 55, b: 43, a: 0.08 },
    prop_orb: "rgba(220, 164, 130, 0.84)",
    prop_pillar: "rgba(220, 130, 103, 0.83)",
    prop_shard: "rgba(198, 165, 115, 0.84)",
    prop_ribbon: "rgba(196, 140, 200, 0.83)",
    prop_echo_cube: "rgba(240, 178, 130, 0.8)",
    distortion: "rgba(206, 131, 106, 0.36)",
    chroma_opacity: 0.18,
    grain_opacity: 0.066,
    vignette_opacity: 0.22,
    wave_speed: 1.55,
    motion_amp: 0.65,
    pulse_amp: 0.09,
  },
  sadness: {
    ...{
      turn_marker: 0,
      scanline_power: 0.24,
      chromatic_split: 0.2,
      doom_bloom: 0.1,
      temp_bias: -12,
      heat_haze: 0.07,
      phase_glow: 0.08,
      entropy: 0.18,
      scanline_phase: 0,
    },
    background: { r: 231, g: 236, b: 243, a: 1 },
    room: { r: 238, g: 243, b: 248, a: 1 },
    room_stroke: { r: 36, g: 52, b: 70, a: 0.17 },
    rabbit: { r: 234, g: 238, b: 244, a: 0.98 },
    player: { r: 102, g: 132, b: 168, a: 0.95 },
    doorline: { r: 136, g: 179, b: 206, a: 0.4 },
    vignette: { r: 43, g: 55, b: 72, a: 0.34 },
    chroma: { r: 122, g: 165, b: 194, a: 0.22 },
    grain: { r: 49, g: 59, b: 72, a: 0.05 },
    prop_orb: "rgba(114, 164, 213, 0.84)",
    prop_pillar: "rgba(138, 194, 213, 0.84)",
    prop_shard: "rgba(124, 180, 212, 0.84)",
    prop_ribbon: "rgba(152, 160, 216, 0.84)",
    prop_echo_cube: "rgba(180, 206, 255, 0.78)",
    distortion: "rgba(98, 148, 189, 0.32)",
    chroma_opacity: 0.14,
    grain_opacity: 0.038,
    vignette_opacity: 0.16,
    wave_speed: 0.9,
    motion_amp: 0.5,
    pulse_amp: 0.07,
  },
  hope: {
    ...{
      turn_marker: 0,
      scanline_power: 0.2,
      chromatic_split: 0.18,
      doom_bloom: 0.14,
      temp_bias: 16,
      heat_haze: 0.08,
      phase_glow: 0.09,
      entropy: 0.16,
      scanline_phase: 0,
    },
    background: { r: 237, g: 247, b: 242, a: 1 },
    room: { r: 244, g: 250, b: 245, a: 1 },
    room_stroke: { r: 33, g: 57, b: 47, a: 0.16 },
    rabbit: { r: 238, g: 249, b: 242, a: 0.98 },
    player: { r: 92, g: 147, b: 132, a: 0.95 },
    doorline: { r: 142, g: 213, b: 162, a: 0.48 },
    vignette: { r: 31, g: 59, b: 53, a: 0.28 },
    chroma: { r: 110, g: 190, b: 167, a: 0.26 },
    grain: { r: 48, g: 72, b: 59, a: 0.046 },
    prop_orb: "rgba(110, 206, 183, 0.85)",
    prop_pillar: "rgba(168, 224, 204, 0.84)",
    prop_shard: "rgba(142, 214, 194, 0.84)",
    prop_ribbon: "rgba(183, 219, 196, 0.84)",
    prop_echo_cube: "rgba(225, 252, 234, 0.78)",
    distortion: "rgba(92, 197, 162, 0.32)",
    chroma_opacity: 0.2,
    grain_opacity: 0.038,
    vignette_opacity: 0.14,
    wave_speed: 1.05,
    motion_amp: 0.58,
    pulse_amp: 0.06,
  },
  conflict: {
    ...{
      turn_marker: 0,
      scanline_power: 0.36,
      chromatic_split: 0.34,
      doom_bloom: 0.2,
      temp_bias: 26,
      heat_haze: 0.17,
      phase_glow: 0.1,
      entropy: 0.38,
      scanline_phase: 0,
    },
    background: { r: 234, g: 238, b: 246, a: 1 },
    room: { r: 242, g: 244, b: 249, a: 1 },
    room_stroke: { r: 54, g: 57, b: 74, a: 0.18 },
    rabbit: { r: 236, g: 240, b: 247, a: 0.98 },
    player: { r: 98, g: 118, b: 160, a: 0.95 },
    doorline: { r: 197, g: 160, b: 226, a: 0.45 },
    vignette: { r: 49, g: 55, b: 76, a: 0.38 },
    chroma: { r: 132, g: 153, b: 212, a: 0.34 },
    grain: { r: 51, g: 57, b: 80, a: 0.09 },
    prop_orb: "rgba(132, 188, 233, 0.86)",
    prop_pillar: "rgba(205, 178, 240, 0.84)",
    prop_shard: "rgba(177, 208, 240, 0.84)",
    prop_ribbon: "rgba(190, 166, 226, 0.84)",
    prop_echo_cube: "rgba(219, 234, 255, 0.74)",
    distortion: "rgba(124, 168, 230, 0.36)",
    chroma_opacity: 0.24,
    grain_opacity: 0.068,
    vignette_opacity: 0.24,
    wave_speed: 1.52,
    motion_amp: 0.72,
    pulse_amp: 0.11,
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseMoodLabel(raw: string): EmotionLabel {
  const lc = raw.toLowerCase();
  if (lc.includes("fear") || lc.includes("anxious")) return "anxious";
  if (lc.includes("threat") || lc.includes("danger") || lc.includes("unsafe") || lc.includes("pressure")) return "threat";
  if (lc.includes("angry") || lc.includes("frustrat") || lc.includes("defiant") || lc.includes("frustration")) return "frustration";
  if (lc.includes("sad") || lc.includes("grief")) return "sadness";
  if (lc.includes("hope") || lc.includes("joy") || lc.includes("optim")) return "hope";
  if (lc.includes("conflict") || lc.includes("mixed") || lc.includes("uncertain")) return "conflict";
  return "neutral";
}

function cloneColor(value: MoodColor): MoodColor {
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function blendColor(base: MoodColor, blend: MoodColor, weight: number): MoodColor {
  const w = clamp01(weight);
  return {
    r: base.r * (1 - w) + blend.r * w,
    g: base.g * (1 - w) + blend.g * w,
    b: base.b * (1 - w) + blend.b * w,
    a: base.a * (1 - w) + blend.a * w,
  };
}

function lerpProfile(from: RoomMoodProfile, to: RoomMoodProfile, amount: number): RoomMoodProfile {
  const t = clamp01(amount);
  return {
    name: to.name,
    confidence: from.confidence + (to.confidence - from.confidence) * t,
    background: blendColor(from.background, to.background, t),
    room: blendColor(from.room, to.room, t),
    room_stroke: blendColor(from.room_stroke, to.room_stroke, t),
    rabbit: blendColor(from.rabbit, to.rabbit, t),
    player: blendColor(from.player, to.player, t),
    doorline: blendColor(from.doorline, to.doorline, t),
    vignette: blendColor(from.vignette, to.vignette, t),
    chroma: blendColor(from.chroma, to.chroma, t),
    grain: blendColor(from.grain, to.grain, t),
    prop_orb: t < 1 ? from.prop_orb : to.prop_orb,
    prop_pillar: t < 1 ? from.prop_pillar : to.prop_pillar,
    prop_shard: t < 1 ? from.prop_shard : to.prop_shard,
    prop_ribbon: t < 1 ? from.prop_ribbon : to.prop_ribbon,
    prop_echo_cube: t < 1 ? from.prop_echo_cube : to.prop_echo_cube,
    distortion: t < 1 ? from.distortion : to.distortion,
    chroma_opacity: from.chroma_opacity + (to.chroma_opacity - from.chroma_opacity) * t,
    grain_opacity: from.grain_opacity + (to.grain_opacity - from.grain_opacity) * t,
    vignette_opacity: from.vignette_opacity + (to.vignette_opacity - from.vignette_opacity) * t,
    wave_speed: from.wave_speed + (to.wave_speed - from.wave_speed) * t,
    motion_amp: from.motion_amp + (to.motion_amp - from.motion_amp) * t,
    pulse_amp: from.pulse_amp + (to.pulse_amp - from.pulse_amp) * t,
    turn_marker: from.turn_marker + (to.turn_marker - from.turn_marker) * t,
    scanline_power: from.scanline_power + (to.scanline_power - from.scanline_power) * t,
    chromatic_split: from.chromatic_split + (to.chromatic_split - from.chromatic_split) * t,
    doom_bloom: from.doom_bloom + (to.doom_bloom - from.doom_bloom) * t,
    temp_bias: from.temp_bias + (to.temp_bias - from.temp_bias) * t,
    heat_haze: from.heat_haze + (to.heat_haze - from.heat_haze) * t,
    phase_glow: from.phase_glow + (to.phase_glow - from.phase_glow) * t,
    entropy: from.entropy + (to.entropy - from.entropy) * t,
    scanline_phase: from.scanline_phase + (to.scanline_phase - from.scanline_phase) * t,
  };
}

function cloneProfile(profile: RoomMoodProfile): RoomMoodProfile {
  return {
    ...profile,
    background: cloneColor(profile.background),
    room: cloneColor(profile.room),
    room_stroke: cloneColor(profile.room_stroke),
    rabbit: cloneColor(profile.rabbit),
    player: cloneColor(profile.player),
    doorline: cloneColor(profile.doorline),
    vignette: cloneColor(profile.vignette),
    chroma: cloneColor(profile.chroma),
    grain: cloneColor(profile.grain),
    turn_marker: profile.turn_marker,
    scanline_power: profile.scanline_power,
    chromatic_split: profile.chromatic_split,
    doom_bloom: profile.doom_bloom,
    temp_bias: profile.temp_bias,
    heat_haze: profile.heat_haze,
    phase_glow: profile.phase_glow,
    entropy: profile.entropy,
    scanline_phase: profile.scanline_phase,
  };
}

function normalizeEmotionDistribution(context: ConsciousnessRuntimeContext): Record<EmotionLabel, number> {
  const output: Record<EmotionLabel, number> = {
    neutral: 0,
    anxious: 0,
    threat: 0,
    frustration: 0,
    sadness: 0,
    hope: 0,
    conflict: 0,
  };

  for (const [emotion, score] of Object.entries(context.multi_emotional_state)) {
    const parsed = parseMoodLabel(emotion);
    if (Number.isFinite(score)) {
      output[parsed] += Math.max(0, score);
    }
  }

  const fallback = parseMoodLabel(context.emotional_state);
  if (Object.values(output).every((value) => value <= 0)) {
    output[fallback] = 1;
  }

  const sum = Object.values(output).reduce((total, value) => total + value, 0);
  if (sum <= 0) {
    return { ...output, neutral: 1 };
  }

  for (const key of Object.keys(output) as EmotionLabel[]) {
    output[key] = output[key] / sum;
  }

  return output;
}

function deriveStateEmotionSeed(state: RabbitState): EmotionLabel {
  if (state.threat >= 70 || state.psych.threat_anticipation >= 0.48) {
    return "threat";
  }
  if (state.psych.uncertainty >= 0.42 && state.tone === RabbitTone.Cold) {
    return "anxious";
  }
  if (state.psych.cognitive_dissonance >= 0.36) {
    return "conflict";
  }
  if (state.tone === RabbitTone.Gentle && state.curiosity >= 55 && state.trust >= 45) {
    return "hope";
  }
  if (state.psych.arousal <= -0.08 && state.psych.control >= 0.08) {
    return "neutral";
  }
  return state.threat >= 55 ? "threat" : "neutral";
}

function mapConsciousnessToRoomMood(
  context: ConsciousnessRuntimeContext,
  state: RabbitState,
  calmMode: boolean,
  turnContext: {
    turn_id: string;
    utterance_text: string;
    tags: string[];
    phase: RabbitPhase;
  },
): RoomMoodProfile {
  const normal = normalizeEmotionDistribution(context);
  const sortedEmotions = Object.entries(normal) as Array<[EmotionLabel, number]>;
  const ordered = sortedEmotions
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  const maxPrimary = ordered[0]?.[1] ?? 0.2;

  let confidence = 0.4;
  let profile = createNeutralRoomMood();
  for (const [emotion, weight] of ordered.slice(0, 3)) {
    const preset = MOOD_PRESETS[emotion];
    const normalizedWeight = clamp01(weight * 1.2 + 0.2 / (ordered.length || 1));
    profile = {
      ...blendProfile(profile, { ...preset, name: emotion, confidence }, normalizedWeight),
    };
  }

  const stateSeed = deriveStateEmotionSeed(state);
  if (stateSeed !== "neutral") {
    const seedPreset = MOOD_PRESETS[stateSeed];
    const stateBlendWeight = clamp01(
      0.22 + Math.abs(state.psych.uncertainty) * 0.35 + Math.abs(state.psych.threat_anticipation) * 0.45 + state.threat / 220,
    );
    profile = {
      ...blendProfile(profile, { ...seedPreset, name: stateSeed, confidence }, stateBlendWeight),
    };
  }

  // Mild entropy push for high uncertainty/conflict.
  const entropyBoost = Math.min(0.18, (state.psych.uncertainty + state.psych.cognitive_dissonance) * 0.36);
  profile.confidence = clamp01(0.75 * maxPrimary + confidence * 0.15 + entropyBoost);
  profile = blendProfile(profile, createNeutralRoomMood(), calmMode ? 0.25 : 0);
  profile = blendProfile(profile, motionBiasForPhase(state.phase, profile), phaseBiasMultiplier(state.phase));
  profile = applyPhaseEmphasis(profile, state.phase);
  profile = {
    ...profile,
    ...composeTurnTrippyProfile({
      context,
      state,
      phase: turnContext.phase,
      turnId: turnContext.turn_id,
      utteranceText: turnContext.utterance_text,
      tags: turnContext.tags,
      calmMode,
      confidence: profile.confidence,
    }),
  };

  return profile;
}

function motionBiasForPhase(phase: RabbitPhase, profile: RoomMoodProfile): RoomMoodProfile {
  switch (phase) {
    case RabbitPhase.Mirror:
      return {
        ...profile,
        wave_speed: profile.wave_speed + 0.22,
        motion_amp: clamp01(profile.motion_amp + 0.16),
        pulse_amp: Math.min(0.14, profile.pulse_amp + 0.035),
      };
    case RabbitPhase.Contract:
      return {
        ...profile,
        wave_speed: profile.wave_speed + 0.06,
        motion_amp: clamp01(profile.motion_amp + 0.12),
        vignette_opacity: clamp01(profile.vignette_opacity + 0.12),
      };
    case RabbitPhase.Destabilize:
      return {
        ...profile,
        grain_opacity: clamp01(profile.grain_opacity + 0.03),
        pulse_amp: clamp01(profile.pulse_amp + 0.035),
      };
    default:
      return profile;
  }
}

function phaseBiasMultiplier(phase: RabbitPhase): number {
  switch (phase) {
    case RabbitPhase.Mirror:
      return 0.2;
    case RabbitPhase.Contract:
      return 0.15;
    case RabbitPhase.Destabilize:
      return 0.16;
    case RabbitPhase.Exit:
      return 0.08;
    default:
      return 0;
  }
}

function applyPhaseEmphasis(profile: RoomMoodProfile, phase: RabbitPhase): RoomMoodProfile {
  if (phase === RabbitPhase.Exit) {
    return {
      ...profile,
      motion_amp: clamp01(profile.motion_amp + 0.08),
      pulse_amp: clamp01(profile.pulse_amp + 0.02),
      chroma_opacity: clamp01(profile.chroma_opacity + 0.03),
    };
  }
  return profile;
}

function blendProfile(base: RoomMoodProfile, target: RoomMoodProfile, amount: number): RoomMoodProfile {
  return lerpProfile(base, target, clamp01(amount));
}

function createNeutralRoomMood(): RoomMoodProfile {
  return {
    name: "neutral",
    confidence: 0.4,
    ...MOOD_PRESETS.neutral,
    turn_marker: 0,
    scanline_power: 0.22,
    chromatic_split: 0.18,
    doom_bloom: 0.11,
    temp_bias: -2,
    heat_haze: 0.06,
    phase_glow: 0.08,
    entropy: 0.12,
    scanline_phase: 0,
  };
}

function colorToRgba(color: MoodColor): string {
  return `rgba(${clamp255(color.r)}, ${clamp255(color.g)}, ${clamp255(color.b)}, ${Math.max(0, Math.min(1, color.a))})`;
}

function clampTempBias(value: number): number {
  return Math.max(-30, Math.min(30, value));
}

function turnMutationOffset(seed: number): number {
  return ((Math.sin(seed * Math.PI * 2) + 1) * 0.5 - 0.5) * 2;
}

const ROOM_MOOD_MUTATION: {
  scanline_power: number;
  chromatic_split: number;
  doom_bloom: number;
  temp_bias: number;
  heat_haze: number;
} = {
  scanline_power: 0.018,
  chromatic_split: 0.014,
  doom_bloom: 0.02,
  temp_bias: 1.6,
  heat_haze: 0.009,
};

const ROOM_MOOD_HARD_CHANNELS: MoodScalarChannel[] = [
  "scanline_power",
  "chromatic_split",
  "doom_bloom",
  "temp_bias",
  "heat_haze",
];

function scaleMoodColor(color: MoodColor, multiplier: number): MoodColor {
  return {
    r: clamp255(color.r * multiplier),
    g: clamp255(color.g * multiplier),
    b: clamp255(color.b * multiplier),
    a: color.a,
  };
}

function applyTemperatureShift(color: MoodColor, tempBias: number): MoodColor {
  const bias = clamp255(tempBias) - 0;
  const red = color.r + (bias * 0.85 + 0.12 * Math.abs(color.b - color.r));
  const green = color.g - bias * 0.42;
  const blue = color.b - (bias * 0.65);
  return {
    r: clamp255(red),
    g: clamp255(green),
    b: clamp255(blue),
    a: color.a,
  };
}

function moodSignature(profile: RoomMoodProfile): string {
  return `${profile.name}|${profile.confidence.toFixed(3)}|${Math.round(profile.background.r)}-${Math.round(
    profile.background.g,
  )}-${Math.round(profile.background.b)}-${profile.background.a.toFixed(3)}|${Math.round(profile.room.r)}-${Math.round(
    profile.room.g,
  )}-${Math.round(profile.room.b)}-${profile.room.a.toFixed(3)}|${Math.round(profile.motion_amp * 1000)}|${profile.turn_marker.toFixed(
    10,
  )}|${profile.scanline_power.toFixed(4)}|${profile.chromatic_split.toFixed(4)}|${profile.doom_bloom.toFixed(4)}|${Math.round(
    profile.temp_bias,
  )}|${profile.scanline_phase.toFixed(4)}`;
}

function calculateMoodDeltaMagnitude(from: RoomMoodProfile, to: RoomMoodProfile): number {
  return (
    Math.abs(to.scanline_power - from.scanline_power) +
    Math.abs(to.chromatic_split - from.chromatic_split) +
    Math.abs(to.doom_bloom - from.doom_bloom) +
    Math.abs(to.temp_bias - from.temp_bias) * 0.012 +
    Math.abs(to.heat_haze - from.heat_haze)
  );
}

function resolveBoundedChannel(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type RuntimeMode = "Explore" | "DialogueActive" | "EndingLocked";
type LlmStatusTone = "ok" | "warn";
type RuntimeBadgeTone = "ok" | "warn";

interface RoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function defaultMorphFrame(): MorphFrame {
  return {
    light: { exposure: 0.42, toplight: 0.2, halo: 0.15 },
    geometry: { skew: 0.05, wave: 0.04 },
    props: { mirror: 0, doorline: 0, eyes: 0.25 },
    audio: { heartbeat: 0.05, hum: 0.1 },
    ui: { vignette: 0.08, jitter: 0, chroma: 0 },
    activeRecipeIds: ["R01_ClinicalBaseline"],
  };
}

export class TopDownGameLoopController {
  private readonly conversation = new ConversationEngine();
  private readonly queue = new LlmTurnQueue();
  private readonly world = new WorldMorphEngine();
  private readonly interaction = new ProximityInteraction2D({ max_distance: 100 });
  private readonly clock = new RuntimeClock();
  private readonly inputController = new InputController(balance.stt_failure_fallback_threshold);
  private readonly dynamicWorld = new DynamicWorldRuntime2D({
    max_props: 6,
    max_distortions: 2,
  });

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private controller!: TopDownController;

  private subtitleEl!: HTMLDivElement;
  private userEchoEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private llmStatusEl!: HTMLDivElement;
  private runtimeStatusEl!: HTMLDivElement;
  private debugToggleButton!: HTMLButtonElement;
  private reconnectBridgeButton!: HTMLButtonElement;
  private interactionPromptEl!: HTMLDivElement;
  private exploreOverlayEl!: HTMLDivElement;
  private dialogueOverlayEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private sendButton!: HTMLButtonElement;
  private voiceButton!: HTMLButtonElement;
  private vignetteEl!: HTMLDivElement;
  private chromaEl!: HTMLDivElement;
  private grainEl!: HTMLDivElement;
  private doomRgbSplitEl!: HTMLDivElement;
  private doomScanlineEl!: HTMLDivElement;
  private doomLensEl!: HTMLDivElement;
  private debugOverlay!: DebugOverlay;
  private consentModalEl!: HTMLDivElement;
  private consentLocalButton!: HTMLButtonElement;
  private consentHostedButton!: HTMLButtonElement;
  private bridgeHintEl!: HTMLDivElement;

  private readonly roomRect: RoomRect = { x: 60, y: 88, width: 960, height: 580 };
  private readonly rabbitPosition: Vec2 = { x: 0, y: 0 };
  private readonly playerPositionBuffer: Vec2 = { x: 0, y: 0 };

  private readonly playerRadius = 15;
  private readonly rabbitRadius = 52;

  private calmMode = false;
  private processing = false;
  private ended = false;
  private forcedFinalAutoPrompted = false;
  private runtimeMode: RuntimeMode = "Explore";
  private canInteract = false;
  private retryTimer: number | null = null;
  private readonly frameRateSafety = new FrameRateSafety();
  private reducedEffectsProfile = false;
  private lastFrameTimestampMs = 0;
  private morphFrame: MorphFrame = defaultMorphFrame();
  private roomMoodCurrent: RoomMoodProfile = createNeutralRoomMood();
  private roomMoodTransitionFrom: RoomMoodProfile = createNeutralRoomMood();
  private roomMoodTransitionTo: RoomMoodProfile = createNeutralRoomMood();
  private roomMoodTransitionStartMs = 0;
  private roomMoodTransitionDurationMs = 420;
  private roomMoodLastWriteMs = 0;
  private roomMoodLastSignature = "";
  private roomMoodLastMutationDelta = 0;
  private roomMoodLastGuaranteedShift = false;
  private roomMoodWobbleSeed = 0;
  private roomMoodTurnCounter = 0;

  private providerStatus = {
    llm: "unknown",
    stt: "unknown",
    tts: "unknown",
  };
  private bridgePollTimer: number | null = null;
  private latestReflexTurnId: string | null = null;
  private lastDebugSnapshot: Record<string, unknown> = {};
  private lastFirstLineLatencyMs = 0;
  private lastEnrichmentLatencyMs = 0;
  private lastEnrichmentPending = false;
  private lastEnrichmentApplied = false;
  private lastEnrichmentDropReason = "none";

  private readonly allowDeterministicFallbackDelivery =
    new URLSearchParams(window.location.search).get("allow_fallback") === "1" ||
    (window as unknown as { __WHITE_ROOM_ALLOW_DETERMINISTIC_FALLBACK__?: boolean })
      .__WHITE_ROOM_ALLOW_DETERMINISTIC_FALLBACK__ === true;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    this.createUi();
    this.createCanvas();
    this.bindEvents();
    this.setRuntimeMode("Explore");
    this.roomMoodWobbleSeed = Math.random() * Math.PI * 2;
    this.setRoomMoodTarget(createNeutralRoomMood());
    this.applyRoomMoodStyles(createNeutralRoomMood(), performance.now());
    void this.initializeRuntimeChoice();
    void this.refreshHealth();
    setInterval(() => void this.refreshHealth(), 15000);
    this.lastFrameTimestampMs = performance.now();
    this.animate();
    this.subtitleEl.textContent = "Walk to the rabbit circle. Press E to enter dialogue.";
  }

  private createUi(): void {
    this.root.innerHTML = `
      <div class="canvas-root">
        <canvas id="topdown-canvas" class="topdown-canvas"></canvas>
      </div>
      <div class="ui-layer">
        <div class="topbar">
          <div class="title">WHITE ROOM / RABBIT</div>
          <div class="controls">
            <div class="runtime-status runtime-status-ok" id="runtime-status">Hosted LLM</div>
            <button class="bridge-reconnect hidden" id="bridge-reconnect" type="button">Reconnect Local AI</button>
            <button class="debug-toggle" id="debug-toggle" type="button" aria-pressed="false">Show Debug</button>
          </div>
          <div class="timer" id="timer">05:00</div>
        </div>

        <div class="explore-overlay" id="explore-overlay">
          <div class="explore-hint">WASD to move. Press E near rabbit.</div>
          <div class="interaction-prompt" id="interaction-prompt">Press E to interact</div>
        </div>

        <div class="dialogue-overlay hidden" id="dialogue-overlay">
          <div class="dialogue-shell">
            <div class="llm-status llm-status-ok" id="llm-status">Rabbit linked.</div>
            <div class="bridge-hint hidden" id="bridge-hint"></div>
            <div class="response-card" id="subtitle">Dialogue active. Ask the rabbit anything.</div>
            <div class="last-user-echo last-user-echo-muted" id="user-echo">You: waiting for input.</div>
            <div class="input-dock">
              <input id="player-input" type="text" maxlength="260" placeholder="Type to speak. Voice optional." />
              <button id="voice-btn">Hold To Talk</button>
              <button id="send-btn" class="primary">Send</button>
            </div>
            <div class="dialogue-hint">Esc to return to movement.</div>
          </div>
        </div>

        <div class="consent-modal hidden" id="consent-modal">
          <div class="consent-card">
            <div class="consent-title">Choose AI Runtime</div>
            <div class="consent-copy">Allow local bridge mode for private on-device AI, or continue with hosted/fallback mode.</div>
            <div class="consent-actions">
              <button id="consent-local" type="button">Use Local AI</button>
              <button id="consent-hosted" type="button">Use Hosted / Fallback</button>
            </div>
          </div>
        </div>

        <div class="vignette"></div>
        <div class="chroma-layer"></div>
        <div class="grain-layer"></div>
        <div class="doom-rgb-split"></div>
        <div class="doom-scanlines"></div>
        <div class="doom-lens"></div>
      </div>
    `;

    const controls = this.root.querySelector(".controls") as HTMLDivElement;
    this.timerEl = this.root.querySelector("#timer") as HTMLDivElement;
    this.subtitleEl = this.root.querySelector("#subtitle") as HTMLDivElement;
    this.userEchoEl = this.root.querySelector("#user-echo") as HTMLDivElement;
    this.llmStatusEl = this.root.querySelector("#llm-status") as HTMLDivElement;
    this.runtimeStatusEl = this.root.querySelector("#runtime-status") as HTMLDivElement;
    this.debugToggleButton = this.root.querySelector("#debug-toggle") as HTMLButtonElement;
    this.reconnectBridgeButton = this.root.querySelector("#bridge-reconnect") as HTMLButtonElement;
    this.interactionPromptEl = this.root.querySelector("#interaction-prompt") as HTMLDivElement;
    this.exploreOverlayEl = this.root.querySelector("#explore-overlay") as HTMLDivElement;
    this.dialogueOverlayEl = this.root.querySelector("#dialogue-overlay") as HTMLDivElement;
    this.bridgeHintEl = this.root.querySelector("#bridge-hint") as HTMLDivElement;
    this.inputEl = this.root.querySelector("#player-input") as HTMLInputElement;
    this.sendButton = this.root.querySelector("#send-btn") as HTMLButtonElement;
    this.voiceButton = this.root.querySelector("#voice-btn") as HTMLButtonElement;
    this.consentModalEl = this.root.querySelector("#consent-modal") as HTMLDivElement;
    this.consentLocalButton = this.root.querySelector("#consent-local") as HTMLButtonElement;
    this.consentHostedButton = this.root.querySelector("#consent-hosted") as HTMLButtonElement;
    this.vignetteEl = this.root.querySelector(".vignette") as HTMLDivElement;
    this.chromaEl = this.root.querySelector(".chroma-layer") as HTMLDivElement;
    this.grainEl = this.root.querySelector(".grain-layer") as HTMLDivElement;
    this.doomRgbSplitEl = this.root.querySelector(".doom-rgb-split") as HTMLDivElement;
    this.doomScanlineEl = this.root.querySelector(".doom-scanlines") as HTMLDivElement;
    this.doomLensEl = this.root.querySelector(".doom-lens") as HTMLDivElement;

    new CalmModeToggle(controls, (enabled) => {
      this.calmMode = enabled;
      if (enabled) {
        this.applyCalmImmediateClamp();
      }
    }).setChecked(false);

    this.debugOverlay = new DebugOverlay(this.root.querySelector(".ui-layer") as HTMLElement);
    this.debugOverlay.setVisible(false);
    this.syncDebugToggleUi();
  }

  private createCanvas(): void {
    this.canvas = this.root.querySelector("#topdown-canvas") as HTMLCanvasElement;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable");
    }
    this.ctx = ctx;

    this.onResize(true);

    const startX = this.roomRect.x + this.roomRect.width * 0.5;
    const startY = this.roomRect.y + this.roomRect.height * 0.82;
    this.controller = new TopDownController(
      { x: startX, y: startY },
      {
        walk_speed: 265,
        run_multiplier: 1.4,
        bounds: this.buildPlayerBounds(),
      },
    );
  }

  private bindEvents(): void {
    window.addEventListener("resize", () => this.onResize(false));

    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "e" && this.runtimeMode === "Explore" && this.canInteract && !this.ended) {
        event.preventDefault();
        this.enterDialogueMode();
      }

      if (event.key === "Escape" && this.runtimeMode === "DialogueActive" && !this.ended) {
        event.preventDefault();
        this.exitDialogueMode();
      }

      if (event.code === "Backquote") {
        const activeTag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
        if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        this.toggleDebugOverlay();
      }
    });

    this.sendButton.addEventListener("click", () => {
      void this.enqueueOrRunTurn(this.inputEl.value);
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.enqueueOrRunTurn(this.inputEl.value);
      }
    });

    this.voiceButton.addEventListener("pointerdown", async () => {
      if (this.ended || this.runtimeMode !== "DialogueActive") return;
      const started = await this.inputController.beginVoice();
      if (!started) {
        this.subtitleEl.textContent = "Voice unavailable. Continue with typed input.";
      } else {
        this.voiceButton.classList.add("recording");
      }
    });

    const stopVoice = async () => {
      if (this.ended || this.runtimeMode !== "DialogueActive") return;
      this.voiceButton.classList.remove("recording");
      const transcript = await this.inputController.endVoice();
      if (transcript) {
        this.inputEl.value = transcript;
        await this.enqueueOrRunTurn(transcript);
      } else if (this.inputController.getVoiceLocked()) {
        this.voiceButton.disabled = true;
        this.subtitleEl.textContent = "Voice failed twice. Typed mode is now primary for this session.";
      }
    };

    this.voiceButton.addEventListener("pointerup", () => {
      void stopVoice();
    });
    this.voiceButton.addEventListener("pointerleave", () => {
      void stopVoice();
    });

    this.consentLocalButton.addEventListener("click", () => {
      void this.handleLocalConsent();
    });
    this.consentHostedButton.addEventListener("click", () => {
      this.handleHostedConsent();
    });
    this.reconnectBridgeButton.addEventListener("click", () => {
      void this.handleLocalConsent(true);
    });
    this.debugToggleButton.addEventListener("click", () => {
      this.toggleDebugOverlay();
    });
  }

  private async initializeRuntimeChoice(): Promise<void> {
    if (!runtimeTransport.hasConsentChoice()) {
      this.consentModalEl.classList.remove("hidden");
      this.reconnectBridgeButton.classList.add("hidden");
      this.setRuntimeStatusBadge("Awaiting Consent", "warn");
      return;
    }

    if (runtimeTransport.getChoice() === "local_bridge") {
      await runtimeTransport.refreshBridgeStatus();
      this.startBridgePolling();
    }

    this.updateRuntimeStatusBadge();
  }

  private setRuntimeStatusBadge(label: string, tone: RuntimeBadgeTone): void {
    this.runtimeStatusEl.textContent = label;
    this.runtimeStatusEl.classList.toggle("runtime-status-ok", tone === "ok");
    this.runtimeStatusEl.classList.toggle("runtime-status-warn", tone === "warn");
  }

  private updateRuntimeStatusBadge(): void {
    const status = runtimeTransport.getRuntimeStatus(this.providerStatus.llm);
    const tone: RuntimeBadgeTone = status === "Deterministic Continuity" ? "warn" : "ok";
    this.setRuntimeStatusBadge(status, tone);

    const localChosen = runtimeTransport.getChoice() === "local_bridge";
    this.reconnectBridgeButton.classList.toggle("hidden", !localChosen);
    if (localChosen && !runtimeTransport.getBridgeState()?.connected) {
      this.bridgeHintEl.classList.remove("hidden");
    } else {
      this.bridgeHintEl.classList.add("hidden");
    }
  }

  private startBridgePolling(): void {
    if (this.bridgePollTimer !== null) return;
    this.bridgePollTimer = window.setInterval(() => {
      void runtimeTransport.refreshBridgeStatus().then(() => this.updateRuntimeStatusBadge());
    }, 7000);
  }

  private async handleLocalConsent(forceNewSession = false): Promise<void> {
    runtimeTransport.setChoice("local_bridge");
    if (forceNewSession || !runtimeTransport.getBridgeState()) {
      const created = await runtimeTransport.createBridgeSession();
      if (created.ok && created.command) {
        this.bridgeHintEl.textContent = `Run local bridge: ${created.command}`;
      } else {
        this.bridgeHintEl.textContent = "Local bridge session failed. Hosted fallback remains active.";
      }
    }

    await runtimeTransport.refreshBridgeStatus();
    this.updateRuntimeStatusBadge();
    this.startBridgePolling();
    this.consentModalEl.classList.add("hidden");
  }

  private handleHostedConsent(): void {
    runtimeTransport.setChoice("hosted");
    this.consentModalEl.classList.add("hidden");
    this.bridgeHintEl.classList.add("hidden");
    this.updateRuntimeStatusBadge();
  }

  private buildPlayerBounds(): TopDownBounds {
    return {
      min_x: this.roomRect.x + this.playerRadius,
      max_x: this.roomRect.x + this.roomRect.width - this.playerRadius,
      min_y: this.roomRect.y + this.playerRadius,
      max_y: this.roomRect.y + this.roomRect.height - this.playerRadius,
    };
  }

  private onResize(initial: boolean): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = 1;

    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const marginX = Math.max(32, Math.floor(width * 0.06));
    const topY = Math.max(74, Math.floor(height * 0.09));
    const bottomPadding = 215;
    this.roomRect.x = marginX;
    this.roomRect.y = topY;
    this.roomRect.width = Math.max(420, width - marginX * 2);
    this.roomRect.height = Math.max(260, height - topY - bottomPadding);

    this.rabbitPosition.x = this.roomRect.x + this.roomRect.width * 0.5;
    this.rabbitPosition.y = this.roomRect.y + this.roomRect.height * 0.45;

    if (!initial && this.controller) {
      this.controller.setBounds(this.buildPlayerBounds());
    }
  }

  private enterDialogueMode(): void {
    this.setRuntimeMode("DialogueActive");
    this.controller.setEnabled(false);
    this.inputEl.focus();
    this.updateRuntimeStatusBadge();
    this.setLlmStatus("Dialogue active.", "ok");
    this.subtitleEl.textContent = "Dialogue active. Ask the rabbit anything.";
    this.userEchoEl.textContent = "You: waiting for input.";
    this.userEchoEl.classList.add("last-user-echo-muted");
  }

  private exitDialogueMode(): void {
    if (this.processing) {
      this.queue.clear();
    }
    this.clearRetryTimer();
    this.setRuntimeMode("Explore");
    this.controller.setEnabled(true);
    this.updateRuntimeStatusBadge();
    this.setLlmStatus("Movement mode.", "ok");
    this.subtitleEl.textContent = "Move toward rabbit and press E to interact.";
    this.userEchoEl.textContent = "You: waiting for input.";
    this.userEchoEl.classList.add("last-user-echo-muted");
  }

  private async enqueueOrRunTurn(raw: string): Promise<void> {
    if (this.processing || this.ended || this.runtimeMode !== "DialogueActive") {
      if (this.processing && this.runtimeMode === "DialogueActive") {
        this.queue.enqueueLatest(raw);
        this.setUserEcho(raw.trim());
        this.setLlmStatus("Rabbit busy. Latest turn queued.", "warn");
      }
      return;
    }

    const text = raw.trim();
    this.setUserEcho(text);
    this.inputEl.value = "";
    await this.runTurnInternal(text);
  }

  private async runTurnInternal(text: string): Promise<void> {
    if (this.ended || this.runtimeMode !== "DialogueActive") return;

    this.processing = true;
    this.voiceButton.disabled = true;

    try {
      const elapsed = this.clock.elapsedMs();
      const startedAtMs = performance.now();
      const result = await this.conversation.runReflexTurn(text, elapsed, this.calmMode, {
        llm_required: true,
        allow_deterministic_fallback_delivery: this.allowDeterministicFallbackDelivery,
        skip_llm: true,
      });
      this.latestReflexTurnId = result.turn_id;
      this.lastFirstLineLatencyMs = Math.max(0, Math.round(performance.now() - startedAtMs));
      this.lastEnrichmentPending = true;
      this.lastEnrichmentApplied = false;
      this.lastEnrichmentDropReason = "pending";
      this.lastEnrichmentLatencyMs = 0;

      this.lastDebugSnapshot = {
        phase: result.state_snapshot.phase,
        tone: result.state_snapshot.tone,
        trust: result.state_snapshot.trust,
        threat: result.state_snapshot.threat,
        curiosity: result.state_snapshot.curiosity,
        psych: result.state_snapshot.psych,
        tags: result.state_snapshot.last_tags,
        goals: result.state_snapshot.active_goals,
        elapsed_ms: result.state_snapshot.elapsed_ms,
        turn_index: result.state_snapshot.turn_index,
        llm_reject_count: result.state_snapshot.llm_reject_count,
        doctrine_count: result.doctrine_count,
        doctrine_sources: result.doctrine_sources,
        doctrine_modules: result.doctrine_modules,
        llm_provider: result.llm_source,
        llm_model_name: result.llm_model_name,
        llm_attempt_status: result.llm_attempt_status,
        llm_attempt_latency_ms: result.llm_attempt_latency_ms,
        llm_cache_hit: result.cache_hit,
        llm_cache_key_version: result.cache_key_version,
        llm_cache_ttl_remaining_ms: result.cache_ttl_remaining_ms,
        llm_available: result.llm_available,
        llm_deliverable: result.deliverable,
        llm_fallback_reason: result.fallback_reason,
        runtime_status: runtimeTransport.getRuntimeStatus(this.providerStatus.llm),
        stt_provider: this.providerStatus.stt,
        tts_provider: this.providerStatus.tts,
        llm_runtime: this.providerStatus.llm,
        voice_locked: this.inputController.getVoiceLocked(),
        calm_mode: this.calmMode,
        performance_reduced: this.reducedEffectsProfile,
        fps_estimate: Number(this.frameRateSafety.currentFpsEstimate().toFixed(1)),
        flags: result.active_flags,
        ending_progress: result.ending_progress,
        quality: result.quality,
        ending_candidate: result.ending,
        mode: this.runtimeMode,
        pointer_lock: false,
        can_interact: this.canInteract,
        queue_pending: this.queue.hasPending(),
        queue_attempts: this.queue.peek()?.attempts ?? 0,
        consciousness: result.consciousness_context,
        dynamic_world: this.dynamicWorld.getSnapshot(),
        turn_id: result.turn_id,
        time_to_first_line_ms: this.lastFirstLineLatencyMs,
        enrichment_pending: this.lastEnrichmentPending,
        enrichment_applied: this.lastEnrichmentApplied,
        enrichment_drop_reason: this.lastEnrichmentDropReason,
        enrichment_latency_ms: this.lastEnrichmentLatencyMs,
      };
      this.debugOverlay.render(this.lastDebugSnapshot);

      this.setRoomMoodFromResult(result);
      this.lastDebugSnapshot.room_mood_turn_signature = this.roomMoodLastSignature;
      this.lastDebugSnapshot.room_mood_delta_magnitude = Number(this.roomMoodLastMutationDelta.toFixed(4));
      this.lastDebugSnapshot.room_mood_guaranteed_shift = this.roomMoodLastGuaranteedShift;
      this.lastDebugSnapshot.room_mood_reduced_effects = this.reducedEffectsProfile;

      this.queue.clear();
      this.clearRetryTimer();
      this.setLlmStatus("Rabbit instant reply. Refining...", "ok");
      this.subtitleEl.textContent = result.response.reply_text;
      void playTtsNonBlocking(result.response.reply_text, result.response.tone);

      const baseMorph = this.world.compute(
        result.state_snapshot,
        result.response.morph_signal.classification,
        result.response.morph_signal.keywords,
        result.response.morph_signal.beat_trigger,
      );
      this.morphFrame = this.reducedEffectsProfile ? this.applyReducedEffectsProfile(baseMorph) : baseMorph;
      this.applyMorph(this.morphFrame);
      this.dynamicWorld.applyDirectives(result.response.world_directives, performance.now());

      if (result.ending || elapsed >= balance.session_hard_limit_ms) {
        this.finishSession(result.ending ?? "ESCAPE_A");
        return;
      }

      void this.conversation
        .requestTurnEnrichment({
          turn_id: result.turn_id,
          state_snapshot: result.state_snapshot,
          packet: result.packet,
          provisional_response: result.response,
        })
        .then((enrichment) => this.applyEnrichmentResult(result, enrichment))
        .catch(() => {
          this.lastEnrichmentPending = false;
          this.lastEnrichmentApplied = false;
          this.lastEnrichmentDropReason = "enrichment_error";
          this.lastDebugSnapshot.enrichment_pending = false;
          this.lastDebugSnapshot.enrichment_applied = false;
          this.lastDebugSnapshot.enrichment_drop_reason = this.lastEnrichmentDropReason;
          this.debugOverlay.render(this.lastDebugSnapshot);
        });
    } finally {
      this.processing = false;
      if (!this.ended && this.runtimeMode === "DialogueActive") {
        this.voiceButton.disabled = false;
      }
      if (!this.processing && this.runtimeMode === "DialogueActive" && this.queue.hasPending() && !this.retryTimer) {
        void this.runQueuedTurn();
      }
    }
  }

  private applyEnrichmentResult(base: ReflexTurnResult, enrichment: EnrichmentTurnResult): void {
    if (this.ended || this.runtimeMode !== "DialogueActive") {
      return;
    }

    this.lastEnrichmentPending = false;
    this.lastEnrichmentLatencyMs = Math.max(0, Math.round(enrichment.completed_at_ms - enrichment.requested_at_ms));

    if (!enrichment.ok || !enrichment.response) {
      this.lastEnrichmentApplied = false;
      this.lastEnrichmentDropReason = enrichment.fallback_reason ?? "enrichment_unavailable";
      this.lastDebugSnapshot.enrichment_pending = false;
      this.lastDebugSnapshot.enrichment_applied = false;
      this.lastDebugSnapshot.enrichment_drop_reason = this.lastEnrichmentDropReason;
      this.lastDebugSnapshot.enrichment_latency_ms = this.lastEnrichmentLatencyMs;
      this.debugOverlay.render(this.lastDebugSnapshot);
      return;
    }

    if (this.latestReflexTurnId !== enrichment.turn_id) {
      this.lastEnrichmentApplied = false;
      this.lastEnrichmentDropReason = enrichmentApplyIfTurnMatchOnly ? "turn_mismatch" : "stale_turn";
      this.lastDebugSnapshot.enrichment_pending = false;
      this.lastDebugSnapshot.enrichment_applied = false;
      this.lastDebugSnapshot.enrichment_drop_reason = this.lastEnrichmentDropReason;
      this.lastDebugSnapshot.enrichment_latency_ms = this.lastEnrichmentLatencyMs;
      this.debugOverlay.render(this.lastDebugSnapshot);
      return;
    }

    if (this.lastEnrichmentLatencyMs > enrichmentSoftDeadlineMs) {
      this.lastEnrichmentApplied = false;
      this.lastEnrichmentDropReason = "enrichment_late";
      this.lastDebugSnapshot.enrichment_pending = false;
      this.lastDebugSnapshot.enrichment_applied = false;
      this.lastDebugSnapshot.enrichment_drop_reason = this.lastEnrichmentDropReason;
      this.lastDebugSnapshot.enrichment_latency_ms = this.lastEnrichmentLatencyMs;
      this.debugOverlay.render(this.lastDebugSnapshot);
      return;
    }

    this.lastEnrichmentApplied = true;
    this.lastEnrichmentDropReason = "none";
    this.subtitleEl.textContent = enrichment.response.reply_text;
    this.dynamicWorld.applyDirectives(enrichment.response.world_directives, performance.now());
    this.setLlmStatus("Rabbit refined.", "ok");

    const baseMorph = this.world.compute(
      base.state_snapshot,
      enrichment.response.morph_signal.classification,
      enrichment.response.morph_signal.keywords,
      enrichment.response.morph_signal.beat_trigger,
    );
    this.morphFrame = this.reducedEffectsProfile ? this.applyReducedEffectsProfile(baseMorph) : baseMorph;
    this.applyMorph(this.morphFrame);

    this.lastDebugSnapshot.llm_provider = enrichment.source ?? this.lastDebugSnapshot.llm_provider;
    this.lastDebugSnapshot.llm_model_name = enrichment.model_name;
    this.lastDebugSnapshot.llm_attempt_status = enrichment.attempt_status;
    this.lastDebugSnapshot.llm_attempt_latency_ms = enrichment.attempt_latency_ms;
    this.lastDebugSnapshot.llm_cache_hit = enrichment.cache_hit;
    this.lastDebugSnapshot.llm_cache_key_version = enrichment.cache_key_version;
    this.lastDebugSnapshot.llm_cache_ttl_remaining_ms = enrichment.cache_ttl_remaining_ms;
    this.lastDebugSnapshot.llm_fallback_reason = enrichment.fallback_reason;
    this.lastDebugSnapshot.enrichment_pending = false;
    this.lastDebugSnapshot.enrichment_applied = true;
    this.lastDebugSnapshot.enrichment_drop_reason = "none";
    this.lastDebugSnapshot.enrichment_latency_ms = this.lastEnrichmentLatencyMs;
    this.debugOverlay.render(this.lastDebugSnapshot);
  }

  private setRoomMoodFromResult(result: ReflexTurnResult): void {
    try {
      const mapped = mapConsciousnessToRoomMood(
        result.consciousness_context,
        result.state_snapshot,
        this.calmMode,
        {
          turn_id: result.turn_id,
          utterance_text: result.packet.utterance_text,
          tags: result.packet.tags,
          phase: result.packet.phase,
        },
      );
      this.setRoomMoodTarget(mapped);
    } catch (error) {
      const fallback = createNeutralRoomMood();
      this.setRoomMoodTarget(fallback);
      this.lastDebugSnapshot.error = `room_mood_mapping_error:${(error as Error)?.message ?? "unknown"}`;
      this.debugOverlay.render(this.lastDebugSnapshot);
    }
  }

  private applyTurnDelta(profile: RoomMoodProfile): RoomMoodProfile {
  const baseSeed = ((profile.turn_marker + (this.roomMoodTurnCounter / 991)) % 1) || 0.001;
  const phase = baseSeed * Math.PI * 2;
  const jitter = 0.0048 + 0.0028 * Math.abs(profile.heat_haze - 0.5);
  const entropyJitter = clamp01(profile.entropy * 1.5);
  const noise = turnMutationOffset(baseSeed);

  const jittered: RoomMoodProfile = {
    ...profile,
    turn_marker: baseSeed,
    scanline_power: clamp01(profile.scanline_power + Math.sin(phase) * jitter + entropyJitter * 0.022),
    chromatic_split: clamp01(profile.chromatic_split + Math.cos(phase * 1.13) * jitter + entropyJitter * 0.018),
    doom_bloom: clamp01(profile.doom_bloom + Math.sin(phase * 0.9) * 0.01 + entropyJitter * 0.015),
    temp_bias: clampTempBias(profile.temp_bias + Math.sin(phase + baseSeed) * 1.1 + noise * 0.9),
    heat_haze: clamp01(profile.heat_haze + Math.cos(phase) * 0.008 + entropyJitter * 0.009),
    phase_glow: clamp01(profile.phase_glow + Math.sin(phase * 0.8) * 0.006 + entropyJitter * 0.025),
    scanline_phase: profile.scanline_phase + Math.cos(phase) * 0.13,
  };

    return this.enforceTurnMutationDelta(jittered, baseSeed);
  }

  private enforceTurnMutationDelta(profile: RoomMoodProfile, seed: number): RoomMoodProfile {
    const base = this.roomMoodCurrent;
    const scale = this.reducedEffectsProfile ? 0.7 : 1;
    const channelBounds: Record<MoodScalarChannel, [number, number]> = {
      scanline_power: [0, 1],
      chromatic_split: [0, 1],
      doom_bloom: [0, 1],
      temp_bias: [-26, 26],
      heat_haze: [0, 1],
    };
    const required = {
      ...profile,
      scanline_power: resolveBoundedChannel(profile.scanline_power, 0, 1),
      chromatic_split: resolveBoundedChannel(profile.chromatic_split, 0, 1),
      doom_bloom: resolveBoundedChannel(profile.doom_bloom, 0, 1),
      temp_bias: resolveBoundedChannel(profile.temp_bias, -26, 26),
      heat_haze: resolveBoundedChannel(profile.heat_haze, 0, 1),
    };

    let mutated = required;
    const magnitude = calculateMoodDeltaMagnitude(base, required);
    const floors = {
      scanline_power: ROOM_MOOD_MUTATION.scanline_power * scale,
      chromatic_split: ROOM_MOOD_MUTATION.chromatic_split * scale,
      doom_bloom: ROOM_MOOD_MUTATION.doom_bloom * scale,
      temp_bias: ROOM_MOOD_MUTATION.temp_bias * scale,
      heat_haze: ROOM_MOOD_MUTATION.heat_haze * scale,
    };

    const hasMotion = ROOM_MOOD_HARD_CHANNELS.some((channel) => {
      return Math.abs(mutated[channel] - base[channel]) >= floors[channel];
    });

    if (!hasMotion || !Number.isFinite(magnitude) || magnitude < 0.002) {
      let fallbackMutations = 0;
      for (let index = 0; index < ROOM_MOOD_HARD_CHANNELS.length; index += 1) {
        const channel = ROOM_MOOD_HARD_CHANNELS[(index + Math.floor(seed * 12)) % ROOM_MOOD_HARD_CHANNELS.length];
        const direction = turnMutationOffset(seed * 2 + index * 0.77) >= 0 ? 1 : -1;
        const floor = floors[channel];
        const current = base[channel];
        const bounds = channelBounds[channel];
        const pushPositive = resolveBoundedChannel(current + floor * direction, bounds[0], bounds[1]);
        const pushNegative = resolveBoundedChannel(current - floor * direction, bounds[0], bounds[1]);
        const nextValue = Math.abs(pushPositive - current) >= Math.abs(pushNegative - current) ? pushPositive : pushNegative;
        mutated = { ...mutated, [channel]: nextValue };
        fallbackMutations += 1;

        if (Math.abs(mutated[channel] - current) >= floor * 0.6) {
          if (fallbackMutations >= 2) {
            break;
          }
        }
      }
    }

    this.roomMoodLastMutationDelta = calculateMoodDeltaMagnitude(base, mutated);
    this.roomMoodLastGuaranteedShift = calculateMoodDeltaMagnitude(base, mutated) >= 0.003;

    return mutated;
  }

  private setRoomMoodTarget(next: RoomMoodProfile): void {
    this.roomMoodTurnCounter += 1;
    const jittered = this.applyTurnDelta(next);
    const signature = moodSignature(jittered);

    this.roomMoodTransitionFrom = cloneProfile(this.roomMoodCurrent);
    this.roomMoodTransitionTo = cloneProfile(jittered);
    this.roomMoodTransitionStartMs = performance.now();
    const confidence = clamp01(jittered.confidence);
    this.roomMoodTransitionDurationMs = 300 + Math.round((1 - confidence) * 240);
    this.roomMoodLastSignature = signature;

    this.dynamicWorld.setVisualProfile({
      orb: jittered.prop_orb,
      pillar: jittered.prop_pillar,
      shard: jittered.prop_shard,
      ribbon: jittered.prop_ribbon,
      echo_cube: jittered.prop_echo_cube,
      distortion: jittered.distortion,
    });
  }

  private updateRoomMood(nowMs: number): void {
    const elapsed = nowMs - this.roomMoodTransitionStartMs;
    const duration = Math.max(180, this.roomMoodTransitionDurationMs);
    const blend = duration <= 0 ? 1 : clamp01(elapsed / duration);
    this.roomMoodCurrent = lerpProfile(this.roomMoodTransitionFrom, this.roomMoodTransitionTo, blend);

    this.applyRoomMoodStyles(this.roomMoodCurrent, nowMs);
  }

  private applyRoomMoodStyles(profile: RoomMoodProfile, nowMs: number): void {
    const time = nowMs * 0.001;
    const effective = this.applyPerformanceMoodBudget(profile);
    const pulse = 1 + Math.sin(time * 0.25 * (effective.wave_speed + 0.05)) * effective.pulse_amp * 0.06;
    const wobble = Math.sin(time * 0.85 + this.roomMoodWobbleSeed) * effective.motion_amp * 0.008;
    const targetColor = applyTemperatureShift(
      scaleMoodColor(effective.background, pulse),
      effective.temp_bias + effective.heat_haze * 2,
    );
    const roomTint = applyTemperatureShift(scaleMoodColor(effective.room, 1 + wobble * 2), effective.temp_bias * 0.7);
    const scanlineShift = nowMs * 0.12 * (0.45 + effective.scanline_power) + effective.scanline_phase;

    if (nowMs - this.roomMoodLastWriteMs < 16) {
      return;
    }
    this.roomMoodLastWriteMs = nowMs;

    const docRoot = document.documentElement;
    const uiRoot = this.root;
    docRoot.style.setProperty("--room-base", colorToRgba(targetColor));
    docRoot.style.setProperty("--room-room", colorToRgba(roomTint));
    docRoot.style.setProperty("--room-room-stroke", colorToRgba(effective.room_stroke));
    docRoot.style.setProperty("--room-rabbit", colorToRgba(effective.rabbit));
    docRoot.style.setProperty("--room-player", colorToRgba(effective.player));
    docRoot.style.setProperty("--room-doorline", colorToRgba(effective.doorline));
    docRoot.style.setProperty("--room-vignette", colorToRgba(effective.vignette));
    docRoot.style.setProperty("--room-chroma", colorToRgba(effective.chroma));
    docRoot.style.setProperty("--room-grain", colorToRgba(effective.grain));
    docRoot.style.setProperty("--room-temp", `${Math.round(effective.temp_bias)}deg`);
    docRoot.style.setProperty("--room-doom-bloom", effective.doom_bloom.toFixed(4));
    docRoot.style.setProperty("--room-scanline", effective.scanline_power.toFixed(4));
    docRoot.style.setProperty("--room-rgb-split", (effective.chromatic_split * 8).toFixed(4));
    docRoot.style.setProperty("--room-heat-haze", effective.heat_haze.toFixed(4));
    docRoot.style.setProperty("--room-phase-glow", effective.phase_glow.toFixed(4));
    docRoot.style.setProperty("--room-scanline-phase", `${scanlineShift}`);
    uiRoot.style.setProperty("--room-base", colorToRgba(targetColor));
    uiRoot.style.setProperty("--room-room", colorToRgba(roomTint));
    uiRoot.style.setProperty("--room-room-stroke", colorToRgba(effective.room_stroke));
    uiRoot.style.setProperty("--room-rabbit", colorToRgba(effective.rabbit));
    uiRoot.style.setProperty("--room-player", colorToRgba(effective.player));
    uiRoot.style.setProperty("--room-doorline", colorToRgba(effective.doorline));
    uiRoot.style.setProperty("--room-vignette", colorToRgba(effective.vignette));
    uiRoot.style.setProperty("--room-chroma", colorToRgba(effective.chroma));
    uiRoot.style.setProperty("--room-grain", colorToRgba(effective.grain));
    uiRoot.style.setProperty("--room-temp", `${Math.round(effective.temp_bias)}deg`);
    uiRoot.style.setProperty("--room-doom-bloom", effective.doom_bloom.toFixed(4));
    uiRoot.style.setProperty("--room-scanline", effective.scanline_power.toFixed(4));
    uiRoot.style.setProperty("--room-rgb-split", (effective.chromatic_split * 8).toFixed(4));
    uiRoot.style.setProperty("--room-heat-haze", effective.heat_haze.toFixed(4));
    uiRoot.style.setProperty("--room-phase-glow", effective.phase_glow.toFixed(4));
    uiRoot.style.setProperty("--room-scanline-phase", `${scanlineShift}`);

    const morph = this.morphFrame;
    const vBlend = clamp01(effective.vignette_opacity + morph.ui.vignette * 0.85);
    const cBlend = clamp01(effective.chroma_opacity + morph.ui.chroma * 1.2);
    const gBlend = clamp01(effective.grain_opacity + morph.ui.jitter * 0.12 + (this.reducedEffectsProfile ? 0.02 : 0.05));
    const scanBlend = clamp01(effective.scanline_power * 0.88 + effective.phase_glow * 0.54);
    const lensBlend = clamp01(effective.doom_bloom + morph.ui.vignette * 0.4 + effective.heat_haze * 0.74);
    const splitBlend = clamp01(effective.chromatic_split + morph.ui.chroma * 0.05);

    this.vignetteEl.style.opacity = String(vBlend);
    this.chromaEl.style.opacity = String(cBlend);
    this.grainEl.style.opacity = String(gBlend);
    this.doomScanlineEl.style.opacity = String(scanBlend);
    this.doomScanlineEl.style.transform = `translateY(${Math.sin(scanlineShift).toFixed(3)}px)`;
    this.doomRgbSplitEl.style.opacity = String(splitBlend);
    this.doomRgbSplitEl.style.transform = `translateX(${(Math.sin(scanlineShift + effective.scanline_phase) * 4 * effective.chromatic_split).toFixed(
      3,
    )}px)`;
    this.doomLensEl.style.opacity = String(lensBlend);
    this.doomLensEl.style.transform = `scale(${1 + effective.phase_glow * 0.12 + effective.heat_haze * 0.08})`;
    this.subtitleEl.style.color = "var(--cog-ink)";
  }

  private applyPerformanceMoodBudget(profile: RoomMoodProfile): RoomMoodProfile {
    if (!this.reducedEffectsProfile) {
      return profile;
    }

    return {
      ...profile,
      scanline_power: clamp01(profile.scanline_power * 0.58 + 0.04),
      chromatic_split: clamp01(profile.chromatic_split * 0.56 + 0.02),
      doom_bloom: clamp01(profile.doom_bloom * 0.45 + 0.03),
      temp_bias: profile.temp_bias * 0.75,
      heat_haze: clamp01(profile.heat_haze * 0.55 + 0.02),
      phase_glow: clamp01(profile.phase_glow * 0.45),
      chroma_opacity: clamp01(profile.chroma_opacity * 0.55),
      grain_opacity: clamp01(profile.grain_opacity * 0.45),
      vignette_opacity: clamp01(profile.vignette_opacity * 0.75 + 0.03),
      scanline_phase: profile.scanline_phase,
    };
  }

  private applyMorph(morph: MorphFrame): void {
    const mood = this.roomMoodCurrent;
    const vBlend = clamp01(mood.vignette_opacity + morph.ui.vignette * 0.85);
    const cBlend = clamp01(mood.chroma_opacity + morph.ui.chroma * 1.2);
    const gBlend = clamp01(mood.grain_opacity + morph.ui.jitter * 0.12 + (this.reducedEffectsProfile ? 0.02 : 0.05));

    this.vignetteEl.style.opacity = String(vBlend);
    this.chromaEl.style.opacity = String(cBlend);
    this.grainEl.style.opacity = String(gBlend);
    this.subtitleEl.style.transform = `translateY(${morph.ui.jitter * 5}px)`;
  }

  private applyReducedEffectsProfile(morph: MorphFrame): MorphFrame {
    return {
      light: {
        exposure: Math.min(morph.light.exposure, 0.55),
        toplight: Math.min(morph.light.toplight, 0.58),
        halo: Math.min(morph.light.halo, 0.6),
      },
      geometry: {
        skew: morph.geometry.skew * 0.45,
        wave: morph.geometry.wave * 0.45,
      },
      props: morph.props,
      audio: {
        heartbeat: Math.min(morph.audio.heartbeat, 0.35),
        hum: Math.min(morph.audio.hum, 0.35),
      },
      ui: {
        vignette: Math.min(morph.ui.vignette, 0.4),
        jitter: Math.min(morph.ui.jitter, 0.08),
        chroma: Math.min(morph.ui.chroma, 0.03),
      },
      activeRecipeIds: morph.activeRecipeIds.includes("PERF_REDUCED_PROFILE")
        ? morph.activeRecipeIds
        : [...morph.activeRecipeIds, "PERF_REDUCED_PROFILE"],
    };
  }

  private applyCalmImmediateClamp(): void {
    this.chromaEl.style.opacity = "0";
    this.vignetteEl.style.opacity = String(Math.min(0.2, this.roomMoodCurrent.vignette_opacity));
    this.subtitleEl.style.transform = "translateY(0px)";
  }

  private updateInteractionUi(): void {
    if (this.runtimeMode !== "Explore") {
      this.interactionPromptEl.classList.remove("visible");
      return;
    }

    const player = this.controller.getPosition(this.playerPositionBuffer);
    const evaluation = this.interaction.evaluate(player, this.rabbitPosition);
    this.canInteract = evaluation.can_interact;
    if (evaluation.can_interact) {
      this.interactionPromptEl.textContent = "Press E to interact";
      this.interactionPromptEl.classList.add("visible");
    } else {
      this.interactionPromptEl.classList.remove("visible");
    }
  }

  private renderScene(nowMs: number): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const mood = this.roomMoodCurrent;
    const morph = this.morphFrame;
    const time = nowMs * 0.001;
    const roomPulse = 1 + Math.sin(time * 0.3 * (mood.wave_speed + 0.2)) * mood.pulse_amp * 0.045;
    const roomDrift = Math.sin(time * 0.5 * (mood.wave_speed + 0.4) + this.roomMoodWobbleSeed) * mood.motion_amp * 4;
    const roomHeat = mood.heat_haze + mood.phase_glow;
    const roomTemp = mood.temp_bias + roomHeat * 16;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colorToRgba(applyTemperatureShift(scaleMoodColor(mood.background, roomPulse), roomTemp));
    ctx.fillRect(0, 0, width, height);

    const waveOffset = Math.sin(time * 1.2 * (mood.wave_speed + 0.3)) * (4 + mood.motion_amp * 6 + morph.geometry.wave * 6);
    ctx.save();
    ctx.translate(waveOffset, 0);
    ctx.fillStyle = colorToRgba(
      applyTemperatureShift(
        scaleMoodColor({ ...mood.room, a: mood.room.a }, roomPulse + roomDrift * 0.0006),
        roomTemp + mood.phase_glow * 8,
      ),
    );
    ctx.strokeStyle = colorToRgba(mood.room_stroke);
    ctx.lineWidth = 2;
    ctx.fillRect(this.roomRect.x, this.roomRect.y, this.roomRect.width, this.roomRect.height);
    ctx.strokeRect(this.roomRect.x, this.roomRect.y, this.roomRect.width, this.roomRect.height);
    ctx.restore();

    const doorlineOpacity = clamp01(mood.vignette_opacity + morph.props.doorline * 0.6 + morph.ui.jitter * 0.08);
    ctx.strokeStyle = `rgba(${clamp255(mood.doorline.r)}, ${clamp255(mood.doorline.g)}, ${clamp255(mood.doorline.b)}, ${clamp01(
      mood.doorline.a * (0.2 + doorlineOpacity),
    )})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.roomRect.x + this.roomRect.width * 0.42, this.roomRect.y + 8);
    ctx.lineTo(this.roomRect.x + this.roomRect.width * 0.58, this.roomRect.y + 8);
    ctx.stroke();

    this.dynamicWorld.draw(ctx, nowMs);

    const rabbitPulse = 1 + Math.sin(nowMs * 0.0022) * 0.03;
    const rabbitR = this.rabbitRadius * rabbitPulse;
    ctx.fillStyle = colorToRgba(scaleMoodColor(mood.rabbit, 1 + Math.sin(time * 0.9) * 0.02));
    ctx.beginPath();
    ctx.arc(this.rabbitPosition.x, this.rabbitPosition.y, rabbitR, 0, Math.PI * 2);
    ctx.fill();

    const eyeIntensity = 0.28 + morph.props.eyes * 0.5;
    const emotionalRed = clamp255(255 - mood.doorline.r * 0.2);
    const emotionalGreen = clamp255(78 + mood.wave_speed * 8);
    const emotionalBlue = clamp255(52 + mood.motion_amp * 40);
    ctx.fillStyle = `rgba(${emotionalRed}, ${emotionalGreen}, ${emotionalBlue}, ${eyeIntensity})`;
    ctx.beginPath();
    ctx.arc(this.rabbitPosition.x - 12, this.rabbitPosition.y - 8, 4, 0, Math.PI * 2);
    ctx.arc(this.rabbitPosition.x + 12, this.rabbitPosition.y - 8, 4, 0, Math.PI * 2);
    ctx.fill();

    const player = this.controller.getPosition(this.playerPositionBuffer);
    ctx.fillStyle = colorToRgba(mood.player);
    ctx.beginPath();
    ctx.arc(player.x, player.y, this.playerRadius, 0, Math.PI * 2);
    ctx.fill();

    if (this.runtimeMode === "Explore" && this.canInteract) {
      ctx.strokeStyle = colorToRgba(scaleMoodColor(mood.chroma, 0.8));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.rabbitPosition.x, this.rabbitPosition.y, 90, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private finishSession(ending: string): void {
    this.ended = true;
    this.queue.clear();
    this.clearRetryTimer();
    this.dynamicWorld.clear();
    this.controller.setEnabled(false);
    this.setRuntimeMode("EndingLocked");
    this.subtitleEl.textContent = `Ending resolved: ${ending}. Session closed.`;
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    if (this.runtimeMode !== "DialogueActive" || this.ended) {
      return;
    }
    const delay = this.queue.getNextDelayMs();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.runQueuedTurn();
    }, delay);
  }

  private async runQueuedTurn(): Promise<void> {
    if (this.processing || this.runtimeMode !== "DialogueActive" || this.ended) {
      return;
    }
    const pending = this.queue.peek();
    if (!pending) {
      return;
    }
    await this.runTurnInternal(pending.text);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setRuntimeMode(mode: RuntimeMode): void {
    this.runtimeMode = mode;
    this.exploreOverlayEl.classList.toggle("hidden", mode !== "Explore");
    this.dialogueOverlayEl.classList.toggle("hidden", mode !== "DialogueActive");
    this.inputEl.disabled = mode !== "DialogueActive" || this.ended;
    this.sendButton.disabled = mode !== "DialogueActive" || this.ended;
    this.voiceButton.disabled = mode !== "DialogueActive" || this.ended || this.processing;
  }

  private setLlmStatus(text: string, tone: LlmStatusTone): void {
    this.llmStatusEl.textContent = text;
    this.llmStatusEl.classList.toggle("llm-status-ok", tone === "ok");
    this.llmStatusEl.classList.toggle("llm-status-warn", tone === "warn");
  }

  private setUserEcho(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      this.userEchoEl.textContent = "You: <silence>";
      this.userEchoEl.classList.add("last-user-echo-muted");
      return;
    }
    this.userEchoEl.textContent = `You: ${trimmed.slice(0, 220)}`;
    this.userEchoEl.classList.remove("last-user-echo-muted");
  }

  private toggleDebugOverlay(): void {
    this.debugOverlay.toggle();
    this.syncDebugToggleUi();
  }

  private syncDebugToggleUi(): void {
    const visible = this.debugOverlay.isVisible();
    this.debugToggleButton.textContent = visible ? "Hide Debug" : "Show Debug";
    this.debugToggleButton.classList.toggle("active", visible);
    this.debugToggleButton.setAttribute("aria-pressed", String(visible));
  }

  private animate = (): void => {
    const frameNow = performance.now();
    const frameDeltaMs = Math.max(0, frameNow - this.lastFrameTimestampMs);
    this.lastFrameTimestampMs = frameNow;
    this.reducedEffectsProfile = this.frameRateSafety.sampleFrame(frameDeltaMs);
    this.updateRoomMood(frameNow);

    if (!this.ended && this.runtimeMode === "Explore") {
      this.controller.update(frameDeltaMs / 1000);
      this.updateInteractionUi();
    }

    const player = this.controller.getPosition(this.playerPositionBuffer);
    const roomCenter = {
      x: this.roomRect.x + this.roomRect.width * 0.5,
      y: this.roomRect.y + this.roomRect.height * 0.5,
    };
    this.dynamicWorld.update(frameNow, frameDeltaMs / 1000, {
      rabbit: this.rabbitPosition,
      player,
      room: roomCenter,
    });

    const elapsed = this.clock.elapsedMs();
    const remaining = Math.max(0, balance.session_hard_limit_ms - elapsed);
    const min = String(Math.floor(remaining / 60000)).padStart(2, "0");
    const sec = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
    this.timerEl.textContent = `${min}:${sec}`;
    this.timerEl.classList.toggle("warn", remaining <= 30000);

    this.renderScene(frameNow);

    if (!this.ended && elapsed >= balance.session_hard_limit_ms) {
      this.finishSession("ESCAPE_A");
    }

    if (
      !this.ended &&
      this.runtimeMode === "DialogueActive" &&
      !this.processing &&
      !this.forcedFinalAutoPrompted &&
      elapsed >= 270000
    ) {
      this.forcedFinalAutoPrompted = true;
      void this.enqueueOrRunTurn("");
    }

    requestAnimationFrame(this.animate);
  };

  private async refreshHealth(): Promise<void> {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const data = (await res.json()) as {
        providers?: {
          llm?: string;
          stt?: string;
          tts?: string;
        };
      };
      if (data.providers) {
        this.providerStatus.llm = data.providers.llm ?? this.providerStatus.llm;
        this.providerStatus.stt = data.providers.stt ?? this.providerStatus.stt;
        this.providerStatus.tts = data.providers.tts ?? this.providerStatus.tts;
      }
      if (runtimeTransport.getChoice() === "local_bridge") {
        await runtimeTransport.refreshBridgeStatus();
      }
      this.updateRuntimeStatusBadge();
    } catch {
      // non-blocking for gameplay
    }
  }
}
