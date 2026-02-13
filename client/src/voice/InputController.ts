import { runtimeTransport } from "../runtime/RuntimeTransport";

export class InputController {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private failCount = 0;
  private voiceLocked = false;

  constructor(private readonly failThreshold: number) {}

  getVoiceLocked(): boolean {
    return this.voiceLocked;
  }

  async beginVoice(): Promise<boolean> {
    if (this.voiceLocked) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recorder = new MediaRecorder(stream);
      this.chunks = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.start();
      return true;
    } catch {
      this.markFailure();
      return false;
    }
  }

  async endVoice(): Promise<string | null> {
    if (!this.recorder) return null;

    return new Promise((resolve) => {
      const current = this.recorder;
      if (!current) {
        resolve(null);
        return;
      }
      current.onstop = async () => {
        const blob = new Blob(this.chunks, { type: current.mimeType || "audio/webm" });
        current.stream.getTracks().forEach((track) => track.stop());
        this.recorder = null;

        const text = await this.transcribe(blob);
        resolve(text);
      };
      current.stop();
    });
  }

  private async transcribe(blob: Blob): Promise<string | null> {
    const form = new FormData();
    form.append("audio", blob, "utterance.webm");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(runtimeTransport.getApiUrl("/api/stt"), {
        method: "POST",
        headers: runtimeTransport.getBridgeHeaders(),
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        this.markFailure();
        return null;
      }

      const data = (await res.json()) as { ok: boolean; text?: string };
      if (!data.ok || !data.text) {
        this.markFailure();
        return null;
      }

      return data.text;
    } catch {
      this.markFailure();
      return null;
    }
  }

  private markFailure(): void {
    this.failCount += 1;
    if (this.failCount >= this.failThreshold) {
      this.voiceLocked = true;
    }
  }
}
