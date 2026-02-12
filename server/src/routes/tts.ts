import { Router } from "express";
import { RabbitTone } from "@white-room/shared";
import { z } from "zod";
import { PiperAdapter } from "../adapters/PiperAdapter";
import { BridgeBroker } from "../bridge/BridgeBroker";

const bodySchema = z.object({
  text: z.string().min(1).max(500),
  tone: z.nativeEnum(RabbitTone),
});

interface TtsRouteDependencies {
  bridgeBroker?: BridgeBroker;
  bridgeRequestTimeoutMs?: number;
}

export function ttsRouter(adapter: PiperAdapter, deps: TtsRouteDependencies = {}): Router {
  const router = Router();
  const bridgeRequestTimeoutMs = deps.bridgeRequestTimeoutMs ?? 21000;

  router.post("/api/tts", async (req, res) => {
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ ok: false, error: "invalid_tts_request" });
      return;
    }

    const bridgeSessionId = req.header("x-bridge-session-id");
    const bridgeClientToken = req.header("x-bridge-client-token");
    if (
      deps.bridgeBroker &&
      typeof bridgeSessionId === "string" &&
      bridgeSessionId.length > 0 &&
      typeof bridgeClientToken === "string" &&
      bridgeClientToken.length > 0
    ) {
      const bridge = await deps.bridgeBroker.requestTts(
        bridgeSessionId,
        bridgeClientToken,
        parse.data.text,
        parse.data.tone,
        bridgeRequestTimeoutMs,
      );
      if (bridge.ok && bridge.wav) {
        res.setHeader("content-type", "audio/wav");
        res.send(bridge.wav);
        return;
      }
    }

    const wav = await adapter.synthesize(parse.data.text, parse.data.tone);
    if (!wav) {
      res.status(503).json({ ok: false, error: "tts_unavailable" });
      return;
    }

    res.setHeader("content-type", "audio/wav");
    res.send(wav);
  });

  return router;
}
