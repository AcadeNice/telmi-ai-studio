import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { ApiError } from "@/server/api/response";
import {
  narrativeCodexJsonSchema,
  normalizeCodexNarrativeOutput,
} from "@/lib/narrative/schema";

const execFileAsync = promisify(execFile);
const CLAUDE_COMMAND = process.env.CLAUDE_COMMAND ?? "claude";
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR ?? "/data/claude-home";
const MAX_OUTPUT_BYTES = 5_000_000;

type ClaudeLoginState = {
  process?: ChildProcessWithoutNullStreams;
  status: "idle" | "pending" | "connected" | "error";
  url?: string;
  detail?: string;
  error?: string;
};

const globalClaude = globalThis as typeof globalThis & {
  telmiClaudeLogin?: ClaudeLoginState;
};

function loginState() {
  return (globalClaude.telmiClaudeLogin ??= { status: "idle" });
}

function environment() {
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR,
    DISABLE_AUTOUPDATER: "1",
    NO_COLOR: "1",
    TERM: "dumb",
  };
}

function cleanOutput(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

export async function getClaudeLoginStatus() {
  try {
    const { stdout } = await execFileAsync(CLAUDE_COMMAND, ["auth", "status"], {
      env: environment(),
      timeout: 15_000,
    });
    const payload = JSON.parse(stdout) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
      authMethod?: string;
    };
    if (payload.loggedIn === false) throw new Error("not logged in");
    const state = loginState();
    state.status = "connected";
    state.error = undefined;
    return {
      connected: true,
      status: "connected" as const,
      email: payload.email,
      subscriptionType: payload.subscriptionType,
      authMethod: payload.authMethod,
    };
  } catch {
    const state = loginState();
    return {
      connected: false,
      status: state.status === "pending" ? "pending" : state.status,
      url: state.url,
      detail: state.detail,
      error: state.error,
    };
  }
}

export async function startClaudeLogin() {
  const current = await getClaudeLoginStatus();
  if (current.connected) return current;
  const state = loginState();
  if (state.process && state.status === "pending") return current;
  state.status = "pending";
  state.url = undefined;
  state.detail = undefined;
  state.error = undefined;
  const child = spawn(CLAUDE_COMMAND, ["auth", "login"], {
    env: environment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.process = child;
  let output = "";
  const consume = (chunk: Buffer) => {
    output = cleanOutput(`${output}${chunk.toString("utf8")}`).slice(
      -MAX_OUTPUT_BYTES,
    );
    state.url = output.match(/https:\/\/[^\s'"<>]+/)?.[0];
    state.detail = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" · ")
      .slice(0, 1_000);
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
      state.error = `La connexion Claude Code s’est arrêtée (code ${code ?? "inconnu"}).`;
    }
  });
  const deadline = Date.now() + 5_000;
  while (!state.url && state.status === "pending" && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  return getClaudeLoginStatus();
}

export async function submitClaudeLoginCode(code: string) {
  const state = loginState();
  if (!state.process || state.status !== "pending")
    throw new ApiError(
      409,
      "CLAUDE_LOGIN_NOT_PENDING",
      "Démarre d’abord la connexion Claude Code.",
    );
  state.process.stdin.write(`${code.trim()}\n`);
  const deadline = Date.now() + 15_000;
  while (state.status === "pending" && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  return getClaudeLoginStatus();
}

export async function logoutClaude() {
  const state = loginState();
  state.process?.kill("SIGTERM");
  await execFileAsync(CLAUDE_COMMAND, ["auth", "logout"], {
    env: environment(),
    timeout: 15_000,
  }).catch(() => undefined);
  globalClaude.telmiClaudeLogin = { status: "idle" };
  return { connected: false, status: "idle" as const };
}

export async function generateNarrativeWithClaude(
  systemPrompt: string,
  userPrompt: string,
  model = "sonnet",
  onProgress?: (percent: number, message: string) => void,
) {
  onProgress?.(12, "Vérification de la connexion Claude Code.");
  const status = await getClaudeLoginStatus();
  if (!status.connected)
    throw new ApiError(
      409,
      "CLAUDE_NOT_CONNECTED",
      "Connecte d’abord le compte Claude dans les paramètres Claude Code CLI.",
    );
  const prompt = `${systemPrompt}\n\nDemande du parent :\n${userPrompt}\n\nRetourne uniquement le scénario JSON demandé. N’utilise aucun outil, aucune commande et aucune recherche.`;
  onProgress?.(24, `Session Claude Code démarrée avec ${model}.`);
  const { stdout } = await execFileAsync(
    CLAUDE_COMMAND,
    [
      "-p",
      "--model",
      model,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(narrativeCodexJsonSchema),
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
      prompt,
    ],
    {
      cwd: "/tmp",
      env: environment(),
      timeout: 300_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    },
  );
  onProgress?.(62, "Réponse JSON structurée reçue de Claude Code.");
  const payload = JSON.parse(stdout) as {
    structured_output?: unknown;
    result?: unknown;
  };
  const raw =
    payload.structured_output ??
    (typeof payload.result === "string"
      ? JSON.parse(payload.result)
      : payload.result);
  if (!raw)
    throw new Error("Claude Code n’a retourné aucun scénario structuré.");
  return normalizeCodexNarrativeOutput(raw);
}
