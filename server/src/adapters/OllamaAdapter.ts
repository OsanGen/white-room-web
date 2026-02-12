import { LlmTurnRequest, RabbitResponse } from "@white-room/shared";
import { ServerEnv } from "../types";
import { withTimeout } from "../utils";

interface OllamaResponse {
  response?: string;
}

export type LlmAttemptStatus = "ok" | "timeout" | "http_error" | "empty" | "parse_error";

export interface LlmAttempt {
  model_name: string;
  attempt_status: LlmAttemptStatus;
  attempt_latency_ms: number;
  output?: unknown;
}

export interface LlmGenerateResult {
  attempts: LlmAttempt[];
}

function responseFormatSchema() {
  return {
      type: "object",
      required: ["reply_text", "tone", "selected_node_id", "set_flags", "memory_quote_used", "morph_signal", "world_directives", "safety"],
      properties: {
        reply_text: { type: "string", minLength: 3, maxLength: 640 },
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

export class OllamaAdapter {
  constructor(private readonly env: ServerEnv) {}

  primaryModelName(): string {
    return this.env.ollama_primary_model;
  }

  async generate(req: LlmTurnRequest): Promise<LlmGenerateResult> {
    const attempts: LlmAttempt[] = [];
    const primary = await this.generateForModel(req, this.env.ollama_primary_model);
    attempts.push(primary);

    if (primary.attempt_status === "ok") {
      return { attempts };
    }

    if (!this.env.llm_enable_secondary_model) {
      return { attempts };
    }

    const fallback = await this.generateForModel(req, this.env.ollama_fallback_model);
    attempts.push(fallback);
    return { attempts };
  }

  private async generateForModel(req: LlmTurnRequest, model: string): Promise<LlmAttempt> {
    const started = Date.now();
    const body = {
      model,
      stream: false,
      prompt: req.prompt,
      format: responseFormatSchema(),
    };

    const attempt = fetch(`${this.env.ollama_url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) {
        return {
          model_name: model,
          attempt_status: "http_error",
          attempt_latency_ms: Date.now() - started,
        } as LlmAttempt;
      }
      const data = (await res.json()) as OllamaResponse;
      if (!data.response?.trim()) {
        return {
          model_name: model,
          attempt_status: "empty",
          attempt_latency_ms: Date.now() - started,
        } as LlmAttempt;
      }

      try {
        return {
          model_name: model,
          attempt_status: "ok",
          attempt_latency_ms: Date.now() - started,
          output: JSON.parse(data.response) as RabbitResponse,
        } as LlmAttempt;
      } catch {
        return {
          model_name: model,
          attempt_status: "parse_error",
          attempt_latency_ms: Date.now() - started,
          output: data.response.trim(),
        } as LlmAttempt;
      }
    });

    const timeoutResult: LlmAttempt = {
      model_name: model,
      attempt_status: "timeout",
      attempt_latency_ms: this.env.llm_model_timeout_ms,
    };

    return withTimeout(attempt, this.env.llm_model_timeout_ms, timeoutResult);
  }
}
