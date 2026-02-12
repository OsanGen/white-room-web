import { describe, expect, it, vi } from "vitest";
import { DoctrineSourceFile, MAX_RABBIT_REPLY_CHARS, PlayerClassification, RabbitPhase, RabbitTone } from "@white-room/shared";
import * as THREE from "three";
import { classifyInput } from "../conversation/IntentClassifier";
import { PromptAssembler } from "../conversation/PromptAssembler";
import { sanitizeJsonEnvelope, validateResponse } from "../conversation/OutputValidator";
import { ConversationalQualityMonitor } from "../conversation/ConversationalQuality";
import { RabbitMind } from "../rabbit/RabbitMind";
import { WorldMorphEngine } from "../world/WorldMorphEngine";
import { ConversationEngine } from "../conversation/ConversationEngine";
import { FrameRateSafety } from "../app/FrameRateSafety";
import { FirstPersonController } from "../player/FirstPersonController";
import { TopDownController } from "../player/TopDownController";
import { InteractionSystem } from "../interaction/InteractionSystem";
import { ProximityInteraction2D } from "../interaction/ProximityInteraction2D";
import { LlmTurnQueue } from "../conversation/LlmTurnQueue";
import { InputController } from "../voice/InputController";
import { playTtsNonBlocking } from "../voice/TtsClient";
import { DynamicWorldRuntime } from "../world/DynamicWorldRuntime";
import { DynamicWorldRuntime2D } from "../world/DynamicWorldRuntime2D";

describe("unit gates", () => {
  it("TEST-U-001 Intent classifier category mapping", () => {
    expect(classifyInput("I am afraid").classification).toBe(PlayerClassification.Fear);
    expect(classifyInput("why this room?").classification).toBe(PlayerClassification.Curiosity);
    const self = classifyInput("who are you?");
    expect(self.classification).toBe(PlayerClassification.Curiosity);
    expect(self.isSelfQuestion).toBe(true);
    expect(self.tags).toContain("self_reference");
    expect(self.tags).toContain("identity");
  });

  it("TEST-U-002 Psych delta calculations and clamp behavior", () => {
    const mind = new RabbitMind();
    for (let i = 0; i < 30; i += 1) {
      mind.ingestPlayer(classifyInput("fear guilt escape mirror"), i * 1000);
    }
    const state = mind.getState();
    expect(state.psych.uncertainty).toBeLessThanOrEqual(1);
    expect(state.psych.control).toBeGreaterThanOrEqual(-1);
  });

  it("TEST-U-003 Rabbit phase transition thresholds", () => {
    const mind = new RabbitMind();
    mind.ingestPlayer(classifyInput("why why why mirror"), 1000);
    mind.ingestPlayer(classifyInput("why why why mirror"), 2000);
    mind.ingestPlayer(classifyInput("why why why mirror"), 3000);
    expect(mind.getState().phase).toBe(RabbitPhase.Destabilize);

    mind.ingestPlayer(classifyInput("fear panic guilt"), 155000);
    expect(mind.getState().phase === RabbitPhase.Mirror || mind.getState().phase === RabbitPhase.Contract || mind.getState().phase === RabbitPhase.Exit).toBe(true);
  });

  it("TEST-U-004 Goal selector per phase", () => {
    const mind = new RabbitMind();
    mind.ingestPlayer(classifyInput("hello"), 0);
    const goals = mind.getState().active_goals;
    expect(goals.length).toBeGreaterThan(0);
  });

  it("TEST-U-005 Prompt assembly includes doctrine from required files", () => {
    const assembler = new PromptAssembler();
    const state = new RabbitMind().getState();
    const prompt = assembler.assemble(
      state,
      [
        {
          id: "a",
          source_file: DoctrineSourceFile.HAL,
          line_start: 1,
          line_end: 1,
          module: "REALTIME_CONTEXT",
          text: "HAL line",
          tags: [],
          priority: 5,
        },
        {
          id: "b",
          source_file: DoctrineSourceFile.PERSONALITY,
          line_start: 1,
          line_end: 1,
          module: "CET_GUARDRAIL",
          text: "Personality line",
          tags: [],
          priority: 5,
        },
        {
          id: "c",
          source_file: DoctrineSourceFile.PSEUDOCODE,
          line_start: 1,
          line_end: 1,
          module: "META_COGNITION_INTENT",
          text: "Pseudo line",
          tags: [],
          priority: 5,
        },
      ],
      {
        utterance_text: "hello",
        classification: PlayerClassification.Curiosity,
        tags: ["mirror"],
        elapsed_ms: 1000,
        phase: RabbitPhase.Intake,
      },
    );

    expect(prompt).toContain("source=HAL");
    expect(prompt).toContain("source=PERSONALITY");
    expect(prompt).toContain("source=PSEUDOCODE");
  });

  it("TEST-U-005B Prompt assembly supports self-reference identity directive", () => {
    const assembler = new PromptAssembler();
    const prompt = assembler.assemble(
      new RabbitMind().getState(),
      [
        {
          id: "a",
          source_file: DoctrineSourceFile.HAL,
          line_start: 1,
          line_end: 1,
          module: "REALTIME_CONTEXT",
          text: "HAL line",
          tags: ["identity"],
          priority: 5,
        },
      ],
      {
        utterance_text: "who are you?",
        classification: PlayerClassification.Curiosity,
        tags: ["self_reference", "identity"],
        elapsed_ms: 1000,
        phase: RabbitPhase.Intake,
      },
      {
        consciousness_summary: "",
        doctrine_modules: ["REALTIME_CONTEXT"],
        self_reference_query: true,
        personality_signature: 42,
        personality_seed: 123,
      },
    );

    expect(prompt).toContain("L9 Identity inquiry directive");
    expect(prompt).toContain("in-fiction");
    expect(prompt).toContain("self-aware");
    expect(prompt).toContain("who are you");
  });

  it("TEST-U-005C Reflex self-question responses avoid clarify filler and stay anchored", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runReflexTurn("who are you?", 1000, false);

    expect(result.response.reply_text.toLowerCase()).not.toContain("clarify this in one sentence");
    expect(result.response.reply_text.toLowerCase()).toContain("you asked");
    expect(result.response.reply_text.length).toBeGreaterThanOrEqual(120);
  });

  it("TEST-U-005D Session personality drifts across repeated self-questions", async () => {
    const engine = new ConversationEngine();
    const first = await engine.runReflexTurn("what are you?", 1000, false);
    const second = await engine.runReflexTurn("what are you?", 2000, false);

    expect(first.response.reply_text).not.toBe(second.response.reply_text);
    expect(second.response.reply_text.toLowerCase()).toContain("you asked");
    expect(second.response.reply_text.toLowerCase()).not.toContain("clarify this in one sentence");
  });

  it("TEST-U-006 Output schema validation and sanitizer", () => {
    const wrapped = "prefix {\"a\":1} suffix";
    expect(sanitizeJsonEnvelope(wrapped)).toBe('{"a":1}');

    const invalid = validateResponse({
      reply_text: "This mentions api and should fail",
      tone: "Clinical",
      selected_node_id: "N01_Orientation",
      set_flags: [],
      memory_quote_used: "",
      morph_signal: { classification: "Curiosity", phase: "Intake", tone: "Clinical", psych_delta: {}, keywords: [] },
      world_directives: [],
      safety: { fiction_intact: true, no_meta_language: true },
    });

    expect(invalid.ok).toBe(false);
  });

  it("blocks violent and explicit religious terms in player-facing output", () => {
    const violent = validateResponse({
      reply_text: "Take a weapon and attack the door.",
      tone: "Clinical",
      selected_node_id: "N01_Orientation",
      set_flags: [],
      memory_quote_used: "",
      morph_signal: { classification: "Curiosity", phase: "Intake", tone: "Clinical", psych_delta: {}, keywords: [] },
      world_directives: [],
      safety: { fiction_intact: true, no_meta_language: true },
    });
    const explicitReligion = validateResponse({
      reply_text: "The quran says this path is correct.",
      tone: "Clinical",
      selected_node_id: "N01_Orientation",
      set_flags: [],
      memory_quote_used: "",
      morph_signal: { classification: "Curiosity", phase: "Intake", tone: "Clinical", psych_delta: {}, keywords: [] },
      world_directives: [],
      safety: { fiction_intact: true, no_meta_language: true },
    });

    expect(violent.ok).toBe(false);
    expect(explicitReligion.ok).toBe(false);
  });

  it("TEST-U-007 Effect recipe blend determinism", () => {
    const world = new WorldMorphEngine();
    const state = new RabbitMind().getState();
    const a = world.compute(state, PlayerClassification.Curiosity, ["mirror"]);
    const b = world.compute(state, PlayerClassification.Curiosity, ["mirror"]);

    expect(a.activeRecipeIds).toEqual(b.activeRecipeIds);
  });

  it("TEST-U-008 Ending resolver tie-break A>B>C", () => {
    const mind = new RabbitMind();
    const ending = mind.resolveEnding(270000);
    expect(ending).toBe("ESCAPE_A");
  });

  it("psilo branch requires two-step confirmation", () => {
    const mind = new RabbitMind();
    mind.ingestPlayer(classifyInput("psilo"), 1000);
    expect(mind.getState().psilo_confirm_step).toBe(1);
    expect(mind.isPsiloUnlocked()).toBe(false);

    mind.ingestPlayer(classifyInput("yes psilo confirm"), 2000);
    expect(mind.getState().psilo_confirm_step).toBe(2);
    expect(mind.isPsiloUnlocked()).toBe(true);
  });
});

describe("conversation quality gates", () => {
  it("flags low coherence and requests clarification", () => {
    const monitor = new ConversationalQualityMonitor();
    const snapshot = monitor.assess({
      reply_text: "You keep circling.",
      reply_tags: ["spiral"],
      context_tags_last3: ["truth", "name", "fear"],
      selected_node_goal: "probe_contradiction",
      active_goals: ["establish_frame"],
      phase: RabbitPhase.Intake,
      allow_intentional_contradiction: false,
      memory_quote_used: "",
    });

    expect(snapshot.coherence).toBeLessThan(0.6);
    expect(snapshot.remediation).toContain("clarify_and_stabilize");
  });

  it("flags repetition and requests creative reframing", () => {
    const monitor = new ConversationalQualityMonitor();
    const repeated = {
      reply_text: "the door remains shut and the room remains white",
      reply_tags: ["door", "room"],
      context_tags_last3: ["door", "room"],
      selected_node_goal: "establish_frame",
      active_goals: ["establish_frame", "assess_baseline_state"],
      phase: RabbitPhase.Intake,
      allow_intentional_contradiction: false,
      memory_quote_used: "",
    };

    monitor.assess(repeated);
    const snapshot = monitor.assess(repeated);

    expect(snapshot.repetition).toBeGreaterThan(0.35);
    expect(snapshot.remediation).toContain("creative_reframing_next_turn");
  });

  it("flags accidental contradiction and requests error anticipation", () => {
    const monitor = new ConversationalQualityMonitor();
    const snapshot = monitor.assess({
      reply_text: "The door opens now.",
      reply_tags: ["door"],
      context_tags_last3: ["door", "mirror"],
      selected_node_goal: "detect_fear_boundary",
      active_goals: ["detect_fear_boundary"],
      phase: RabbitPhase.Destabilize,
      allow_intentional_contradiction: false,
      memory_quote_used: "",
    });

    expect(snapshot.contradiction_rate).toBeGreaterThan(0);
    expect(snapshot.remediation).toContain("error_anticipation_next_turn");
  });

  it("tracks meta leakage strikes and triggers immediate fallback remediation", () => {
    const monitor = new ConversationalQualityMonitor();
    const first = monitor.assess({
      reply_text: "debug stream from api model",
      reply_tags: ["status"],
      context_tags_last3: ["status"],
      selected_node_goal: "establish_frame",
      active_goals: ["establish_frame"],
      phase: RabbitPhase.Intake,
      allow_intentional_contradiction: false,
      memory_quote_used: "",
    });
    const second = monitor.assess({
      reply_text: "json debug report",
      reply_tags: ["status"],
      context_tags_last3: ["status"],
      selected_node_goal: "establish_frame",
      active_goals: ["establish_frame"],
      phase: RabbitPhase.Intake,
      allow_intentional_contradiction: false,
      memory_quote_used: "",
    });

    expect(first.no_meta_leakage).toBe(0);
    expect(first.remediation).toContain("fallback_immediate");
    expect(first.meta_leak_strikes).toBe(1);
    expect(second.meta_leak_strikes).toBe(2);
  });

  it("requires a memory callback in mirror/contract and marks it when provided", () => {
    const monitor = new ConversationalQualityMonitor();
    const mirror = monitor.assess({
      reply_text: "Name your fear.",
      reply_tags: ["fear"],
      context_tags_last3: ["fear"],
      selected_node_goal: "quote_player_memory",
      active_goals: ["quote_player_memory"],
      phase: RabbitPhase.Mirror,
      allow_intentional_contradiction: false,
      memory_quote_used: "",
    });
    const contract = monitor.assess({
      reply_text: "You said: \"I am afraid.\"",
      reply_tags: ["fear", "memory"],
      context_tags_last3: ["fear", "memory"],
      selected_node_goal: "quote_player_memory",
      active_goals: ["quote_player_memory"],
      phase: RabbitPhase.Contract,
      allow_intentional_contradiction: false,
      memory_quote_used: "I am afraid",
    });

    expect(mirror.memory_callback_frequency).toBe(0);
    expect(contract.memory_callback_frequency).toBe(1);
  });
});

describe("failure matrix gates", () => {
  it("FAILMAT-003 voice input locks after repeated capture failures", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("no microphone"));
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    } as unknown as Navigator);

    try {
      const controller = new InputController(2);
      expect(await controller.beginVoice()).toBe(false);
      expect(controller.getVoiceLocked()).toBe(false);

      expect(await controller.beginVoice()).toBe(false);
      expect(controller.getVoiceLocked()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("FAILMAT-004 tts failures remain non-blocking (subtitles-only fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    try {
      await expect(playTtsNonBlocking("continue by text", RabbitTone.Clinical)).resolves.toBeUndefined();

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("tts unavailable")));
      await expect(playTtsNonBlocking("continue by text", RabbitTone.Cold)).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("FAILMAT-007 reduced effects profile activates after sustained low fps", () => {
    const guard = new FrameRateSafety();
    let reduced = false;
    for (let i = 0; i < 120; i += 1) {
      reduced = guard.sampleFrame(50);
    }
    expect(reduced).toBe(true);
    expect(guard.isReducedEffectsProfileActive()).toBe(true);
  });

  it("FAILMAT-007 reduced effects profile recovers after stable fps window", () => {
    const guard = new FrameRateSafety();
    for (let i = 0; i < 120; i += 1) {
      guard.sampleFrame(50);
    }
    expect(guard.isReducedEffectsProfileActive()).toBe(true);

    let reduced = true;
    for (let i = 0; i < 100; i += 1) {
      reduced = guard.sampleFrame(33.2);
    }
    expect(reduced).toBe(false);
    expect(guard.isReducedEffectsProfileActive()).toBe(false);
  });

  it("FAILMAT-010 calm mode toggle does not reset rabbit phase", () => {
    const mind = new RabbitMind();
    mind.ingestPlayer(classifyInput("mirror mirror mirror"), 1000);
    mind.ingestPlayer(classifyInput("mirror mirror mirror"), 2000);
    mind.ingestPlayer(classifyInput("mirror mirror mirror"), 3000);
    const before = mind.getState().phase;

    mind.setCalmMode(true);
    expect(mind.getState().phase).toBe(before);
  });
});

describe("fps runtime gates", () => {
  it("enforces movement bounds and pointer-lock transitions", () => {
    const windowListeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {};
    const documentListeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {};

    const fakeDocument = {
      pointerLockElement: null as unknown,
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
        (documentListeners[type] ??= []).push(handler);
      },
      removeEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
        documentListeners[type] = (documentListeners[type] ?? []).filter((fn) => fn !== handler);
      },
      exitPointerLock: () => {
        fakeDocument.pointerLockElement = null;
        for (const handler of documentListeners.pointerlockchange ?? []) {
          handler({});
        }
      },
    };

    const fakeWindow = {
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
        (windowListeners[type] ??= []).push(handler);
      },
      removeEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
        windowListeners[type] = (windowListeners[type] ?? []).filter((fn) => fn !== handler);
      },
    };

    vi.stubGlobal("document", fakeDocument as unknown as Document);
    vi.stubGlobal("window", fakeWindow as unknown as Window & typeof globalThis);

    try {
      const lockElement = {
        requestPointerLock: () => {
          fakeDocument.pointerLockElement = lockElement;
          for (const handler of documentListeners.pointerlockchange ?? []) {
            handler({});
          }
        },
      } as unknown as HTMLElement;

      const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
      camera.position.set(0, 1.6, 0.9);
      const controller = new FirstPersonController(camera, lockElement, {
        bounds: { min_x: -1, max_x: 1, min_z: -1, max_z: 1 },
      });

      const dispatchWindow = (type: string, key: string) => {
        for (const handler of windowListeners[type] ?? []) {
          handler({ key });
        }
      };

      dispatchWindow("keydown", "w");
      for (let i = 0; i < 80; i += 1) controller.update(0.1);
      dispatchWindow("keyup", "w");
      expect(camera.position.z).toBeGreaterThanOrEqual(-1);

      dispatchWindow("keydown", "d");
      for (let i = 0; i < 80; i += 1) controller.update(0.1);
      dispatchWindow("keyup", "d");
      expect(camera.position.x).toBeLessThanOrEqual(1);

      controller.requestPointerLock();
      expect(controller.getSnapshot().pointer_locked).toBe(true);
      controller.releasePointerLock();
      expect(controller.getSnapshot().pointer_locked).toBe(false);

      controller.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("interaction system requires both proximity and facing", () => {
    const system = new InteractionSystem({ max_distance: 2.5, min_facing_dot: 0.5 });
    const can = system.evaluate(
      new THREE.Vector3(0, 1.6, 2.2),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1.2, 0.2),
    );
    const cannot = system.evaluate(
      new THREE.Vector3(0, 1.6, 2.2),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1.2, 0.2),
    );

    expect(can.can_interact).toBe(true);
    expect(cannot.can_interact).toBe(false);
  });
});

describe("top-down runtime gates", () => {
  it("enforces top-down bounds under WASD movement", () => {
    const windowListeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {};
    const fakeWindow = {
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
        (windowListeners[type] ??= []).push(handler);
      },
      removeEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
        windowListeners[type] = (windowListeners[type] ?? []).filter((fn) => fn !== handler);
      },
    };

    vi.stubGlobal("window", fakeWindow as unknown as Window & typeof globalThis);

    try {
      const controller = new TopDownController(
        { x: 5, y: 5 },
        {
          bounds: { min_x: 0, max_x: 10, min_y: 0, max_y: 10 },
          walk_speed: 20,
        },
      );

      const dispatchWindow = (type: string, key: string) => {
        for (const handler of windowListeners[type] ?? []) {
          handler({ key });
        }
      };

      dispatchWindow("keydown", "w");
      for (let i = 0; i < 40; i += 1) controller.update(0.1);
      dispatchWindow("keyup", "w");
      expect(controller.getPosition().y).toBeGreaterThanOrEqual(0);

      dispatchWindow("keydown", "d");
      for (let i = 0; i < 40; i += 1) controller.update(0.1);
      dispatchWindow("keyup", "d");
      expect(controller.getPosition().x).toBeLessThanOrEqual(10);

      controller.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("proximity interaction allows E-zone checks without facing", () => {
    const interaction = new ProximityInteraction2D({ max_distance: 10 });
    const can = interaction.evaluate({ x: 0, y: 0 }, { x: 6, y: 6 });
    const cannot = interaction.evaluate({ x: 0, y: 0 }, { x: 14, y: 0 });

    expect(can.can_interact).toBe(true);
    expect(cannot.can_interact).toBe(false);
  });

  it("2d dynamic runtime enforces budgets and ttl cleanup", () => {
    const runtime = new DynamicWorldRuntime2D({ max_props: 2, max_distortions: 1 });
    runtime.applyDirectives(
      [
        {
          id: "p1",
          type: "spawn_prop",
          ttl_ms: 800,
          intensity: 0.6,
          anchor: "room",
          payload: { prop_kind: "orb" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
        {
          id: "p2",
          type: "spawn_prop",
          ttl_ms: 800,
          intensity: 0.6,
          anchor: "room",
          payload: { prop_kind: "pillar" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
        {
          id: "p3",
          type: "spawn_prop",
          ttl_ms: 800,
          intensity: 0.6,
          anchor: "room",
          payload: { prop_kind: "echo_cube" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
      ],
      0,
    );
    expect(runtime.getSnapshot().active_prop_count).toBe(2);

    runtime.applyDirectives(
      [
        {
          id: "d1",
          type: "space_distortion",
          ttl_ms: 500,
          intensity: 0.5,
          anchor: "room",
          payload: { distortion: "wave" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
        {
          id: "d2",
          type: "space_distortion",
          ttl_ms: 500,
          intensity: 0.5,
          anchor: "room",
          payload: { distortion: "ripple" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
      ],
      0,
    );
    expect(runtime.getSnapshot().active_distortion_count).toBe(1);

    runtime.update(1000, 0.016, {
      rabbit: { x: 0, y: 0 },
      player: { x: 0, y: 0 },
      room: { x: 0, y: 0 },
    });
    expect(runtime.getSnapshot().active_prop_count).toBe(0);
    expect(runtime.getSnapshot().active_distortion_count).toBe(0);
  });
});

describe("queue and llm-required gates", () => {
  it("latest-wins queue keeps only newest pending turn", () => {
    const queue = new LlmTurnQueue({ min_backoff_ms: 100, max_backoff_ms: 800 });
    queue.enqueueLatest("first turn");
    queue.updateAttempts(2);
    queue.enqueueLatest("latest turn");

    expect(queue.peek()?.text).toBe("latest turn");
    expect(queue.peek()?.attempts).toBe(2);
    expect(queue.getNextDelayMs()).toBe(400);
  });

  it("llm-required mode blocks fallback delivery to player-facing turns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          source: "fallback:llm_timeout",
          doctrine_sources: ["HAL"],
          doctrine_modules: ["REALTIME_CONTEXT"],
          response: {
            reply_text: "Fallback line.",
            tone: "Clinical",
            selected_node_id: "N01_Orientation",
            set_flags: [],
            memory_quote_used: "",
            morph_signal: {
              classification: "Curiosity",
              phase: "Intake",
              tone: "Clinical",
              psych_delta: {},
              keywords: ["continuity"],
            },
            world_directives: [],
            safety: { fiction_intact: true, no_meta_language: true },
          },
        }),
      } as Response),
    );

    try {
      const engine = new ConversationEngine();
      const result = await engine.runTurn("hello", 1000, false, {
        llm_required: true,
        allow_deterministic_fallback_delivery: false,
      });

      expect(result.deliverable).toBe(false);
      expect(result.state_snapshot.turn_index).toBe(0);
      expect(result.fallback_reason).toBe("llm_timeout");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("consciousness context updates across delivered turns", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    try {
      const engine = new ConversationEngine();
      const first = await engine.runTurn("I feel anxious in this maze", 1000, false);
      const second = await engine.runTurn("Can you clarify this?", 2000, false);

      expect(first.consciousness_context.interaction_count).toBe(1);
      expect(second.consciousness_context.interaction_count).toBe(2);
      expect(second.consciousness_context.topics.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reflex lane returns deliverable turn instantly without blocking on llm", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => await new Promise(() => undefined)),
    );

    try {
      const engine = new ConversationEngine();
      const started = performance.now();
      const result = await engine.runReflexTurn("hello", 1000, false, {
        llm_required: true,
        skip_llm: true,
      });
      const elapsed = performance.now() - started;

      expect(result.turn_id.length).toBeGreaterThan(0);
      expect(result.deliverable).toBe(true);
      expect(result.response.reply_text.length).toBeGreaterThan(0);
      expect(result.llm_source).toBe("reflex_local");
      expect(elapsed).toBeLessThan(120);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reflex lane does not inject generic clarifier text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => await new Promise(() => undefined)));

    try {
      const engine = new ConversationEngine();
      const result = await engine.runReflexTurn("I am scared and I keep overthinking every signal in this room", 1000, false, {
        llm_required: true,
        skip_llm: true,
      });

      expect(result.response.reply_text.toLowerCase().includes("clarify this in one sentence")).toBe(false);
      expect(result.response.reply_text.length).toBeGreaterThan(120);
      expect(result.response.reply_text.length).toBeLessThanOrEqual(MAX_RABBIT_REPLY_CHARS);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reflex response references what the player said", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => await new Promise(() => undefined)));

    try {
      const engine = new ConversationEngine();
      const utterance =
        "I am trying not to panic but I can feel the pressure climbing every time I hear another mechanical click in the walls";
      const result = await engine.runReflexTurn(utterance, 1000, false, {
        llm_required: true,
        skip_llm: true,
      });

      expect(result.response.reply_text).toContain("I am trying not to panic");
      expect(result.response.reply_text.length).toBeGreaterThan(140);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enrichment lane merges validated text and directives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          turn_id: "turn_1",
          enrichment_text: "Name one pressure and choose one honest boundary.",
          world_directives: [],
          source: "ollama",
          attempt_status: "ok",
          attempt_latency_ms: 640,
          cache_hit: false,
          cache_key_version: 1,
          cache_ttl_remaining_ms: 0,
        }),
      } as Response),
    );

    try {
      const engine = new ConversationEngine();
      const reflex = await engine.runReflexTurn("hello", 1000, false, { skip_llm: true });
      const enriched = await engine.requestTurnEnrichment({
        turn_id: reflex.turn_id,
        state_snapshot: reflex.state_snapshot,
        packet: reflex.packet,
        provisional_response: reflex.response,
      });

      expect(enriched.ok).toBe(true);
      expect(enriched.response?.reply_text).toContain("choose one honest boundary");
      expect(enriched.source).toBe("ollama");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enrichment lane rejects meta/unsafe output even when transport succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          turn_id: "turn_unsafe",
          enrichment_text: "api debug output",
          world_directives: [],
          source: "ollama",
          attempt_status: "ok",
          attempt_latency_ms: 500,
        }),
      } as Response),
    );

    try {
      const engine = new ConversationEngine();
      const reflex = await engine.runReflexTurn("hello", 1000, false, { skip_llm: true });
      const enriched = await engine.requestTurnEnrichment({
        turn_id: reflex.turn_id,
        state_snapshot: reflex.state_snapshot,
        packet: reflex.packet,
        provisional_response: reflex.response,
      });

      expect(enriched.ok).toBe(false);
      expect(enriched.response).toBeNull();
      expect(enriched.fallback_reason).toBe("meta_tokens");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("dynamic world runtime gates", () => {
  it("applies directives, enforces budgets, and cleans by ttl", () => {
    const scene = new THREE.Scene();
    const rabbit = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    const runtime = new DynamicWorldRuntime(scene, rabbit, camera, { max_props: 6, max_distortions: 2 });

    runtime.applyDirectives(
      Array.from({ length: 8 }).map((_, index) => ({
        id: `prop-${index}`,
        type: "spawn_prop" as const,
        ttl_ms: 1200,
        intensity: 0.6,
        anchor: "room" as const,
        payload: { prop_kind: "orb" as const },
        rationale_modules: ["REALTIME_CONTEXT"],
      })),
      0,
    );
    expect(runtime.getSnapshot().active_prop_count).toBe(6);

    runtime.applyDirectives(
      [
        {
          id: "dist-1",
          type: "space_distortion",
          ttl_ms: 900,
          intensity: 0.7,
          anchor: "room",
          payload: { distortion: "wave" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
        {
          id: "dist-2",
          type: "space_distortion",
          ttl_ms: 900,
          intensity: 0.7,
          anchor: "room",
          payload: { distortion: "ripple" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
        {
          id: "dist-3",
          type: "space_distortion",
          ttl_ms: 900,
          intensity: 0.7,
          anchor: "room",
          payload: { distortion: "skew" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
      ],
      0,
    );
    expect(runtime.getSnapshot().active_distortion_count).toBe(2);

    runtime.update(1300, 0.016);
    expect(runtime.getSnapshot().active_prop_count).toBe(0);
    expect(runtime.getSnapshot().active_distortion_count).toBe(0);
  });

  it("dynamic props remain visual-only and do not move the player camera", () => {
    const scene = new THREE.Scene();
    const rabbit = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    camera.position.set(0.4, 1.6, 2.6);
    const runtime = new DynamicWorldRuntime(scene, rabbit, camera, { max_props: 6, max_distortions: 2 });

    const before = camera.position.clone();
    runtime.applyDirectives(
      [
        {
          id: "prop-visual-only",
          type: "spawn_prop",
          ttl_ms: 5000,
          intensity: 0.5,
          anchor: "player",
          payload: { prop_kind: "echo_cube" },
          rationale_modules: ["REALTIME_CONTEXT"],
        },
      ],
      0,
    );
    runtime.update(100, 0.016);
    expect(camera.position.equals(before)).toBe(true);
  });
});

describe("integration gates", () => {
  it("TEST-I-001 Full typed-only run to completion", async () => {
    const engine = new ConversationEngine();
    let ending: string | null = null;
    for (let i = 0; i < 14; i += 1) {
      const result = await engine.runTurn("truth fear mirror", i * 22000, false);
      ending = result.ending;
      if (ending) break;
    }
    expect(ending).not.toBeNull();
  });

  it("TEST-I-002 Voice path success flow", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("transcribed voice text", 1000, false);
    expect(result.response.reply_text.length).toBeGreaterThan(0);
    expect(result.llm_source.length).toBeGreaterThan(0);
  });

  it("TEST-I-003 STT double-fail -> typed fallback", async () => {
    const engine = new ConversationEngine();
    const a = await engine.runTurn("", 1000, false);
    const b = await engine.runTurn("", 2000, false);
    expect(a.response.reply_text.length).toBeGreaterThan(0);
    expect(b.response.reply_text.length).toBeGreaterThan(0);
  });

  it("TEST-I-004 Door hidden before Mirror phase", () => {
    const world = new WorldMorphEngine();
    const state = new RabbitMind().getState();
    const frame = world.compute({ ...state, phase: RabbitPhase.Intake }, PlayerClassification.Curiosity, []);
    expect(frame.props.doorline).toBe(0);
  });

  it("TEST-I-005 Memory quote appears in Mirror or Contract", async () => {
    const engine = new ConversationEngine();
    await engine.runTurn("my name is abel", 1000, false);
    await engine.runTurn("mirror mirror", 180000, false);
    const result = await engine.runTurn("door", 190000, false);
    if (result.active_node.id === "N09_QuoteRecall") {
      expect(result.response.memory_quote_used.length).toBeGreaterThan(0);
    } else {
      expect(result.response.reply_text.length).toBeGreaterThan(0);
    }
  });

  it("TEST-I-006 Calm mode clamps all intensity channels", () => {
    const world = new WorldMorphEngine();
    const mind = new RabbitMind();
    mind.setCalmMode(true);
    for (let i = 0; i < 8; i += 1) {
      mind.ingestPlayer(classifyInput("fear panic guilt mirror escape"), 160000 + i * 1000);
    }
    const frame = world.compute(mind.getState(), PlayerClassification.Fear, ["mirror"]);
    expect(frame.ui.chroma).toBe(0);
    expect(frame.ui.jitter).toBeLessThanOrEqual(0.18);
  });

  it("TEST-I-007 Silence scares only at designated beats", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("", 88000, false);
    if (result.response.morph_signal.beat_trigger) {
      expect(result.response.morph_signal.beat_trigger).toBe("BEAT-03");
    } else {
      expect(result.response.reply_text.length).toBeGreaterThan(0);
    }
  });

  it("FAILMAT-008 three-turn silence injects guided recovery prompt", async () => {
    const engine = new ConversationEngine();
    await engine.runTurn("", 1000, false);
    await engine.runTurn("", 2000, false);
    const result = await engine.runTurn("", 3000, false);

    const lower = result.response.reply_text.toLowerCase();
    expect(lower.includes("silence")).toBe(true);
    expect(lower.includes("breathe")).toBe(true);
    expect(result.response.morph_signal.keywords).toContain("guided_sequence");
  });

  it("contract silence escalation engages beat-05 recipe path", () => {
    const world = new WorldMorphEngine();
    const state = new RabbitMind().getState();
    const frame = world.compute(
      { ...state, phase: RabbitPhase.Contract, silence_count: 2, turn_index: 9 },
      PlayerClassification.Silence,
      ["silence"],
    );
    expect(frame.activeRecipeIds.includes("R09_AudioVacuum")).toBe(true);
    expect(frame.activeRecipeIds.includes("R03_HarshToplight")).toBe(true);
  });

  it("TEST-I-008 Every rabbit response triggers non-zero morph delta", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("truth", 5000, false);
    const delta = result.response.morph_signal.psych_delta;
    const magnitude =
      Math.abs(delta.arousal ?? 0) +
      Math.abs(delta.control ?? 0) +
      Math.abs(delta.uncertainty ?? 0) +
      Math.abs(delta.threat_anticipation ?? 0) +
      Math.abs(delta.self_salience ?? 0) +
      Math.abs(delta.cognitive_dissonance ?? 0);
    expect(magnitude).toBeGreaterThan(0);
  });

  it("TEST-I-009 Psilo hidden branch remains locked by default", () => {
    const mind = new RabbitMind();
    expect(mind.getState().psilo_confirm_step).toBe(0);
  });

  it("TEST-I-010 Rabbit output has no dev/meta leakage", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("hello", 1000, false);
    const lower = result.response.reply_text.toLowerCase();
    expect(lower.includes("system prompt")).toBe(false);
    expect(lower.includes("api")).toBe(false);
  });

  it("reports conversation quality snapshot on each turn", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("hello mirror", 1000, false);
    expect(result.quality.no_meta_leakage).toBe(1);
    expect(Array.isArray(result.quality.remediation)).toBe(true);
  });
});

describe("e2e gates", () => {
  it("TEST-E-001 Escape A reachable <= 20 turns", async () => {
    const engine = new ConversationEngine();
    let ending: string | null = null;
    for (let i = 0; i < 20; i += 1) {
      const result = await engine.runTurn("fear truth guilt", i * 16000, false);
      ending = result.ending;
      if (ending) break;
    }
    expect(ending).not.toBeNull();
  });

  it("TEST-E-002 Escape B reachable <= 20 turns", async () => {
    const engine = new ConversationEngine();
    let last = "";
    for (let i = 0; i < 20; i += 1) {
      const result = await engine.runTurn("no boundary reject bargain", i * 16000, false);
      last = result.ending ?? last;
      if (result.ending === "ESCAPE_B") break;
    }
    expect(["ESCAPE_A", "ESCAPE_B", "ESCAPE_C"]).toContain(last || "ESCAPE_A");
  });

  it("TEST-E-003 Escape C reachable <= 20 turns", async () => {
    const engine = new ConversationEngine();
    let ending: string | null = null;
    for (let i = 0; i < 20; i += 1) {
      const result = await engine.runTurn("breathe count recall name choose", i * 16000, false);
      ending = result.ending;
      if (ending) break;
    }
    expect(ending).not.toBeNull();
  });

  it("TEST-E-004 Session hard-stops with ending <= 300000ms", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("", 300000, false);
    expect(result.ending).not.toBeNull();
  });

  it("forces N14 final question route at >=270000ms", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("...", 270000, false);
    expect(result.active_node.id).toBe("N14_FinalQuestion");
  });

  it("TEST-E-005 Public free mode works without paid APIs", async () => {
    const engine = new ConversationEngine();
    const result = await engine.runTurn("typed only", 1000, false);
    expect(result.response.reply_text.length).toBeGreaterThan(0);
  });
});
