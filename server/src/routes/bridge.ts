import { Router } from "express";
import { BridgeBroker } from "../bridge/BridgeBroker";

export function bridgeRouter(broker: BridgeBroker): Router {
  const router = Router();

  router.post("/api/bridge/session", (_req, res) => {
    const session = broker.createSession();
    res.json({
      ok: true,
      session_id: session.session_id,
      client_token: session.client_token,
      bridge_token: session.bridge_token,
      expires_at_ms: session.expires_at_ms,
    });
  });

  router.get("/api/bridge/session/:id", (req, res) => {
    const clientToken = req.query.client_token;
    if (typeof clientToken !== "string" || clientToken.length === 0) {
      res.status(401).json({ ok: false, error: "invalid_client_token" });
      return;
    }

    const status = broker.getSessionStatus(req.params.id, clientToken);
    if (!status) {
      res.status(404).json({ ok: false, error: "session_not_found" });
      return;
    }

    res.json({
      ok: true,
      status,
    });
  });

  return router;
}

