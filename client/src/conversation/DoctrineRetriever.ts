import { DoctrineChunk, DoctrineSourceFile, PlayerClassification, RabbitPhase } from "@white-room/shared";

const fallbackChunks: DoctrineChunk[] = [
  {
    id: "HAL_CONTEXT",
    source_file: DoctrineSourceFile.HAL,
    line_start: 1,
    line_end: 1,
    module: "REALTIME_CONTEXT",
    text: "Maintain real-time contextual continuity and reference recent user statements.",
    tags: ["context", "continuity", "memory"],
    priority: 5,
  },
  {
    id: "HAL_EMOTION",
    source_file: DoctrineSourceFile.HAL,
    line_start: 2,
    line_end: 2,
    module: "EMOTION_MAPPING",
    text: "Map user affect to rabbit tone while preserving phase constraints.",
    tags: ["emotion", "tone", "phase"],
    priority: 4,
  },
  {
    id: "PERSONALITY_CET",
    source_file: DoctrineSourceFile.PERSONALITY,
    line_start: 1,
    line_end: 1,
    module: "CET_GUARDRAIL",
    text: "Default to CET-facing therapeutic framing and do not leak hidden backstory.",
    tags: ["cet", "guardrail", "safety"],
    priority: 5,
  },
  {
    id: "PERSONALITY_PSILO",
    source_file: DoctrineSourceFile.PERSONALITY,
    line_start: 2,
    line_end: 2,
    module: "PSILO_TRIGGER_GUARDRAIL",
    text: "Psilo identity branch remains locked unless explicit two-step confirmation occurs.",
    tags: ["psilo", "lock", "identity"],
    priority: 5,
  },
  {
    id: "PSEUDOCODE_PROCESS",
    source_file: DoctrineSourceFile.PSEUDOCODE,
    line_start: 1,
    line_end: 1,
    module: "META_COGNITION_INTENT",
    text: "Use process_input, analyze_emotion, and generate_intent_based_response orchestration.",
    tags: ["process_input", "intent", "orchestration"],
    priority: 4,
  },
  {
    id: "PSEUDOCODE_ERROR",
    source_file: DoctrineSourceFile.PSEUDOCODE,
    line_start: 2,
    line_end: 2,
    module: "ERROR_ANTICIPATION",
    text: "If output fails validation, simplify and recover with deterministic fallback.",
    tags: ["error", "fallback", "validation"],
    priority: 4,
  },
];

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bset = new Set(b);
  return a.filter((x) => bset.has(x)).length / Math.max(1, Math.min(a.length, b.length));
}

function phaseAlignment(phase: RabbitPhase, chunk: DoctrineChunk): number {
  const key = phase.toLowerCase();
  return chunk.text.toLowerCase().includes(key) ? 1 : 0.2;
}

function classAlignment(classification: PlayerClassification, chunk: DoctrineChunk): number {
  const key = classification.toLowerCase();
  return chunk.text.toLowerCase().includes(key) ? 1 : 0.2;
}

export class DoctrineRetriever {
  retrieve(input: { tags: string[]; phase: RabbitPhase; classification: PlayerClassification; turn: number }): DoctrineChunk[] {
    const scored = fallbackChunks.map((chunk) => {
      const score =
        0.35 * overlap(input.tags, chunk.tags) +
        0.2 * phaseAlignment(input.phase, chunk) +
        0.2 * classAlignment(input.classification, chunk) +
        0.15 * overlap(input.tags, chunk.text.toLowerCase().split(/\W+/)) +
        0.1 * (1 - ((chunk.line_start + input.turn) % 12) / 12);
      return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score || b.chunk.priority - a.chunk.priority);
    const chosen = scored.slice(0, 8).map((x) => x.chunk);

    const sourceSet = new Set(chosen.map((chunk) => chunk.source_file));
    if (!sourceSet.has(DoctrineSourceFile.HAL)) {
      chosen.push(fallbackChunks.find((chunk) => chunk.source_file === DoctrineSourceFile.HAL)!);
    }
    if (!sourceSet.has(DoctrineSourceFile.PERSONALITY)) {
      chosen.push(fallbackChunks.find((chunk) => chunk.source_file === DoctrineSourceFile.PERSONALITY)!);
    }
    if (input.turn % 2 === 1 && !sourceSet.has(DoctrineSourceFile.PSEUDOCODE)) {
      chosen.push(fallbackChunks.find((chunk) => chunk.source_file === DoctrineSourceFile.PSEUDOCODE)!);
    }

    return chosen.slice(0, 8);
  }
}
