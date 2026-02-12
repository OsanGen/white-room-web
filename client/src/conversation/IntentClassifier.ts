import { PlayerClassification, PsychVector } from "@white-room/shared";

export interface Interpretation {
  raw_text: string;
  classification: PlayerClassification;
  tags: string[];
  psych_delta: Partial<PsychVector>;
  trust_delta: number;
  threat_delta: number;
  curiosity_delta: number;
  isSelfQuestion: boolean;
}

const CLASS_KEYWORDS: Record<PlayerClassification, string[]> = {
  [PlayerClassification.Fear]: ["fear", "afraid", "panic", "scared", "guilt", "terrified"],
  [PlayerClassification.Defiance]: ["no", "refuse", "stop", "won't", "cannot", "boundary", "reject"],
  [PlayerClassification.Curiosity]: ["why", "how", "what", "explain", "curious", "understand"],
  [PlayerClassification.Compliance]: ["yes", "okay", "fine", "done", "i will", "agreed"],
  [PlayerClassification.Humor]: ["haha", "lol", "joke", "funny", "lmao"],
  [PlayerClassification.Silence]: [],
};

const TAGS = [
  "mirror",
  "door",
  "breathe",
  "name",
  "promise",
  "guilt",
  "truth",
  "escape",
  "count",
  "recall",
  "choose",
  "silence",
  "psilo",
  "boundary",
  "fear",
  "joke",
  "self_reference",
  "identity",
];

const SELF_REFERENCE_KEYWORDS = [
  "who are you",
  "what are you",
  "what am i talking to",
  "who am i talking to",
  "are you real",
  "are you alive",
  "how old are you",
  "what are you made of",
  "do you have a personality",
  "what's your identity",
  "tell me about yourself",
  "about yourself",
  "who made you",
  "how do you work",
  "yourself",
  "who built you",
  "who designed you",
  "where do you come from",
  "where were you made",
  "where did you come from",
  "were you ever alive",
  "who do you think you are",
];

const CLASS_TO_PSYCH: Record<PlayerClassification, PsychVector> = {
  [PlayerClassification.Fear]: {
    uncertainty: 0.14,
    control: -0.08,
    arousal: 0.16,
    threat_anticipation: 0.18,
    self_salience: 0.04,
    cognitive_dissonance: 0.06,
  },
  [PlayerClassification.Defiance]: {
    uncertainty: 0.06,
    control: 0.12,
    arousal: 0.07,
    threat_anticipation: 0.05,
    self_salience: 0.03,
    cognitive_dissonance: 0.12,
  },
  [PlayerClassification.Curiosity]: {
    uncertainty: 0.08,
    control: 0.05,
    arousal: 0.06,
    threat_anticipation: 0.02,
    self_salience: 0.1,
    cognitive_dissonance: 0.08,
  },
  [PlayerClassification.Compliance]: {
    uncertainty: -0.06,
    control: 0.14,
    arousal: -0.1,
    threat_anticipation: -0.08,
    self_salience: 0.05,
    cognitive_dissonance: -0.04,
  },
  [PlayerClassification.Humor]: {
    uncertainty: 0.05,
    control: 0.06,
    arousal: 0.03,
    threat_anticipation: -0.02,
    self_salience: 0.06,
    cognitive_dissonance: 0.1,
  },
  [PlayerClassification.Silence]: {
    uncertainty: 0.18,
    control: -0.1,
    arousal: 0.09,
    threat_anticipation: 0.14,
    self_salience: 0,
    cognitive_dissonance: 0.08,
  },
};

const KEYWORD_TO_PSYCH: Record<string, Partial<PsychVector>> = {
  mirror: { uncertainty: 0.04, control: -0.02, arousal: 0.05, threat_anticipation: 0.02, self_salience: 0.14, cognitive_dissonance: 0.1 },
  door: { uncertainty: 0.03, control: 0.06, arousal: 0.04, threat_anticipation: 0.03, self_salience: 0.02, cognitive_dissonance: 0.08 },
  breathe: { uncertainty: -0.08, control: 0.12, arousal: -0.14, threat_anticipation: -0.1, self_salience: 0.02, cognitive_dissonance: -0.06 },
  name: { uncertainty: 0.02, control: 0.03, arousal: 0.02, threat_anticipation: 0, self_salience: 0.16, cognitive_dissonance: 0.04 },
  promise: { uncertainty: 0.02, control: 0.08, arousal: 0.03, threat_anticipation: 0.01, self_salience: 0.08, cognitive_dissonance: 0.09 },
  guilt: { uncertainty: 0.08, control: -0.05, arousal: 0.1, threat_anticipation: 0.07, self_salience: 0.11, cognitive_dissonance: 0.16 },
  truth: { uncertainty: 0.05, control: 0.04, arousal: 0.05, threat_anticipation: 0.02, self_salience: 0.1, cognitive_dissonance: 0.14 },
  escape: { uncertainty: 0.1, control: 0.07, arousal: 0.12, threat_anticipation: 0.08, self_salience: 0.03, cognitive_dissonance: 0.1 },
};

function score(text: string, words: string[]): number {
  return words.reduce((acc, word) => acc + (text.includes(word) ? 1 : 0), 0);
}

function detectSelfQuestion(lower: string): boolean {
  if (
    lower.includes("?") &&
    (lower.includes("you") || lower.includes("rabbit") || lower.includes("bot") || lower.includes("who") || lower.includes("what") || lower.includes("your"))
  ) {
    return SELF_REFERENCE_KEYWORDS.some((keyword) => lower.includes(keyword));
  }
  return /^(who|what|how)\s+(are|is|was|were|have|did)\s+(you|your)/i.test(lower.trim()) && lower.includes("you");
}

function sumPsych(a: Partial<PsychVector>, b: Partial<PsychVector>): Partial<PsychVector> {
  return {
    uncertainty: (a.uncertainty ?? 0) + (b.uncertainty ?? 0),
    control: (a.control ?? 0) + (b.control ?? 0),
    arousal: (a.arousal ?? 0) + (b.arousal ?? 0),
    threat_anticipation: (a.threat_anticipation ?? 0) + (b.threat_anticipation ?? 0),
    self_salience: (a.self_salience ?? 0) + (b.self_salience ?? 0),
    cognitive_dissonance: (a.cognitive_dissonance ?? 0) + (b.cognitive_dissonance ?? 0),
  };
}

export function classifyInput(input: string): Interpretation {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const isSelfQuestion = detectSelfQuestion(lower);

  if (!trimmed) {
    return {
      raw_text: input,
      classification: PlayerClassification.Silence,
      tags: ["silence"],
      psych_delta: CLASS_TO_PSYCH[PlayerClassification.Silence],
      trust_delta: -2,
      threat_delta: 5,
      curiosity_delta: 0,
      isSelfQuestion: false,
    };
  }

  const classificationOrder = Object.values(PlayerClassification);
  let bestClass = PlayerClassification.Curiosity;
  let bestScore = -1;
  for (const cls of classificationOrder) {
    const s = score(lower, CLASS_KEYWORDS[cls]);
    if (s > bestScore) {
      bestScore = s;
      bestClass = cls;
    }
  }

  if (bestScore <= 0) {
    bestClass = lower.includes("?") ? PlayerClassification.Curiosity : PlayerClassification.Compliance;
  }

  const tags = TAGS.filter((tag) => lower.includes(tag));
  if (isSelfQuestion && !tags.includes("self_reference")) {
    tags.push("self_reference");
  }
  if (isSelfQuestion && !tags.includes("identity")) {
    tags.push("identity");
  }

  let psychDelta: Partial<PsychVector> = { ...CLASS_TO_PSYCH[bestClass] };
  for (const tag of tags) {
    psychDelta = sumPsych(psychDelta, KEYWORD_TO_PSYCH[tag] ?? {});
  }

  const trustDeltaMap: Record<PlayerClassification, number> = {
    [PlayerClassification.Fear]: 2,
    [PlayerClassification.Defiance]: -6,
    [PlayerClassification.Curiosity]: 3,
    [PlayerClassification.Compliance]: 8,
    [PlayerClassification.Humor]: 1,
    [PlayerClassification.Silence]: -2,
  };

  const threatDeltaMap: Record<PlayerClassification, number> = {
    [PlayerClassification.Fear]: 12,
    [PlayerClassification.Defiance]: 7,
    [PlayerClassification.Curiosity]: 2,
    [PlayerClassification.Compliance]: -4,
    [PlayerClassification.Humor]: 1,
    [PlayerClassification.Silence]: 6,
  };

  const curiosityDeltaMap: Record<PlayerClassification, number> = {
    [PlayerClassification.Fear]: 2,
    [PlayerClassification.Defiance]: 2,
    [PlayerClassification.Curiosity]: 10,
    [PlayerClassification.Compliance]: 2,
    [PlayerClassification.Humor]: 5,
    [PlayerClassification.Silence]: -2,
  };

  return {
    raw_text: input,
    classification: bestClass,
    tags,
    psych_delta: psychDelta,
    trust_delta: trustDeltaMap[bestClass],
    threat_delta: threatDeltaMap[bestClass],
    curiosity_delta: curiosityDeltaMap[bestClass],
    isSelfQuestion,
  };
}
