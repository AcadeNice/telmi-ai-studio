import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NarrativeStory } from "@/lib/narrative/schema";
import {
  compileTelmiDocuments,
  validateTelmiDocuments,
} from "@/lib/telmi/compiler";

const execFileAsync = promisify(execFile);

export async function validateImage(
  filePath: string,
  expectedWidth = 640,
  expectedHeight = 480,
) {
  const metadata = await sharp(filePath).metadata();
  return (
    metadata.format === "png" &&
    metadata.width === expectedWidth &&
    metadata.height === expectedHeight
  );
}

export async function validateAudio(filePath: string) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,bit_rate,codec_name",
      "-of",
      "json",
      filePath,
    ]);
    const stream = JSON.parse(stdout).streams?.[0];
    const bitrate = Number(stream?.bit_rate ?? 0);
    return (
      stream?.codec_name === "mp3" &&
      Number(stream?.sample_rate) === 44_100 &&
      bitrate >= 64_000 &&
      bitrate <= 192_000
    );
  } catch {
    return false;
  }
}

export async function buildTelmiPack(options: {
  story: NarrativeStory;
  uuid: string;
  version: number;
  assetDirectory: string;
  outputPath: string;
  illustrationMode?: "cover" | "choices" | "every-scene";
  author?: string;
  voice?: string;
  publisher?: string;
}) {
  const documents = compileTelmiDocuments(
    options.story,
    options.uuid,
    options.version,
    options.illustrationMode,
    {
      author: options.author,
      voice: options.voice,
      publisher: options.publisher,
    },
  );
  const validation = validateTelmiDocuments(documents.nodes);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));

  const rootName = `${String(options.story.age).padStart(2, "0")}__${options.story.title.replace(/[^a-zA-Z0-9_-]/g, "_")}_${options.uuid}`;
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const archive = archiver("zip", { zlib: { level: 9 } });
  const output = fs.createWriteStream(options.outputPath);
  const passthrough = new PassThrough();
  archive.pipe(passthrough);
  const completion = pipeline(passthrough, output);

  archive.append(JSON.stringify(documents.metadata, null, 2), {
    name: `${rootName}/metadata.json`,
  });
  archive.append(JSON.stringify(documents.nodes, null, 2), {
    name: `${rootName}/nodes.json`,
  });
  archive.append(JSON.stringify(documents.notes, null, 2), {
    name: `${rootName}/notes.json`,
  });
  if (fs.existsSync(options.assetDirectory))
    archive.directory(options.assetDirectory, rootName);
  await archive.finalize();
  await completion;
  return {
    outputPath: options.outputPath,
    bytes: fs.statSync(options.outputPath).size,
    documents,
  };
}
