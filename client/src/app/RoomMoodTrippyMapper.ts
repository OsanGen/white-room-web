import { RabbitPhase, type RabbitState } from "@white-room/shared";
import type { ConsciousnessRuntimeContext } from "../conversation/ConsciousnessRuntimeContext";

export interface DoomMoodProfileExtension {
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

interface TrippyComposeInput {
  context: ConsciousnessRuntimeContext;
  state: RabbitState;
  phase: RabbitPhase;
  turnId: string;
  utteranceText: string;
  tags: string[];
  calmMode: boolean;
  confidence: number;
}

type EmotionBucket = "neutral" | "anxious" | "threat" | "frustration" | "sadness" | "hope" | "conflict";

const emotionBias: Record<EmotionBucket, { temp: number; scanline: number; split: number; bloom: number; heat: number }> = {
  neutral: { temp: -2, scanline: 0.22, split: 0.19, bloom: 0.12, heat: 0.06 },
  anxious: { temp: -22, scanline: 0.34, split: 0.31, bloom: 0.18, heat: 0.14 },
  threat: { temp: 14, scanline: 0.4, split: 0.39, bloom: 0.21, heat: 0.19 },
  frustration: { temp: 8, scanline: 0.33, split: 0.27, bloom: 0.16, heat: 0.18 },
  sadness: { temp: -12, scanline: 0.24, split: 0.2, bloom: 0.1, heat: 0.07 },
  hope: { temp: 16, scanline: 0.2, split: 0.18, bloom: 0.14, heat: 0.08 },
  conflict: { temp: 26, scanline: 0.36, split: 0.34, bloom: 0.2, heat: 0.17 },
};

function parseMoodLabel(raw: string): EmotionBucket {
  const lc = raw.toLowerCase();
  if (lc.includes("fear") || lc.includes("anxious") || lc.includes("panic") || lc.includes("unsafe")) return "anxious";
  if (lc.includes("threat") || lc.includes("danger") || lc.includes("pressure") || lc.includes("attack")) return "threat";
  if (lc.includes("angry") || lc.includes("frustrat") || lc.includes("defiant")) return "frustration";
  if (lc.includes("sad") || lc.includes("grief") || lc.includes("loss")) return "sadness";
  if (lc.includes("hope") || lc.includes("calm") || lc.includes("resolve")) return "hope";
  if (lc.includes("conflict") || lc.includes("uncertain") || lc.includes("doubt") || lc.includes("mixed")) return "conflict";
  return "neutral";
}

function normalizeEmotionDistribution(context: ConsciousnessRuntimeContext): Record<EmotionBucket, number> {
  const output: Record<EmotionBucket, number> = {
    neutral: 0,
    anxious: 0,
    threat: 0,
    frustration: 0,
    sadness: 0,
    hope: 0,
    conflict: 0,
  };

  for (const [emotion, score] of Object.entries(context.multi_emotional_state)) {
    if (!Number.isFinite(score)) continue;
    const normalized = parseMoodLabel(emotion);
    output[normalized] += Math.max(0, score);
  }

  const fallback = parseMoodLabel(context.emotional_state);
  if (Object.values(output).every((value) => value <= 0)) {
    output[fallback] = 1;
  }

  const total = Object.values(output).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return { ...output, neutral: 1 };
  }

  for (const emotion of Object.keys(output) as EmotionBucket[]) {
    output[emotion] = Math.max(0, output[emotion] / total);
  }

  return output;
}

function hashTurnSeed(input: string): number {
  let hash = 1469598103934665603;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 1099511628211);
  }
  return Number((((hash >>> 0) / 0xffffffff) + 1e-7) % 1);
}

export function seedFromTurn(turnId: string, utteranceText: string, tags: string[], phase: RabbitPhase): number {
  const sortedTags = [...new Set(tags)].sort().join(",");
  const raw = `${turnId}|${utteranceText}|${phase}|${sortedTags}`.toLowerCase();
  return Math.max(0.001, Math.min(0.999, hashTurnSeed(raw)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function blend(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function composeTurnTrippyProfile(input: TrippyComposeInput): DoomMoodProfileExtension {
  const distribution = normalizeEmotionDistribution(input.context);
  const ordered = (Object.entries(distribution) as Array<[EmotionBucket, number]>).filter(([, weight]) => weight > 0);
  const top = ordered.sort((a, b) => b[1] - a[1])[0];

  const primary = top?.[0] ?? "neutral";
  const topWeight = Math.max(0.22, top?.[1] ?? 0.22);
  const secondary = ordered[1]?.[0] ?? primary;
  const secondaryWeight = ordered[1]?.[1] ?? 0;

  const seed = seedFromTurn(input.turnId, input.utteranceText, input.tags, input.phase);
  const seedOsc = (Math.sin(seed * Math.PI * 2) + 1) / 2;
  const uncertainty = clamp01(input.state.psych.uncertainty);
  const dissonance = clamp01(input.state.psych.cognitive_dissonance);
  const threatAnt = clamp01(input.state.psych.threat_anticipation);
  const control = clamp01(input.state.psych.control + 1) / 2;
  const entropy = clamp01((uncertainty + dissonance + Math.abs(input.state.psych.arousal)) / 3);
  const fearDrive = Math.min(1, input.state.threat / 100 + threatAnt * 0.8 + uncertainty * 0.3);
  const calmPenalty = input.calmMode ? 0.56 : 1;

  const base = emotionBias[primary];
  const blendSecondary = emotionBias[secondary];
  const tempBias = blend(base.temp, blendSecondary.temp, secondaryWeight / Math.max(0.22, topWeight + 0.22)) + seedOsc * 14 - 7;

  const scanline = clamp01(blend(base.scanline, blendSecondary.scanline, secondaryWeight / Math.max(0.22, topWeight + 0.22)));
  const split = clamp01(blend(base.split, blendSecondary.split, secondaryWeight / Math.max(0.22, topWeight + 0.22)));
  const bloom = clamp01(blend(base.bloom, blendSecondary.bloom, secondaryWeight / Math.max(0.22, topWeight + 0.22)));

  const phaseBoost = (() => {
    switch (input.phase) {
      case RabbitPhase.Mirror:
        return 0.16;
      case RabbitPhase.Contract:
        return 0.12;
      case RabbitPhase.Destabilize:
        return 0.22;
      case RabbitPhase.Exit:
        return 0.08;
      default:
        return 0;
    }
  })();

  const confidencePenalty = clamp01(1 - clamp01(input.confidence));
  const normalizedThreat = threatAnt * 0.8 + fearDrive * 0.5;
  const phaseGlint = Math.max(0.02, Math.min(0.45, 0.08 + normalizedThreat * 0.5 + phaseBoost + confidencePenalty * 0.22));

  const scanlinePower = clamp01(
    scanline + seed * 0.12 + uncertainty * 0.35 + dissonance * 0.18 + phaseBoost + normalizedThreat * 0.04 + input.state.turn_index * 0.00015,
  );

  const chromaSplitPx = clamp01(
    split + input.state.psych.arousal * 0.08 + fearDrive * 0.2 + entropy * 0.12 + phaseBoost * 0.4 + seed * 0.18,
  );

  const doomBloom = clamp01(bloom + threatAnt * 0.1 + seed * 0.09 + phaseBoost * 0.12 + entropy * 0.06 + uncertainty * 0.12);
  const heatDrive = clamp01(
    clamp01(base.heat + blendSecondary.heat * (secondaryWeight / Math.max(0.22, topWeight + 0.22)) + fearDrive * 0.38 + dissonance * 0.22 + phaseBoost * 0.7 + (1 - control) * 0.2),
  );

  return {
    turn_marker: seed,
    scanline_power: clamp01(scanlinePower * 0.92 + 0.12),
    chromatic_split: clamp01(chromaSplitPx * 0.88 + 0.10),
    doom_bloom: clamp01(doomBloom * 0.7 + 0.06),
    temp_bias: Math.max(-26, Math.min(26, tempBias)),
    heat_haze: clamp01(heatDrive * 0.8 + 0.05),
    phase_glow: clamp01(phaseGlint * calmPenalty),
    entropy,
    scanline_phase: seed * Math.PI * 2,
  };
}
