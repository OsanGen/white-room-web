import WebSocket from "ws";

interface CliConfig {
  server: string;
  session: string;
  bridgeToken: string;
  ollamaUrl: string;
  primaryModel: string;
  llmTimeoutMs: number;
  localSttUrl: string;
  localTtsUrl: string;
}

interface BridgeEnvelope {
  type?: string;
  request_id?: string;
  payload?: Record<string, unknown>;
}

function usage(): void {
  // eslint-disable-next-line no-console
  console.log(
    "Usage: npm --workspace bridge run dev -- --server http://host --session <id> --bridge-token <token> [--ollama-url http://127.0.0.1:11434] [--model qwen2.5:3b] [--llm-timeout-ms 18000] [--local-stt-url http://127.0.0.1:8787/api/stt] [--local-tts-url http://127.0.0.1:8787/api/tts]",
  );
}

function parseArgs(argv: string[]): CliConfig | null {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--")) {
      continue;
    }
    args.set(key.slice(2), value);
    i += 1;
  }

  const server = args.get("server") ?? process.env.BRIDGE_SERVER_URL;
  const session = args.get("session") ?? process.env.BRIDGE_SESSION_ID;
  const bridgeToken = args.get("bridge-token") ?? process.env.BRIDGE_TOKEN;

  if (!server || !session || !bridgeToken) {
    return null;
  }

  return {
    server,
    session,
    bridgeToken,
    ollamaUrl: args.get("ollama-url") ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    primaryModel: args.get("model") ?? process.env.OLLAMA_PRIMARY_MODEL ?? "qwen2.5:3b",
    llmTimeoutMs: Number(args.get("llm-timeout-ms") ?? process.env.BRIDGE_LLM_TIMEOUT_MS ?? "18000"),
    localSttUrl: args.get("local-stt-url") ?? process.env.BRIDGE_LOCAL_STT_URL ?? "",
    localTtsUrl: args.get("local-tts-url") ?? process.env.BRIDGE_LOCAL_TTS_URL ?? "",
  };
}

function wsUrl(config: CliConfig): string {
  const origin = config.server.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "");
  const query = new URLSearchParams({
    session_id: config.session,
    bridge_token: config.bridgeToken,
  });
  return `${origin}/ws/bridge?${query.toString()}`;
}

function responseFormatSchema() {
  return {
    type: "object",
    required: ["reply_text", "tone", "selected_node_id", "set_flags", "memory_quote_used", "morph_signal", "world_directives", "safety"],
    properties: {
      reply_text: { type: "string", minLength: 3, maxLength: 280 },
      tone: { type: "string", enum: ["Clinical", "Gentle", "Amused", "Cold"] },
      selected_node_id: { type: "string" },
      set_flags: { type: "array", items: { type: "string" } },
      memory_quote_used: { type: "string" },
      morph_signal: { type: "object" },
      world_directives: { type: "array" },
      safety: { type: "object" },
    },
  };
}

async function callLocalOllama(config: CliConfig, payload: Record<string, unknown>) {
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    const res = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.primaryModel,
        stream: false,
        prompt,
        format: responseFormatSchema(),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: "llm_error",
        attempt_status: "http_error",
        attempt_latency_ms: Date.now() - started,
        model_name: config.primaryModel,
      };
    }

    const data = (await res.json()) as { response?: string };
    const content = data.response?.trim();
    if (!content) {
      return {
        ok: false,
        reason: "llm_error",
        attempt_status: "empty",
        attempt_latency_ms: Date.now() - started,
        model_name: config.primaryModel,
      };
    }

    try {
      const parsed = JSON.parse(content);
      return {
        ok: true,
        output: parsed,
        attempt_status: "ok",
        attempt_latency_ms: Date.now() - started,
        model_name: config.primaryModel,
      };
    } catch {
      return {
        ok: true,
        output: content,
        attempt_status: "parse_error",
        attempt_latency_ms: Date.now() - started,
        model_name: config.primaryModel,
      };
    }
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name;
    return {
      ok: false,
      reason: name === "AbortError" ? "llm_timeout" : "llm_error",
      attempt_status: name === "AbortError" ? "timeout" : "network_error",
      attempt_latency_ms: Date.now() - started,
      model_name: config.primaryModel,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callLocalStt(config: CliConfig, payload: Record<string, unknown>) {
  if (!config.localSttUrl) {
    return { ok: false, reason: "bridge_stt_unavailable" };
  }

  const audioBase64 = payload.audio_base64;
  if (typeof audioBase64 !== "string" || audioBase64.length === 0) {
    return { ok: false, reason: "bridge_invalid_audio" };
  }

  try {
    const bytes = Buffer.from(audioBase64, "base64");
    const form = new FormData();
    form.append("audio", new Blob([bytes], { type: "audio/webm" }), "bridge.webm");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(config.localSttUrl, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, reason: "bridge_stt_error" };
    }

    const data = (await res.json()) as { ok: boolean; text?: string };
    if (!data.ok || !data.text) {
      return { ok: false, reason: "bridge_stt_error" };
    }
    return { ok: true, text: data.text };
  } catch {
    return { ok: false, reason: "bridge_stt_error" };
  }
}

async function callLocalTts(config: CliConfig, payload: Record<string, unknown>) {
  if (!config.localTtsUrl) {
    return { ok: false, reason: "bridge_tts_unavailable" };
  }

  const text = payload.text;
  const tone = payload.tone;
  if (typeof text !== "string" || typeof tone !== "string") {
    return { ok: false, reason: "bridge_invalid_tts_payload" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(config.localTtsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, tone }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, reason: "bridge_tts_error" };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: true, wav_base64: bytes.toString("base64") };
  } catch {
    return { ok: false, reason: "bridge_tts_error" };
  }
}

function parseEnvelope(raw: WebSocket.RawData): BridgeEnvelope | null {
  let text = "";
  if (typeof raw === "string") {
    text = raw;
  } else if (raw instanceof Buffer) {
    text = raw.toString("utf8");
  } else if (Array.isArray(raw)) {
    text = Buffer.concat(raw).toString("utf8");
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString("utf8");
  } else if (ArrayBuffer.isView(raw)) {
    text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  } else {
    return null;
  }
  try {
    return JSON.parse(text) as BridgeEnvelope;
  } catch {
    return null;
  }
}

async function run(config: CliConfig): Promise<void> {
  const endpoint = wsUrl(config);
  let reconnectDelayMs = 1000;

  const connect = () => {
    const ws = new WebSocket(endpoint);
    let pingTimer: NodeJS.Timeout | null = null;

    ws.on("open", () => {
      reconnectDelayMs = 1000;
      // eslint-disable-next-line no-console
      console.log(`[bridge] connected to ${endpoint}`);
      pingTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "bridge_ping" }));
        }
      }, 20000);
      pingTimer.unref();
    });

    ws.on("message", async (raw) => {
      const envelope = parseEnvelope(raw);
      if (!envelope?.type || !envelope.request_id || !envelope.payload) {
        return;
      }

      if (envelope.type === "llm_request") {
        const result = await callLocalOllama(config, envelope.payload);
        ws.send(
          JSON.stringify({
            type: "llm_response",
            request_id: envelope.request_id,
            ok: result.ok,
            output: result.ok ? result.output : undefined,
            reason: result.ok ? undefined : result.reason,
            model_name: result.model_name,
            attempt_status: result.attempt_status,
            attempt_latency_ms: result.attempt_latency_ms,
          }),
        );
        return;
      }

      if (envelope.type === "stt_request") {
        const result = await callLocalStt(config, envelope.payload);
        ws.send(
          JSON.stringify({
            type: "stt_response",
            request_id: envelope.request_id,
            ok: result.ok,
            text: result.ok ? result.text : undefined,
            reason: result.ok ? undefined : result.reason,
          }),
        );
        return;
      }

      if (envelope.type === "tts_request") {
        const result = await callLocalTts(config, envelope.payload);
        ws.send(
          JSON.stringify({
            type: "tts_response",
            request_id: envelope.request_id,
            ok: result.ok,
            wav_base64: result.ok ? result.wav_base64 : undefined,
            reason: result.ok ? undefined : result.reason,
          }),
        );
      }
    });

    ws.on("close", () => {
      if (pingTimer) {
        clearInterval(pingTimer);
      }
      // eslint-disable-next-line no-console
      console.warn(`[bridge] disconnected. reconnecting in ${reconnectDelayMs}ms`);
      setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(10000, reconnectDelayMs * 2);
    });

    ws.on("error", (error) => {
      // eslint-disable-next-line no-console
      console.error("[bridge] socket error", error);
    });
  };

  connect();
}

const config = parseArgs(process.argv.slice(2));
if (!config) {
  usage();
  process.exit(1);
}

void run(config);
