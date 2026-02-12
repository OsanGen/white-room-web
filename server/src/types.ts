import path from "node:path";

export interface ServerEnv {
  port: number;
  ollama_url: string;
  ollama_primary_model: string;
  ollama_fallback_model: string;
  llm_enable_secondary_model: boolean;
  llama_cpp_url: string;
  llm_model_timeout_ms: number;
  llm_route_timeout_ms: number;
  llm_doctrine_top_k: number;
  llm_prompt_char_cap: number;
  llm_cache_enabled: boolean;
  llm_cache_ttl_ms: number;
  llm_cache_max_entries: number;
  llm_cache_key_version: number;
  reflex_enabled: boolean;
  reflex_target_ms: number;
  enrichment_soft_deadline_ms: number;
  enrichment_drop_if_stale: boolean;
  enrichment_apply_if_turn_match_only: boolean;
  bridge_session_ttl_ms: number;
  bridge_request_timeout_ms: number;
  stt_timeout_ms: number;
  tts_timeout_ms: number;
  whisper_cli: string;
  whisper_model_path: string;
  piper_cli: string;
  piper_model_path: string;
  piper_config_path: string;
  espeak_cli: string;
  source_hal_path: string;
  source_personality_path: string;
  source_pseudocode_path: string;
}

export function loadEnv(): ServerEnv {
  const halRoot = process.env.HAL_ROOT ?? "/Users/abelsanchez/CODEX/HAL 2.0";
  const bool = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    return value === "1" || value.toLowerCase() === "true";
  };

  return {
    port: Number(process.env.PORT ?? 8787),
    ollama_url: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    ollama_primary_model: process.env.OLLAMA_PRIMARY_MODEL ?? "qwen2.5:3b",
    ollama_fallback_model: process.env.OLLAMA_FALLBACK_MODEL ?? "qwen2.5:7b",
    llm_enable_secondary_model: bool(process.env.LLM_ENABLE_SECONDARY_MODEL, false),
    llama_cpp_url: process.env.LLAMA_CPP_URL ?? "http://127.0.0.1:8080",
    llm_model_timeout_ms: Number(process.env.LLM_MODEL_TIMEOUT_MS ?? process.env.LLM_TIMEOUT_MS ?? 18000),
    llm_route_timeout_ms: Number(process.env.LLM_ROUTE_TIMEOUT_MS ?? 21000),
    llm_doctrine_top_k: Number(process.env.LLM_DOCTRINE_TOP_K ?? 4),
    llm_prompt_char_cap: Number(process.env.LLM_PROMPT_CHAR_CAP ?? 6200),
    llm_cache_enabled: bool(process.env.LLM_CACHE_ENABLED, true),
    llm_cache_ttl_ms: Number(process.env.LLM_CACHE_TTL_MS ?? 3600000),
    llm_cache_max_entries: Number(process.env.LLM_CACHE_MAX_ENTRIES ?? 2000),
    llm_cache_key_version: Number(process.env.LLM_CACHE_KEY_VERSION ?? 1),
    reflex_enabled: bool(process.env.REFLEX_ENABLED, true),
    reflex_target_ms: Number(process.env.REFLEX_TARGET_MS ?? 120),
    enrichment_soft_deadline_ms: Number(process.env.ENRICHMENT_SOFT_DEADLINE_MS ?? 2200),
    enrichment_drop_if_stale: bool(process.env.ENRICHMENT_DROP_IF_STALE, true),
    enrichment_apply_if_turn_match_only: bool(process.env.ENRICHMENT_APPLY_IF_TURN_MATCH_ONLY, true),
    bridge_session_ttl_ms: Number(process.env.BRIDGE_SESSION_TTL_MS ?? 900000),
    bridge_request_timeout_ms: Number(process.env.BRIDGE_REQUEST_TIMEOUT_MS ?? 21000),
    stt_timeout_ms: Number(process.env.STT_TIMEOUT_MS ?? 5000),
    tts_timeout_ms: Number(process.env.TTS_TIMEOUT_MS ?? 2500),
    whisper_cli: process.env.WHISPER_CLI ?? "whisper-cli",
    whisper_model_path: process.env.WHISPER_MODEL_PATH ?? "",
    piper_cli: process.env.PIPER_CLI ?? "python3 -m piper",
    piper_model_path: process.env.PIPER_MODEL_PATH ?? "",
    piper_config_path: process.env.PIPER_CONFIG_PATH ?? "",
    espeak_cli: process.env.ESPEAK_CLI ?? "espeak-ng",
    source_hal_path: process.env.SOURCE_HAL_PATH ?? path.join(halRoot, "HAL_CONCIOUS.txt"),
    source_personality_path: process.env.SOURCE_PERSONALITY_PATH ?? path.join(halRoot, "J_PERSONALITY.txt"),
    source_pseudocode_path: process.env.SOURCE_PSEUDOCODE_PATH ?? path.join(halRoot, "J_PSEUDOCODE.txt"),
  };
}
