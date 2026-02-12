import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const halRoot = process.env.HAL_ROOT ?? path.resolve(root, "..");

function assert(check, message) {
  if (!check) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileNonEmpty(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

const specPath = path.join(halRoot, "FINAL_BUILD_TARGET.txt");
const halPath = path.join(halRoot, "HAL_CONCIOUS.txt");
const personalityPath = path.join(halRoot, "J_PERSONALITY.txt");
const pseudocodePath = path.join(halRoot, "J_PSEUDOCODE.txt");

const dialoguePath = path.join(root, "client/src/data/dialogue_nodes.json");
const recipesPath = path.join(root, "client/src/data/effect_recipes.json");
const balancePath = path.join(root, "client/src/data/game_balance.json");
const cloudflareRedirects = path.join(root, "client/public/_redirects");
const itchChecklistPath = path.join(root, "docs/ITCH_IO_PUBLISH.md");
const packageScriptPath = path.join(root, "scripts/package-release.mjs");

const requiredNodeIds = [
  "N01_Orientation",
  "N02_NameProbe",
  "N03_BreathInvite",
  "N04_ContradictionProbe",
  "N05_FearProbe",
  "N06_HumorDeflect",
  "N07_SilencePressure",
  "N08_MirrorManifest",
  "N09_QuoteRecall",
  "N10_DoorOutlineHint",
  "N11_BargainOffer",
  "N12_BoundaryTest",
  "N13_GuidedSequence",
  "N14_FinalQuestion",
  "N15_ResolveEnding",
];

const requiredRecipeIds = [
  "R01_ClinicalBaseline",
  "R02_OverexposedDrift",
  "R03_HarshToplight",
  "R04_SoftHalo",
  "R05_MirrorPresence",
  "R06_DoorlineReveal",
  "R07_EyeGlowPulse",
  "R08_CornerBreath",
  "R09_AudioVacuum",
  "R10_ParallaxSlip",
  "R11_SubtitleGhosting",
  "R12_ShadowLag",
];

const checks = [];

const spec = fs.readFileSync(specPath, "utf8");
checks.push([spec.includes("SPEC_VERSION=5.0.0"), "Verify SPEC_VERSION==5.0.0"]);
checks.push([fileNonEmpty(halPath) && fileNonEmpty(personalityPath) && fileNonEmpty(pseudocodePath), "Verify source doctrine files exist and non-empty"]);

const nodes = readJson(dialoguePath);
checks.push([Array.isArray(nodes) && nodes.length >= 15, "Verify node count >= 15"]);
checks.push([
  requiredNodeIds.every((id) => nodes.some((node) => node.id === id)),
  "Verify dialogue_nodes.json includes required 15 IDs",
]);

const recipes = readJson(recipesPath);
checks.push([
  requiredRecipeIds.every((id) => recipes.some((recipe) => recipe.id === id)),
  "Verify effect_recipes.json includes required R01-R12",
]);

const balance = readJson(balancePath);
checks.push([balance.session_hard_limit_ms === 300000, "Verify phase timer constants include hard stop 300000ms"]);
checks.push([balance.stt_failure_fallback_threshold === 2, "Verify STT fail threshold == 2"]);
checks.push([Boolean(balance.safety_caps_calm), "Verify Calm Mode clamps configured"]);
checks.push([
  balance.safety_caps_calm?.chroma_max === 0,
  "Verify calm mode chroma clamp is zero",
]);

const llmRoute = fs.readFileSync(path.join(root, "server/src/routes/llm.ts"), "utf8");
checks.push([llmRoute.includes("deterministicRabbit"), "Verify deterministic no-LLM fallback exists"]);
checks.push(
  [llmRoute.includes("llmRouteTimeoutMs") || llmRoute.includes("modelTimeoutMs"), "Verify LLM route timeout guard is configurable"],
);
checks.push([llmRoute.includes("llm_timeout"), "Verify LLM route emits timeout fallback reason"]);

const inputController = fs.readFileSync(path.join(root, "client/src/voice/InputController.ts"), "utf8");
checks.push([inputController.includes("voiceLocked"), "Verify typed input path enabled after STT failures"]);

const rabbitMind = fs.readFileSync(path.join(root, "client/src/rabbit/RabbitMind.ts"), "utf8");
checks.push([rabbitMind.includes("psilo_confirm_step") && rabbitMind.includes("updatePsiloState"), "Verify Psilo branch default locked"]);

const flatFlags = nodes.flatMap((node) => node.set_flags ?? []);
const hasAFlags =
  flatFlags.includes("AdmittedFear") &&
  flatFlags.includes("ContradictionAcknowledged") &&
  flatFlags.includes("TruthStatementAccepted");
const hasBFlags =
  flatFlags.includes("BoundaryDeclared") &&
  flatFlags.includes("BargainRejected") &&
  flatFlags.includes("BoundaryMaintained");
const hasCFlags =
  flatFlags.includes("BreathDone") &&
  flatFlags.includes("CountDone") &&
  flatFlags.includes("RecallDone") &&
  flatFlags.includes("NameDone") &&
  flatFlags.includes("ChoiceDone");
checks.push([hasAFlags && hasBFlags && hasCFlags, "Verify ending flags configured for A/B/C"]);

const gameLoop = fs.readFileSync(path.join(root, "client/src/app/GameLoopController.ts"), "utf8");
checks.push([gameLoop.includes("applyMorph"), "Verify every turn applies morph signal"]);
checks.push([gameLoop.includes("forcedFinalAutoPrompted"), "Verify forced final branch auto-prompt exists"]);

const conversationEngine = fs.readFileSync(path.join(root, "client/src/conversation/ConversationEngine.ts"), "utf8");
checks.push([conversationEngine.includes("N14_FinalQuestion"), "Verify forced final question route wiring"]);
checks.push([conversationEngine.includes("qualityMonitor.assess"), "Verify conversational quality monitor is active"]);
checks.push([conversationEngine.includes("fallback_immediate"), "Verify no-meta quality remediation fallback exists"]);
checks.push([conversationEngine.includes("applySilenceRecovery"), "Verify silence deadlock recovery logic exists"]);
checks.push([gameLoop.includes("quality: result.quality"), "Verify debug overlay includes quality metrics"]);
checks.push([gameLoop.includes("FrameRateSafety"), "Verify low-fps reduced effects guard exists"]);
checks.push([gameLoop.includes("PERF_REDUCED_PROFILE"), "Verify reduced effects profile is applied under low fps"]);
const serverRoutesTest = fs.readFileSync(path.join(root, "server/src/tests/routes-failure-matrix.test.ts"), "utf8");
checks.push([serverRoutesTest.includes("/api/stt"), "Verify STT failure route tests exist"]);
checks.push([serverRoutesTest.includes("/api/tts"), "Verify TTS failure route tests exist"]);
checks.push([serverRoutesTest.includes("/api/llm/respond"), "Verify LLM fallback route tests exist"]);
checks.push([serverRoutesTest.includes("fallback:llm_timeout"), "Verify LLM timeout fallback route test exists"]);
checks.push([serverRoutesTest.includes("fallback:llm_error"), "Verify LLM error fallback route test exists"]);
const healthRouteTest = fs.readFileSync(path.join(root, "server/src/tests/health-route.test.ts"), "utf8");
checks.push([healthRouteTest.includes("/api/health"), "Verify health route integration tests exist"]);
checks.push([healthRouteTest.includes("typed-only"), "Verify health route fallback provider assertions exist"]);
const healthRoute = fs.readFileSync(path.join(root, "server/src/routes/health.ts"), "utf8");
checks.push([healthRoute.includes("withTimeout"), "Verify health probes are timeout guarded"]);
checks.push([healthRoute.includes("Promise.all"), "Verify health probes execute in parallel"]);
const doctrineParser = fs.readFileSync(path.join(root, "server/src/doctrine/DoctrineParser.ts"), "utf8");
const doctrineIndexer = fs.readFileSync(path.join(root, "server/src/doctrine/DoctrineIndexer.ts"), "utf8");
checks.push([doctrineParser.includes("hasCorruptionSignal"), "Verify doctrine parse corruption detection exists"]);
checks.push([doctrineParser.includes("consumeWarnings"), "Verify doctrine parser warning buffer exists"]);
checks.push([doctrineIndexer.includes("emitParserWarnings"), "Verify doctrine corruption warnings are surfaced"]);
checks.push([fileNonEmpty(cloudflareRedirects), "Verify Cloudflare Pages redirect manifest exists"]);
checks.push([fileNonEmpty(itchChecklistPath), "Verify itch.io checklist exists"]);
checks.push([fileNonEmpty(packageScriptPath), "Verify release package script exists"]);

const failures = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}`);
}

if (failures.length > 0) {
  throw new Error(`Spec verification failed (${failures.length} checks)`);
}

console.log("Spec verification passed.");
