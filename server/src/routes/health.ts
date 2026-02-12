import { Router } from "express";
import { DoctrineIndexer } from "../doctrine/DoctrineIndexer";
import { ServerEnv } from "../types";
import { runCommand } from "../utils";

async function checkOllama(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkBinary(command: string): Promise<boolean> {
  const result = await runCommand(command, ["--help"], undefined, 2000);
  return result.code === 0;
}

interface HealthDependencies {
  checkOllama?: (url: string) => Promise<boolean>;
  checkBinary?: (command: string) => Promise<boolean>;
  probeTimeoutMs?: number;
}

function withTimeout(work: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    work
      .then((ok) => resolve(ok))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer));
  });
}

export function healthRouter(indexer: DoctrineIndexer, env: ServerEnv, deps: HealthDependencies = {}): Router {
  const router = Router();
  const ollamaProbe = deps.checkOllama ?? checkOllama;
  const binaryProbe = deps.checkBinary ?? checkBinary;
  const probeTimeoutMs = deps.probeTimeoutMs ?? 2000;

  router.get("/api/health", async (_req, res) => {
    const [ollama, stt, tts] = await Promise.all([
      withTimeout(ollamaProbe(env.ollama_url), probeTimeoutMs),
      withTimeout(binaryProbe(env.whisper_cli), probeTimeoutMs),
      withTimeout(binaryProbe(env.espeak_cli), probeTimeoutMs),
    ]);

    res.json({
      ok: ollama || stt || tts,
      doctrine_chunks: indexer.chunkCount(),
      mode: "local-first",
      providers: {
        llm: ollama ? "ollama" : "deterministic",
        stt: stt ? "whisper.cpp" : "typed-only",
        tts: tts ? "piper/espeak" : "subtitles-only",
      },
      availability: { ollama, stt, tts },
    });
  });

  return router;
}
