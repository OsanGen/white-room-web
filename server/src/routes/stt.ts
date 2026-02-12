import { Router } from "express";
import multer from "multer";
import { WhisperCppAdapter } from "../adapters/WhisperCppAdapter";
import { BridgeBroker } from "../bridge/BridgeBroker";

const upload = multer({ storage: multer.memoryStorage() });

interface SttRouteDependencies {
  bridgeBroker?: BridgeBroker;
  bridgeRequestTimeoutMs?: number;
}

export function sttRouter(adapter: WhisperCppAdapter, deps: SttRouteDependencies = {}): Router {
  const router = Router();
  const bridgeRequestTimeoutMs = deps.bridgeRequestTimeoutMs ?? 21000;

  router.post("/api/stt", upload.single("audio"), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ ok: false, error: "missing_audio" });
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
      const bridge = await deps.bridgeBroker.requestStt(
        bridgeSessionId,
        bridgeClientToken,
        file.buffer,
        bridgeRequestTimeoutMs,
      );
      if (bridge.ok && bridge.text) {
        res.json({ ok: true, text: bridge.text });
        return;
      }
    }

    const text = await adapter.transcribe(file.buffer);
    if (!text) {
      res.status(503).json({ ok: false, error: "stt_unavailable" });
      return;
    }

    res.json({ ok: true, text });
  });

  return router;
}
