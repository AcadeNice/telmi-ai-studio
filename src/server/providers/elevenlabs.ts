import fs from "node:fs/promises";
import path from "node:path";
import { getProviderConfig } from "./config";

const BASE_URL = "https://api.elevenlabs.io/v1";
const MAX_AUDIO_BYTES = 50_000_000;

function assertBoundedResponse(response: Response, maxBytes: number) {
  const size = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(size) && size > maxBytes)
    throw new Error("La réponse du fournisseur dépasse la taille autorisée.");
}

export async function listElevenLabsVoices() {
  const config = getProviderConfig("tts");
  const response = await fetch(`${config.baseUrl ?? BASE_URL}/voices`, {
    headers: { "xi-api-key": config.apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`ElevenLabs voices: HTTP ${response.status}`);
  const payload = (await response.json()) as {
    voices?: Array<{
      voice_id: string;
      name: string;
      category?: string;
      preview_url?: string;
    }>;
  };
  return payload.voices ?? [];
}

export async function generateSpeech(
  text: string,
  voiceId: string,
  outputPath: string,
) {
  const config = getProviderConfig("tts");
  const response = await fetch(
    `${config.baseUrl ?? BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: config.model ?? "eleven_multilingual_v2",
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs TTS: HTTP ${response.status}`);
  assertBoundedResponse(response, MAX_AUDIO_BYTES);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength > MAX_AUDIO_BYTES)
    throw new Error("La réponse audio dépasse 50 Mo.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, audio);
  return { outputPath, bytes: (await fs.stat(outputPath)).size };
}
