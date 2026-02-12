import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RabbitTone } from "@white-room/shared";
import type WebSocket from "ws";

interface BridgeSessionRecord {
  session_id: string;
  client_token: string;
  bridge_token: string;
  created_at_ms: number;
  expires_at_ms: number;
  connected: boolean;
  socket?: WebSocket;
  last_seen_at_ms: number;
}

interface BridgePendingRequest {
  session_id: string;
  resolve: (result: BridgeMessageEnvelope) => void;
  timeout: NodeJS.Timeout;
}

interface BridgeMessageEnvelope {
  type: string;
  request_id?: string;
  ok?: boolean;
  output?: unknown;
  text?: string;
  wav_base64?: string;
  reason?: string;
  model_name?: string;
  attempt_status?: string;
  attempt_latency_ms?: number;
}

export interface BridgeSessionInit {
  session_id: string;
  client_token: string;
  bridge_token: string;
  expires_at_ms: number;
}

export interface BridgeSessionStatus {
  session_id: string;
  connected: boolean;
  expires_at_ms: number;
  last_seen_at_ms: number;
}

export interface BridgeLlmDiagnostics {
  model_name: string | null;
  attempt_status: string;
  attempt_latency_ms: number;
}

export interface BridgeLlmResult {
  ok: boolean;
  output?: unknown;
  reason?: string;
  diagnostics: BridgeLlmDiagnostics;
}

export interface BridgeSttResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

export interface BridgeTtsResult {
  ok: boolean;
  wav?: Buffer;
  reason?: string;
}

function parseBridgeMessage(data: WebSocket.RawData): BridgeMessageEnvelope | null {
  let asString = "";
  if (typeof data === "string") {
    asString = data;
  } else if (data instanceof Buffer) {
    asString = data.toString("utf8");
  } else if (Array.isArray(data)) {
    asString = Buffer.concat(data).toString("utf8");
  } else if (data instanceof ArrayBuffer) {
    asString = Buffer.from(data).toString("utf8");
  } else if (ArrayBuffer.isView(data)) {
    asString = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  } else {
    return null;
  }

  try {
    const parsed = JSON.parse(asString) as BridgeMessageEnvelope;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasOpenSocket(socket: WebSocket | undefined): boolean {
  return Boolean(socket && socket.readyState === socket.OPEN);
}

export class BridgeBroker {
  private readonly sessions = new Map<string, BridgeSessionRecord>();
  private readonly pending = new Map<string, BridgePendingRequest>();

  constructor(private readonly sessionTtlMs: number) {
    const timer = setInterval(() => this.evictExpired(), 15000);
    timer.unref();
  }

  createSession(): BridgeSessionInit {
    const now = Date.now();
    const session: BridgeSessionRecord = {
      session_id: randomUUID(),
      client_token: randomUUID(),
      bridge_token: randomUUID(),
      created_at_ms: now,
      expires_at_ms: now + this.sessionTtlMs,
      connected: false,
      last_seen_at_ms: now,
    };
    this.sessions.set(session.session_id, session);
    return {
      session_id: session.session_id,
      client_token: session.client_token,
      bridge_token: session.bridge_token,
      expires_at_ms: session.expires_at_ms,
    };
  }

  getSessionStatus(sessionId: string, clientToken: string): BridgeSessionStatus | null {
    const session = this.validateClientSession(sessionId, clientToken);
    if (!session) return null;
    return {
      session_id: session.session_id,
      connected: session.connected && hasOpenSocket(session.socket),
      expires_at_ms: session.expires_at_ms,
      last_seen_at_ms: session.last_seen_at_ms,
    };
  }

  validateClientSession(sessionId: string, clientToken: string): BridgeSessionRecord | null {
    this.evictExpired();
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.client_token !== clientToken) return null;
    return session;
  }

  attachBridgeSocket(sessionId: string, bridgeToken: string, socket: WebSocket): boolean {
    this.evictExpired();
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.bridge_token !== bridgeToken) return false;

    if (session.socket && session.socket !== socket) {
      try {
        session.socket.close();
      } catch {
        // no-op
      }
    }

    session.socket = socket;
    session.connected = true;
    session.last_seen_at_ms = Date.now();
    return true;
  }

  detachSocket(socket: WebSocket): void {
    for (const session of this.sessions.values()) {
      if (session.socket === socket) {
        session.connected = false;
        session.socket = undefined;
        session.last_seen_at_ms = Date.now();
      }
    }
  }

  handleSocketMessage(socket: WebSocket, data: WebSocket.RawData): void {
    const parsed = parseBridgeMessage(data);
    if (!parsed) return;

    if (parsed.type === "bridge_ping") {
      try {
        socket.send(JSON.stringify({ type: "bridge_pong", ts: Date.now() }));
      } catch {
        // no-op
      }
      return;
    }

    if (!["llm_response", "stt_response", "tts_response"].includes(parsed.type) || !parsed.request_id) {
      return;
    }

    const pending = this.pending.get(parsed.request_id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(parsed.request_id);
    pending.resolve(parsed);
  }

  async requestLlm(
    sessionId: string,
    clientToken: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<BridgeLlmResult> {
    const envelope = await this.request(sessionId, clientToken, "llm_request", payload, timeoutMs);
    const diagnostics: BridgeLlmDiagnostics = {
      model_name: typeof envelope.model_name === "string" ? envelope.model_name : null,
      attempt_status:
        typeof envelope.attempt_status === "string"
          ? envelope.attempt_status
          : envelope.ok
            ? "ok"
            : envelope.reason ?? "bridge_error",
      attempt_latency_ms: typeof envelope.attempt_latency_ms === "number" ? envelope.attempt_latency_ms : 0,
    };

    if (envelope.ok && envelope.output !== undefined) {
      return { ok: true, output: envelope.output, diagnostics };
    }

    return {
      ok: false,
      reason: envelope.reason ?? "bridge_error",
      diagnostics,
    };
  }

  async requestStt(
    sessionId: string,
    clientToken: string,
    audio: Buffer,
    timeoutMs: number,
  ): Promise<BridgeSttResult> {
    const envelope = await this.request(
      sessionId,
      clientToken,
      "stt_request",
      { audio_base64: audio.toString("base64") },
      timeoutMs,
    );

    if (envelope.ok && typeof envelope.text === "string" && envelope.text.trim().length > 0) {
      return { ok: true, text: envelope.text.trim() };
    }

    return { ok: false, reason: envelope.reason ?? "bridge_error" };
  }

  async requestTts(
    sessionId: string,
    clientToken: string,
    text: string,
    tone: RabbitTone,
    timeoutMs: number,
  ): Promise<BridgeTtsResult> {
    const envelope = await this.request(sessionId, clientToken, "tts_request", { text, tone }, timeoutMs);

    if (envelope.ok && typeof envelope.wav_base64 === "string" && envelope.wav_base64.length > 0) {
      try {
        return { ok: true, wav: Buffer.from(envelope.wav_base64, "base64") };
      } catch {
        return { ok: false, reason: "bridge_invalid_audio" };
      }
    }

    return { ok: false, reason: envelope.reason ?? "bridge_error" };
  }

  parseUpgradeRequest(request: IncomingMessage): { session_id: string; bridge_token: string } | null {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/ws/bridge") {
      return null;
    }
    const session_id = url.searchParams.get("session_id");
    const bridge_token = url.searchParams.get("bridge_token");
    if (!session_id || !bridge_token) {
      return null;
    }
    return { session_id, bridge_token };
  }

  private async request(
    sessionId: string,
    clientToken: string,
    messageType: "llm_request" | "stt_request" | "tts_request",
    payload: unknown,
    timeoutMs: number,
  ): Promise<BridgeMessageEnvelope> {
    const session = this.validateClientSession(sessionId, clientToken);
    if (!session) {
      return { type: `${messageType}_result`, ok: false, reason: "bridge_unauthorized" };
    }

    const socket = session.socket;
    if (!socket || socket.readyState !== socket.OPEN) {
      session.connected = false;
      return { type: `${messageType}_result`, ok: false, reason: "bridge_disconnected" };
    }

    const requestId = randomUUID();
    const timeout = setTimeout(() => {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      pending.resolve({ type: `${messageType}_result`, ok: false, reason: "bridge_timeout" });
    }, timeoutMs);

    const resultPromise = new Promise<BridgeMessageEnvelope>((resolve) => {
      this.pending.set(requestId, { session_id: sessionId, resolve, timeout });
    });

    try {
      socket.send(
        JSON.stringify({
          type: messageType,
          request_id: requestId,
          payload,
        }),
      );
      session.last_seen_at_ms = Date.now();
    } catch {
      clearTimeout(timeout);
      this.pending.delete(requestId);
      return { type: `${messageType}_result`, ok: false, reason: "bridge_send_failed" };
    }

    return resultPromise;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.expires_at_ms > now) {
        continue;
      }
      if (session.socket) {
        try {
          session.socket.close();
        } catch {
          // no-op
        }
      }
      this.sessions.delete(session.session_id);
    }

    for (const [requestId, pending] of this.pending.entries()) {
      if (this.sessions.has(pending.session_id)) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      pending.resolve({ type: "request_result", ok: false, reason: "bridge_session_expired" });
    }
  }
}
