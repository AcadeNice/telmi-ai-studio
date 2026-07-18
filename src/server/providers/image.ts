import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getProviderConfig } from "./config";

export async function generateImage(prompt: string, outputPath: string) {
  const config = getProviderConfig("image");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
  });
  const response = await client.images.generate({
    model: config.model ?? "gpt-image-1",
    prompt,
    size: "1024x1024",
    response_format: "b64_json",
  });
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded)
    throw new Error("Le fournisseur image n’a retourné aucune image.");
  if (encoded.length > 70_000_000)
    throw new Error("La réponse image dépasse la taille autorisée.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(encoded, "base64"))
    .resize(640, 480, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return { outputPath, bytes: (await fs.stat(outputPath)).size };
}
