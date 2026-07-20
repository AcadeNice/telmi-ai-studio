import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getProviderConfig } from "./config";
import { generateImageWithCodex } from "./codex";

type ImageGenerationResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

function isOpenRouter(baseUrl?: string | null) {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

async function generateWithOpenRouter(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/images`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, prompt }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response
    .json()
    .catch(() => null)) as ImageGenerationResponse | null;
  if (!response.ok)
    throw new Error(
      payload?.error?.message
        ? `OpenRouter images : ${payload.error.message}`
        : `OpenRouter images : HTTP ${response.status}`,
    );
  return payload;
}

export async function generateImage(
  prompt: string,
  outputPath: string,
  choiceNavigation = false,
) {
  const config = getProviderConfig("image");
  if (config.provider.toLowerCase() === "codex") {
    const temporary = `${outputPath}.codex-source`;
    try {
      await generateImageWithCodex(prompt, temporary);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await sharp(temporary)
        .resize(640, 480, { fit: "cover" })
        .composite(
          choiceNavigation ? [{ input: choiceNavigationOverlay() }] : [],
        )
        .png({ compressionLevel: 9 })
        .toFile(outputPath);
      return { outputPath, bytes: (await fs.stat(outputPath)).size };
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const model = config.model ?? "gpt-image-1";
  const response = isOpenRouter(config.baseUrl)
    ? await generateWithOpenRouter(
        config.apiKey,
        config.baseUrl!,
        model,
        prompt,
      )
    : await new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? undefined,
      }).images.generate({
        model,
        prompt,
        size: "1024x1024",
        response_format: "b64_json",
      });
  const encoded = response?.data?.[0]?.b64_json;
  if (!encoded)
    throw new Error("Le fournisseur image n’a retourné aucune image.");
  if (encoded.length > 70_000_000)
    throw new Error("La réponse image dépasse la taille autorisée.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(encoded, "base64"))
    .resize(640, 480, { fit: "cover" })
    .composite(choiceNavigation ? [{ input: choiceNavigationOverlay() }] : [])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return { outputPath, bytes: (await fs.stat(outputPath)).size };
}

function choiceNavigationOverlay() {
  return Buffer.from(`<svg width="640" height="480" viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 480V376A104 104 0 0 1 104 480H0Z" fill="white" fill-opacity="0.94"/>
    <g fill="none" stroke="#31284F" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M45 425L25 445L45 465"/>
      <path d="M25 445H53"/>
      <path d="M65 425L85 445L65 465"/>
      <path d="M57 445H85"/>
    </g>
  </svg>`);
}
