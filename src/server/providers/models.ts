import { ApiError } from "@/server/api/response";
import type { ProviderType } from "./config";

export type ProviderPreset =
  | "openrouter"
  | "openai"
  | "mistral"
  | "groq"
  | "elevenlabs"
  | "piper"
  | "codex"
  | "custom";

export type ProviderModel = {
  id: string;
  name: string;
  description?: string;
};

const PRESET_BASE_URLS: Partial<Record<ProviderPreset, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  elevenlabs: "https://api.elevenlabs.io/v1",
};

export function providerBaseUrl(
  preset: ProviderPreset,
  customBaseUrl?: string | null,
) {
  return preset === "custom"
    ? customBaseUrl?.replace(/\/+$/, "")
    : PRESET_BASE_URLS[preset];
}

export function inferProviderPreset(
  provider: string,
  baseUrl: string | null | undefined,
  type: ProviderType,
): ProviderPreset {
  const normalized = provider.toLowerCase();
  try {
    const hostname = new URL(baseUrl ?? "").hostname;
    if (hostname === "openrouter.ai") return "openrouter";
    if (hostname === "api.openai.com") return "openai";
    if (hostname === "api.mistral.ai") return "mistral";
    if (hostname === "api.groq.com") return "groq";
    if (hostname === "api.elevenlabs.io") return "elevenlabs";
  } catch {
    // A custom URL is validated by the API schema before use.
  }
  if (type === "tts" && normalized === "elevenlabs") return "elevenlabs";
  if (type === "tts" && normalized === "piper") return "piper";
  if (["text", "image"].includes(type) && normalized === "codex")
    return "codex";
  if (["openrouter", "openai", "mistral", "groq"].includes(normalized))
    return normalized as ProviderPreset;
  return "custom";
}

export async function listProviderModels(input: {
  type: ProviderType;
  preset: ProviderPreset;
  apiKey?: string;
  baseUrl?: string | null;
}) {
  if (input.preset === "codex")
    return input.type === "image"
      ? [
          {
            id: "gpt-image-2",
            name: "GPT Image 2 — abonnement Codex",
            description: "Génération via le skill officiel $imagegen.",
          },
        ]
      : [
          {
            id: "gpt-5.6-sol",
            name: "GPT-5.6 Sol — abonnement Codex",
            description: "Modèle Codex recommandé pour générer le scénario.",
          },
        ];
  if (input.preset === "piper")
    return [
      {
        id: "fr_FR-beatrice",
        name: "Béatrice — Français (local)",
        description: "Voix Piper utilisée par défaut dans Telmi Sync.",
      },
      {
        id: "fr_FR-gilles-low",
        name: "Gilles — qualité basse",
      },
      {
        id: "fr_FR-mls-medium",
        name: "MLS — qualité moyenne",
      },
      {
        id: "fr_FR-mls_1840-low",
        name: "MLS 1840 — qualité basse",
      },
      {
        id: "fr_FR-siwis-low",
        name: "Siwis — qualité basse",
      },
      {
        id: "fr_FR-siwis-medium",
        name: "Siwis — qualité moyenne",
      },
      {
        id: "fr_FR-tom-medium",
        name: "Tom — qualité moyenne",
      },
      {
        id: "fr_FR-upmc-medium",
        name: "UPMC — qualité moyenne",
      },
    ];
  const baseUrl = providerBaseUrl(input.preset, input.baseUrl);
  if (!baseUrl)
    throw new ApiError(
      400,
      "BASE_URL_REQUIRED",
      "Saisissez l’URL de l’API personnalisée.",
    );
  if (input.preset === "openrouter")
    return listOpenRouterModels(baseUrl, input.type, input.apiKey);
  if (input.preset === "elevenlabs") {
    if (!input.apiKey) throwApiKeyRequired();
    return listElevenLabsModels(baseUrl, input.apiKey);
  }
  if (!input.apiKey) throwApiKeyRequired();
  return listOpenAiCompatibleModels(
    baseUrl,
    input.apiKey,
    input.type,
    input.preset === "custom",
  );
}

function throwApiKeyRequired(): never {
  throw new ApiError(
    400,
    "API_KEY_REQUIRED",
    "Saisissez d’abord la clé API, puis actualisez les modèles.",
  );
}

async function listOpenRouterModels(
  baseUrl: string,
  type: ProviderType,
  apiKey?: string,
) {
  if (type === "tts") return [];
  const url = new URL(`${baseUrl}/models`);
  url.searchParams.set(
    "output_modalities",
    type === "image" ? "image" : "text",
  );
  url.searchParams.set("sort", "most-popular");
  if (type === "text")
    url.searchParams.set("supported_parameters", "structured_outputs");
  const response = await fetch(url, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: string;
      name?: string;
      description?: string;
      architecture?: { output_modalities?: string[] };
    }>;
  } | null;
  if (!response.ok)
    throw new ApiError(
      502,
      "MODEL_CATALOG_ERROR",
      `OpenRouter n’a pas retourné son catalogue (HTTP ${response.status}).`,
    );
  return normalizeModels(
    (payload?.data ?? []).filter((model) =>
      matchesOpenRouterOutput(
        model.architecture?.output_modalities ?? [],
        type,
      ),
    ),
  );
}

export function matchesOpenRouterOutput(
  modalities: string[],
  type: ProviderType,
) {
  if (type === "image") return modalities.includes("image");
  if (type !== "text") return false;
  return modalities.length === 1 && modalities[0] === "text";
}

async function listOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string,
  type: ProviderType,
  includeAll: boolean,
) {
  if (type === "tts") return [];
  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ id?: string; name?: string; description?: string }>;
  } | null;
  if (!response.ok)
    throw new ApiError(
      502,
      "MODEL_CATALOG_ERROR",
      `Le fournisseur n’a pas retourné ses modèles (HTTP ${response.status}).`,
    );
  const models = payload?.data ?? [];
  return normalizeModels(
    includeAll ? models : models.filter((model) => matchesType(model.id, type)),
  );
}

async function listElevenLabsModels(baseUrl: string, apiKey: string) {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as Array<{
    model_id?: string;
    name?: string;
    description?: string;
    can_do_text_to_speech?: boolean;
    requires_alpha_access?: boolean;
  }> | null;
  if (!response.ok)
    throw new ApiError(
      502,
      "MODEL_CATALOG_ERROR",
      `ElevenLabs n’a pas retourné ses modèles (HTTP ${response.status}).`,
    );
  return (Array.isArray(payload) ? payload : [])
    .filter(
      (model) => model.can_do_text_to_speech && !model.requires_alpha_access,
    )
    .flatMap((model) =>
      model.model_id
        ? [
            {
              id: model.model_id,
              name: model.name || model.model_id,
              description: model.description,
            },
          ]
        : [],
    )
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export function matchesType(id: string | undefined, type: ProviderType) {
  if (!id) return false;
  const value = id.toLowerCase();
  const image = value.includes("image") || value.includes("dall-e");
  if (type === "image") return image;
  if (type !== "text") return false;
  return ![
    "embedding",
    "moderation",
    "whisper",
    "transcribe",
    "tts",
    "realtime",
    "audio",
    "image",
    "dall-e",
  ].some((fragment) => value.includes(fragment));
}

function normalizeModels(
  models: Array<{ id?: string; name?: string; description?: string }>,
) {
  return models
    .flatMap((model) =>
      model.id
        ? [
            {
              id: model.id,
              name: model.name || model.id,
              description: model.description,
            },
          ]
        : [],
    )
    .sort((left, right) => left.name.localeCompare(right.name, "fr"))
    .slice(0, 500);
}
