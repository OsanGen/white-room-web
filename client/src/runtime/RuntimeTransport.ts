type RuntimeChoice = "local_bridge" | "hosted";

interface BridgeSessionState {
  session_id: string;
  client_token: string;
  bridge_token: string;
  expires_at_ms: number;
  connected: boolean;
  last_seen_at_ms: number;
}

interface CreateSessionResponse {
  ok: boolean;
  session_id: string;
  client_token: string;
  bridge_token: string;
  expires_at_ms: number;
}

interface SessionStatusResponse {
  ok: boolean;
  status?: {
    session_id: string;
    connected: boolean;
    expires_at_ms: number;
    last_seen_at_ms: number;
  };
}

const STORAGE_CHOICE_KEY = "wr_runtime_choice";
const STORAGE_SESSION_KEY = "wr_bridge_session";
const hasWindow = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
const apiBase = (() => {
  const raw = typeof import.meta !== "undefined" ? import.meta.env.VITE_API_BASE_URL : "";
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/\/+$/, "");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
})();

function resolveApiUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalizedPath;
  return `${base}${normalizedPath}`;
}

function resolveBridgeServerOrigin(base: string): string {
  if (!hasWindow) return "";
  if (!base || base.startsWith("/")) {
    return window.location.origin;
  }
  try {
    return new URL(base).origin;
  } catch {
    return window.location.origin;
  }
}

function parseStoredSession(raw: string | null): BridgeSessionState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BridgeSessionState;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.session_id !== "string" ||
      typeof parsed.client_token !== "string" ||
      typeof parsed.bridge_token !== "string" ||
      typeof parsed.expires_at_ms !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class RuntimeTransport {
  private choice: RuntimeChoice | null = null;
  private bridge: BridgeSessionState | null = null;

  constructor() {
    if (hasWindow) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    const rawChoice = window.localStorage.getItem(STORAGE_CHOICE_KEY);
    this.choice = rawChoice === "local_bridge" || rawChoice === "hosted" ? rawChoice : null;
    this.bridge = parseStoredSession(window.localStorage.getItem(STORAGE_SESSION_KEY));
  }

  private persistChoice(): void {
    if (!hasWindow) return;
    if (!this.choice) {
      window.localStorage.removeItem(STORAGE_CHOICE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_CHOICE_KEY, this.choice);
  }

  private persistBridge(): void {
    if (!hasWindow) return;
    if (!this.bridge) {
      window.localStorage.removeItem(STORAGE_SESSION_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(this.bridge));
  }

  hasConsentChoice(): boolean {
    return this.choice !== null;
  }

  getChoice(): RuntimeChoice | null {
    return this.choice;
  }

  setChoice(choice: RuntimeChoice): void {
    this.choice = choice;
    this.persistChoice();
    if (choice !== "local_bridge") {
      if (this.bridge) {
        this.bridge.connected = false;
      }
      this.persistBridge();
    }
  }

  getBridgeState(): BridgeSessionState | null {
    return this.bridge;
  }

  async createBridgeSession(): Promise<{ ok: boolean; command?: string }> {
    if (!hasWindow) {
      return { ok: false };
    }
    try {
      const res = await fetch(this.getApiUrl("/api/bridge/session"), {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        return { ok: false };
      }
      const data = (await res.json()) as CreateSessionResponse;
      if (!data.ok) {
        return { ok: false };
      }

      this.bridge = {
        session_id: data.session_id,
        client_token: data.client_token,
        bridge_token: data.bridge_token,
        expires_at_ms: data.expires_at_ms,
        connected: false,
        last_seen_at_ms: Date.now(),
      };
      this.persistBridge();

      const wsOrigin = this.getBridgeServerOrigin().replace(/^http/, "ws");
      const command = [
        "npm --workspace bridge run dev --",
        `--server ${wsOrigin.replace(/^ws/, "http")}`,
        `--session ${data.session_id}`,
        `--bridge-token ${data.bridge_token}`,
      ].join(" ");
      return { ok: true, command };
    } catch {
      return { ok: false };
    }
  }

  async refreshBridgeStatus(): Promise<boolean> {
    if (!hasWindow) {
      return false;
    }
    if (!this.bridge) {
      return false;
    }
    try {
      const query = new URLSearchParams({ client_token: this.bridge.client_token });
      const res = await fetch(
        this.getApiUrl(`/api/bridge/session/${this.bridge.session_id}?${query.toString()}`),
      );
      if (!res.ok) {
        this.bridge.connected = false;
        this.persistBridge();
        return false;
      }
      const data = (await res.json()) as SessionStatusResponse;
      if (!data.ok || !data.status) {
        this.bridge.connected = false;
        this.persistBridge();
        return false;
      }
      this.bridge.connected = data.status.connected;
      this.bridge.last_seen_at_ms = data.status.last_seen_at_ms;
      this.bridge.expires_at_ms = data.status.expires_at_ms;
      this.persistBridge();
      return data.status.connected;
    } catch {
      this.bridge.connected = false;
      this.persistBridge();
      return false;
    }
  }

  getLlmBridgePayload(): { bridge_session_id?: string; bridge_client_token?: string } {
    if (this.choice !== "local_bridge" || !this.bridge || !this.bridge.connected) {
      return {};
    }
    return {
      bridge_session_id: this.bridge.session_id,
      bridge_client_token: this.bridge.client_token,
    };
  }

  getBridgeHeaders(): Record<string, string> {
    if (this.choice !== "local_bridge" || !this.bridge || !this.bridge.connected) {
      return {};
    }
    return {
      "x-bridge-session-id": this.bridge.session_id,
      "x-bridge-client-token": this.bridge.client_token,
    };
  }

  getApiUrl(path: string): string {
    return resolveApiUrl(apiBase, path);
  }

  getBridgeServerOrigin(): string {
    return resolveBridgeServerOrigin(apiBase);
  }

  getRuntimeStatus(providerLlm: string): string {
    if (this.choice === "local_bridge" && this.bridge?.connected) {
      return "Local Bridge Connected";
    }
    if (providerLlm === "ollama") {
      return "Hosted LLM";
    }
    return "Deterministic Continuity";
  }
}

export const runtimeTransport = new RuntimeTransport();
