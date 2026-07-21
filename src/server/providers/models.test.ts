import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatApproximateUsdRange,
  inferProviderPreset,
  listProviderModels,
  matchesOpenRouterOutput,
  matchesType,
  openAiImagePriceLabel,
  providerBaseUrl,
} from "./models";

describe("provider model catalogs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("infers known providers from legacy URLs", () => {
    expect(
      inferProviderPreset("openai", "https://openrouter.ai/api/v1", "image"),
    ).toBe("openrouter");
    expect(inferProviderPreset("codex", null, "text")).toBe("codex");
    expect(inferProviderPreset("codex", null, "image")).toBe("codex");
    expect(
      inferProviderPreset(
        "compatible",
        "https://openrouter.ai/api/v1",
        "image",
      ),
    ).toBe("openrouter");
  });

  it("uses fixed URLs for presets and manual URLs for custom providers", () => {
    expect(providerBaseUrl("elevenlabs")).toBe("https://api.elevenlabs.io/v1");
    expect(providerBaseUrl("custom", "https://models.example/v1/")).toBe(
      "https://models.example/v1",
    );
  });

  it("separates text and image model identifiers", () => {
    expect(matchesType("gpt-4.1-mini", "text")).toBe(true);
    expect(matchesType("gpt-image-1", "text")).toBe(false);
    expect(matchesType("gpt-image-1", "image")).toBe(true);
    expect(matchesType("text-embedding-3-small", "text")).toBe(false);
  });

  it("keeps image-generating OpenRouter models out of the text selector", () => {
    expect(matchesOpenRouterOutput(["text"], "text")).toBe(true);
    expect(matchesOpenRouterOutput(["text", "image"], "text")).toBe(false);
    expect(matchesOpenRouterOutput(["text", "image"], "image")).toBe(true);
  });

  it("formats indicative per-image provider prices", () => {
    expect(formatApproximateUsdRange([0.05], "image")).toBe("≈ $0.05/image");
    expect(formatApproximateUsdRange([0.03, 0.08], "image")).toBe(
      "≈ $0.03–$0.08/image",
    );
    expect(
      formatApproximateUsdRange([0.02 * 1.048576], "image 1024×1024"),
    ).toBe("≈ $0.021/image 1024×1024");
    expect(openAiImagePriceLabel("gpt-image-1-mini")).toBe(
      "≈ $0.005–$0.036 · 1024×1024 selon qualité",
    );
    expect(openAiImagePriceLabel("unknown-image-model")).toBeUndefined();
  });

  it("keeps the specialized OpenAI image catalog when /models omits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const models = await listProviderModels({
      type: "image",
      preset: "openai",
      apiKey: "test-key",
    });
    expect(models[0]?.id).toBe("gpt-image-2");
    expect(models[0]?.supportsReferenceImage).toBe(true);
  });

  it("exposes Claude Code models only for text generation", async () => {
    const textModels = await listProviderModels({
      type: "text",
      preset: "claude",
    });
    const imageModels = await listProviderModels({
      type: "image",
      preset: "claude",
    });
    expect(textModels.map((model) => model.id)).toEqual([
      "sonnet",
      "opus",
      "haiku",
      "default",
    ]);
    expect(imageModels).toEqual([]);
  });
});
