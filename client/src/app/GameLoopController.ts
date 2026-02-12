import * as THREE from "three";
import { RabbitPhase } from "@white-room/shared";
import balanceJson from "../data/game_balance.json";
import { ConversationEngine } from "../conversation/ConversationEngine";
import { LlmTurnQueue } from "../conversation/LlmTurnQueue";
import { FrameRateSafety } from "./FrameRateSafety";
import { RuntimeClock } from "./RuntimeClock";
import { FirstPersonController } from "../player/FirstPersonController";
import { InteractionSystem } from "../interaction/InteractionSystem";
import { WorldMorphEngine } from "../world/WorldMorphEngine";
import type { MorphFrame } from "../world/WorldMorphEngine";
import { DynamicWorldRuntime } from "../world/DynamicWorldRuntime";
import { DebugOverlay } from "../ui/DebugOverlay";
import { CalmModeToggle } from "../ui/CalmModeToggle";
import { InputController } from "../voice/InputController";
import { playTtsNonBlocking } from "../voice/TtsClient";

const balance = balanceJson as {
  session_hard_limit_ms: number;
  stt_failure_fallback_threshold: number;
};

type RuntimeMode = "Explore" | "DialogueActive" | "EndingLocked";

type LlmStatusTone = "ok" | "warn";

export class GameLoopController {
  private readonly conversation = new ConversationEngine();
  private readonly queue = new LlmTurnQueue();
  private readonly world = new WorldMorphEngine();
  private readonly interaction = new InteractionSystem();
  private readonly clock = new RuntimeClock();
  private readonly inputController = new InputController(balance.stt_failure_fallback_threshold);

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private firstPerson!: FirstPersonController;
  private dynamicWorld!: DynamicWorldRuntime;

  private rabbit!: THREE.Group;
  private room!: THREE.Mesh;
  private mirror!: THREE.Mesh;
  private doorOutline!: THREE.LineSegments;
  private eyeMaterial!: THREE.MeshStandardMaterial;
  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.AmbientLight;

  private subtitleEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private llmStatusEl!: HTMLDivElement;
  private interactionPromptEl!: HTMLDivElement;
  private exploreOverlayEl!: HTMLDivElement;
  private dialogueOverlayEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private sendButton!: HTMLButtonElement;
  private voiceButton!: HTMLButtonElement;
  private vignetteEl!: HTMLDivElement;
  private chromaEl!: HTMLDivElement;
  private debugOverlay!: DebugOverlay;

  private calmMode = false;
  private processing = false;
  private ended = false;
  private forcedFinalAutoPrompted = false;
  private runtimeMode: RuntimeMode = "Explore";
  private canInteract = false;
  private retryTimer: number | null = null;
  private readonly frameRateSafety = new FrameRateSafety();
  private reducedEffectsProfile = false;
  private lastFrameTimestampMs = 0;

  private readonly rabbitAnchor = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3();
  private readonly playerDirection = new THREE.Vector3();

  private providerStatus = {
    llm: "unknown",
    stt: "unknown",
    tts: "unknown",
  };

  private readonly allowDeterministicFallbackDelivery =
    new URLSearchParams(window.location.search).get("allow_fallback") === "1" ||
    (window as unknown as { __WHITE_ROOM_ALLOW_DETERMINISTIC_FALLBACK__?: boolean })
      .__WHITE_ROOM_ALLOW_DETERMINISTIC_FALLBACK__ === true;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    this.createUi();
    this.createScene();
    this.bindEvents();
    this.setRuntimeMode("Explore");
    void this.refreshHealth();
    setInterval(() => void this.refreshHealth(), 15000);
    this.lastFrameTimestampMs = performance.now();
    this.animate();
    this.subtitleEl.textContent = "Walk to the rabbit. Press E to enter dialogue.";
  }

  private createUi(): void {
    this.root.innerHTML = `
      <div class="canvas-root"></div>
      <div class="ui-layer">
        <div class="topbar">
          <div class="title">WHITE ROOM / RABBIT</div>
          <div class="controls"></div>
          <div class="timer" id="timer">05:00</div>
        </div>

        <div class="subtitle-panel" id="subtitle">Subtitles always on.</div>

        <div class="explore-overlay" id="explore-overlay">
          <div class="crosshair" aria-hidden="true"></div>
          <div class="interaction-prompt" id="interaction-prompt">Press E to interact</div>
        </div>

        <div class="dialogue-overlay" id="dialogue-overlay">
          <div class="llm-status llm-status-ok" id="llm-status">Rabbit linked.</div>
          <div class="input-dock">
            <input id="player-input" type="text" maxlength="260" placeholder="Type to speak. Voice optional." />
            <button id="voice-btn">Hold To Talk</button>
            <button id="send-btn" class="primary">Send</button>
          </div>
          <div class="dialogue-hint">Esc to return to movement.</div>
        </div>

        <div class="vignette"></div>
        <div class="chroma-layer"></div>
        <div class="grain-layer"></div>
      </div>
    `;

    const controls = this.root.querySelector(".controls") as HTMLDivElement;
    this.timerEl = this.root.querySelector("#timer") as HTMLDivElement;
    this.subtitleEl = this.root.querySelector("#subtitle") as HTMLDivElement;
    this.llmStatusEl = this.root.querySelector("#llm-status") as HTMLDivElement;
    this.interactionPromptEl = this.root.querySelector("#interaction-prompt") as HTMLDivElement;
    this.exploreOverlayEl = this.root.querySelector("#explore-overlay") as HTMLDivElement;
    this.dialogueOverlayEl = this.root.querySelector("#dialogue-overlay") as HTMLDivElement;
    this.inputEl = this.root.querySelector("#player-input") as HTMLInputElement;
    this.sendButton = this.root.querySelector("#send-btn") as HTMLButtonElement;
    this.voiceButton = this.root.querySelector("#voice-btn") as HTMLButtonElement;
    this.vignetteEl = this.root.querySelector(".vignette") as HTMLDivElement;
    this.chromaEl = this.root.querySelector(".chroma-layer") as HTMLDivElement;

    new CalmModeToggle(controls, (enabled) => {
      this.calmMode = enabled;
      if (enabled) {
        this.applyCalmImmediateClamp();
      }
    }).setChecked(false);

    this.debugOverlay = new DebugOverlay(this.root.querySelector(".ui-layer") as HTMLElement);
  }

  private createScene(): void {
    const canvasRoot = this.root.querySelector(".canvas-root") as HTMLDivElement;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvasRoot.clientWidth || window.innerWidth, canvasRoot.clientHeight || window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    canvasRoot.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#f7f9fc");

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.6, 4.6);

    const roomGeo = new THREE.BoxGeometry(10, 5, 10);
    const roomMat = new THREE.MeshStandardMaterial({
      color: "#f3f7fb",
      side: THREE.BackSide,
      roughness: 0.85,
      metalness: 0.02,
    });
    this.room = new THREE.Mesh(roomGeo, roomMat);
    this.scene.add(this.room);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: "#eef3f9", roughness: 0.9, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    this.scene.add(floor);

    this.keyLight = new THREE.DirectionalLight("#ffffff", 1.2);
    this.keyLight.position.set(0, 3, 0.6);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.AmbientLight("#e8eff7", 0.6);
    this.scene.add(this.fillLight);

    this.rabbit = this.createRabbit();
    this.rabbit.position.set(0, -1.2, 0);
    this.scene.add(this.rabbit);

    this.mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.8),
      new THREE.MeshStandardMaterial({
        color: "#e3ebf3",
        metalness: 0.8,
        roughness: 0.2,
        transparent: true,
        opacity: 0,
      }),
    );
    this.mirror.position.set(0, -0.2, -3.9);
    this.scene.add(this.mirror);

    const doorEdges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.4, 2.5));
    const doorMaterial = new THREE.LineBasicMaterial({ color: "#ffd6b4", transparent: true, opacity: 0 });
    this.doorOutline = new THREE.LineSegments(doorEdges, doorMaterial);
    this.doorOutline.position.set(0, -1.1, -3.95);
    this.scene.add(this.doorOutline);

    this.firstPerson = new FirstPersonController(this.camera, this.renderer.domElement, {
      bounds: { min_x: -4.15, max_x: 4.15, min_z: -4.15, max_z: 4.15 },
    });
    this.dynamicWorld = new DynamicWorldRuntime(this.scene, this.rabbit, this.camera, {
      max_props: 6,
      max_distortions: 2,
    });

    window.addEventListener("resize", () => this.onResize());
  }

  private createRabbit(): THREE.Group {
    const group = new THREE.Group();

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 32, 24),
      new THREE.MeshStandardMaterial({ color: "#f7f8fb", roughness: 0.45, metalness: 0.1 }),
    );
    head.position.set(0, 0.8, 0);
    group.add(head);

    const earGeo = new THREE.CapsuleGeometry(0.16, 1.0, 8, 12);
    const earMat = new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.4 });

    const leftEar = new THREE.Mesh(earGeo, earMat);
    leftEar.position.set(-0.35, 1.9, 0.02);
    leftEar.rotation.z = 0.2;
    group.add(leftEar);

    const rightEar = new THREE.Mesh(earGeo, earMat);
    rightEar.position.set(0.35, 1.9, 0.02);
    rightEar.rotation.z = -0.2;
    group.add(rightEar);

    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: "#ff8855",
      emissive: "#ff4500",
      emissiveIntensity: 0.8,
      roughness: 0.25,
      metalness: 0.15,
    });

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), this.eyeMaterial);
    eyeL.position.set(-0.2, 0.95, 0.78);
    group.add(eyeL);

    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), this.eyeMaterial);
    eyeR.position.set(0.2, 0.95, 0.78);
    group.add(eyeR);

    return group;
  }

  private bindEvents(): void {
    this.renderer.domElement.addEventListener("click", () => {
      if (this.runtimeMode === "Explore" && !this.ended) {
        this.firstPerson.requestPointerLock();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "e" && this.runtimeMode === "Explore" && this.canInteract && !this.ended) {
        event.preventDefault();
        this.enterDialogueMode();
      }

      if (event.key === "Escape" && this.runtimeMode === "DialogueActive" && !this.ended) {
        event.preventDefault();
        this.exitDialogueMode();
      }
    });

    this.sendButton.addEventListener("click", () => {
      void this.enqueueOrRunTurn(this.inputEl.value);
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.enqueueOrRunTurn(this.inputEl.value);
      }
    });

    this.voiceButton.addEventListener("pointerdown", async () => {
      if (this.ended || this.runtimeMode !== "DialogueActive") return;
      const started = await this.inputController.beginVoice();
      if (!started) {
        this.subtitleEl.textContent = "Voice unavailable. Continue with typed input.";
      } else {
        this.voiceButton.classList.add("recording");
      }
    });

    const stopVoice = async () => {
      if (this.ended || this.runtimeMode !== "DialogueActive") return;
      this.voiceButton.classList.remove("recording");
      const transcript = await this.inputController.endVoice();
      if (transcript) {
        this.inputEl.value = transcript;
        await this.enqueueOrRunTurn(transcript);
      } else if (this.inputController.getVoiceLocked()) {
        this.voiceButton.disabled = true;
        this.subtitleEl.textContent = "Voice failed twice. Typed mode is now primary for this session.";
      }
    };

    this.voiceButton.addEventListener("pointerup", () => {
      void stopVoice();
    });
    this.voiceButton.addEventListener("pointerleave", () => {
      void stopVoice();
    });
  }

  private enterDialogueMode(): void {
    this.setRuntimeMode("DialogueActive");
    this.firstPerson.setEnabled(false);
    this.firstPerson.releasePointerLock();
    this.inputEl.focus();
    this.setLlmStatus("Rabbit linked.", "ok");
    this.subtitleEl.textContent = "Dialogue active. Ask the rabbit anything.";
  }

  private exitDialogueMode(): void {
    if (this.processing) {
      this.queue.clear();
    }
    this.clearRetryTimer();
    this.setRuntimeMode("Explore");
    this.firstPerson.setEnabled(true);
    this.firstPerson.requestPointerLock();
    this.setLlmStatus("Movement mode.", "ok");
    this.subtitleEl.textContent = "Walk to the rabbit. Press E to interact.";
  }

  private async enqueueOrRunTurn(raw: string): Promise<void> {
    if (this.processing || this.ended || this.runtimeMode !== "DialogueActive") {
      if (this.processing && this.runtimeMode === "DialogueActive") {
        this.queue.enqueueLatest(raw);
        this.setLlmStatus("Rabbit busy. Latest turn queued.", "warn");
      }
      return;
    }

    const text = raw.trim();
    this.inputEl.value = "";
    await this.runTurnInternal(text);
  }

  private async runTurnInternal(text: string): Promise<void> {
    if (this.ended || this.runtimeMode !== "DialogueActive") return;

    this.processing = true;
    this.voiceButton.disabled = true;

    try {
      const elapsed = this.clock.elapsedMs();
      const result = await this.conversation.runTurn(text, elapsed, this.calmMode, {
        llm_required: true,
        allow_deterministic_fallback_delivery: this.allowDeterministicFallbackDelivery,
      });

      this.debugOverlay.render({
        phase: result.state_snapshot.phase,
        tone: result.state_snapshot.tone,
        trust: result.state_snapshot.trust,
        threat: result.state_snapshot.threat,
        curiosity: result.state_snapshot.curiosity,
        psych: result.state_snapshot.psych,
        tags: result.state_snapshot.last_tags,
        goals: result.state_snapshot.active_goals,
        elapsed_ms: result.state_snapshot.elapsed_ms,
        turn_index: result.state_snapshot.turn_index,
        llm_reject_count: result.state_snapshot.llm_reject_count,
        doctrine_count: result.doctrine_count,
        doctrine_sources: result.doctrine_sources,
        doctrine_modules: result.doctrine_modules,
        llm_provider: result.llm_source,
        llm_available: result.llm_available,
        llm_deliverable: result.deliverable,
        llm_fallback_reason: result.fallback_reason,
        stt_provider: this.providerStatus.stt,
        tts_provider: this.providerStatus.tts,
        llm_runtime: this.providerStatus.llm,
        voice_locked: this.inputController.getVoiceLocked(),
        calm_mode: this.calmMode,
        performance_reduced: this.reducedEffectsProfile,
        fps_estimate: Number(this.frameRateSafety.currentFpsEstimate().toFixed(1)),
        flags: result.active_flags,
        ending_progress: result.ending_progress,
        quality: result.quality,
        ending_candidate: result.ending,
        mode: this.runtimeMode,
        pointer_lock: this.firstPerson.getSnapshot().pointer_locked,
        can_interact: this.canInteract,
        queue_pending: this.queue.hasPending(),
        queue_attempts: this.queue.peek()?.attempts ?? 0,
        consciousness: result.consciousness_context,
        dynamic_world: this.dynamicWorld.getSnapshot(),
      });

      if (!result.deliverable) {
        this.queue.enqueueLatest(text);
        const attempts = (this.queue.peek()?.attempts ?? 0) + 1;
        this.queue.updateAttempts(attempts);
        this.setLlmStatus("Rabbit unavailable, retrying...", "warn");
        this.scheduleRetry();
        return;
      }

      this.queue.clear();
      this.clearRetryTimer();
      this.setLlmStatus("Rabbit linked.", "ok");
      this.subtitleEl.textContent = result.response.reply_text;
      void playTtsNonBlocking(result.response.reply_text, result.response.tone);

      const baseMorph = this.world.compute(
        result.state_snapshot,
        result.response.morph_signal.classification,
        result.response.morph_signal.keywords,
        result.response.morph_signal.beat_trigger,
      );
      const morph = this.reducedEffectsProfile ? this.applyReducedEffectsProfile(baseMorph) : baseMorph;
      this.applyMorph(morph, result.state_snapshot.phase);
      this.dynamicWorld.applyDirectives(result.response.world_directives, performance.now());

      if (result.ending || elapsed >= balance.session_hard_limit_ms) {
        this.finishSession(result.ending ?? "ESCAPE_A");
      }
    } finally {
      this.processing = false;
      if (!this.ended && this.runtimeMode === "DialogueActive") {
        this.voiceButton.disabled = false;
      }
      if (!this.processing && this.runtimeMode === "DialogueActive" && this.queue.hasPending() && !this.retryTimer) {
        void this.runQueuedTurn();
      }
    }
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    if (this.runtimeMode !== "DialogueActive" || this.ended) {
      return;
    }
    const delay = this.queue.getNextDelayMs();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.runQueuedTurn();
    }, delay);
  }

  private async runQueuedTurn(): Promise<void> {
    if (this.processing || this.runtimeMode !== "DialogueActive" || this.ended) {
      return;
    }
    const pending = this.queue.peek();
    if (!pending) {
      return;
    }
    await this.runTurnInternal(pending.text);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setRuntimeMode(mode: RuntimeMode): void {
    this.runtimeMode = mode;
    this.exploreOverlayEl.classList.toggle("hidden", mode !== "Explore");
    this.dialogueOverlayEl.classList.toggle("hidden", mode !== "DialogueActive");
    this.inputEl.disabled = mode !== "DialogueActive" || this.ended;
    this.sendButton.disabled = mode !== "DialogueActive" || this.ended;
    this.voiceButton.disabled = mode !== "DialogueActive" || this.ended || this.processing;
  }

  private setLlmStatus(text: string, tone: LlmStatusTone): void {
    this.llmStatusEl.textContent = text;
    this.llmStatusEl.classList.toggle("llm-status-ok", tone === "ok");
    this.llmStatusEl.classList.toggle("llm-status-warn", tone === "warn");
  }

  private updateInteractionUi(): void {
    if (this.runtimeMode !== "Explore") {
      this.interactionPromptEl.classList.remove("visible");
      return;
    }

    this.rabbit.getWorldPosition(this.rabbitAnchor);
    this.rabbitAnchor.y += 1.1;
    const evaluation = this.interaction.evaluate(
      this.firstPerson.getPosition(this.playerPosition),
      this.firstPerson.getForwardDirection(this.playerDirection),
      this.rabbitAnchor,
    );

    this.canInteract = evaluation.can_interact;
    if (evaluation.can_interact) {
      this.interactionPromptEl.textContent = "Press E to interact";
      this.interactionPromptEl.classList.add("visible");
    } else {
      this.interactionPromptEl.classList.remove("visible");
    }
  }

  private applyMorph(
    morph: {
      light: { exposure: number; toplight: number; halo: number };
      geometry: { skew: number; wave: number };
      props: { mirror: number; doorline: number; eyes: number };
      audio: { heartbeat: number; hum: number };
      ui: { vignette: number; jitter: number; chroma: number };
    },
    phase: RabbitPhase,
  ): void {
    this.renderer.toneMappingExposure = 0.65 + morph.light.exposure;
    this.keyLight.intensity = 0.4 + morph.light.toplight * 2.2;
    this.fillLight.intensity = 0.3 + morph.light.halo * 1.6;

    this.room.rotation.y = (morph.geometry.skew - 0.2) * 0.15;
    this.room.scale.set(1 + morph.geometry.wave * 0.04, 1, 1 + morph.geometry.wave * 0.04);

    (this.mirror.material as THREE.MeshStandardMaterial).opacity =
      phase === RabbitPhase.Mirror || phase === RabbitPhase.Contract || phase === RabbitPhase.Exit
        ? morph.props.mirror
        : 0;
    (this.doorOutline.material as THREE.LineBasicMaterial).opacity =
      phase === RabbitPhase.Mirror || phase === RabbitPhase.Contract || phase === RabbitPhase.Exit
        ? morph.props.doorline
        : 0;

    this.eyeMaterial.emissiveIntensity = 0.5 + morph.props.eyes * 2.2;

    this.vignetteEl.style.opacity = String(morph.ui.vignette);
    this.chromaEl.style.opacity = String(morph.ui.chroma);
    this.subtitleEl.style.transform = `translateX(-50%) translateY(${morph.ui.jitter * 8}px)`;
  }

  private finishSession(ending: string): void {
    this.ended = true;
    this.queue.clear();
    this.clearRetryTimer();
    this.dynamicWorld.clear();
    this.firstPerson.releasePointerLock();
    this.firstPerson.setEnabled(false);
    this.setRuntimeMode("EndingLocked");
    this.subtitleEl.textContent = `Ending resolved: ${ending}. Session closed.`;
  }

  private applyReducedEffectsProfile(morph: MorphFrame): MorphFrame {
    return {
      light: {
        exposure: Math.min(morph.light.exposure, 0.55),
        toplight: Math.min(morph.light.toplight, 0.6),
        halo: Math.min(morph.light.halo, 0.55),
      },
      geometry: {
        skew: morph.geometry.skew * 0.55,
        wave: morph.geometry.wave * 0.55,
      },
      props: morph.props,
      audio: {
        heartbeat: Math.min(morph.audio.heartbeat, 0.35),
        hum: Math.min(morph.audio.hum, 0.35),
      },
      ui: {
        vignette: Math.min(morph.ui.vignette, 0.4),
        jitter: Math.min(morph.ui.jitter, 0.08),
        chroma: Math.min(morph.ui.chroma, 0.03),
      },
      activeRecipeIds: morph.activeRecipeIds.includes("PERF_REDUCED_PROFILE")
        ? morph.activeRecipeIds
        : [...morph.activeRecipeIds, "PERF_REDUCED_PROFILE"],
    };
  }

  private applyCalmImmediateClamp(): void {
    this.chromaEl.style.opacity = "0";
    this.subtitleEl.style.transform = "translateX(-50%) translateY(0px)";

    if (this.renderer) {
      this.renderer.toneMappingExposure = Math.min(this.renderer.toneMappingExposure, 0.85);
    }
    if (this.keyLight) {
      this.keyLight.intensity = Math.min(this.keyLight.intensity, 1.2);
    }
    if (this.fillLight) {
      this.fillLight.intensity = Math.max(this.fillLight.intensity, 0.35);
    }
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    const frameNow = performance.now();
    const frameDeltaMs = Math.max(0, frameNow - this.lastFrameTimestampMs);
    this.lastFrameTimestampMs = frameNow;
    this.reducedEffectsProfile = this.frameRateSafety.sampleFrame(frameDeltaMs);

    if (!this.ended && this.runtimeMode === "Explore") {
      this.firstPerson.update(frameDeltaMs / 1000);
      this.updateInteractionUi();
    }

    this.dynamicWorld.update(frameNow, frameDeltaMs / 1000);

    const elapsed = this.clock.elapsedMs();
    const remaining = Math.max(0, balance.session_hard_limit_ms - elapsed);
    const min = String(Math.floor(remaining / 60000)).padStart(2, "0");
    const sec = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
    this.timerEl.textContent = `${min}:${sec}`;
    this.timerEl.classList.toggle("warn", remaining <= 30000);

    this.rabbit.rotation.y += 0.0025;
    this.rabbit.position.y = -1.2 + Math.sin(frameNow * 0.0016) * 0.02;

    this.renderer.render(this.scene, this.camera);

    if (!this.ended && elapsed >= balance.session_hard_limit_ms) {
      this.finishSession("ESCAPE_A");
    }

    if (
      !this.ended &&
      this.runtimeMode === "DialogueActive" &&
      !this.processing &&
      !this.forcedFinalAutoPrompted &&
      elapsed >= 270000
    ) {
      this.forcedFinalAutoPrompted = true;
      void this.enqueueOrRunTurn("");
    }

    requestAnimationFrame(this.animate);
  };

  private async refreshHealth(): Promise<void> {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const data = (await res.json()) as {
        providers?: {
          llm?: string;
          stt?: string;
          tts?: string;
        };
      };
      if (data.providers) {
        this.providerStatus.llm = data.providers.llm ?? this.providerStatus.llm;
        this.providerStatus.stt = data.providers.stt ?? this.providerStatus.stt;
        this.providerStatus.tts = data.providers.tts ?? this.providerStatus.tts;
      }
    } catch {
      // non-blocking for gameplay
    }
  }
}
