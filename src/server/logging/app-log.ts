import fs from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "@/server/storage/paths";

const sensitive =
  /(api[_-]?key|authorization|token|secret|password)(["'\s:=]+)([^\s,"'}]+)/gi;

function redact(value: unknown) {
  const text =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return text
    .replace(sensitive, "$1$2[MASQUÉ]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[JETON_MASQUÉ]");
}

export async function writeAppLog(
  level: "info" | "warning" | "error",
  message: string,
  context?: unknown,
) {
  const directory = path.join(dataDirectory, "logs");
  await fs.mkdir(directory, { recursive: true });
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message: redact(message),
    context: context === undefined ? undefined : redact(context),
  });
  await fs.appendFile(path.join(directory, "application.jsonl"), `${line}\n`, {
    mode: 0o600,
  });
}

export async function readAppLogs(limit = 200) {
  try {
    const content = await fs.readFile(
      path.join(dataDirectory, "logs", "application.jsonl"),
      "utf8",
    );
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
