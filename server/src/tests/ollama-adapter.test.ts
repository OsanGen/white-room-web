import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaAdapter } from "../adapters/OllamaAdapter";
import type { ServerEnv } from "../types";

function env(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    port: 8787,
    ollama_url: "http://127.0.0.1:11434",
    ollama_primary_model: "qwen2.5:3b",
    ollama_fallback_model: "qwen2.5:7b",
    llm_enable_secondary_model: false,
    llama_cpp_url: "http://127.0.0.1:8080",
    llm_model_timeout_ms: 20,
    llm_route_timeout_ms: 21000,
    llm_doctrine_top_k: 4,
    llm_prompt_char_cap: 6200,
    llm_cache_enabled: true,
    llm_cache_ttl_ms: 3600000,
    llm_cache_max_entries: 2000,
    llm_cache_key_version: 1,
    reflex_enabled: true,
    reflex_target_ms: 120,
    enrichment_soft_deadline_ms: 2200,
    enrichment_drop_if_stale: true,
    enrichment_apply_if_turn_match_only: true,
    bridge_session_ttl_ms: 900000,
    bridge_request_timeout_ms: 21000,
    stt_timeout_ms: 5000,
    tts_timeout_ms: 2500,
    whisper_cli: "whisper-cli",
    whisper_model_path: "",
    piper_cli: "python3 -m piper",
    piper_model_path: "",
    piper_config_path: "",
    espeak_cli: "espeak-ng",
    source_hal_path: "HAL_CONCIOUS.txt",
    source_personality_path: "J_PERSONALITY.txt",
    source_pseudocode_path: "J_PSEUDOCODE.txt",
    ...overrides,
  };
}

const request = {
  state: {
    phase: "Intake",
    tone: "Clinical",
    trust: 35,
    threat: 15,
    curiosity: 20,
    memory: [],
    last_tags: [],
    active_goals: ["establish_frame"],
    psych: {
      uncertainty: 0,
      control: 0,
      arousal: 0,
      threat_anticipation: 0,
      self_salience: 0,
      cognitive_dissonance: 0,
    },
    elapsed_ms: 0,
    turn_index: 0,
    llm_reject_count: 0,
    calm_mode: false,
    silence_count: 0,
    psilo_confirm_step: 0,
    final_question_asked: false,
  },
  packet: {
    utterance_text: "hello",
    classification: "Curiosity",
    tags: ["checkin"],
    elapsed_ms: 1000,
    phase: "Intake",
  },
  prompt: "test",
  schema: { type: "object" },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ollama adapter statuses", () => {
  it("returns timeout status for stalled primary request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => await new Promise(() => undefined)));
    const adapter = new OllamaAdapter(env({ llm_model_timeout_ms: 5 }));
    const result = await adapter.generate(request as never);
    expect(result.attempts.length).toBe(1);
    expect(result.attempts[0].attempt_status).toBe("timeout");
  });

  it("returns parse_error when model returns non-json text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response: "plain sentence" }),
      } as Response),
    );
    const adapter = new OllamaAdapter(env());
    const result = await adapter.generate(request as never);
    expect(result.attempts[0].attempt_status).toBe("parse_error");
    expect(typeof result.attempts[0].output).toBe("string");
  });

  it("does not run secondary model when disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } as Response),
    );
    const adapter = new OllamaAdapter(env({ llm_enable_secondary_model: false }));
    const result = await adapter.generate(request as never);
    expect(result.attempts.length).toBe(1);
  });

  it("runs fallback model when enabled and primary fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ response: JSON.stringify({ reply_text: "ok" }) }),
        } as Response),
    );
    const adapter = new OllamaAdapter(env({ llm_enable_secondary_model: true }));
    const result = await adapter.generate(request as never);
    expect(result.attempts.length).toBe(2);
    expect(result.attempts[1].attempt_status).toBe("ok");
  });
});
