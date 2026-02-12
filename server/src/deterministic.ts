import {
  PlayerClassification,
  ProgressFlag,
  RabbitPhase,
  RabbitResponse,
  RabbitTone,
  TurnInputPacket,
} from "@white-room/shared";

function lineFor(packet: TurnInputPacket): string {
  if (packet.elapsed_ms >= 270000) {
    return "Time has narrowed. One sentence now decides the door.";
  }

  switch (packet.phase) {
    case RabbitPhase.Intake:
      return "There is one room. One rabbit. Speak your first true sentence.";
    case RabbitPhase.Destabilize:
      return "You hold two stories at once. Name the contradiction.";
    case RabbitPhase.Mirror:
      return "The mirror is listening faster than you are speaking.";
    case RabbitPhase.Contract:
      return "State your boundary or accept the sequence.";
    case RabbitPhase.Exit:
      return "Final answer. No ornament.";
    default:
      return "Speak.";
  }
}

function toneFor(packet: TurnInputPacket): RabbitTone {
  if (packet.classification === PlayerClassification.Humor) return RabbitTone.Amused;
  if (packet.classification === PlayerClassification.Defiance) return RabbitTone.Cold;
  if (packet.classification === PlayerClassification.Compliance) return RabbitTone.Gentle;
  return RabbitTone.Clinical;
}

function flagsFor(packet: TurnInputPacket): ProgressFlag[] {
  const tags = new Set(packet.tags.map((t) => t.toLowerCase()));
  const flags: ProgressFlag[] = [];
  if (tags.has("fear") || tags.has("guilt")) flags.push(ProgressFlag.AdmittedFear);
  if (tags.has("truth")) flags.push(ProgressFlag.TruthStatementAccepted);
  if (tags.has("boundary")) flags.push(ProgressFlag.BoundaryDeclared);
  if (tags.has("breathe")) flags.push(ProgressFlag.BreathDone);
  if (tags.has("count")) flags.push(ProgressFlag.CountDone);
  if (tags.has("recall")) flags.push(ProgressFlag.RecallDone);
  if (tags.has("name")) flags.push(ProgressFlag.NameDone);
  if (tags.has("choose")) flags.push(ProgressFlag.ChoiceDone);
  return flags;
}

export function deterministicRabbit(packet: TurnInputPacket): RabbitResponse {
  return {
    reply_text: lineFor(packet),
    tone: toneFor(packet),
    selected_node_id: packet.phase === RabbitPhase.Exit ? "N15_ResolveEnding" : "N14_FinalQuestion",
    set_flags: flagsFor(packet),
    memory_quote_used: "",
    morph_signal: {
      classification: packet.classification,
      phase: packet.phase,
      tone: toneFor(packet),
      psych_delta: {
        uncertainty: packet.classification === PlayerClassification.Silence ? 0.18 : 0.05,
      },
      keywords: packet.tags,
    },
    world_directives: [],
    safety: {
      fiction_intact: true,
      no_meta_language: true,
    },
  };
}
