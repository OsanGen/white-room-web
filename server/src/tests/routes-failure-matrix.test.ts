import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RABBIT_STATE,
  PlayerClassification,
  RabbitPhase,
  RabbitTone,
} from "@white-room/shared";
import { LlmTurnCache } from "../cache/LlmTurnCache";
import { sttRouter } from "../routes/stt";
import { ttsRouter } from "../routes/tts";
import { llmRouter } from "../routes/llm";

async function startServer(app: express.Express): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to get test server address");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      await close();
    }
  }
});

describe("server route failure matrix", () => {
  it("FAILMAT-003 /api/stt missing audio returns 400", async () => {
    const app = express();
    app.use(sttRouter({ transcribe: async () => "ok" } as never));
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/stt`, { method: "POST" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "missing_audio" });
  });

  it("FAILMAT-003 /api/stt unavailable returns 503", async () => {
    const app = express();
    app.use(sttRouter({ transcribe: async () => null } as never));
    const { origin, close } = await startServer(app);
    closers.push(close);

    const form = new FormData();
    form.append("audio", new Blob(["fake-audio-bytes"], { type: "audio/webm" }), "clip.webm");

    const res = await fetch(`${origin}/api/stt`, { method: "POST", body: form });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "stt_unavailable" });
  });

  it("FAILMAT-004 /api/tts invalid request returns 400", async () => {
    const app = express();
    app.use(express.json());
    app.use(ttsRouter({ synthesize: async () => Buffer.from("wav") } as never));
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "invalid_tts_request" });
  });

  it("FAILMAT-004 /api/tts unavailable returns 503", async () => {
    const app = express();
    app.use(express.json());
    app.use(ttsRouter({ synthesize: async () => null } as never));
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "continue", tone: RabbitTone.Clinical }),
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "tts_unavailable" });
  });

  it("FAILMAT-001 /api/llm/respond falls back to deterministic on malformed model output", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({
            attempts: [
              {
                model_name: "qwen2.5:3b",
                attempt_status: "ok",
                attempt_latency_ms: 100,
                output: { broken: true },
              },
            ],
          }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "",
          classification: PlayerClassification.Silence,
          tags: ["silence"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      source: string;
      response: { reply_text: string };
    };
    expect(data.ok).toBe(true);
    expect(data.source.startsWith("fallback:")).toBe(true);
    expect(data.response.reply_text.length).toBeGreaterThan(0);
  });

  it("repairs partial model output into a deliverable llm response", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({
            attempts: [
              {
                model_name: "qwen2.5:3b",
                attempt_status: "ok",
                attempt_latency_ms: 100,
                output: {
                  reply_text: "Breathe once, then tell me what you are avoiding.",
                },
              },
            ],
          }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "I don't know where to begin",
          classification: PlayerClassification.Curiosity,
          tags: ["uncertainty"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      source: string;
      response: { reply_text: string; morph_signal: { keywords: string[] } };
    };
    expect(data.ok).toBe(true);
    expect(data.source).toBe("ollama");
    expect(data.response.reply_text.length).toBeGreaterThan(0);
    expect(data.response.morph_signal.keywords.length).toBeGreaterThan(0);
  });

  it("repairs alternate text keys into a deliverable llm response", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({
            attempts: [
              {
                model_name: "qwen2.5:3b",
                attempt_status: "ok",
                attempt_latency_ms: 100,
                output: {
                  response: {
                    content: "Start with one true sentence and keep it simple.",
                  },
                  morph: {
                    keywords: ["truth", "begin"],
                  },
                  flags: [],
                },
              },
            ],
          }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "how do i begin",
          classification: PlayerClassification.Curiosity,
          tags: ["begin"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      source: string;
      response: { reply_text: string; morph_signal: { keywords: string[] } };
    };
    expect(data.ok).toBe(true);
    expect(data.source).toBe("ollama");
    expect(data.response.reply_text).toContain("Start with one true sentence");
    expect(data.response.morph_signal.keywords.length).toBeGreaterThan(0);
  });

  it("FAILMAT-001 /api/llm/respond falls back on model exception", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => {
            throw new Error("model runtime failed");
          },
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "",
          classification: PlayerClassification.Silence,
          tags: ["silence"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      source: string;
      response: { reply_text: string };
    };
    expect(data.ok).toBe(true);
    expect(data.source).toBe("fallback:llm_error");
    expect(data.response.reply_text.length).toBeGreaterThan(0);
  });

  it("FAILMAT-001 /api/llm/respond enforces route timeout for stalled model", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => await new Promise(() => undefined),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
        {
          llmRouteTimeoutMs: 50,
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const started = Date.now();
    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "",
          classification: PlayerClassification.Silence,
          tags: ["silence"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
      }),
    });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);

    const data = (await res.json()) as {
      ok: boolean;
      source: string;
      response: { reply_text: string };
    };
    expect(data.ok).toBe(true);
    expect(data.source).toBe("fallback:llm_timeout");
    expect(data.response.reply_text.length).toBeGreaterThan(0);
  });

  it("maps transport timeout status to fallback:llm_timeout (not schema_invalid)", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({
            attempts: [
              {
                model_name: "qwen2.5:3b",
                attempt_status: "timeout",
                attempt_latency_ms: 10000,
              },
            ],
          }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "hello",
          classification: PlayerClassification.Curiosity,
          tags: ["checkin"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; source: string };
    expect(data.ok).toBe(true);
    expect(data.source).toBe("fallback:llm_timeout");
  });

  it("returns cache hit on second identical validated turn without invoking model again", async () => {
    const app = express();
    app.use(express.json());

    const generate = vi.fn().mockResolvedValue({
      attempts: [
        {
          model_name: "qwen2.5:3b",
          attempt_status: "ok",
          attempt_latency_ms: 120,
          output: {
            reply_text: "Start with one true sentence.",
            tone: "Clinical",
            selected_node_id: "N01_Orientation",
            set_flags: [],
            memory_quote_used: "",
            morph_signal: {
              classification: "Curiosity",
              phase: "Intake",
              tone: "Clinical",
              psych_delta: {},
              keywords: ["truth"],
            },
            world_directives: [],
            safety: { fiction_intact: true, no_meta_language: true },
          },
        },
      ],
    });

    app.use(
      llmRouter(
        {
          generate,
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
        {
          turnCache: new LlmTurnCache({
            enabled: true,
            ttl_ms: 60000,
            max_entries: 20,
            key_version: 1,
          }),
        },
      ),
    );

    const { origin, close } = await startServer(app);
    closers.push(close);

    const payload = {
      state: DEFAULT_RABBIT_STATE,
      packet: {
        utterance_text: "hello",
        classification: PlayerClassification.Curiosity,
        tags: ["checkin"],
        elapsed_ms: 1000,
        phase: RabbitPhase.Intake,
      },
      prompt: "test",
      schema: { type: "object" },
    };

    const first = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as { source: string; cache_hit: boolean };
    expect(firstData.source).toBe("ollama");
    expect(firstData.cache_hit).toBe(false);

    const second = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as {
      source: string;
      cache_hit: boolean;
      cache_key_version: number;
      cache_ttl_remaining_ms: number;
    };
    expect(secondData.source).toBe("cache");
    expect(secondData.cache_hit).toBe(true);
    expect(secondData.cache_key_version).toBe(1);
    expect(secondData.cache_ttl_remaining_ms).toBeGreaterThan(0);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not cache fallback responses", async () => {
    const app = express();
    app.use(express.json());

    const generate = vi.fn().mockResolvedValue({
      attempts: [
        {
          model_name: "qwen2.5:3b",
          attempt_status: "ok",
          attempt_latency_ms: 70,
          output: { broken: true },
        },
      ],
    });

    app.use(
      llmRouter(
        {
          generate,
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
        {
          turnCache: new LlmTurnCache({
            enabled: true,
            ttl_ms: 60000,
            max_entries: 20,
            key_version: 1,
          }),
        },
      ),
    );

    const { origin, close } = await startServer(app);
    closers.push(close);

    const payload = {
      state: DEFAULT_RABBIT_STATE,
      packet: {
        utterance_text: "same request",
        classification: PlayerClassification.Curiosity,
        tags: ["same"],
        elapsed_ms: 1000,
        phase: RabbitPhase.Intake,
      },
      prompt: "test",
      schema: { type: "object" },
    };

    const first = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const firstData = (await first.json()) as { source: string; cache_hit: boolean };
    expect(firstData.source).toBe("fallback:schema_invalid");
    expect(firstData.cache_hit).toBe(false);

    const second = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const secondData = (await second.json()) as { source: string; cache_hit: boolean };
    expect(secondData.source).toBe("fallback:schema_invalid");
    expect(secondData.cache_hit).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("returns enrich payload for valid llm enrichment response", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({
            attempts: [
              {
                model_name: "qwen2.5:3b",
                attempt_status: "ok",
                attempt_latency_ms: 90,
                output: {
                  reply_text: "Name the pattern once, then choose one boundary.",
                  tone: "Clinical",
                  selected_node_id: "N01_Orientation",
                  set_flags: [],
                  memory_quote_used: "",
                  morph_signal: {
                    classification: "Curiosity",
                    phase: "Intake",
                    tone: "Clinical",
                    psych_delta: {},
                    keywords: ["boundary"],
                  },
                  world_directives: [],
                  safety: { fiction_intact: true, no_meta_language: true },
                },
              },
            ],
          }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/enrich`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turn_id: "turn_1",
        state_snapshot_min: {
          phase: RabbitPhase.Intake,
          tone: RabbitTone.Clinical,
          trust: 35,
          threat: 15,
          curiosity: 20,
          calm_mode: false,
        },
        packet: {
          utterance_text: "how do i begin",
          classification: PlayerClassification.Curiosity,
          tags: ["begin"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        provisional_reply_text: "Start with one sentence.",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      turn_id: string;
      source: string;
      enrichment_text?: string;
      world_directives?: unknown[];
    };
    expect(data.ok).toBe(true);
    expect(data.turn_id).toBe("turn_1");
    expect(data.source).toBe("ollama");
    expect(typeof data.enrichment_text).toBe("string");
    expect(Array.isArray(data.world_directives)).toBe(true);
  });

  it("falls back for invalid enrich payload instead of blocking turn", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({
            attempts: [
              {
                model_name: "qwen2.5:3b",
                attempt_status: "ok",
                attempt_latency_ms: 90,
                output: { broken: true },
              },
            ],
          }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/enrich`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turn_id: "turn_2",
        state_snapshot_min: {
          phase: RabbitPhase.Intake,
          tone: RabbitTone.Clinical,
          trust: 35,
          threat: 15,
          curiosity: 20,
          calm_mode: false,
        },
        packet: {
          utterance_text: "same",
          classification: PlayerClassification.Curiosity,
          tags: ["same"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        provisional_reply_text: "Start with one sentence.",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      source: string;
      fallback_reason: string | null;
    };
    expect(data.ok).toBe(true);
    expect(data.source.startsWith("fallback:")).toBe(true);
    expect(typeof data.fallback_reason === "string" || data.fallback_reason === null).toBe(true);
  });

  it("uses cache on repeated enrich requests", async () => {
    const app = express();
    app.use(express.json());

    const generate = vi.fn().mockResolvedValue({
      attempts: [
        {
          model_name: "qwen2.5:3b",
          attempt_status: "ok",
          attempt_latency_ms: 80,
          output: {
            reply_text: "Name one pressure, then choose one boundary.",
            tone: "Clinical",
            selected_node_id: "N01_Orientation",
            set_flags: [],
            memory_quote_used: "",
            morph_signal: {
              classification: "Curiosity",
              phase: "Intake",
              tone: "Clinical",
              psych_delta: {},
              keywords: ["boundary"],
            },
            world_directives: [],
            safety: { fiction_intact: true, no_meta_language: true },
          },
        },
      ],
    });

    app.use(
      llmRouter(
        {
          generate,
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
        {
          turnCache: new LlmTurnCache({
            enabled: true,
            ttl_ms: 60000,
            max_entries: 20,
            key_version: 1,
          }),
        },
      ),
    );

    const { origin, close } = await startServer(app);
    closers.push(close);

    const payload = {
      turn_id: "turn_cache",
      state_snapshot_min: {
        phase: RabbitPhase.Intake,
        tone: RabbitTone.Clinical,
        trust: 35,
        threat: 15,
        curiosity: 20,
        calm_mode: false,
      },
      packet: {
        utterance_text: "cache me",
        classification: PlayerClassification.Curiosity,
        tags: ["cache"],
        elapsed_ms: 1000,
        phase: RabbitPhase.Intake,
      },
      provisional_reply_text: "Start with one sentence.",
    };

    const first = await fetch(`${origin}/api/llm/enrich`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const firstData = (await first.json()) as { source: string; cache_hit: boolean };
    expect(firstData.source).toBe("ollama");
    expect(firstData.cache_hit).toBe(false);

    const second = await fetch(`${origin}/api/llm/enrich`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const secondData = (await second.json()) as { source: string; cache_hit: boolean };
    expect(secondData.source).toBe("cache");
    expect(secondData.cache_hit).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("uses bridge_local source when bridge session returns valid output", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      llmRouter(
        {
          generate: async () => ({ attempts: [] }),
        } as never,
        {
          retrieveTopK: () => [],
        } as never,
        {
          bridgeBroker: {
            requestLlm: async () => ({
              ok: true,
              output: {
                reply_text: "Bridge says continue.",
                tone: "Clinical",
                selected_node_id: "N01_Orientation",
                set_flags: [],
                memory_quote_used: "",
                morph_signal: {
                  classification: "Curiosity",
                  phase: "Intake",
                  tone: "Clinical",
                  psych_delta: {},
                  keywords: ["bridge"],
                },
                world_directives: [],
                safety: { fiction_intact: true, no_meta_language: true },
              },
              diagnostics: {
                model_name: "local-bridge-qwen",
                attempt_status: "ok",
                attempt_latency_ms: 640,
              },
            }),
          } as never,
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/llm/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: DEFAULT_RABBIT_STATE,
        packet: {
          utterance_text: "hello",
          classification: PlayerClassification.Curiosity,
          tags: ["checkin"],
          elapsed_ms: 1000,
          phase: RabbitPhase.Intake,
        },
        prompt: "test",
        schema: { type: "object" },
        bridge_session_id: "session_1",
        bridge_client_token: "client_1",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; source: string; model_name: string };
    expect(data.ok).toBe(true);
    expect(data.source).toBe("bridge_local");
    expect(data.model_name).toBe("local-bridge-qwen");
  });
});
