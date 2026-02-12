import { DoctrineChunk, DoctrineSourceFile, PlayerClassification, RabbitPhase } from "@white-room/shared";
import { DoctrineParser } from "./DoctrineParser";

export interface RetrievalInput {
  tags: string[];
  phase: RabbitPhase;
  classification: PlayerClassification;
  turn_index: number;
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  const overlap = a.filter((x) => bSet.has(x)).length;
  return overlap / Math.max(1, Math.min(a.length, b.length));
}

function phaseScore(phase: RabbitPhase, text: string): number {
  const lower = text.toLowerCase();
  const map: Record<RabbitPhase, string[]> = {
    [RabbitPhase.Intake]: ["intake", "orientation", "baseline"],
    [RabbitPhase.Destabilize]: ["destabilize", "contradiction", "fear"],
    [RabbitPhase.Mirror]: ["mirror", "self", "reflection"],
    [RabbitPhase.Contract]: ["contract", "bargain", "boundary"],
    [RabbitPhase.Exit]: ["exit", "ending", "release"],
  };
  const hits = map[phase].reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
  return hits / 3;
}

function classScore(classification: PlayerClassification, text: string): number {
  const lower = text.toLowerCase();
  const map: Record<PlayerClassification, string[]> = {
    [PlayerClassification.Fear]: ["fear", "panic", "threat"],
    [PlayerClassification.Defiance]: ["boundary", "refuse", "defiance"],
    [PlayerClassification.Curiosity]: ["question", "curious", "why"],
    [PlayerClassification.Compliance]: ["follow", "guided", "comply"],
    [PlayerClassification.Humor]: ["humor", "joke", "amused"],
    [PlayerClassification.Silence]: ["silence", "quiet", "pause"],
  };
  const hits = map[classification].reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
  return hits / 3;
}

function bm25Approx(tags: string[], text: string): number {
  if (tags.length === 0) return 0;
  const lower = text.toLowerCase();
  const matches = tags.reduce((sum, tag) => sum + (lower.includes(tag.toLowerCase()) ? 1 : 0), 0);
  return matches / tags.length;
}

function recencyDecay(turnIndex: number, chunk: DoctrineChunk): number {
  const seed = (chunk.line_start + chunk.line_end + turnIndex) % 12;
  return 1 - seed / 12;
}

export class DoctrineIndexer {
  private chunks: DoctrineChunk[] = [];
  private readonly parser = new DoctrineParser();

  async initialize(paths: { hal: string; personality: string; pseudocode: string }): Promise<void> {
    const halChunks = await this.parser.parseFile(paths.hal, DoctrineSourceFile.HAL);
    this.emitParserWarnings();
    const personalityChunks = await this.parser.parseFile(paths.personality, DoctrineSourceFile.PERSONALITY);
    this.emitParserWarnings();
    const pseudocodeChunks = await this.parser.parseFile(paths.pseudocode, DoctrineSourceFile.PSEUDOCODE);
    this.emitParserWarnings();

    this.chunks = [...halChunks, ...personalityChunks, ...pseudocodeChunks];

    if (this.chunks.length === 0) {
      throw new Error("Doctrine index is empty");
    }
  }

  retrieveTopK(input: RetrievalInput, topK = 8): DoctrineChunk[] {
    const scored = this.chunks.map((chunk) => {
      const score =
        0.35 * overlapScore(input.tags, chunk.tags) +
        0.2 * phaseScore(input.phase, chunk.text) +
        0.2 * classScore(input.classification, chunk.text) +
        0.15 * bm25Approx(input.tags, chunk.text) +
        0.1 * recencyDecay(input.turn_index, chunk);

      return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score || b.chunk.priority - a.chunk.priority);
    const selected = scored.slice(0, topK).map((x) => x.chunk);

    this.ensureSourceCoverage(selected, DoctrineSourceFile.HAL);
    this.ensureSourceCoverage(selected, DoctrineSourceFile.PERSONALITY);
    if (input.turn_index % 2 === 1) {
      this.ensureSourceCoverage(selected, DoctrineSourceFile.PSEUDOCODE);
    }

    return selected;
  }

  private highestForSource(source: DoctrineSourceFile): DoctrineChunk | undefined {
    return this.chunks
      .filter((chunk) => chunk.source_file === source)
      .sort((a, b) => b.priority - a.priority || a.line_start - b.line_start)[0];
  }

  private ensureSourceCoverage(selected: DoctrineChunk[], source: DoctrineSourceFile): void {
    if (selected.some((chunk) => chunk.source_file === source)) {
      return;
    }

    const fallback = this.highestForSource(source);
    if (!fallback) {
      return;
    }

    // Keep list length stable by replacing the lowest-priority/least-constrained member.
    let replaceIndex = 0;
    for (let i = 1; i < selected.length; i += 1) {
      if (selected[i].priority < selected[replaceIndex].priority) {
        replaceIndex = i;
      }
    }
    selected[replaceIndex] = fallback;
  }

  chunkCount(): number {
    return this.chunks.length;
  }

  private emitParserWarnings(): void {
    for (const warning of this.parser.consumeWarnings()) {
      // eslint-disable-next-line no-console
      console.warn(`[doctrine] ${warning}`);
    }
  }
}
