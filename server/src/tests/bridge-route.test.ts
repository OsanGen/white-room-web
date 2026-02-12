import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeBroker } from "../bridge/BridgeBroker";
import { bridgeRouter } from "../routes/bridge";

async function startServer(app: express.Express): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to get test server address");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      await close();
    }
  }
});

describe("bridge session routes", () => {
  it("creates bridge session and returns status by client token", async () => {
    const broker = new BridgeBroker(60000);
    const app = express();
    app.use(express.json());
    app.use(bridgeRouter(broker));
    const { origin, close } = await startServer(app);
    closers.push(close);

    const created = await fetch(`${origin}/api/bridge/session`, { method: "POST" });
    expect(created.status).toBe(200);
    const payload = (await created.json()) as {
      ok: boolean;
      session_id: string;
      client_token: string;
      bridge_token: string;
      expires_at_ms: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.session_id.length).toBeGreaterThan(0);
    expect(payload.client_token.length).toBeGreaterThan(0);
    expect(payload.bridge_token.length).toBeGreaterThan(0);
    expect(payload.expires_at_ms).toBeGreaterThan(Date.now());

    const statusRes = await fetch(
      `${origin}/api/bridge/session/${payload.session_id}?client_token=${payload.client_token}`,
    );
    expect(statusRes.status).toBe(200);
    const statusPayload = (await statusRes.json()) as {
      ok: boolean;
      status: { connected: boolean };
    };
    expect(statusPayload.ok).toBe(true);
    expect(statusPayload.status.connected).toBe(false);
  });

  it("rejects session status request with missing token", async () => {
    const broker = new BridgeBroker(60000);
    const app = express();
    app.use(express.json());
    app.use(bridgeRouter(broker));
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/bridge/session/unknown`);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "invalid_client_token" });
  });
});

