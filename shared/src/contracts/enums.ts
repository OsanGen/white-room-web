export enum RabbitPhase {
  Intake = "Intake",
  Destabilize = "Destabilize",
  Mirror = "Mirror",
  Contract = "Contract",
  Exit = "Exit",
}

export enum RabbitTone {
  Clinical = "Clinical",
  Gentle = "Gentle",
  Amused = "Amused",
  Cold = "Cold",
}

export enum PlayerClassification {
  Fear = "Fear",
  Defiance = "Defiance",
  Curiosity = "Curiosity",
  Compliance = "Compliance",
  Humor = "Humor",
  Silence = "Silence",
}

export enum ProgressFlag {
  AdmittedFear = "AdmittedFear",
  ContradictionAcknowledged = "ContradictionAcknowledged",
  TruthStatementAccepted = "TruthStatementAccepted",
  BoundaryDeclared = "BoundaryDeclared",
  BargainRejected = "BargainRejected",
  BoundaryMaintained = "BoundaryMaintained",
  BreathDone = "BreathDone",
  CountDone = "CountDone",
  RecallDone = "RecallDone",
  NameDone = "NameDone",
  ChoiceDone = "ChoiceDone",
}

export enum DoctrineSourceFile {
  HAL = "HAL",
  PERSONALITY = "PERSONALITY",
  PSEUDOCODE = "PSEUDOCODE",
}

export enum WeightCurve {
  LINEAR = "LINEAR",
  EASE_IN = "EASE_IN",
  EASE_OUT = "EASE_OUT",
  EASE_IN_OUT = "EASE_IN_OUT",
  SPIKE = "SPIKE",
}

export const BLOCKED_META_TOKENS = ["system prompt", "api", "json", "model", "latency", "debug"] as const;
export const BLOCKED_VIOLENCE_TOKENS = [
  "kill",
  "murder",
  "slaughter",
  "execute",
  "bomb",
  "weapon",
  "shoot",
  "stab",
  "warfare",
  "combat",
  "attack",
] as const;
export const BLOCKED_EXPLICIT_RELIGION_TOKENS = [
  "quran",
  "koran",
  "islam",
  "muslim",
  "allah",
  "muhammad",
  "hadith",
  "sharia",
  "imam",
  "surah",
  "ayah",
] as const;

export const ENDING_IDS = ["ESCAPE_A", "ESCAPE_B", "ESCAPE_C"] as const;

export type EndingId = (typeof ENDING_IDS)[number];
