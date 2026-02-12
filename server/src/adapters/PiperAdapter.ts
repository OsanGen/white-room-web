import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RabbitTone } from "@white-room/shared";
import { ServerEnv } from "../types";
import { runCommand, withTimeout } from "../utils";

function toneToEspeakArgs(tone: RabbitTone): string[] {
  switch (tone) {
    case RabbitTone.Gentle:
      return ["-s", "140", "-p", "45"];
    case RabbitTone.Amused:
      return ["-s", "165", "-p", "55"];
    case RabbitTone.Cold:
      return ["-s", "130", "-p", "30"];
    default:
      return ["-s", "150", "-p", "40"];
  }
}

export class PiperAdapter {
  constructor(private readonly env: ServerEnv) {}

  async synthesize(text: string, tone: RabbitTone): Promise<Buffer | null> {
    const tempDir = await mkdtemp(join(tmpdir(), "white-room-tts-"));
    const wavPath = join(tempDir, "out.wav");

    try {
      if (this.env.piper_model_path && this.env.piper_config_path) {
        const cmd = this.env.piper_cli.split(" ").filter(Boolean);
        const executable = cmd.shift() ?? "python3";
        const args = [...cmd, "--model", this.env.piper_model_path, "--config", this.env.piper_config_path, "--output_file", wavPath];

        const piperJob = runCommand(executable, args, Buffer.from(text, "utf8"), this.env.tts_timeout_ms);
        const piperResult = await withTimeout(piperJob, this.env.tts_timeout_ms, { code: 1, stdout: "", stderr: "timeout" });
        if (piperResult.code === 0) {
          return readFile(wavPath);
        }
      }

      const espeakJob = runCommand(this.env.espeak_cli, [...toneToEspeakArgs(tone), "-w", wavPath, text], undefined, this.env.tts_timeout_ms);
      const espeakResult = await withTimeout(espeakJob, this.env.tts_timeout_ms, { code: 1, stdout: "", stderr: "timeout" });
      if (espeakResult.code !== 0) {
        return null;
      }

      return readFile(wavPath);
    } catch {
      return null;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
