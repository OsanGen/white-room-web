import { RabbitPhase, RabbitTone } from "../contracts/enums";
import { PsychVector, RabbitState } from "../contracts/models";

export const SESSION_HARD_LIMIT_MS = 300000;
export const FORCED_FINAL_BRANCH_AT_MS = 270000;
export const MAX_RABBIT_REPLY_CHARS = 640;

export const DEFAULT_PSYCH_VECTOR: PsychVector = {
  uncertainty: 0,
  control: 0,
  arousal: 0,
  threat_anticipation: 0,
  self_salience: 0,
  cognitive_dissonance: 0,
};

export const DEFAULT_RABBIT_STATE: RabbitState = {
  phase: RabbitPhase.Intake,
  tone: RabbitTone.Clinical,
  trust: 35,
  threat: 15,
  curiosity: 20,
  memory: [],
  last_tags: [],
  active_goals: ["establish_frame"],
  psych: DEFAULT_PSYCH_VECTOR,
  elapsed_ms: 0,
  turn_index: 0,
  llm_reject_count: 0,
  calm_mode: false,
  silence_count: 0,
  psilo_confirm_step: 0,
  final_question_asked: false,
};
