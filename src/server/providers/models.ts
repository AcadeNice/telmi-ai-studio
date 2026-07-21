import { ApiError } from "@/server/api/response";
import type { ProviderType } from "./config";
import { listCodexTextModels } from "./codex";

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
  priceLabel?: string;
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
            priceLabel: "inclus dans l’abonnement · consommation variable",
          },
        ]
      : listCodexTextModels();
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
  const models = await listOpenAiCompatibleModels(
    baseUrl,
    input.apiKey,
    input.type,
    input.preset === "custom",
  );
  return input.type === "image" && input.preset === "openai"
    ? models.map((model) => ({
        ...model,
        priceLabel: openAiImagePriceLabel(model.id),
      }))
    : models;
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
  const models = normalizeModels(
    (payload?.data ?? []).filter((model) =>
      matchesOpenRouterOutput(
        model.architecture?.output_modalities ?? [],
        type,
      ),
    ),
  );
  return type === "image"
    ? attachOpenRouterImagePrices(baseUrl, apiKey, models)
    : models;
}

async function attachOpenRouterImagePrices(
  baseUrl: string,
  apiKey: string | undefined,
  models: ProviderModel[],
) {
  const result: ProviderModel[] = [];
  const pending = [...models];
  const workers = Array.from(
    { length: Math.min(6, pending.length) },
    async () => {
      while (pending.length) {
        const model = pending.shift();
        if (!model) return;
        const priceLabel = await openRouterImagePriceLabel(
          baseUrl,
          model.id,
          apiKey,
        ).catch(() => undefined);
        result.push({ ...model, priceLabel });
      }
    },
  );
  await Promise.all(workers);
  return result.sort((left, right) =>
    left.name.localeCompare(right.name, "fr"),
  );
}

async function openRouterImagePriceLabel(
  baseUrl: string,
  modelId: string,
  apiKey?: string,
) {
  const response = await fetch(
    `${baseUrl}/images/models/${modelId}/endpoints`,
    {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) return undefined;
  const payload = (await response.json().catch(() => null)) as {
    endpoints?: Array<{
      pricing?: Array<{
        billable?: string;
        unit?: string;
        cost_usd?: number;
      }>;
    }>;
  } | null;
  const directPrices = (payload?.endpoints ?? [])
    .flatMap((endpoint) => endpoint.pricing ?? [])
    .filter(
      (price) =>
        price.billable === "output_image" &&
        price.unit === "image" &&
        Number.isFinite(price.cost_usd),
    )
    .map((price) => Number(price.cost_usd));
  if (directPrices.length)
    return formatApproximateUsdRange(directPrices, "image 1024×1024");
  const megapixelPrices = (payload?.endpoints ?? [])
    .flatMap((endpoint) => endpoint.pricing ?? [])
    .filter(
      (price) =>
        price.billable === "output_image" &&
        price.unit === "megapixel" &&
        Number.isFinite(price.cost_usd),
    )
    .map((price) => Number(price.cost_usd));
  return megapixelPrices.length
    ? formatApproximateUsdRange(
        megapixelPrices.map((price) => price * 1.048576),
        "image 1024×1024",
      )
    : undefined;
}

export function formatApproximateUsdRange(
  values: number[],
  unit: "image" | "image 1024×1024",
) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!valid.length) return undefined;
  const minimum = Math.min(...valid);
  const maximum = Math.max(...valid);
  const format = (value: number) =>
    `$${value
      .toFixed(value < 0.01 ? 4 : 3)
      .replace(/0+$/, "")
      .replace(/\.$/, "")}`;
  return minimum === maximum
    ? `≈ ${format(minimum)}/${unit}`
    : `≈ ${format(minimum)}–${format(maximum)}/${unit}`;
}

export function openAiImagePriceLabel(modelId: string) {
  const id = modelId.toLowerCase();
  if (id.includes("gpt-image-1-mini"))
    return "≈ $0.005–$0.036 · 1024×1024 selon qualité";
  if (id.includes("gpt-image-1.5") || id.includes("chatgpt-image"))
    return "≈ $0.009–$0.133 · 1024×1024 selon qualité";
  if (id === "gpt-image-1" || id.startsWith("gpt-image-1-"))
    return "≈ $0.011–$0.167 · 1024×1024 selon qualité";
  if (id.includes("dall-e-3")) return "≈ $0.04 · 1024×1024 qualité standard";
  if (id.includes("dall-e-2")) return "≈ $0.016 · 1024×1024";
  return undefined;
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
