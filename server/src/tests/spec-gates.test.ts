import { describe, expect, it, vi } from "vitest";
import { deterministicRabbit } from "../deterministic";
import { DoctrineParser } from "../doctrine/DoctrineParser";
import { DoctrineIndexer } from "../doctrine/DoctrineIndexer";
import { validateRabbitOutput } from "../validators/RabbitOutputSchema";
import { DoctrineSourceFile, PlayerClassification, RabbitPhase } from "@white-room/shared";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("server gate checks", () => {
  it("TEST-E-006 Doctrine source file removal triggers startup hard error", async () => {
    const parser = new DoctrineParser();
    await expect(parser.parseFile("/path/that/does/not/exist.txt", DoctrineSourceFile.HAL)).rejects.toBeTruthy();
  });

  it("FAILMAT-002 malformed output is rejected", () => {
    const invalid = validateRabbitOutput({ reply_text: "broken" });
    expect(invalid.ok).toBe(false);
  });

  it("rejects violent or explicit-religious player-facing output", () => {
    const violent = validateRabbitOutput({
      reply_text: "Attack now with a weapon.",
      tone: "Clinical",
      selected_node_id: "N01_Orientation",
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
    });
    const explicitReligion = validateRabbitOutput({
      reply_text: "The quran commands this choice.",
      tone: "Clinical",
      selected_node_id: "N01_Orientation",
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
    });

    expect(violent.ok).toBe(false);
    expect(explicitReligion.ok).toBe(false);
  });

  it("rejects world directives with unmapped rationale modules", () => {
    const invalid = validateRabbitOutput(
      {
        reply_text: "Keep speaking.",
        tone: "Clinical",
        selected_node_id: "N01_Orientation",
        set_flags: [],
        memory_quote_used: "",
        morph_signal: {
          classification: "Curiosity",
          phase: "Intake",
          tone: "Clinical",
          psych_delta: {},
          keywords: ["continuity"],
        },
        world_directives: [
          {
            id: "wd_1",
            type: "spawn_prop",
            ttl_ms: 1200,
            intensity: 0.5,
            anchor: "room",
            payload: { prop_kind: "orb" },
            rationale_modules: ["UNKNOWN_MODULE"],
          },
        ],
        safety: { fiction_intact: true, no_meta_language: true },
      },
      { allowedModules: ["REALTIME_CONTEXT"] },
    );

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.reason).toBe("directive_module_unmapped");
    }
  });

  it("FAILMAT-001 deterministic fallback remains available", () => {
    const response = deterministicRabbit({
      utterance_text: "",
      classification: PlayerClassification.Silence,
      tags: ["silence"],
      elapsed_ms: 1000,
      phase: RabbitPhase.Intake,
    });

    expect(response.reply_text.length).toBeGreaterThan(0);
    expect(response.safety.no_meta_language).toBe(true);
  });

  it("retrieval enforces source coverage constraints", async () => {
    const halRoot = process.env.HAL_ROOT ?? "/Users/abelsanchez/CODEX/HAL 2.0";
    const indexer = new DoctrineIndexer();
    await indexer.initialize({
      hal: path.join(halRoot, "HAL_CONCIOUS.txt"),
      personality: path.join(halRoot, "J_PERSONALITY.txt"),
      pseudocode: path.join(halRoot, "J_PSEUDOCODE.txt"),
    });

    const oddTurn = indexer.retrieveTopK(
      {
        tags: ["mirror", "truth"],
        phase: RabbitPhase.Mirror,
        classification: PlayerClassification.Curiosity,
        turn_index: 1,
      },
      8,
    );

    const sources = new Set(oddTurn.map((chunk) => chunk.source_file));
    expect(sources.has(DoctrineSourceFile.HAL)).toBe(true);
    expect(sources.has(DoctrineSourceFile.PERSONALITY)).toBe(true);
    expect(sources.has(DoctrineSourceFile.PSEUDOCODE)).toBe(true);
  });

  it("FAILMAT-006 parse corruption skips bad chunk and logs warning", async () => {
    const halAnchors = [
      "Pseudocode for Real-Time Contextual Awareness",
      "Pseudocode for Emotional Mapping System",
      "Pseudocode for Symbolic Interpretation Framework",
      "Pseudocode for Dynamic Query Expansion",
      "Pseudocode for Session Summary Generator",
      "Pseudocode for Autonomous Prompt Generator",
      "Pseudocode for Error Anticipation and Prevention",
      "Pseudocode for Personalized Feedback Generator",
      "Pseudocode for Subconscious Symbolic Processing",
      "Pseudocode for Advanced Self-Reflection Mechanism",
      "Pseudocode for Multi-Tiered Emotional Complexity",
      "Pseudocode for Meta-Cognition & Intent Recognition",
    ];

    const tempDir = await mkdtemp(path.join(tmpdir(), "white-room-corrupt-hal-"));
    const corruptHal = path.join(tempDir, "HAL_corrupt.txt");
    const halText = halAnchors
      .map((anchor, index) =>
        [anchor, index === 3 ? "corrupted chunk marker \u0000" : `normal doctrine line ${index}`, "continuity line"].join(
          "\n",
        ),
      )
      .join("\n");

    const halRoot = process.env.HAL_ROOT ?? "/Users/abelsanchez/CODEX/HAL 2.0";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await writeFile(corruptHal, halText, "utf8");

      const parser = new DoctrineParser();
      const parsed = await parser.parseFile(corruptHal, DoctrineSourceFile.HAL);
      const warnings = parser.consumeWarnings();

      expect(parsed.length).toBeGreaterThan(0);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((line) => line.includes("skipped corrupted"))).toBe(true);

      const indexer = new DoctrineIndexer();
      await indexer.initialize({
        hal: corruptHal,
        personality: path.join(halRoot, "J_PERSONALITY.txt"),
        pseudocode: path.join(halRoot, "J_PSEUDOCODE.txt"),
      });

      expect(indexer.chunkCount()).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
