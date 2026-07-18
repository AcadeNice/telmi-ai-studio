import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@/server/api/response";
import { getProviderConfig } from "./config";

const BASE_URL = "https://api.elevenlabs.io/v1";
const MAX_AUDIO_BYTES = 50_000_000;

function cleanBaseUrl(baseUrl = BASE_URL) {
  return baseUrl.replace(/\/+$/, "");
}

export function getElevenLabsVoicesUrl(baseUrl = BASE_URL) {
  const base = cleanBaseUrl(baseUrl);
  if (base.endsWith("/v1")) return `${base.slice(0, -3)}/v2/voices`;
  if (base.endsWith("/v2")) return `${base}/voices`;
  return `${base}/voices`;
}

function assertBoundedResponse(response: Response, maxBytes: number) {
  const size = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(size) && size > maxBytes)
    throw new Error("La réponse du fournisseur dépasse la taille autorisée.");
}

export async function listElevenLabsVoices() {
  const config = getProviderConfig("tts");
  const voices: Array<{
    voice_id: string;
    name: string;
    category?: string;
    preview_url?: string;
    labels?: Record<string, string>;
  }> = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const url = new URL(getElevenLabsVoicesUrl(config.baseUrl ?? BASE_URL));
    url.searchParams.set("page_size", "100");
    url.searchParams.set("sort", "name");
    url.searchParams.set("sort_direction", "asc");
    if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);

    const response = await fetch(url, {
      headers: { "xi-api-key": config.apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new ApiError(
        502,
        "ELEVENLABS_VOICES_ERROR",
        response.status === 401
          ? "ElevenLabs refuse la clé API configurée."
          : `Impossible de récupérer les voix ElevenLabs (HTTP ${response.status}).`,
      );
    const payload = (await response.json()) as {
      voices?: typeof voices;
      has_more?: boolean;
      next_page_token?: string | null;
    };
    voices.push(...(payload.voices ?? []));
    if (!payload.has_more || !payload.next_page_token) break;
    nextPageToken = payload.next_page_token;
  }

  return voices;
}

export async function generateSpeech(
  text: string,
  voiceId: string,
  outputPath: string,
) {
  const config = getProviderConfig("tts");
  const response = await fetch(
    `${cleanBaseUrl(config.baseUrl ?? BASE_URL)}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
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
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: { code?: string; message?: string };
    } | null;
    if (
      response.status === 402 &&
      payload?.detail?.code === "paid_plan_required"
    )
      throw new Error(
        "La voix ElevenLabs sélectionnée nécessite un abonnement payant. Choisissez une voix prédéfinie ou utilisez un compte ElevenLabs payant.",
      );
    throw new Error(
      payload?.detail?.message
        ? `ElevenLabs TTS : ${payload.detail.message}`
        : `ElevenLabs TTS : HTTP ${response.status}`,
    );
  }
  assertBoundedResponse(response, MAX_AUDIO_BYTES);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength > MAX_AUDIO_BYTES)
    throw new Error("La réponse audio dépasse 50 Mo.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, audio);
  return { outputPath, bytes: (await fs.stat(outputPath)).size };
}
