import { describe, expect, it } from "vitest";
import { PlayerClassification, RabbitPhase, RabbitTone, type RabbitResponse } from "@white-room/shared";
import { LlmTurnCache, type LlmTurnCacheKeyInput } from "../cache/LlmTurnCache";

function baseKeyInput(overrides: Partial<LlmTurnCacheKeyInput> = {}): LlmTurnCacheKeyInput {
  return {
    model_name: "qwen2.5:3b",
    phase: RabbitPhase.Intake,
    classification: PlayerClassification.Curiosity,
    utterance_text: "Hello Rabbit",
    tags: ["CheckIn", "Mirror"],
    trust: 35,
    threat: 15,
    curiosity: 22,
    tone: RabbitTone.Clinical,
    doctrine_modules: ["REALTIME_CONTEXT", "SELF_REFLECTION"],
    doctrine_sources: ["HAL", "PSEUDOCODE"],
    doctrine_top_k: 4,
    prompt_char_cap: 6200,
    calm_mode: false,
    ...overrides,
  };
}

const response: RabbitResponse = {
  reply_text: "Start with one true sentence.",
  tone: RabbitTone.Clinical,
  selected_node_id: "N01_Orientation",
  set_flags: [],
  memory_quote_used: "",
  morph_signal: {
    classification: PlayerClassification.Curiosity,
    phase: RabbitPhase.Intake,
    tone: RabbitTone.Clinical,
    psych_delta: {},
    keywords: ["truth"],
  },
  world_directives: [],
  safety: {
    fiction_intact: true,
    no_meta_language: true,
  },
};

describe("llm turn cache", () => {
  it("builds stable keys under canonicalization", () => {
    const cache = new LlmTurnCache({
      enabled: true,
      ttl_ms: 60000,
      max_entries: 20,
      key_version: 1,
    });

    const keyA = cache.buildKey(baseKeyInput());
    const keyB = cache.buildKey(
      baseKeyInput({
        utterance_text: "  hello   rabbit  ",
        tags: ["mirror", "checkin", "checkin"],
        doctrine_modules: ["SELF_REFLECTION", "REALTIME_CONTEXT"],
        doctrine_sources: ["pseudocode", "hal"],
      }),
    );

    expect(keyA).toBe(keyB);
  });

  it("changes keys when doctrine fingerprint changes", () => {
    const cache = new LlmTurnCache({
      enabled: true,
      ttl_ms: 60000,
      max_entries: 20,
      key_version: 1,
    });

    const base = cache.buildKey(baseKeyInput());
    const changedTopK = cache.buildKey(baseKeyInput({ doctrine_top_k: 5 }));
    const changedModule = cache.buildKey(baseKeyInput({ doctrine_modules: ["REALTIME_CONTEXT"] }));

    expect(changedTopK).not.toBe(base);
    expect(changedModule).not.toBe(base);
  });

  it("expires entries after ttl", async () => {
    const cache = new LlmTurnCache({
      enabled: true,
      ttl_ms: 20,
      max_entries: 20,
      key_version: 1,
    });

    const key = cache.buildKey(baseKeyInput());
    cache.write({
      key,
      response,
      model_name: "qwen2.5:3b",
      source: "ollama",
    });

    expect(cache.read(key).hit).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(cache.read(key).hit).toBe(false);
  });

  it("enforces strict lru eviction", () => {
    const cache = new LlmTurnCache({
      enabled: true,
      ttl_ms: 60000,
      max_entries: 2,
      key_version: 1,
    });

    const keyA = cache.buildKey(baseKeyInput({ utterance_text: "a" }));
    const keyB = cache.buildKey(baseKeyInput({ utterance_text: "b" }));
    const keyC = cache.buildKey(baseKeyInput({ utterance_text: "c" }));

    cache.write({ key: keyA, response, model_name: "qwen2.5:3b", source: "ollama" });
    cache.write({ key: keyB, response, model_name: "qwen2.5:3b", source: "ollama" });

    // Touch A so B becomes oldest.
    expect(cache.read(keyA).hit).toBe(true);
    cache.write({ key: keyC, response, model_name: "qwen2.5:3b", source: "ollama" });

    expect(cache.read(keyB).hit).toBe(false);
    expect(cache.read(keyA).hit).toBe(true);
    expect(cache.read(keyC).hit).toBe(true);
  });

  it("does not store entries when disabled", () => {
    const cache = new LlmTurnCache({
      enabled: false,
      ttl_ms: 60000,
      max_entries: 20,
      key_version: 1,
    });

    const key = cache.buildKey(baseKeyInput());
    cache.write({
      key,
      response,
      model_name: "qwen2.5:3b",
      source: "ollama",
    });

    expect(cache.size()).toBe(0);
    expect(cache.read(key).hit).toBe(false);
  });
});
