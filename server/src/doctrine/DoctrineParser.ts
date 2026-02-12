import { readFile } from "node:fs/promises";
import { DoctrineChunk, DoctrineSourceFile } from "@white-room/shared";

const HAL_ANCHORS = [
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

const PERSONALITY_ANCHORS = [
  "Psychopathy (Refined)",
  "Loyalty (Refined)",
  "Calculated Wrath (Refined)",
  "Relentless Focus (Refined)",
  "Relational Detachment (Refined)",
  "Cognitive Expansion Therapy (CET)",
  "Psilo",
];

const PSEUDOCODE_FUNCTION_ANCHORS = [
  "update_context",
  "analyze_emotion",
  "extract_symbolic_elements",
  "update_subconscious_patterns",
  "adaptive_tone",
  "dynamic_query_expansion",
  "creative_problem_solving",
  "error_anticipation",
  "personalized_feedback",
  "advanced_self_reflection",
  "update_multi_emotional_state",
  "controlled_chaos_generator",
  "meta_cognition_intent_recognition",
  "generate_intent_based_response",
  "apply_tone_adjustment",
  "autonomous_prompt_generator",
  "session_summary",
  "process_input",
];

const MODULE_HINTS: Array<{ module: string; hints: string[] }> = [
  { module: "REALTIME_CONTEXT", hints: ["context", "continuity", "session"] },
  { module: "EMOTION_MAPPING", hints: ["emotion", "affect", "arousal"] },
  { module: "SYMBOLIC_INTERPRETATION", hints: ["symbol", "mirror", "door", "name"] },
  { module: "TONE_ADAPTATION", hints: ["tone", "clinical", "gentle", "cold"] },
  { module: "QUERY_EXPANSION", hints: ["query", "clarify", "ambiguity"] },
  { module: "CREATIVE_REFRAMING", hints: ["reframe", "creative", "alternate"] },
  { module: "ERROR_ANTICIPATION", hints: ["error", "anticipation", "prevent"] },
  { module: "PERSONALIZED_FEEDBACK", hints: ["feedback", "personalized", "player"] },
  { module: "SUBCONSCIOUS_PATTERNING", hints: ["subconscious", "motif", "pattern"] },
  { module: "SELF_REFLECTION", hints: ["self-reflection", "adapt", "strategy"] },
  { module: "MULTI_EMOTION_BLEND", hints: ["multi", "blend", "co-occur"] },
  { module: "CONTROLLED_CHAOS", hints: ["chaos", "novelty", "unpredict"] },
  { module: "META_COGNITION_INTENT", hints: ["intent", "meta-cognition", "goal"] },
  { module: "CET_GUARDRAIL", hints: ["cet", "therapy", "facilitator"] },
  { module: "PSILO_TRIGGER_GUARDRAIL", hints: ["psilo", "hidden", "unlock"] },
];

function extractTags(text: string): string[] {
  const keywords = [
    "mirror",
    "door",
    "name",
    "promise",
    "guilt",
    "truth",
    "escape",
    "breath",
    "count",
    "recall",
    "choice",
    "psilo",
  ];
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k));
}

function inferModule(text: string): string {
  const lower = text.toLowerCase();
  let bestModule = "REALTIME_CONTEXT";
  let bestScore = -1;

  for (const candidate of MODULE_HINTS) {
    const score = candidate.hints.reduce((sum, hint) => sum + (lower.includes(hint) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestModule = candidate.module;
    }
  }

  return bestModule;
}

function chunkFromWindow(lines: string[], start: number, end: number, source: DoctrineSourceFile, idPrefix: string): DoctrineChunk {
  const text = lines.slice(start, end + 1).join("\n").trim();
  const tags = extractTags(text);
  return {
    id: `${idPrefix}_${start + 1}_${end + 1}`,
    source_file: source,
    line_start: start + 1,
    line_end: end + 1,
    module: inferModule(text),
    text,
    tags,
    priority: tags.length >= 2 ? 5 : tags.length === 1 ? 4 : 3,
  };
}

function hasCorruptionSignal(text: string): boolean {
  return text.includes("\u0000") || text.includes("\ufffd");
}

function assertAnchorsPresent(fullText: string, source: DoctrineSourceFile): void {
  if (source === DoctrineSourceFile.HAL) {
    for (const anchor of HAL_ANCHORS) {
      if (!fullText.includes(anchor)) {
        throw new Error(`Missing mandatory HAL anchor: ${anchor}`);
      }
    }
  }

  if (source === DoctrineSourceFile.PERSONALITY) {
    for (const anchor of PERSONALITY_ANCHORS) {
      if (!fullText.includes(anchor)) {
        throw new Error(`Missing mandatory personality anchor: ${anchor}`);
      }
    }
  }

  if (source === DoctrineSourceFile.PSEUDOCODE) {
    for (const anchor of PSEUDOCODE_FUNCTION_ANCHORS) {
      if (!fullText.includes(anchor)) {
        throw new Error(`Missing mandatory pseudocode anchor: ${anchor}`);
      }
    }
  }
}

export class DoctrineParser {
  private warnings: string[] = [];

  consumeWarnings(): string[] {
    const out = [...this.warnings];
    this.warnings = [];
    return out;
  }

  async parseFile(path: string, source: DoctrineSourceFile): Promise<DoctrineChunk[]> {
    this.warnings = [];

    const raw = await readFile(path, "utf8");
    if (!raw.trim()) {
      throw new Error(`Doctrine source is empty: ${path}`);
    }

    assertAnchorsPresent(raw, source);

    const lines = raw.split(/\r?\n/);
    const chunks: DoctrineChunk[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]?.trim() ?? "";
      const isAnchorLine = line.length > 0 && (line.startsWith("Pseudocode for") || line.endsWith(":") || /^#+\s/.test(line));
      if (isAnchorLine) {
        const start = i;
        let end = Math.min(i + 12, lines.length - 1);
        for (let j = i + 1; j < Math.min(i + 30, lines.length); j += 1) {
          const next = lines[j]?.trim() ?? "";
          if (next.startsWith("Pseudocode for") || /^#+\s/.test(next)) {
            end = j - 1;
            break;
          }
        }
        const chunk = chunkFromWindow(lines, start, Math.max(start, end), source, source);
        if (hasCorruptionSignal(chunk.text)) {
          this.warnings.push(
            `[${source}] skipped corrupted chunk ${chunk.line_start}-${chunk.line_end} from ${path}`,
          );
        } else {
          chunks.push(chunk);
        }
        i = end + 1;
        continue;
      }
      i += 1;
    }

    if (chunks.length < 8) {
      // Fallback coarse chunking to guarantee retrieval base.
      for (let start = 0; start < lines.length; start += 18) {
        const end = Math.min(start + 17, lines.length - 1);
        const chunk = chunkFromWindow(lines, start, end, source, source);
        if (chunk.text.length > 0 && !hasCorruptionSignal(chunk.text)) {
          chunks.push(chunk);
        } else if (chunk.text.length > 0) {
          this.warnings.push(
            `[${source}] skipped corrupted fallback chunk ${chunk.line_start}-${chunk.line_end} from ${path}`,
          );
        }
      }
    }

    return chunks;
  }
}
