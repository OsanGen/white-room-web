import { describe, expect, it } from "vitest";
import { RabbitPhase, RabbitTone, type RabbitState } from "@white-room/shared";
import type { ConsciousnessRuntimeContext } from "../conversation/ConsciousnessRuntimeContext";
import { composeTurnTrippyProfile } from "../app/RoomMoodTrippyMapper";

function createContext(overrides: Partial<ConsciousnessRuntimeContext>): ConsciousnessRuntimeContext {
  return {
    topics: [],
    emotional_state: overrides.emotional_state ?? "neutral",
    multi_emotional_state: overrides.multi_emotional_state ?? { neutral: 1 },
    symbolic_elements: [],
    subconscious_patterns: {},
    unresolved_questions: [],
    preferred_tone: "neutral",
    reflection_log: [],
    recognized_intents: [],
    persona_vector: {
      irony: 0.4,
      warmth: 0.4,
      dark_humor: 0.35,
      curiosity_drive: 0.55,
      self_reflection_drive: 0.6,
      improvisation: 0.45,
    },
    interaction_count: 0,
    adaptation_flag: "normal",
    ...overrides,
  };
}

function createState(overrides: Partial<RabbitState> = {}): RabbitState {
  const defaultPsych = {
    uncertainty: 0.2,
    control: 0,
    arousal: 0.1,
    threat_anticipation: 0.1,
    self_salience: 0.1,
    cognitive_dissonance: 0.1,
  };

  return {
    phase: RabbitPhase.Intake,
    tone: RabbitTone.Clinical,
    trust: 32,
    threat: 19,
    curiosity: 58,
    memory: [],
    last_tags: [],
    active_goals: ["establish_frame"],
    turn_index: 0,
    llm_reject_count: 0,
    calm_mode: false,
    silence_count: 0,
    psilo_confirm_step: 0,
    final_question_asked: false,
    elapsed_ms: 0,
    ...overrides,
    psych: { ...defaultPsych, ...(overrides.psych ?? {}) },
  };
}

describe("room mood trippy mapper", () => {
  it("always produces deterministic turn entropy for repeated prompts", () => {
    const context = createContext({ emotional_state: "threat", multi_emotional_state: { threat: 1 } });
    const state = createState({ threat: 82, turn_index: 1 });

    const first = composeTurnTrippyProfile({
      context,
      state,
      phase: RabbitPhase.Mirror,
      turnId: "turn-001",
      utteranceText: "I am scared",
      tags: ["fear", "mirror"],
      calmMode: false,
      confidence: 0.72,
    });

    const second = composeTurnTrippyProfile({
      context,
      state,
      phase: RabbitPhase.Mirror,
      turnId: "turn-002",
      utteranceText: "I am scared",
      tags: ["fear", "mirror"],
      calmMode: false,
      confidence: 0.72,
    });

    expect(first.turn_marker).not.toBe(second.turn_marker);
    expect(first.scanline_power).toBeGreaterThan(0);
    expect(first.scanline_power).toBeLessThanOrEqual(1);
    expect(first.scanline_power).not.toBe(second.scanline_power);
  });

  it("injects deterministic per-turn motion even on identical semantic input", () => {
    const context = createContext({
      emotional_state: "neutral",
      multi_emotional_state: { neutral: 1 },
    });
    const state = createState();

    const first = composeTurnTrippyProfile({
      context,
      state,
      phase: RabbitPhase.Intake,
      turnId: "repeat-turn",
      utteranceText: "i am ready",
      tags: ["frame"],
      calmMode: false,
      confidence: 0.6,
    });

    const second = composeTurnTrippyProfile({
      context,
      state,
      phase: RabbitPhase.Intake,
      turnId: "repeat-turn",
      utteranceText: "i am ready",
      tags: ["frame"],
      calmMode: false,
      confidence: 0.6,
    });

    expect(second.scanline_power).toBe(first.scanline_power);
    expect(second.chromatic_split).toBe(first.chromatic_split);

    const third = composeTurnTrippyProfile({
      context,
      state,
      phase: RabbitPhase.Intake,
      turnId: "repeat-turn-2",
      utteranceText: "i am ready",
      tags: ["frame"],
      calmMode: false,
      confidence: 0.6,
    });

    const movedChannels =
      first.scanline_power !== third.scanline_power ||
      first.chromatic_split !== third.chromatic_split ||
      first.doom_bloom !== third.doom_bloom ||
      first.temp_bias !== third.temp_bias ||
      first.heat_haze !== third.heat_haze;

    expect(movedChannels).toBe(true);
  });

  it("maps neutral and threat profiles to distinct trippy vectors", () => {
    const neutral = composeTurnTrippyProfile({
      context: createContext({
        emotional_state: "neutral",
        multi_emotional_state: { neutral: 1 },
      }),
      state: createState(),
      phase: RabbitPhase.Intake,
      turnId: "neutral-turn",
      utteranceText: "let us keep moving",
      tags: ["frame"],
      calmMode: false,
      confidence: 0.45,
    });
    const threat = composeTurnTrippyProfile({
      context: createContext({
        emotional_state: "threat",
        multi_emotional_state: { threat: 1 },
      }),
      state: createState({
        phase: RabbitPhase.Destabilize,
        threat: 92,
        psych: {
          uncertainty: 0.74,
          cognitive_dissonance: 0.62,
          threat_anticipation: 0.78,
          arousal: 0.35,
          control: -0.1,
          self_salience: 0.1,
        },
      }),
      phase: RabbitPhase.Destabilize,
      turnId: "threat-turn",
      utteranceText: "the room is closing in",
      tags: ["threat", "destabilize"],
      calmMode: false,
      confidence: 0.45,
    });

    expect(threat.scanline_power).not.toBe(neutral.scanline_power);
    expect(threat.chromatic_split).not.toBe(neutral.chromatic_split);
    expect(Math.abs(threat.temp_bias)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(neutral.temp_bias)).toBeGreaterThanOrEqual(0);
  });

  it("never emits out-of-range trippy controls", () => {
    const profile = composeTurnTrippyProfile({
      context: createContext({
        emotional_state: "sad",
        multi_emotional_state: { sadness: 1 },
      }),
      state: createState({ phase: RabbitPhase.Exit, calm_mode: true }),
      phase: RabbitPhase.Exit,
      turnId: "range-turn",
      utteranceText: "hello there",
      tags: [],
      calmMode: true,
      confidence: 0.9,
    });

    expect(profile.scanline_power).toBeGreaterThanOrEqual(0);
    expect(profile.scanline_power).toBeLessThanOrEqual(1.05);
    expect(profile.chromatic_split).toBeGreaterThanOrEqual(0);
    expect(profile.chromatic_split).toBeLessThanOrEqual(1);
    expect(profile.scanline_phase).toBeGreaterThanOrEqual(0);
  });
});
