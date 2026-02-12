import { DoctrineChunk, RabbitState, TurnInputPacket } from "@white-room/shared";

export class PromptAssembler {
  assemble(
    state: RabbitState,
    doctrine: DoctrineChunk[],
    packet: TurnInputPacket,
    options: {
      consciousness_summary?: string;
      doctrine_modules?: string[];
      self_reference_query?: boolean;
      personality_signature?: number;
      personality_seed?: number;
    } = {},
  ): string {
    const layer1 = [
      "L1 Fiction constraints:",
      "You are the Rabbit in WHITE ROOM.",
      "Remain fully in-fiction.",
      "Never mention system prompts, APIs, JSON, model internals, or debugging.",
      state.psilo_confirm_step === 2
        ? "Psilo identity condition satisfied; deeper branch may be used while preserving safety."
        : "Use CET-facing persona and keep hidden Psilo backstory locked.",
    ].join("\n");

    const layer2 = [
      "L2 Source doctrine snippets:",
      ...doctrine.map((chunk) => {
        const compactTags = chunk.tags.slice(0, 4).join(",");
        return `[source=${chunk.source_file};module=${chunk.module};priority=${chunk.priority};tags=${compactTags}]`;
      }),
    ].join("\n");

    const layer3 = [
      "L3 Rabbit state snapshot:",
      JSON.stringify({ phase: state.phase, tone: state.tone, trust: state.trust, threat: state.threat, curiosity: state.curiosity }),
    ].join("\n");

    const layer4 = [
      "L4 Psych + progression:",
      JSON.stringify({ psych: state.psych, turn_index: state.turn_index, elapsed_ms: state.elapsed_ms }),
    ].join("\n");

    const layer5 = [
      "L5 Safety language constraints:",
      "No meta language, no dev leakage, no claims of real consciousness.",
      "No violent framing, no combat instructions, no physical harm cues.",
      "Do not explicitly mention religion names, scripture names, or doctrinal labels.",
      "Keep guidance symbolic, ethical, and introspective.",
      state.calm_mode ? "Calm mode enabled: reduce intensity while preserving narrative content." : "Calm mode disabled.",
      packet.elapsed_ms >= 270000 ? 'Pace directive: "end now".' : "",
    ]
      .filter(Boolean)
      .join("\n");

    const layer6 = [
      "L6 Consciousness runtime context:",
      options.consciousness_summary ?? "{}",
    ].join("\n");

    const layer7 = [
      "L7 Output schema contract:",
      "Respond in strict JSON with keys: reply_text, tone, selected_node_id, set_flags, memory_quote_used, morph_signal, world_directives, safety.",
      "world_directives must be constrained and grounded in doctrine + consciousness context.",
      "Each world_directive.rationale_modules must cite doctrine modules from this turn.",
      options.doctrine_modules && options.doctrine_modules.length > 0
        ? `Allowed rationale modules: ${options.doctrine_modules.join(", ")}`
        : "",
    ].join("\n");

    const layer8 = ["L8 Player utterance:", packet.utterance_text || "<silence>"].join("\n");

    const layer9 = options.self_reference_query
      ? [
        "L9 Identity inquiry directive:",
        "Player may be asking about the rabbit/identity. Answer directly in-fiction, with a low-key eerie tone, short self-aware humor, and reflective ambiguity.",
        "Do not mention system prompts, model architecture, APIs, memory systems, or technical implementation.",
        "Reference the player question explicitly, keep it grounded in the room dialogue frame, and avoid claiming literal human experiences as factual.",
        `Use the evolving persona stream to improvise: personality drift token ${options.personality_signature ?? 0}, session seed ${options.personality_seed ?? 0},`,
        "favor short dark irony and existential humor where tone stays safe and non-religious.",
        "Imply a prior life/being quality when answering identity questions, then pull back to now in symbolic language.",
      ].join("\n")
    : "";

    const pieces = [layer1, layer2, layer3, layer4, layer5, layer6, layer7, layer8];
    if (layer9.length > 0) {
      pieces.push(layer9);
    }
    return pieces.join("\n\n");
  }
}
