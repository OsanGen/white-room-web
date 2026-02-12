import { describe, expect, it } from "vitest";
import { MAX_RABBIT_REPLY_CHARS, FORCED_FINAL_BRANCH_AT_MS, SESSION_HARD_LIMIT_MS } from "./constants/defaults";
import { RabbitResponseSchema } from "./contracts/schema";

describe("shared constants", () => {
  it("enforces 5 minute hard stop", () => {
    expect(SESSION_HARD_LIMIT_MS).toBe(300000);
  });

  it("forces final branch at 270s", () => {
    expect(FORCED_FINAL_BRANCH_AT_MS).toBe(270000);
  });

  it("allows maximum rabbit reply length", () => {
    const accepted = "x".repeat(MAX_RABBIT_REPLY_CHARS);
    expect(
      RabbitResponseSchema.safeParse({
        reply_text: accepted,
        tone: "Clinical",
        selected_node_id: "N14_FinalQuestion",
        set_flags: [],
        memory_quote_used: "",
        morph_signal: {
          classification: "Curiosity",
          phase: "Intake",
          tone: "Clinical",
          psych_delta: {},
          keywords: [],
        },
        world_directives: [],
        safety: { fiction_intact: true, no_meta_language: true },
      }).success,
    ).toBe(true);
  });

  it("rejects rabbit reply text above cap", () => {
    const rejected = "x".repeat(MAX_RABBIT_REPLY_CHARS + 1);
    expect(
      RabbitResponseSchema.safeParse({
        reply_text: rejected,
        tone: "Clinical",
        selected_node_id: "N14_FinalQuestion",
        set_flags: [],
        memory_quote_used: "",
        morph_signal: {
          classification: "Curiosity",
          phase: "Intake",
          tone: "Clinical",
          psych_delta: {},
          keywords: [],
        },
        world_directives: [],
        safety: { fiction_intact: true, no_meta_language: true },
      }).success,
    ).toBe(false);
  });
});
