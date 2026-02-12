import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerEnv } from "../types";
import { runCommand, withTimeout } from "../utils";

export class WhisperCppAdapter {
  constructor(private readonly env: ServerEnv) {}

  async transcribe(wavBytes: Buffer): Promise<string | null> {
    if (!this.env.whisper_model_path) {
      return null;
    }

    const tempDir = await mkdtemp(join(tmpdir(), "white-room-whisper-"));
    const inPath = join(tempDir, "input.wav");
    const outPath = join(tempDir, "output");

    try {
      await writeFile(inPath, wavBytes);
      const job = runCommand(
        this.env.whisper_cli,
        ["-m", this.env.whisper_model_path, "-f", inPath, "-of", outPath, "-otxt", "-nt"],
        undefined,
        this.env.stt_timeout_ms,
      );
      const result = await withTimeout(job, this.env.stt_timeout_ms, { code: 1, stdout: "", stderr: "timeout" });
      if (result.code !== 0) {
        return null;
      }
      const text = await readFile(`${outPath}.txt`, "utf8");
      return text.trim() || null;
    } catch {
      return null;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
