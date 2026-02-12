import { access } from "node:fs/promises";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { OllamaAdapter } from "./adapters/OllamaAdapter";
import { PiperAdapter } from "./adapters/PiperAdapter";
import { WhisperCppAdapter } from "./adapters/WhisperCppAdapter";
import { BridgeBroker } from "./bridge/BridgeBroker";
import { LlmTurnCache } from "./cache/LlmTurnCache";
import { DoctrineIndexer } from "./doctrine/DoctrineIndexer";
import { bridgeRouter } from "./routes/bridge";
import { healthRouter } from "./routes/health";
import { llmRouter } from "./routes/llm";
import { sttRouter } from "./routes/stt";
import { ttsRouter } from "./routes/tts";
import { loadEnv } from "./types";

async function assertDoctrineFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await access(path);
    } catch {
      throw new Error(`Required doctrine source missing: ${path}`);
    }
  }
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  await assertDoctrineFiles([env.source_hal_path, env.source_personality_path, env.source_pseudocode_path]);

  const doctrine = new DoctrineIndexer();
  await doctrine.initialize({
    hal: env.source_hal_path,
    personality: env.source_personality_path,
    pseudocode: env.source_pseudocode_path,
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  const ollama = new OllamaAdapter(env);
  const whisper = new WhisperCppAdapter(env);
  const piper = new PiperAdapter(env);
  const bridgeBroker = new BridgeBroker(env.bridge_session_ttl_ms);
  const llmTurnCache = new LlmTurnCache({
    enabled: env.llm_cache_enabled,
    ttl_ms: env.llm_cache_ttl_ms,
    max_entries: env.llm_cache_max_entries,
    key_version: env.llm_cache_key_version,
  });

  app.use(healthRouter(doctrine, env));
  app.use(bridgeRouter(bridgeBroker));
  app.use(
    llmRouter(ollama, doctrine, {
      llmRouteTimeoutMs: env.llm_route_timeout_ms,
      doctrineTopK: env.llm_doctrine_top_k,
      promptCharCap: env.llm_prompt_char_cap,
      turnCache: llmTurnCache,
      bridgeBroker,
      bridgeRequestTimeoutMs: env.bridge_request_timeout_ms,
    }),
  );
  app.use(sttRouter(whisper, { bridgeBroker, bridgeRequestTimeoutMs: env.bridge_request_timeout_ms }));
  app.use(ttsRouter(piper, { bridgeBroker, bridgeRequestTimeoutMs: env.bridge_request_timeout_ms }));

  const httpServer = createServer(app);
  const wsServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const parsed = bridgeBroker.parseUpgradeRequest(request);
    if (!parsed) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      const accepted = bridgeBroker.attachBridgeSocket(parsed.session_id, parsed.bridge_token, ws);
      if (!accepted) {
        ws.close(1008, "unauthorized");
        return;
      }

      ws.on("message", (data) => bridgeBroker.handleSocketMessage(ws, data));
      ws.on("close", () => bridgeBroker.detachSocket(ws));
      ws.on("error", () => bridgeBroker.detachSocket(ws));
    });
  });

  httpServer.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[white-room server] ready on :${env.port}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[white-room server] fatal bootstrap error", error);
  process.exit(1);
});
