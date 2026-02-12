import {
  BLOCKED_EXPLICIT_RELIGION_TOKENS,
  BLOCKED_META_TOKENS,
  BLOCKED_VIOLENCE_TOKENS,
  RabbitResponse,
  RabbitResponseSchema,
} from "@white-room/shared";

export function sanitizeJsonEnvelope(raw: string): string {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return raw.slice(first, last + 1);
  }
  return raw;
}

export function validateResponse(raw: unknown): { ok: true; value: RabbitResponse } | { ok: false; reason: string } {
  const parsed = RabbitResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "schema_invalid" };
  }

  const lower = parsed.data.reply_text.toLowerCase();
  if (BLOCKED_META_TOKENS.some((token) => lower.includes(token))) {
    return { ok: false, reason: "meta_tokens" };
  }
  if (BLOCKED_VIOLENCE_TOKENS.some((token) => lower.includes(token))) {
    return { ok: false, reason: "violence_tokens" };
  }
  if (BLOCKED_EXPLICIT_RELIGION_TOKENS.some((token) => lower.includes(token))) {
    return { ok: false, reason: "explicit_religion_tokens" };
  }

  if (!parsed.data.safety.fiction_intact || !parsed.data.safety.no_meta_language) {
    return { ok: false, reason: "safety_flags" };
  }

  return { ok: true, value: parsed.data };
}
