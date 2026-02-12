import {
  BLOCKED_EXPLICIT_RELIGION_TOKENS,
  BLOCKED_META_TOKENS,
  BLOCKED_VIOLENCE_TOKENS,
  WorldDirectiveSchema,
  RabbitResponse,
  RabbitResponseSchema,
  MAX_RABBIT_REPLY_CHARS,
} from "@white-room/shared";

function containsBlockedMeta(reply: string): boolean {
  const lower = reply.toLowerCase();
  return BLOCKED_META_TOKENS.some((token) => lower.includes(token));
}

function containsBlockedViolence(reply: string): boolean {
  const lower = reply.toLowerCase();
  return BLOCKED_VIOLENCE_TOKENS.some((token) => lower.includes(token));
}

function containsExplicitReligion(reply: string): boolean {
  const lower = reply.toLowerCase();
  return BLOCKED_EXPLICIT_RELIGION_TOKENS.some((token) => lower.includes(token));
}

interface RabbitOutputValidationOptions {
  allowedModules?: string[];
}

function sanitizeEnrichmentText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_RABBIT_REPLY_CHARS ? trimmed.slice(0, MAX_RABBIT_REPLY_CHARS) : trimmed;
}

export function validateEnrichmentPacket(
  text: unknown,
  directives: unknown,
  options: RabbitOutputValidationOptions = {},
): { ok: true; data: { enrichment_text: string; world_directives: RabbitResponse["world_directives"] } } | { ok: false; reason: string } {
  const enrichmentText = sanitizeEnrichmentText(text);
  if (!enrichmentText) {
    return { ok: false, reason: "schema_invalid" };
  }
  if (containsBlockedMeta(enrichmentText)) {
    return { ok: false, reason: "meta_blocked" };
  }
  if (containsBlockedViolence(enrichmentText)) {
    return { ok: false, reason: "violence_blocked" };
  }
  if (containsExplicitReligion(enrichmentText)) {
    return { ok: false, reason: "explicit_religion_blocked" };
  }

  const parsedDirectives: RabbitResponse["world_directives"] = [];
  if (Array.isArray(directives)) {
    for (const item of directives) {
      const parsed = WorldDirectiveSchema.safeParse(item);
      if (!parsed.success) {
        return { ok: false, reason: "schema_invalid" };
      }
      if (options.allowedModules && options.allowedModules.length > 0) {
        const allowed = new Set(options.allowedModules);
        if (parsed.data.rationale_modules.some((module) => !allowed.has(module))) {
          return { ok: false, reason: "directive_module_unmapped" };
        }
      }
      parsedDirectives.push(parsed.data);
    }
  }

  return {
    ok: true,
    data: {
      enrichment_text: enrichmentText,
      world_directives: parsedDirectives.slice(0, 3),
    },
  };
}

export function validateRabbitOutput(
  raw: unknown,
  options: RabbitOutputValidationOptions = {},
): { ok: true; data: RabbitResponse } | { ok: false; reason: string } {
  const parsed = RabbitResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "schema_invalid" };
  }

  if (containsBlockedMeta(parsed.data.reply_text)) {
    return { ok: false, reason: "meta_blocked" };
  }
  if (containsBlockedViolence(parsed.data.reply_text)) {
    return { ok: false, reason: "violence_blocked" };
  }
  if (containsExplicitReligion(parsed.data.reply_text)) {
    return { ok: false, reason: "explicit_religion_blocked" };
  }

  if (!parsed.data.safety.fiction_intact || !parsed.data.safety.no_meta_language) {
    return { ok: false, reason: "safety_flags_failed" };
  }

  if (options.allowedModules && options.allowedModules.length > 0) {
    const allowed = new Set(options.allowedModules);
    for (const directive of parsed.data.world_directives) {
      const unknown = directive.rationale_modules.find((module) => !allowed.has(module));
      if (unknown) {
        return { ok: false, reason: "directive_module_unmapped" };
      }
    }
  }

  return { ok: true, data: parsed.data };
}
