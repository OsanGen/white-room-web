import { createHash } from "node:crypto";
import { PlayerClassification, RabbitPhase, RabbitResponse, RabbitTone } from "@white-room/shared";

export interface LlmTurnCacheConfig {
  enabled: boolean;
  ttl_ms: number;
  max_entries: number;
  key_version: number;
}

export interface LlmTurnCacheKeyInput {
  model_name: string;
  phase: RabbitPhase;
  classification: PlayerClassification;
  utterance_text: string;
  tags: string[];
  trust: number;
  threat: number;
  curiosity: number;
  tone: RabbitTone;
  doctrine_modules: string[];
  doctrine_sources: string[];
  doctrine_top_k: number;
  prompt_char_cap: number;
  calm_mode: boolean;
}

export interface LlmTurnCacheWriteInput {
  key: string;
  response: RabbitResponse;
  model_name: string | null;
  source: string;
}

export interface LlmTurnCacheReadResult {
  hit: boolean;
  response: RabbitResponse | null;
  model_name: string | null;
  source: string | null;
  cache_ttl_remaining_ms: number;
}

interface CacheEntry {
  response: RabbitResponse;
  model_name: string | null;
  source: string;
  expires_at_ms: number;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeList(values: string[]): string[] {
  const normalized = values.map((value) => normalizeText(value)).filter((value) => value.length > 0);
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function binFive(value: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(100, Math.floor(safe)));
  return Math.floor(clamped / 5) * 5;
}

function cloneResponse(response: RabbitResponse): RabbitResponse {
  return JSON.parse(JSON.stringify(response)) as RabbitResponse;
}

export class LlmTurnCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly config: LlmTurnCacheConfig) {}

  isEnabled(): boolean {
    return this.config.enabled && this.config.max_entries > 0 && this.config.ttl_ms > 0;
  }

  keyVersion(): number {
    return this.config.key_version;
  }

  buildKey(input: LlmTurnCacheKeyInput): string {
    const canonical = {
      schema_version: this.config.key_version,
      model_name: input.model_name,
      phase: input.phase,
      classification: input.classification,
      utterance_text: normalizeText(input.utterance_text),
      tags: normalizeList(input.tags),
      trust_bin: binFive(input.trust),
      threat_bin: binFive(input.threat),
      curiosity_bin: binFive(input.curiosity),
      tone: input.tone,
      doctrine_fingerprint: {
        doctrine_modules: normalizeList(input.doctrine_modules),
        doctrine_sources: normalizeList(input.doctrine_sources),
        top_k: Math.max(1, Math.floor(input.doctrine_top_k)),
        prompt_cap: Math.max(1200, Math.floor(input.prompt_char_cap)),
      },
      calm_mode: input.calm_mode === true,
    };

    const digest = createHash("sha256");
    digest.update(JSON.stringify(canonical));
    return digest.digest("hex");
  }

  read(key: string): LlmTurnCacheReadResult {
    if (!this.isEnabled()) {
      return {
        hit: false,
        response: null,
        model_name: null,
        source: null,
        cache_ttl_remaining_ms: 0,
      };
    }

    const entry = this.entries.get(key);
    if (!entry) {
      return {
        hit: false,
        response: null,
        model_name: null,
        source: null,
        cache_ttl_remaining_ms: 0,
      };
    }

    const now = Date.now();
    if (entry.expires_at_ms <= now) {
      this.entries.delete(key);
      return {
        hit: false,
        response: null,
        model_name: null,
        source: null,
        cache_ttl_remaining_ms: 0,
      };
    }

    this.entries.delete(key);
    this.entries.set(key, entry);

    return {
      hit: true,
      response: cloneResponse(entry.response),
      model_name: entry.model_name,
      source: entry.source,
      cache_ttl_remaining_ms: Math.max(0, entry.expires_at_ms - now),
    };
  }

  write(input: LlmTurnCacheWriteInput): void {
    if (!this.isEnabled()) {
      return;
    }

    const now = Date.now();
    const entry: CacheEntry = {
      response: cloneResponse(input.response),
      model_name: input.model_name,
      source: input.source,
      expires_at_ms: now + this.config.ttl_ms,
    };

    if (this.entries.has(input.key)) {
      this.entries.delete(input.key);
    }

    this.entries.set(input.key, entry);
    this.enforceMaxEntries();
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private enforceMaxEntries(): void {
    while (this.entries.size > this.config.max_entries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}
