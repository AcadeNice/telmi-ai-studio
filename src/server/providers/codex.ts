import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/server/api/response";
import {
  narrativeCodexJsonSchema,
  normalizeCodexNarrativeOutput,
} from "@/lib/narrative/schema";

const execFileAsync = promisify(execFile);
const CODEX_HOME = process.env.CODEX_HOME ?? "/data/codex-home";
const CODEX_COMMAND = process.env.CODEX_COMMAND ?? "codex";
const MAX_OUTPUT_BYTES = 5_000_000;

type LoginState = {
  process?: ChildProcessWithoutNullStreams;
  status: "idle" | "pending" | "connected" | "error";
  url?: string;
  code?: string;
  error?: string;
};

const globalLogin = globalThis as typeof globalThis & {
  telmiCodexLogin?: LoginState;
};

function loginState() {
  return (globalLogin.telmiCodexLogin ??= { status: "idle" });
}

function cleanOutput(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function codexEnvironment() {
  return { ...process.env, CODEX_HOME, NO_COLOR: "1", TERM: "dumb" };
}

export async function listCodexTextModels() {
  const cachePath = path.join(CODEX_HOME, "models_cache.json");
  const fallback = [
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      description: "Modèle Codex le plus capable pour les scénarios complexes.",
    },
  ];
  try {
    const payload = JSON.parse(await fs.readFile(cachePath, "utf8")) as {
      models?: Array<{
        slug?: unknown;
        display_name?: unknown;
        description?: unknown;
        visibility?: unknown;
      }>;
    };
    const list = (payload.models ?? []).flatMap((model) =>
      model.visibility === "list" && typeof model.slug === "string"
        ? [
            {
              id: model.slug,
              name:
                typeof model.display_name === "string"
                  ? model.display_name
                  : model.slug,
              description:
                typeof model.description === "string"
                  ? model.description
                  : undefined,
            },
          ]
        : [],
    );
    return list.length ? list : fallback;
  } catch {
    return fallback;
  }
}

export async function getCodexLoginStatus() {
  await fs.mkdir(CODEX_HOME, { recursive: true });
  try {
    const { stdout, stderr } = await execFileAsync(
      CODEX_COMMAND,
      ["login", "status"],
      { env: codexEnvironment(), timeout: 15_000 },
    );
    const detail = cleanOutput(`${stdout}\n${stderr}`).trim();
    const state = loginState();
    state.status = "connected";
    state.error = undefined;
    return { connected: true, status: "connected" as const, detail };
  } catch {
    const state = loginState();
    return {
      connected: false,
      status: state.status === "pending" ? "pending" : state.status,
      url: state.url,
      code: state.code,
      error: state.error,
    };
  }
}

export async function startCodexDeviceLogin() {
  const current = await getCodexLoginStatus();
  if (current.connected) return current;
  const state = loginState();
  if (state.process && state.status === "pending") return current;
  await fs.mkdir(CODEX_HOME, { recursive: true });
  state.status = "pending";
  state.url = undefined;
  state.code = undefined;
  state.error = undefined;
  const child = spawn(CODEX_COMMAND, ["login", "--device-auth"], {
    env: codexEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.process = child;
  let output = "";
  const consume = (chunk: Buffer) => {
    output = cleanOutput(`${output}${chunk.toString("utf8")}`).slice(
      -MAX_OUTPUT_BYTES,
    );
    state.url = output.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0];
    state.code = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{6}\b/)?.[0];
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.on("error", (error) => {
    state.status = "error";
    state.error = error.message;
    state.process = undefined;
  });
  child.on("exit", (code) => {
    state.process = undefined;
    if (code === 0) state.status = "connected";
    else if (state.status === "pending") {
      state.status = "error";
      state.error = `La connexion Codex s’est arrêtée (code ${code ?? "inconnu"}).`;
    }
  });
  const deadline = Date.now() + 5_000;
  while (!state.code && state.status === "pending" && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  return getCodexLoginStatus();
}

export async function logoutCodex() {
  const state = loginState();
  state.process?.kill("SIGTERM");
  state.process = undefined;
  await fs.mkdir(CODEX_HOME, { recursive: true });
  await execFileAsync(CODEX_COMMAND, ["logout"], {
    env: codexEnvironment(),
    timeout: 15_000,
  }).catch(() => undefined);
  globalLogin.telmiCodexLogin = { status: "idle" };
  return { connected: false, status: "idle" as const };
}

export async function generateNarrativeWithCodex(
  systemPrompt: string,
  userPrompt: string,
  model = "gpt-5.6-sol",
  onProgress?: (percent: number, message: string) => void,
) {
  onProgress?.(12, "Vérification de la connexion ChatGPT/Codex.");
  const status = await getCodexLoginStatus();
  if (!status.connected)
    throw new ApiError(
      409,
      "CODEX_NOT_CONNECTED",
      "Connecte d’abord le compte ChatGPT dans les paramètres Codex CLI.",
    );
  const id = randomUUID();
  const schemaPath = path.join("/tmp", `telmi-codex-schema-${id}.json`);
  const outputPath = path.join("/tmp", `telmi-codex-output-${id}.json`);
  await fs.writeFile(
    schemaPath,
    JSON.stringify(narrativeCodexJsonSchema),
    "utf8",
  );
  const prompt = `${systemPrompt}\n\nDemande du parent :\n${userPrompt}\n\nRetourne uniquement le scénario JSON demandé. N’utilise aucun outil, aucune commande et aucune recherche.`;
  try {
    onProgress?.(22, `Session Codex démarrée avec ${model}.`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        CODEX_COMMAND,
        [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--ignore-user-config",
          "--ignore-rules",
          "--model",
          model,
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          "-",
        ],
        {
          cwd: "/tmp",
          env: codexEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let errorOutput = "";
      let generationReported = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Codex CLI a dépassé le délai de génération."));
      }, 300_000);
      child.stderr.on("data", (chunk: Buffer) => {
        if (!generationReported) {
          generationReported = true;
          onProgress?.(38, "Codex construit le scénario et ses branches.");
        }
        errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(
          -MAX_OUTPUT_BYTES,
        );
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              cleanOutput(errorOutput).trim() || `Codex CLI : code ${code}`,
            ),
          );
      });
      child.stdin.end(prompt);
    });
    onProgress?.(62, "Réponse JSON structurée reçue de Codex.");
    return normalizeCodexNarrativeOutput(
      JSON.parse(await fs.readFile(outputPath, "utf8")) as unknown,
    );
  } finally {
    await Promise.all([
      fs.rm(schemaPath, { force: true }),
      fs.rm(outputPath, { force: true }),
    ]);
  }
}

export async function generateImageWithCodex(
  prompt: string,
  outputPath: string,
  referenceImagePath?: string,
) {
  const status = await getCodexLoginStatus();
  if (!status.connected)
    throw new ApiError(
      409,
      "CODEX_NOT_CONNECTED",
      "Connecte d’abord le compte ChatGPT dans les paramètres Codex CLI.",
    );
  const workDirectory = path.join("/tmp", `telmi-codex-image-${randomUUID()}`);
  const requestedOutput = path.join(workDirectory, "telmi-image.png");
  const referenceCopy = path.join(workDirectory, "story-reference.png");
  const generatedImagesDirectory = path.join(CODEX_HOME, "generated_images");
  const generationStartedAt = Date.now();
  await fs.mkdir(workDirectory, { recursive: true });
  if (referenceImagePath)
    await fs.copyFile(referenceImagePath, referenceCopy).catch(() => undefined);
  const hasReference = await fs
    .access(referenceCopy)
    .then(() => true)
    .catch(() => false);
  const instruction = `$telmi-story-illustrator Crée une illustration Telmi pour une histoire enfantine.\n\nRôle de l’image et contexte visuel : ${prompt}\n\n${hasReference ? `Image de référence canonique pour l’identité et le style : ${referenceCopy}.` : "Aucune image de référence canonique n’est encore disponible : établir l’identité visuelle de cette histoire."}\n\nEnregistre le résultat final dans ${requestedOutput}.`;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        CODEX_COMMAND,
        [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "workspace-write",
          "--ignore-user-config",
          "--ignore-rules",
          "--model",
          "gpt-5.6-sol",
          instruction,
        ],
        {
          cwd: workDirectory,
          env: codexEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let errorOutput = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Codex Imagegen a dépassé le délai de génération."));
      }, 360_000);
      child.stderr.on("data", (chunk: Buffer) => {
        errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(
          -MAX_OUTPUT_BYTES,
        );
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              cleanOutput(errorOutput).trim() ||
                `Codex Imagegen : code ${code}`,
            ),
          );
      });
    });
    let sourcePath = requestedOutput;
    try {
      await fs.access(sourcePath);
    } catch {
      const candidates: Array<{ path: string; modifiedAt: number }> = [];
      const sessionDirectories = await fs
        .readdir(generatedImagesDirectory, { withFileTypes: true })
        .catch(() => []);
      for (const directory of sessionDirectories) {
        if (!directory.isDirectory()) continue;
        const directoryPath = path.join(
          generatedImagesDirectory,
          directory.name,
        );
        const files = await fs.readdir(directoryPath, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !/\.(png|jpe?g|webp)$/i.test(file.name))
            continue;
          const candidatePath = path.join(directoryPath, file.name);
          const stat = await fs.stat(candidatePath);
          if (stat.mtimeMs >= generationStartedAt - 5_000)
            candidates.push({ path: candidatePath, modifiedAt: stat.mtimeMs });
        }
      }
      const generated = candidates.sort(
        (left, right) => right.modifiedAt - left.modifiedAt,
      )[0];
      if (!generated)
        throw new Error("Codex Imagegen n’a produit aucun fichier image.");
      sourcePath = generated.path;
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(sourcePath, outputPath);
    return { outputPath, bytes: (await fs.stat(outputPath)).size };
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}
