import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/server/api/response";

const execFileAsync = promisify(execFile);
const PIPER_PYTHON = process.env.PIPER_PYTHON ?? "/opt/piper/bin/python";
const PIPER_VOICE_DIR = process.env.PIPER_VOICE_DIR ?? "/opt/piper/voices";
const MAX_TEXT_LENGTH = 20_000;

export const PIPER_DEFAULT_VOICE = "fr_FR-beatrice";

const voices = [
  {
    voice_id: PIPER_DEFAULT_VOICE,
    name: "Béatrice — Français (Piper local)",
    category: "local",
    labels: { language: "fr", accent: "France", provider: "Piper" },
  },
  {
    voice_id: "fr_FR-siwis-medium",
    name: "Siwis — Français (Piper local)",
    category: "local",
    labels: { language: "fr", accent: "France", provider: "Piper" },
  },
] as const;

export function listPiperVoices() {
  return voices.map((voice) => ({ ...voice, labels: { ...voice.labels } }));
}

export function resolvePiperVoice(voiceId?: string | null) {
  return voices.some((voice) => voice.voice_id === voiceId)
    ? (voiceId as string)
    : PIPER_DEFAULT_VOICE;
}

function assertVoice(voiceId: string) {
  if (!voices.some((voice) => voice.voice_id === voiceId))
    throw new ApiError(
      400,
      "PIPER_VOICE_UNAVAILABLE",
      "Cette voix Piper locale n’est pas installée.",
    );
}

export async function generatePiperSpeech(
  text: string,
  voiceId: string,
  outputPath: string,
) {
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.length > MAX_TEXT_LENGTH)
    throw new ApiError(
      400,
      "PIPER_TEXT_INVALID",
      "Le texte de narration est vide ou trop long.",
    );
  assertVoice(voiceId);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const wavPath = path.join("/tmp", `telmi-piper-${randomUUID()}.wav`);
  try {
    await execFileAsync(
      PIPER_PYTHON,
      [
        "-m",
        "piper",
        "-m",
        voiceId,
        "--data-dir",
        PIPER_VOICE_DIR,
        "-f",
        wavPath,
        "--",
        normalizedText,
      ],
      { timeout: 180_000, maxBuffer: 2_000_000 },
    );
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        wavPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-f",
        "mp3",
        outputPath,
      ],
      { timeout: 180_000, maxBuffer: 2_000_000 },
    );
    return { outputPath, bytes: (await fs.stat(outputPath)).size };
  } finally {
    await fs.rm(wavPath, { force: true });
  }
}
