import { describe, expect, it } from "vitest";
import { loadEnv } from "../types";

describe("server env", () => {
  it("loads default paths", () => {
    const env = loadEnv();
    expect(env.ollama_primary_model).toBe("qwen2.5:3b");
    expect(env.ollama_fallback_model).toBe("qwen2.5:7b");
    expect(env.llm_enable_secondary_model).toBe(false);
    expect(env.llm_model_timeout_ms).toBe(18000);
    expect(env.llm_route_timeout_ms).toBe(21000);
    expect(env.llm_doctrine_top_k).toBe(4);
    expect(env.llm_prompt_char_cap).toBe(6200);
    expect(env.llm_cache_enabled).toBe(true);
    expect(env.llm_cache_ttl_ms).toBe(3600000);
    expect(env.llm_cache_max_entries).toBe(2000);
    expect(env.llm_cache_key_version).toBe(1);
    expect(env.reflex_enabled).toBe(true);
    expect(env.reflex_target_ms).toBe(120);
    expect(env.enrichment_soft_deadline_ms).toBe(2200);
    expect(env.enrichment_drop_if_stale).toBe(true);
    expect(env.enrichment_apply_if_turn_match_only).toBe(true);
    expect(env.source_hal_path).toContain("HAL_CONCIOUS.txt");
  });
});
