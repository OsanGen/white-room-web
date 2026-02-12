import { RabbitTone } from "@white-room/shared";
import { runtimeTransport } from "../runtime/RuntimeTransport";

export async function playTtsNonBlocking(text: string, tone: RabbitTone): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...runtimeTransport.getBridgeHeaders(),
      },
      body: JSON.stringify({ text, tone }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return;
    const wav = await res.arrayBuffer();
    const audio = new Audio(URL.createObjectURL(new Blob([wav], { type: "audio/wav" })));
    void audio.play();
  } catch {
    // subtitles remain authoritative fallback
  }
}
