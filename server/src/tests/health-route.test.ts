import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { healthRouter } from "../routes/health";
import { loadEnv } from "../types";

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

describe("health route", () => {
  it("reports deterministic/typed/subtitles providers when everything is unavailable", async () => {
    const app = express();
    app.use(
      healthRouter(
        { chunkCount: () => 77 } as never,
        loadEnv(),
        {
          checkOllama: async () => false,
          checkBinary: async () => false,
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      doctrine_chunks: number;
      providers: { llm: string; stt: string; tts: string };
      availability: { ollama: boolean; stt: boolean; tts: boolean };
    };
    expect(data.ok).toBe(false);
    expect(data.doctrine_chunks).toBe(77);
    expect(data.providers).toEqual({
      llm: "deterministic",
      stt: "typed-only",
      tts: "subtitles-only",
    });
    expect(data.availability).toEqual({
      ollama: false,
      stt: false,
      tts: false,
    });
  });

  it("reports mixed provider availability correctly", async () => {
    const app = express();
    app.use(
      healthRouter(
        { chunkCount: () => 12 } as never,
        loadEnv(),
        {
          checkOllama: async () => true,
          checkBinary: async (command) => command.includes("whisper"),
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      providers: { llm: string; stt: string; tts: string };
      availability: { ollama: boolean; stt: boolean; tts: boolean };
    };
    expect(data.ok).toBe(true);
    expect(data.providers).toEqual({
      llm: "ollama",
      stt: "whisper.cpp",
      tts: "subtitles-only",
    });
    expect(data.availability).toEqual({
      ollama: true,
      stt: true,
      tts: false,
    });
  });

  it("treats local voice stack availability as healthy even without ollama", async () => {
    const app = express();
    app.use(
      healthRouter(
        { chunkCount: () => 5 } as never,
        loadEnv(),
        {
          checkOllama: async () => false,
          checkBinary: async () => true,
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      providers: { llm: string; stt: string; tts: string };
      availability: { ollama: boolean; stt: boolean; tts: boolean };
    };
    expect(data.ok).toBe(true);
    expect(data.providers).toEqual({
      llm: "deterministic",
      stt: "whisper.cpp",
      tts: "piper/espeak",
    });
    expect(data.availability).toEqual({
      ollama: false,
      stt: true,
      tts: true,
    });
  });

  it("falls back quickly when probes stall (timeout guard)", async () => {
    const app = express();
    app.use(
      healthRouter(
        { chunkCount: () => 9 } as never,
        loadEnv(),
        {
          checkOllama: async () => await new Promise<boolean>(() => undefined),
          checkBinary: async () => await new Promise<boolean>(() => undefined),
          probeTimeoutMs: 50,
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const started = Date.now();
    const res = await fetch(`${origin}/api/health`);
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);

    const data = (await res.json()) as {
      ok: boolean;
      providers: { llm: string; stt: string; tts: string };
      availability: { ollama: boolean; stt: boolean; tts: boolean };
    };
    expect(data.ok).toBe(false);
    expect(data.providers.llm).toBe("deterministic");
    expect(data.providers.stt).toBe("typed-only");
    expect(data.providers.tts).toBe("subtitles-only");
    expect(data.availability).toEqual({
      ollama: false,
      stt: false,
      tts: false,
    });
  });

  it("treats probe exceptions as unavailable without failing the route", async () => {
    const app = express();
    app.use(
      healthRouter(
        { chunkCount: () => 3 } as never,
        loadEnv(),
        {
          checkOllama: async () => {
            throw new Error("ollama probe failed");
          },
          checkBinary: async (command) => {
            if (command.includes("whisper")) throw new Error("stt probe failed");
            return true;
          },
          probeTimeoutMs: 100,
        },
      ),
    );
    const { origin, close } = await startServer(app);
    closers.push(close);

    const res = await fetch(`${origin}/api/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      providers: { llm: string; stt: string; tts: string };
      availability: { ollama: boolean; stt: boolean; tts: boolean };
    };
    expect(data.ok).toBe(true);
    expect(data.providers).toEqual({
      llm: "deterministic",
      stt: "typed-only",
      tts: "piper/espeak",
    });
    expect(data.availability).toEqual({
      ollama: false,
      stt: false,
      tts: true,
    });
  });
});
