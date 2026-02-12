import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(command: string, args: string[], stdin?: Buffer, timeoutMs = 15000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 1, stdout: "", stderr: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout: "", stderr: String(error) });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export async function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: T): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(onTimeout), timeoutMs);
  });

  const result = await Promise.race([work, timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  return result;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
