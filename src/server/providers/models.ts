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
  strengths?: string;
  limitations?: string;
  supportsReferenceImage?: boolean;
};

const PRESET_BASE_URLS: Partial<Record<ProviderPreset, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  elevenlabs: "https://api.elevenlabs.io/v1",
};

const OPENAI_IMAGE_MODELS: ProviderModel[] = [
  {
    id: "gpt-image-2",
    name: "GPT Image 2 — recommandé",
    description:
      "Modèle OpenAI actuel pour la génération et l’édition d’images de haute qualité.",
    supportsReferenceImage: true,
  },
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5 — ancien",
    description:
      "Ancienne génération GPT Image, encore utile pour comparer qualité et coût.",
    limitations:
      "Modèle déprécié par OpenAI : préférez GPT Image 2 pour un nouveau projet.",
    supportsReferenceImage: true,
  },
  {
    id: "gpt-image-1",
    name: "GPT Image 1 — ancien",
    description: "Ancien modèle OpenAI de génération et d’édition d’images.",
    limitations:
      "Modèle déprécié par OpenAI, conservé uniquement pour compatibilité.",
    supportsReferenceImage: true,
  },
  {
    id: "gpt-image-1-mini",
    name: "GPT Image 1 mini — économique, ancien",
    description:
      "Ancienne variante économique de GPT Image 1, adaptée aux essais peu coûteux.",
    limitations:
      "Moins fidèle et désormais déprécié ; déconseillé pour la cohérence finale d’un livre.",
    supportsReferenceImage: true,
  },
  {
    id: "dall-e-3",
    name: "DALL·E 3 — historique",
    description: "Ancien modèle de génération à partir de texte.",
    limitations:
      "Déprécié et sans réutilisation fiable d’une image de référence.",
    supportsReferenceImage: false,
  },
  {
    id: "dall-e-2",
    name: "DALL·E 2 — historique",
    description:
      "Premier ancien modèle DALL·E encore listé pour compatibilité.",
    limitations:
      "Qualité inférieure, déprécié et sans cohérence par image de référence.",
    supportsReferenceImage: false,
  },
];

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
}): Promise<ProviderModel[]> {
  if (input.preset === "codex")
    return input.type === "image"
      ? [
          {
            id: "gpt-image-2",
            name: "GPT Image 2 — abonnement Codex",
            description:
              "Génération d’illustrations via Codex et le skill officiel $imagegen.",
            priceLabel: "inclus dans l’abonnement · consommation variable",
            strengths:
              "Bonne compréhension des consignes, retouches et réutilisation d’une fiche de personnages.",
            limitations:
              "Plus lent qu’une API directe et soumis aux limites de l’abonnement ChatGPT.",
            supportsReferenceImage: true,
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
    ? mergeProviderModels(OPENAI_IMAGE_MODELS, models).map((model) => ({
        ...enrichImageModel(model),
        priceLabel: openAiImagePriceLabel(model.id),
      }))
    : models;
}

function mergeProviderModels(
  preferred: ProviderModel[],
  discovered: ProviderModel[],
) {
  const byId = new Map(discovered.map((model) => [model.id, model]));
  return [
    ...preferred.map((model) => ({ ...byId.get(model.id), ...model })),
    ...discovered.filter(
      (model) =>
        !preferred.some((preferredModel) => preferredModel.id === model.id),
    ),
  ];
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
    ? attachOpenRouterImagePrices(
        baseUrl,
        apiKey,
        await listOpenRouterImageCapabilities(baseUrl, apiKey, models),
      )
    : models;
}

async function listOpenRouterImageCapabilities(
  baseUrl: string,
  apiKey: string | undefined,
  fallback: ProviderModel[],
) {
  const response = await fetch(`${baseUrl}/images/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) return fallback.map(enrichImageModel);
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: string;
      name?: string;
      description?: string;
      supported_parameters?: Record<string, unknown>;
    }>;
  } | null;
  const models = (payload?.data ?? []).flatMap((model) =>
    model.id
      ? [
          enrichImageModel({
            id: model.id,
            name: model.name || model.id,
            description: model.description,
            supportsReferenceImage: Object.hasOwn(
              model.supported_parameters ?? {},
              "input_references",
            ),
          }),
        ]
      : [],
  );
  return models.length ? models : fallback.map(enrichImageModel);
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
        ).catch(() => "prix indisponible");
        result.push({ ...model, priceLabel });
      }
    },
  );
  await Promise.all(workers);
  return result.sort(
    (left, right) =>
      Number(right.supportsReferenceImage === true) -
        Number(left.supportsReferenceImage === true) ||
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
  if (!response.ok) return "prix indisponible";
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
  if (megapixelPrices.length)
    return formatApproximateUsdRange(
      megapixelPrices.map((price) => price * 1.048576),
      "image 1024×1024",
    );
  const tokenPriced = (payload?.endpoints ?? [])
    .flatMap((endpoint) => endpoint.pricing ?? [])
    .some(
      (price) =>
        price.billable === "output_image" &&
        price.unit === "token" &&
        Number.isFinite(price.cost_usd),
    );
  return tokenPriced
    ? "prix variable · jetons image"
    : "prix non publié par OpenRouter";
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
  if (id.includes("gpt-image-2")) return "prix variable · calculateur OpenAI";
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

function enrichImageModel(model: ProviderModel): ProviderModel {
  const id = model.id.toLowerCase();
  const reference = model.supportsReferenceImage === true;
  if (id.includes("gpt-image") || id.includes("chatgpt-image"))
    return {
      ...model,
      supportsReferenceImage: model.supportsReferenceImage ?? true,
      strengths:
        model.strengths ??
        "Très bonne fidélité aux consignes, édition d’images et cohérence à partir d’une référence.",
      limitations:
        model.limitations ??
        "Le coût et le délai augmentent avec la qualité ; le rendu peut être moins stylisé que certains modèles spécialisés.",
    };
  if (id.includes("gemini") || id.includes("nano-banana"))
    return {
      ...model,
      strengths:
        "Bon suivi du contexte, retouche et cohérence des personnages lorsque les références sont acceptées.",
      limitations:
        "Le rendu et les capacités exactes varient selon la version Gemini et le fournisseur routé.",
    };
  if (id.includes("seedream"))
    return {
      ...model,
      strengths:
        "Illustrations détaillées, styles variés et bonne continuité visuelle avec une référence.",
      limitations:
        "Les petits accessoires et les scènes très chargées doivent rester contrôlés image par image.",
    };
  if (id.includes("flux"))
    return {
      ...model,
      strengths:
        "Très bon rendu visuel, lumière et détails ; adapté aux illustrations expressives.",
      limitations: reference
        ? "La référence améliore la cohérence, mais certains détails fins peuvent encore dériver."
        : "Cette variante ne déclare pas d’image de référence ; cohérence moins fiable entre scènes.",
    };
  if (id.includes("ideogram"))
    return {
      ...model,
      strengths:
        "Bon pour les compositions graphiques et le texte intégré à une image.",
      limitations:
        "Moins prioritaire pour Telmi, qui demande des images sans texte et une forte continuité des personnages.",
    };
  if (id.includes("recraft"))
    return {
      ...model,
      strengths:
        "Excellent pour les aplats, styles illustrés, icônes et rendus vectoriels propres.",
      limitations:
        "Moins adapté aux personnages narratifs complexes et aux nombreuses variations émotionnelles.",
    };
  return {
    ...model,
    strengths:
      model.description ?? "Modèle disponible pour la génération d’images.",
    limitations: reference
      ? "La référence améliore la continuité, mais chaque illustration doit être vérifiée."
      : "Aucune référence visuelle n’est déclarée ; la cohérence entre scènes n’est pas garantie.",
  };
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
