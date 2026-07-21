import { and, eq, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { ApiError } from "@/server/api/response";
import { expectedMedia, mediaKey } from "@/lib/media/review";
import {
  choiceDisplayLabel,
  choiceImagePrompt,
  coverImagePrompt,
  isMultipleChoiceImage,
  noTextImagePrompt,
} from "@/lib/narrative/choice-labels";
import { buildStoryVisualContext } from "@/lib/narrative/image-style";
import type { CreationParameters } from "@/lib/narrative/schema";
import { db, ensureDatabase } from "@/server/db";
import {
  generatedAssets,
  generationJobs,
  jobSteps,
  stories,
  storyVersions,
} from "@/server/db/schema";
import { recordUsage } from "@/server/jobs/service";
import { generateSpeech } from "@/server/providers/tts";
import { getProviderConfig } from "@/server/providers/config";
import {
  generateImage,
  supportsConfiguredImageReferences,
} from "@/server/providers/image";
import { loadNarrative } from "@/server/stories/service";
import { versionDirectory } from "@/server/storage/paths";
import { validateAudio, validateImage } from "@/server/telmi/pack";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_AUDIO_BYTES = 50_000_000;

type AssetMetadata = {
  prompt?: string;
  text?: string;
  voiceId?: string;
  label?: string;
  source?: "generated" | "uploaded";
  originalName?: string;
  linkedTo?: string;
  role?: "character_reference";
  approved?: boolean;
};

export const CHARACTER_REFERENCE_SCENE_KEY = "__character_reference__";

type VersionContext = {
  story: typeof stories.$inferSelect;
  version: typeof storyVersions.$inferSelect;
};

function getVersionContext(storyId: string, versionId: string): VersionContext {
  ensureDatabase();
  const row = db
    .select({ story: stories, version: storyVersions })
    .from(storyVersions)
    .innerJoin(stories, eq(storyVersions.storyId, stories.id))
    .where(and(eq(storyVersions.id, versionId), eq(stories.id, storyId)))
    .get();
  if (!row)
    throw new ApiError(404, "VERSION_NOT_FOUND", "Version introuvable.");
  return row;
}

function parseMetadata(value: string | null): AssetMetadata {
  if (!value) return {};
  try {
    return JSON.parse(value) as AssetMetadata;
  } catch {
    return {};
  }
}

function derivedAssetMetadata(
  context: VersionContext,
  asset: typeof generatedAssets.$inferSelect,
): AssetMetadata {
  const narrative = loadNarrative(context.version.id);
  const parameters = JSON.parse(
    context.version.parametersJson,
  ) as CreationParameters;
  if (!narrative) return {};
  const visualContext = buildStoryVisualContext(narrative, parameters);
  const existing = parseMetadata(asset.metadataJson);
  if (
    asset.type === "image" &&
    asset.sceneKey === CHARACTER_REFERENCE_SCENE_KEY
  )
    return {
      ...existing,
      label: "Référence des personnages",
      source: existing.source ?? "generated",
      role: "character_reference",
      approved: existing.approved === true,
    };
  if (asset.type === "cover")
    return {
      prompt:
        existing.prompt ??
        coverImagePrompt(narrative, visualContext, parameters.childName),
      label: existing.label ?? "Couverture",
      source: existing.source ?? "generated",
      ...existing,
    };
  if (asset.type === "title_audio")
    return {
      text: existing.text ?? narrative.title,
      voiceId: existing.voiceId ?? parameters.defaultVoiceId,
      label: existing.label ?? "Titre de l’histoire",
      source: existing.source ?? "generated",
      ...existing,
    };
  const choiceId = asset.sceneKey?.startsWith("choice:")
    ? asset.sceneKey.slice("choice:".length)
    : null;
  const choice = choiceId
    ? narrative.choices.find((item) => item.id === choiceId)
    : null;
  const scene = asset.sceneKey
    ? narrative.scenes.find((item) => item.id === asset.sceneKey)
    : null;
  if (asset.type === "image" && choice)
    return {
      ...existing,
      prompt:
        existing.prompt ??
        choiceImagePrompt(
          narrative,
          choice,
          visualContext,
          parameters.childName,
        ),
      label: `Choix : ${choiceDisplayLabel(narrative, choice)}`,
      source: existing.source ?? "generated",
    };
  if (asset.type === "image" && scene)
    return {
      prompt:
        existing.prompt ??
        noTextImagePrompt(
          scene.imagePrompt ?? scene.text,
          visualContext,
          parameters.childName,
        ),
      label: existing.label ?? scene.title,
      source: existing.source ?? "generated",
      ...existing,
    };
  if (asset.type === "audio" && choice)
    return {
      ...existing,
      text: existing.text ?? choice.label,
      voiceId: existing.voiceId ?? parameters.defaultVoiceId,
      label: `Choix : ${choiceDisplayLabel(narrative, choice)}`,
      source: existing.source ?? "generated",
    };
  if (asset.type === "audio" && scene)
    return {
      text: existing.text ?? scene.text,
      voiceId: existing.voiceId ?? scene.voiceId ?? parameters.defaultVoiceId,
      label: existing.label ?? scene.title,
      source: existing.source ?? "generated",
      ...existing,
    };
  return existing;
}

function expectedAssets(context: VersionContext) {
  const narrative = loadNarrative(context.version.id);
  if (!narrative)
    throw new ApiError(409, "NARRATIVE_REQUIRED", "Scénario absent.");
  const parameters = JSON.parse(context.version.parametersJson) as {
    illustrationMode?: "cover" | "choices" | "every-scene";
  };
  const illustrationMode = parameters.illustrationMode ?? "choices";
  return expectedMedia(narrative, illustrationMode);
}

function sameAsset(
  asset: typeof generatedAssets.$inferSelect,
  expected: { type: string; sceneKey: string | null },
) {
  return asset.type === expected.type && asset.sceneKey === expected.sceneKey;
}

function canEditAudioDuringGeneration(versionId: string) {
  return Boolean(
    db
      .select({ id: jobSteps.id })
      .from(generationJobs)
      .innerJoin(jobSteps, eq(jobSteps.jobId, generationJobs.id))
      .where(
        and(
          eq(generationJobs.versionId, versionId),
          eq(generationJobs.status, "running"),
          eq(jobSteps.step, "tts"),
          eq(jobSteps.status, "completed"),
        ),
      )
      .get(),
  );
}

export async function getMediaReview(storyId: string, versionId: string) {
  const context = getVersionContext(storyId, versionId);
  const assets = db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.versionId, versionId))
    .all();
  const expected = expectedAssets(context);
  const reviewable = assets
    .filter((asset) =>
      ["cover", "image", "title_audio", "audio"].includes(asset.type),
    )
    .map((asset) => {
      const metadata = derivedAssetMetadata(context, asset);
      return {
        id: asset.id,
        type: asset.type,
        sceneKey: asset.sceneKey,
        provider: asset.provider,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        label: metadata.label ?? asset.sceneKey ?? asset.type,
        prompt: metadata.prompt,
        text: metadata.text,
        voiceId: metadata.voiceId,
        source: metadata.source ?? "generated",
        role: metadata.role,
        approved: metadata.approved,
        contentUrl: `/api/media-assets/${asset.id}/content?v=${asset.updatedAt.getTime()}`,
      };
    });
  const order = new Map(expected.map((item, index) => [mediaKey(item), index]));
  reviewable.sort(
    (left, right) =>
      (order.get(mediaKey(left)) ?? 9999) -
      (order.get(mediaKey(right)) ?? 9999),
  );
  const complete = expected.every((item) =>
    assets.some((asset) => sameAsset(asset, item)),
  );
  const referenceAsset = assets.find(
    (asset) =>
      asset.type === "image" &&
      asset.sceneKey === CHARACTER_REFERENCE_SCENE_KEY,
  );
  const normallyEditable = (["validated", "ready"] as string[]).includes(
    context.version.status,
  );
  const audioEditable =
    normallyEditable ||
    (context.version.status === "generating" &&
      canEditAudioDuringGeneration(versionId));
  return {
    list: reviewable,
    complete,
    expectedCount: expected.length,
    generatedCount: expected.filter((item) =>
      assets.some((asset) => sameAsset(asset, item)),
    ).length,
    reviewedAt: context.version.mediaReviewedAt,
    readOnly: !normallyEditable,
    imageEditable: normallyEditable,
    audioEditable,
    referenceSupported: await supportsConfiguredImageReferences().catch(
      () => false,
    ),
    referenceApproved:
      parseMetadata(referenceAsset?.metadataJson ?? null).approved === true,
  };
}

function getScopedAsset(storyId: string, versionId: string, assetId: string) {
  const context = getVersionContext(storyId, versionId);
  const asset = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.id, assetId),
        eq(generatedAssets.versionId, versionId),
      ),
    )
    .get();
  if (
    !asset ||
    !["cover", "image", "title_audio", "audio"].includes(asset.type)
  )
    throw new ApiError(404, "ASSET_NOT_FOUND", "Média introuvable.");
  if (context.version.status === "published")
    throw new ApiError(
      409,
      "PUBLISHED_VERSION_IMMUTABLE",
      "Retirez d’abord cette version du store avant de modifier ses médias.",
    );
  const normallyEditable = (["validated", "ready"] as string[]).includes(
    context.version.status,
  );
  const audioDuringGeneration =
    context.version.status === "generating" &&
    ["title_audio", "audio"].includes(asset.type) &&
    canEditAudioDuringGeneration(versionId);
  if (!normallyEditable && !audioDuringGeneration)
    throw new ApiError(
      409,
      "MEDIA_NOT_EDITABLE",
      "Attendez la fin de la génération avant de modifier les médias.",
    );
  return { context, asset };
}

async function invalidateCompiledPack(context: VersionContext) {
  const packs = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.versionId, context.version.id),
        eq(generatedAssets.type, "pack"),
      ),
    )
    .all();
  for (const pack of packs) await fs.rm(pack.path, { force: true });
  db.transaction((tx) => {
    tx.delete(generatedAssets)
      .where(
        and(
          eq(generatedAssets.versionId, context.version.id),
          eq(generatedAssets.type, "pack"),
        ),
      )
      .run();
    tx.update(storyVersions)
      .set({
        status:
          context.version.status === "generating" ? "generating" : "validated",
        mediaReviewedAt: null,
        packPath: null,
        updatedAt: new Date(),
      })
      .where(eq(storyVersions.id, context.version.id))
      .run();
  });
}

async function updateAsset(
  asset: typeof generatedAssets.$inferSelect,
  provider: string,
  metadata: AssetMetadata,
) {
  const stat = await fs.stat(asset.path);
  db.update(generatedAssets)
    .set({
      provider,
      bytes: stat.size,
      metadataJson: JSON.stringify(metadata),
      updatedAt: new Date(),
    })
    .where(eq(generatedAssets.id, asset.id))
    .run();
}

export function getApprovedCharacterReference(versionId: string) {
  const asset = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.versionId, versionId),
        eq(generatedAssets.type, "image"),
        eq(generatedAssets.sceneKey, CHARACTER_REFERENCE_SCENE_KEY),
      ),
    )
    .get();
  if (!asset || parseMetadata(asset.metadataJson).approved !== true)
    return null;
  return asset;
}

function characterReferencePrompt(context: VersionContext) {
  const narrative = loadNarrative(context.version.id);
  if (!narrative)
    throw new ApiError(409, "NARRATIVE_REQUIRED", "Scénario absent.");
  const parameters = JSON.parse(
    context.version.parametersJson,
  ) as CreationParameters;
  const visualContext = buildStoryVisualContext(narrative, parameters);
  return [
    "Planche de référence visuelle des personnages récurrents de cette histoire pour enfant",
    visualContext,
    "Montrer le personnage principal en pied, de face et de trois quarts, avec son apparence complète clairement visible",
    "Ajouter les autres personnages récurrents importants s’ils apparaissent dans l’histoire, bien séparés et entièrement visibles",
    "Fond simple et clair, lumière neutre, palette et proportions définitives qui devront rester identiques dans toutes les scènes",
    "Aucune mise en scène narrative, aucun cadre, aucune légende, aucun mot, aucune lettre, aucun chiffre, aucun symbole typographique",
  ].join(". ");
}

export async function generateCharacterReference(
  storyId: string,
  versionId: string,
  customPrompt?: string,
) {
  const context = getVersionContext(storyId, versionId);
  if (!(await supportsConfiguredImageReferences()))
    throw new ApiError(
      409,
      "REFERENCE_IMAGE_UNSUPPORTED",
      "Le modèle d’image sélectionné ne déclare pas la prise en charge d’une image de référence.",
    );
  if (!(["validated", "ready"] as string[]).includes(context.version.status))
    throw new ApiError(
      409,
      "REFERENCE_IMAGE_NOT_EDITABLE",
      "Validez d’abord le scénario avant de créer la référence des personnages.",
    );
  const prompt = customPrompt?.trim() || characterReferencePrompt(context);
  const filePath = path.join(
    versionDirectory(context.story.id, context.version.version),
    "assets",
    "characters-reference.png",
  );
  await generateImage(prompt, filePath);
  const stat = await fs.stat(filePath);
  const existing = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.versionId, versionId),
        eq(generatedAssets.type, "image"),
        eq(generatedAssets.sceneKey, CHARACTER_REFERENCE_SCENE_KEY),
      ),
    )
    .get();
  const metadata: AssetMetadata = {
    prompt,
    label: "Référence des personnages",
    source: "generated",
    role: "character_reference",
    approved: false,
  };
  if (existing) {
    db.update(generatedAssets)
      .set({
        provider: getProviderConfig("image").provider,
        path: filePath,
        bytes: stat.size,
        metadataJson: JSON.stringify(metadata),
        updatedAt: new Date(),
      })
      .where(eq(generatedAssets.id, existing.id))
      .run();
  } else {
    db.insert(generatedAssets)
      .values({
        id: randomUUID(),
        versionId,
        sceneKey: CHARACTER_REFERENCE_SCENE_KEY,
        type: "image",
        provider: getProviderConfig("image").provider,
        path: filePath,
        mimeType: "image/png",
        bytes: stat.size,
        metadataJson: JSON.stringify(metadata),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }
  recordUsage(
    versionId,
    getProviderConfig("image").provider,
    "character-reference",
    1,
    getProviderConfig("image").provider.toLowerCase() === "codex" ? 0 : 4,
  );
  await invalidateCompiledPack(context);
  return getMediaReview(storyId, versionId);
}

export async function approveCharacterReference(
  storyId: string,
  versionId: string,
) {
  const context = getVersionContext(storyId, versionId);
  const asset = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.versionId, versionId),
        eq(generatedAssets.type, "image"),
        eq(generatedAssets.sceneKey, CHARACTER_REFERENCE_SCENE_KEY),
      ),
    )
    .get();
  if (!asset || !(await validateImage(asset.path)))
    throw new ApiError(
      409,
      "REFERENCE_IMAGE_REQUIRED",
      "Générez ou envoyez d’abord une référence des personnages.",
    );
  await updateAsset(asset, asset.provider ?? "image", {
    ...derivedAssetMetadata(context, asset),
    approved: true,
    role: "character_reference",
  });
  const staleImages = db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.versionId, versionId))
    .all()
    .filter(
      (item) =>
        ["cover", "title_image"].includes(item.type) ||
        (item.type === "image" &&
          item.sceneKey !== CHARACTER_REFERENCE_SCENE_KEY),
    );
  await Promise.all(
    staleImages.map((item) => fs.rm(item.path, { force: true })),
  );
  for (const stale of staleImages)
    db.delete(generatedAssets).where(eq(generatedAssets.id, stale.id)).run();
  return getMediaReview(storyId, versionId);
}

async function syncTitleImage(
  context: VersionContext,
  cover: typeof generatedAssets.$inferSelect,
  metadata: AssetMetadata,
) {
  const title = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.versionId, context.version.id),
        eq(generatedAssets.type, "title_image"),
        sql`${generatedAssets.sceneKey} is null`,
      ),
    )
    .get();
  if (!title) return;
  await fs.copyFile(cover.path, title.path);
  await updateAsset(title, cover.provider ?? "upload", {
    ...metadata,
    label: "Écran titre",
    linkedTo: "cover",
  });
}

export async function regenerateMedia(
  storyId: string,
  versionId: string,
  assetId: string,
  input: { prompt?: string; voiceId?: string },
) {
  const { context, asset } = getScopedAsset(storyId, versionId, assetId);
  const metadata = derivedAssetMetadata(context, asset);
  const temporary = `${asset.path}.replacement-${randomUUID()}`;
  try {
    if (["cover", "image"].includes(asset.type)) {
      const prompt = input.prompt?.trim() || metadata.prompt?.trim();
      if (!prompt)
        throw new ApiError(400, "PROMPT_REQUIRED", "Le prompt est requis.");
      const narrative = loadNarrative(versionId);
      const choiceId = asset.sceneKey?.startsWith("choice:")
        ? asset.sceneKey.slice("choice:".length)
        : null;
      const choice = choiceId
        ? narrative?.choices.find((item) => item.id === choiceId)
        : undefined;
      await generateImage(
        prompt,
        temporary,
        Boolean(
          narrative && choice && isMultipleChoiceImage(narrative, choice),
        ),
        asset.sceneKey === CHARACTER_REFERENCE_SCENE_KEY
          ? undefined
          : getApprovedCharacterReference(versionId)?.path,
      );
      await fs.rename(temporary, asset.path);
      const provider = getProviderConfig("image").provider;
      const nextMetadata = {
        ...metadata,
        prompt,
        source: "generated" as const,
        approved:
          asset.sceneKey === CHARACTER_REFERENCE_SCENE_KEY
            ? false
            : metadata.approved,
      };
      await updateAsset(asset, provider, nextMetadata);
      if (asset.type === "cover")
        await syncTitleImage(context, { ...asset, provider }, nextMetadata);
      recordUsage(
        versionId,
        provider,
        "image-regeneration",
        1,
        provider.toLowerCase() === "codex" ? 0 : 4,
      );
    } else {
      const text = metadata.text?.trim();
      const voiceId = input.voiceId?.trim() || metadata.voiceId?.trim();
      if (!text || !voiceId)
        throw new ApiError(
          400,
          "VOICE_OR_TEXT_REQUIRED",
          "Le texte et la voix sont requis pour régénérer cet audio.",
        );
      await generateSpeech(text, voiceId, temporary);
      await fs.rename(temporary, asset.path);
      const provider = getProviderConfig("tts").provider;
      await updateAsset(asset, provider, {
        ...metadata,
        text,
        voiceId,
        source: "generated",
      });
      recordUsage(
        versionId,
        provider,
        "tts-regeneration",
        text.length,
        provider.toLowerCase() === "piper"
          ? 0
          : Math.max(1, Math.ceil((text.length / 1000) * 30)),
      );
    }
    await invalidateCompiledPack(context);
    return getMediaReview(storyId, versionId);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function uploadMedia(
  storyId: string,
  versionId: string,
  assetId: string,
  file: File,
) {
  const { context, asset } = getScopedAsset(storyId, versionId, assetId);
  const image = ["cover", "image"].includes(asset.type);
  const maxBytes = image ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (file.size <= 0 || file.size > maxBytes)
    throw new ApiError(
      413,
      "MEDIA_TOO_LARGE",
      `Le fichier doit faire moins de ${maxBytes / 1_000_000} Mo.`,
    );
  const metadata = derivedAssetMetadata(context, asset);
  const inputPath = `${asset.path}.upload-${randomUUID()}`;
  const outputPath = `${asset.path}.normalized-${randomUUID()}${image ? ".png" : ".mp3"}`;
  try {
    await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    if (image) {
      await sharp(inputPath)
        .rotate()
        .resize(640, 480, { fit: "cover" })
        .png({ compressionLevel: 9 })
        .toFile(outputPath);
    } else {
      await execFileAsync("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-i",
        inputPath,
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-ar",
        "44100",
        "-b:a",
        "128k",
        outputPath,
      ]);
      if (!(await validateAudio(outputPath)))
        throw new ApiError(
          422,
          "INVALID_AUDIO",
          "Le fichier audio ne peut pas être converti au format Telmi.",
        );
    }
    await fs.rename(outputPath, asset.path);
    const nextMetadata = {
      ...metadata,
      source: "uploaded" as const,
      originalName: file.name.slice(0, 240),
      approved:
        asset.sceneKey === CHARACTER_REFERENCE_SCENE_KEY
          ? false
          : metadata.approved,
    };
    await updateAsset(asset, "upload", nextMetadata);
    if (asset.type === "cover")
      await syncTitleImage(
        context,
        { ...asset, provider: "upload" },
        nextMetadata,
      );
    await invalidateCompiledPack(context);
    return getMediaReview(storyId, versionId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      422,
      image ? "INVALID_IMAGE" : "INVALID_AUDIO",
      image
        ? "L’image envoyée ne peut pas être convertie en PNG 640 × 480."
        : "Le fichier audio envoyé ne peut pas être converti en MP3.",
    );
  } finally {
    await Promise.all([
      fs.rm(inputPath, { force: true }),
      fs.rm(outputPath, { force: true }),
    ]);
  }
}

export async function markMediaReviewed(
  storyId: string,
  versionId: string,
  options: { allowPublished?: boolean } = {},
) {
  const context = getVersionContext(storyId, versionId);
  if (context.version.status === "published" && options.allowPublished !== true)
    throw new ApiError(
      409,
      "PUBLISHED_VERSION_IMMUTABLE",
      "Cette version est déjà publiée.",
    );
  const review = await getMediaReview(storyId, versionId);
  if (!review.complete)
    throw new ApiError(
      409,
      "MEDIA_INCOMPLETE",
      `${review.generatedCount} média(s) sur ${review.expectedCount} sont disponibles.`,
    );
  const assets = db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.versionId, versionId))
    .all();
  if (!assets.some((asset) => asset.type === "title_image"))
    throw new ApiError(
      409,
      "MEDIA_INCOMPLETE",
      "L’image de titre liée à la couverture est absente.",
    );
  for (const asset of assets) {
    if (["cover", "image", "title_image"].includes(asset.type)) {
      if (!(await validateImage(asset.path)))
        throw new ApiError(
          422,
          "INVALID_IMAGE",
          `L’image ${derivedAssetMetadata(context, asset).label ?? asset.id} est invalide.`,
        );
    }
    if (["audio", "title_audio"].includes(asset.type)) {
      if (!(await validateAudio(asset.path)))
        throw new ApiError(
          422,
          "INVALID_AUDIO",
          `L’audio ${derivedAssetMetadata(context, asset).label ?? asset.id} est invalide.`,
        );
    }
  }
  const reviewedAt = new Date();
  db.update(storyVersions)
    .set({ mediaReviewedAt: reviewedAt, updatedAt: reviewedAt })
    .where(eq(storyVersions.id, versionId))
    .run();
  return reviewedAt;
}
