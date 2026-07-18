import path from "node:path";

export const dataDirectory =
  process.env.DATA_DIR ?? path.join(process.cwd(), "data");

export function versionDirectory(storyId: string, version: number) {
  return path.join(dataDirectory, "stories", storyId, `v${version}`);
}

export function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
