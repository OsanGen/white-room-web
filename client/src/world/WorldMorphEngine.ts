import { PlayerClassification, RabbitPhase, RabbitState } from "@white-room/shared";
import recipesJson from "../data/effect_recipes.json";
import balanceJson from "../data/game_balance.json";
import { clamp, lerp } from "../utils/math";

export interface MorphFrame {
  light: { exposure: number; toplight: number; halo: number };
  geometry: { skew: number; wave: number };
  props: { mirror: number; doorline: number; eyes: number };
  audio: { heartbeat: number; hum: number };
  ui: { vignette: number; jitter: number; chroma: number };
  activeRecipeIds: string[];
}

interface Recipe {
  id: string;
  duration_ms: number;
  intensity: number;
  weight_curve: string;
  channels: {
    light: Record<string, number>;
    geometry: Record<string, number>;
    props: Record<string, number>;
    audio: Record<string, number>;
    ui: Record<string, number>;
  };
}

const recipes = recipesJson as Recipe[];
const gameBalance = balanceJson as {
  safety_caps_default: Record<string, number>;
  safety_caps_calm: Record<string, number>;
};

function activeRecipeIds(phase: RabbitPhase, classification: PlayerClassification, keywords: string[]): string[] {
  const ids = ["R01_ClinicalBaseline"];

  if (phase === RabbitPhase.Destabilize) ids.push("R02_OverexposedDrift");
  if (phase === RabbitPhase.Mirror) ids.push("R05_MirrorPresence");
  if (phase === RabbitPhase.Contract || phase === RabbitPhase.Exit) ids.push("R06_DoorlineReveal");

  if (classification === PlayerClassification.Fear) ids.push("R03_HarshToplight", "R07_EyeGlowPulse");
  if (classification === PlayerClassification.Silence) ids.push("R09_AudioVacuum");
  if (classification === PlayerClassification.Humor) ids.push("R10_ParallaxSlip", "R11_SubtitleGhosting");

  if (keywords.includes("mirror")) ids.push("R12_ShadowLag");
  if (keywords.includes("breathe")) ids.push("R08_CornerBreath", "R04_SoftHalo");

  return [...new Set(ids)];
}

function curveWeight(curve: string): number {
  switch (curve) {
    case "SPIKE":
      return 1;
    case "EASE_IN":
      return 0.8;
    case "EASE_OUT":
      return 0.8;
    case "LINEAR":
      return 0.7;
    default:
      return 0.75;
  }
}

export class WorldMorphEngine {
  private lastPhase: RabbitPhase | null = null;

  private previous: MorphFrame = {
    light: { exposure: 0.42, toplight: 0.2, halo: 0.15 },
    geometry: { skew: 0.05, wave: 0.04 },
    props: { mirror: 0, doorline: 0, eyes: 0.25 },
    audio: { heartbeat: 0.05, hum: 0.1 },
    ui: { vignette: 0.08, jitter: 0, chroma: 0 },
    activeRecipeIds: ["R01_ClinicalBaseline"],
  };

  compute(state: RabbitState, classification: PlayerClassification, keywords: string[], beatTrigger?: string): MorphFrame {
    const enteringPhase = this.lastPhase !== state.phase;
    const U = state.psych.uncertainty;
    const C = state.psych.control;
    const A = state.psych.arousal;
    const T = state.psych.threat_anticipation;
    const S = state.psych.self_salience;
    const D = state.psych.cognitive_dissonance;

    const base: MorphFrame = {
      light: {
        exposure: clamp(0.42 + 0.28 * A + 0.18 * U - 0.22 * C, 0, 1),
        toplight: clamp(0.2 + 0.4 * T + 0.2 * D, 0, 1),
        halo: clamp(0.15 + 0.35 * C + 0.2 * S - 0.15 * T, 0, 1),
      },
      geometry: {
        skew: clamp(0.05 + 0.45 * D + 0.25 * T + 0.1 * U, 0, 1),
        wave: clamp(0.04 + 0.35 * A + 0.2 * U, 0, 1),
      },
      props: {
        mirror: state.phase === RabbitPhase.Mirror || state.phase === RabbitPhase.Contract || state.phase === RabbitPhase.Exit ? clamp(0.3 + 0.5 * S + 0.2 * U, 0, 1) : 0,
        doorline: state.phase === RabbitPhase.Mirror || state.phase === RabbitPhase.Contract || state.phase === RabbitPhase.Exit ? clamp(0.25 + 0.35 * C + 0.2 * D, 0, 1) : 0,
        eyes: clamp(0.25 + 0.55 * T, 0, 1),
      },
      audio: {
        heartbeat: clamp(0.05 + 0.45 * T + 0.2 * A - 0.15 * C, 0, 1),
        hum: clamp(0.1 + 0.3 * U + 0.1 * D, 0, 1),
      },
      ui: {
        vignette: clamp(0.08 + 0.3 * T + 0.2 * U, 0, 1),
        jitter: clamp(0 + 0.28 * D + 0.12 * A, 0, 1),
        chroma: clamp(0 + 0.24 * D + 0.1 * T, 0, 1),
      },
      activeRecipeIds: [],
    };

    const ids = activeRecipeIds(state.phase, classification, keywords);

    // Scripted beat alignment from spec Section 10.5.
    if (state.phase === RabbitPhase.Intake && enteringPhase) {
      beatTrigger = beatTrigger ?? "BEAT-01";
    }
    if (state.phase === RabbitPhase.Destabilize && enteringPhase) {
      beatTrigger = beatTrigger ?? "BEAT-02";
      ids.push("R10_ParallaxSlip");
    }
    if (state.phase === RabbitPhase.Mirror && enteringPhase) {
      beatTrigger = beatTrigger ?? "BEAT-04";
      ids.push("R05_MirrorPresence", "R12_ShadowLag");
    }
    if (classification === PlayerClassification.Silence && state.turn_index >= 4) {
      beatTrigger = beatTrigger ?? "BEAT-03";
      ids.push("R09_AudioVacuum");
    }
    if (state.phase === RabbitPhase.Contract && state.silence_count >= 2) {
      beatTrigger = beatTrigger ?? "BEAT-05";
      ids.push("R09_AudioVacuum", "R03_HarshToplight");
    }

    const uniqueIds = [...new Set(ids)];
    const selectedRecipes = uniqueIds
      .map((id) => recipes.find((recipe) => recipe.id === id))
      .filter((recipe): recipe is Recipe => Boolean(recipe));

    const blended = structuredClone(base);

    for (const recipe of selectedRecipes) {
      const w = recipe.intensity * curveWeight(recipe.weight_curve);
      blended.light.exposure += (recipe.channels.light.exposure ?? 0) * w * 0.2;
      blended.light.toplight += (recipe.channels.light.toplight ?? 0) * w * 0.2;
      blended.light.halo += (recipe.channels.light.halo ?? 0) * w * 0.2;
      blended.geometry.skew += (recipe.channels.geometry.skew ?? 0) * w * 0.2;
      blended.geometry.wave += (recipe.channels.geometry.wave ?? 0) * w * 0.2;
      blended.props.mirror += (recipe.channels.props.mirror ?? 0) * w * 0.2;
      blended.props.doorline += (recipe.channels.props.doorline ?? 0) * w * 0.2;
      blended.props.eyes += (recipe.channels.props.eyes ?? 0) * w * 0.2;
      blended.audio.heartbeat += (recipe.channels.audio.heartbeat ?? 0) * w * 0.2;
      blended.audio.hum += (recipe.channels.audio.hum ?? 0) * w * 0.2;
      blended.ui.vignette += (recipe.channels.ui.vignette ?? 0) * w * 0.2;
      blended.ui.jitter += (recipe.channels.ui.jitter ?? 0) * w * 0.2;
      blended.ui.chroma += (recipe.channels.ui.chroma ?? 0) * w * 0.2;
    }

    if (beatTrigger === "BEAT-05") {
      blended.audio.heartbeat += 0.18;
      blended.audio.hum = clamp(blended.audio.hum - 0.08, 0, 1);
    }
    if (beatTrigger === "BEAT-04") {
      blended.props.mirror += 0.15;
      blended.ui.jitter += 0.05;
    }
    if (beatTrigger === "BEAT-02") {
      blended.geometry.wave += 0.08;
    }

    blended.activeRecipeIds = uniqueIds;

    const hardCut = beatTrigger === "BEAT-03" || beatTrigger === "BEAT-05";
    const smoothing = hardCut ? 1 : 0.65;

    const smoothed: MorphFrame = {
      light: {
        exposure: lerp(this.previous.light.exposure, blended.light.exposure, smoothing),
        toplight: lerp(this.previous.light.toplight, blended.light.toplight, smoothing),
        halo: lerp(this.previous.light.halo, blended.light.halo, smoothing),
      },
      geometry: {
        skew: lerp(this.previous.geometry.skew, blended.geometry.skew, smoothing),
        wave: lerp(this.previous.geometry.wave, blended.geometry.wave, smoothing),
      },
      props: {
        mirror: lerp(this.previous.props.mirror, blended.props.mirror, smoothing),
        doorline: lerp(this.previous.props.doorline, blended.props.doorline, smoothing),
        eyes: lerp(this.previous.props.eyes, blended.props.eyes, smoothing),
      },
      audio: {
        heartbeat: lerp(this.previous.audio.heartbeat, blended.audio.heartbeat, smoothing),
        hum: lerp(this.previous.audio.hum, blended.audio.hum, smoothing),
      },
      ui: {
        vignette: lerp(this.previous.ui.vignette, blended.ui.vignette, smoothing),
        jitter: lerp(this.previous.ui.jitter, blended.ui.jitter, smoothing),
        chroma: lerp(this.previous.ui.chroma, blended.ui.chroma, smoothing),
      },
      activeRecipeIds: uniqueIds,
    };

    const caps = state.calm_mode ? gameBalance.safety_caps_calm : gameBalance.safety_caps_default;
    smoothed.ui.chroma = clamp(smoothed.ui.chroma, 0, caps.chroma_max);
    smoothed.ui.vignette = clamp(smoothed.ui.vignette, 0, caps.vignette_max);
    smoothed.ui.jitter = clamp(smoothed.ui.jitter, 0, caps.jitter_max);
    smoothed.geometry.skew = clamp(smoothed.geometry.skew, 0, caps.geom_skew_max);
    smoothed.light.exposure = clamp(smoothed.light.exposure, 0, caps.exposure_pulse_max + 0.45);
    smoothed.audio.heartbeat = clamp(smoothed.audio.heartbeat, 0, caps.heartbeat_gain_max);

    this.previous = smoothed;
    this.lastPhase = state.phase;
    return smoothed;
  }
}
