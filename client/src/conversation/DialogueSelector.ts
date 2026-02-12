import { DialogueNode, ProgressFlag, RabbitState } from "@white-room/shared";

function nodeMatches(node: DialogueNode, state: RabbitState, flags: Set<ProgressFlag>): boolean {
  return node.conditions.some((condition) => {
    if (condition.min_trust !== undefined && state.trust < condition.min_trust) return false;
    if (condition.min_threat !== undefined && state.threat < condition.min_threat) return false;
    if (condition.min_curiosity !== undefined && state.curiosity < condition.min_curiosity) return false;

    if (condition.requires_tags && condition.requires_tags.length > 0) {
      const stateTags = new Set(state.last_tags);
      for (const tag of condition.requires_tags) {
        if (!stateTags.has(tag)) return false;
      }
    }

    if (condition.requires_flags && condition.requires_flags.length > 0) {
      for (const flag of condition.requires_flags) {
        if (!flags.has(flag)) return false;
      }
    }

    return true;
  });
}

export function selectNode(nodes: DialogueNode[], state: RabbitState, flags: Set<ProgressFlag>): DialogueNode {
  const phaseNodes = nodes.filter((node) => node.phase === state.phase);
  const candidates = phaseNodes.filter((node) => nodeMatches(node, state, flags));
  const pool = candidates.length > 0 ? candidates : phaseNodes;

  if (pool.length === 0) {
    throw new Error(`No dialogue nodes for phase ${state.phase}`);
  }

  return pool[state.turn_index % pool.length];
}

export function templateWithQuote(node: DialogueNode, turn: number, quote: string): string {
  const raw = node.reply_templates[turn % node.reply_templates.length] ?? "Speak.";
  if (!raw.includes("{quote}")) {
    return raw;
  }

  const safeQuote = quote.trim() ? quote : "that line you gave me";
  return raw.replaceAll("{quote}", safeQuote);
}
