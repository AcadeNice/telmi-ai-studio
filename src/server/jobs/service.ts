import { and, eq, gte, inArray, sql } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  compileTelmiDocuments,
  validateTelmiDocuments,
} from "@/lib/telmi/compiler";
import { validateNarrativeGraph } from "@/lib/narrative/validator";
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
  notifications,
  settings,
  stories,
  storyVersions,
  usageRecords,
} from "@/server/db/schema";
import { ApiError } from "@/server/api/response";
import { generateImage } from "@/server/providers/image";
import { generateSpeech } from "@/server/providers/tts";
import { getProviderConfig } from "@/server/providers/config";
import { loadNarrative } from "@/server/stories/service";
import { writeAppLog } from "@/server/logging/app-log";
import {
  buildTelmiPack,
  validateAudio,
  validateImage,
} from "@/server/telmi/pack";
import { safeFileName, versionDirectory } from "@/server/storage/paths";

export const JOB_STEPS = ["validate", "tts", "images", "compile"] as const;
export const MEDIA_GENERATION_STEPS = ["validate", "tts", "images"] as const;
export type JobStepName = (typeof JOB_STEPS)[number];

function jobContext(jobId: string) {
  const row = db
    .select({ job: generationJobs, version: storyVersions, story: stories })
    .from(generationJobs)
    .innerJoin(storyVersions, eq(generationJobs.versionId, storyVersions.id))
    .innerJoin(stories, eq(storyVersions.storyId, stories.id))
    .where(eq(generationJobs.id, jobId))
    .get();
  if (!row) throw new ApiError(404, "JOB_NOT_FOUND", "Travail introuvable.");
  return row;
}

function monthStart() {
  const value = new Date();
  value.setDate(1);
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatEuros(cents: number) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function getBudgetState(versionId?: string) {
  ensureDatabase();
  const config = db
    .select()
    .from(settings)
    .where(eq(settings.id, "primary"))
    .get();
  if (!config)
    throw new ApiError(
      409,
      "SETUP_REQUIRED",
      "L’installation initiale est requise.",
    );
  const monthly =
    db
      .select({
        total: sql<number>`coalesce(sum(${usageRecords.costCents}), 0)`,
      })
      .from(usageRecords)
      .where(gte(usageRecords.createdAt, monthStart()))
      .get()?.total ?? 0;
  const story = versionId
    ? (db
        .select({
          total: sql<number>`coalesce(sum(${usageRecords.costCents}), 0)`,
        })
        .from(usageRecords)
        .where(eq(usageRecords.versionId, versionId))
        .get()?.total ?? 0)
    : 0;
  return {
    monthlySpentCents: monthly,
    monthlyBudgetCents: config.monthlyBudgetCents,
    storySpentCents: story,
    storyBudgetCents: config.storyBudgetCents,
  };
}

export function recordUsage(
  versionId: string,
  provider: string,
  operation: string,
  units: number,
  costCents: number,
) {
  db.insert(usageRecords)
    .values({
      id: randomUUID(),
      versionId,
      provider,
      operation,
      units,
      costCents,
      createdAt: new Date(),
    })
    .run();
  const total =
    db
      .select({
        total: sql<number>`coalesce(sum(${usageRecords.costCents}), 0)`,
      })
      .from(usageRecords)
      .where(eq(usageRecords.versionId, versionId))
      .get()?.total ?? 0;
  db.update(storyVersions)
    .set({ actualCostCents: total, updatedAt: new Date() })
    .where(eq(storyVersions.id, versionId))
    .run();
  const budget = getBudgetState(versionId);
  if (
    budget.monthlyBudgetCents > 0 &&
    budget.monthlySpentCents >= budget.monthlyBudgetCents * 0.8 &&
    budget.monthlySpentCents - costCents < budget.monthlyBudgetCents * 0.8
  ) {
    db.insert(notifications)
      .values({
        id: randomUUID(),
        level: "warning",
        title: "Budget mensuel",
        message: "80 % du budget mensuel a été consommé.",
        createdAt: new Date(),
      })
      .run();
  }
}

export function createGenerationJob(versionId: string, overrideBudget = false) {
  ensureDatabase();
  const version = db
    .select()
    .from(storyVersions)
    .where(eq(storyVersions.id, versionId))
    .get();
  if (!version)
    throw new ApiError(404, "VERSION_NOT_FOUND", "Version introuvable.");
  if (version.status !== "validated" && version.status !== "ready")
    throw new ApiError(
      409,
      "PARENT_VALIDATION_REQUIRED",
      "Le scénario doit être validé par le parent avant les médias.",
    );
  const narrative = loadNarrative(versionId);
  if (!narrative)
    throw new ApiError(
      409,
      "NARRATIVE_REQUIRED",
      "Aucun scénario n’est enregistré.",
    );
  const validation = validateNarrativeGraph(narrative);
  if (!validation.valid)
    throw new ApiError(
      422,
      "INVALID_GRAPH",
      "Le graphe narratif comporte des erreurs bloquantes.",
      { graph: validation.issues.map((item) => item.message) },
    );
  const budget = getBudgetState(versionId);
  const activeReserved =
    db
      .select({
        total: sql<number>`coalesce(sum(${storyVersions.estimatedCostCents}), 0)`,
      })
      .from(generationJobs)
      .innerJoin(storyVersions, eq(generationJobs.versionId, storyVersions.id))
      .where(inArray(generationJobs.status, ["queued", "running"]))
      .get()?.total ?? 0;
  const estimate = version.estimatedCostCents;
  const projectedMonthly = budget.monthlySpentCents + activeReserved + estimate;
  const projectedStory = budget.storySpentCents + estimate;
  const monthlyExceeded =
    budget.monthlyBudgetCents > 0 &&
    projectedMonthly > budget.monthlyBudgetCents;
  const storyExceeded =
    budget.storyBudgetCents > 0 && projectedStory > budget.storyBudgetCents;
  if (!overrideBudget && (monthlyExceeded || storyExceeded)) {
    const details = [
      `Estimation de la génération : ${formatEuros(estimate)}.`,
      ...(storyExceeded
        ? [
            `Total projeté pour cette histoire : ${formatEuros(projectedStory)} sur un plafond de ${formatEuros(budget.storyBudgetCents)}.`,
          ]
        : []),
      ...(monthlyExceeded
        ? [
            `Total mensuel projeté : ${formatEuros(projectedMonthly)} sur un budget de ${formatEuros(budget.monthlyBudgetCents)}.`,
          ]
        : []),
    ];
    throw new ApiError(
      409,
      "BUDGET_EXCEEDED",
      "Le budget configuré est atteint. Une confirmation explicite est nécessaire.",
      { budget: details },
    );
  }
  const id = randomUUID();
  const now = new Date();
  const stalePacks = db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.versionId, versionId),
        eq(generatedAssets.type, "pack"),
      ),
    )
    .all();
  for (const pack of stalePacks) void fs.rm(pack.path, { force: true });
  db.transaction((tx) => {
    tx.insert(generationJobs)
      .values({
        id,
        versionId,
        status: "queued",
        progress: 0,
        overrideBudget,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const step of MEDIA_GENERATION_STEPS)
      tx.insert(jobSteps)
        .values({
          id: randomUUID(),
          jobId: id,
          step,
          assetId: "all",
          idempotencyKey: `${id}:${step}:all`,
          status: "pending",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    tx.delete(generatedAssets)
      .where(
        and(
          eq(generatedAssets.versionId, versionId),
          eq(generatedAssets.type, "pack"),
        ),
      )
      .run();
    tx.update(storyVersions)
      .set({
        status: "generating",
        mediaReviewedAt: null,
        packPath: null,
        updatedAt: now,
      })
      .where(eq(storyVersions.id, versionId))
      .run();
  });
  return getGenerationJob(id);
}

export function createCompileJob(
  versionId: string,
  options: { allowPublished?: boolean } = {},
) {
  ensureDatabase();
  const version = db
    .select()
    .from(storyVersions)
    .where(eq(storyVersions.id, versionId))
    .get();
  if (!version)
    throw new ApiError(404, "VERSION_NOT_FOUND", "Version introuvable.");
  if (!version.mediaReviewedAt)
    throw new ApiError(
      409,
      "MEDIA_REVIEW_REQUIRED",
      "Vérifiez les images et les narrations avant de créer le ZIP.",
    );
  const retainPublishedStatus =
    version.status === "published" && options.allowPublished === true;
  if (
    !(
      retainPublishedStatus ||
      (["validated", "ready"] as string[]).includes(version.status)
    )
  )
    throw new ApiError(
      409,
      "MEDIA_NOT_READY",
      "Les médias ne sont pas prêts à être compilés.",
    );
  const id = randomUUID();
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(generationJobs)
      .values({
        id,
        versionId,
        status: "queued",
        progress: 0,
        overrideBudget: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const step of ["validate", "compile"] as const)
      tx.insert(jobSteps)
        .values({
          id: randomUUID(),
          jobId: id,
          step,
          assetId: "all",
          idempotencyKey: `${id}:${step}:all`,
          status: "pending",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    tx.update(storyVersions)
      .set({
        status: retainPublishedStatus ? "published" : "generating",
        updatedAt: now,
      })
      .where(eq(storyVersions.id, versionId))
      .run();
  });
  return getGenerationJob(id);
}

export function getGenerationJob(id: string) {
  const job = db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .get();
  if (!job) return null;
  return {
    ...job,
    steps: db.select().from(jobSteps).where(eq(jobSteps.jobId, id)).all(),
  };
}

function recordAsset(
  versionId: string,
  sceneKey: string | null,
  type: typeof generatedAssets.$inferInsert.type,
  provider: string | null,
  filePath: string,
  mimeType: string,
  metadata?: Record<string, unknown>,
) {
  const statPromise = fs.stat(filePath);
  return statPromise.then((stat) => {
    db.transaction((tx) => {
      tx.delete(generatedAssets)
        .where(
          and(
            eq(generatedAssets.versionId, versionId),
            eq(generatedAssets.type, type),
            sceneKey === null
              ? sql`${generatedAssets.sceneKey} is null`
              : eq(generatedAssets.sceneKey, sceneKey),
          ),
        )
        .run();
      tx.insert(generatedAssets)
        .values({
          id: randomUUID(),
          versionId,
          sceneKey,
          type,
          provider,
          path: filePath,
          mimeType,
          bytes: stat.size,
          metadataJson: metadata ? JSON.stringify(metadata) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
    });
  });
}

async function runValidate(jobId: string) {
  const { version } = jobContext(jobId);
  const narrative = loadNarrative(version.id);
  if (!narrative) throw new Error("Scénario absent.");
  const result = validateNarrativeGraph(narrative);
  if (!result.valid)
    throw new Error(
      result.issues
        .filter((item) => item.severity === "error")
        .map((item) => item.message)
        .join(" "),
    );
  return result;
}

async function runTts(jobId: string) {
  const { story, version } = jobContext(jobId);
  const narrative = loadNarrative(version.id)!;
  const parameters = JSON.parse(version.parametersJson) as {
    defaultVoiceId?: string;
  };
  if (!parameters.defaultVoiceId)
    throw new Error("Aucune voix de narration n’est sélectionnée.");
  const ttsProvider = getProviderConfig("tts").provider;
  const base = path.join(versionDirectory(story.id, version.version), "assets");
  const audioDir = path.join(base, "audios");
  const work: Array<Promise<unknown>> = [];
  let characters = narrative.title.length;
  await generateSpeech(
    narrative.title,
    parameters.defaultVoiceId,
    path.join(base, "title.mp3"),
  );
  await recordAsset(
    version.id,
    null,
    "title_audio",
    ttsProvider,
    path.join(base, "title.mp3"),
    "audio/mpeg",
    {
      text: narrative.title,
      voiceId: parameters.defaultVoiceId,
      label: "Titre de l’histoire",
      source: "generated",
    },
  );
  for (const [index, scene] of narrative.scenes.entries()) {
    characters += scene.text.length;
    const file = path.join(audioDir, `s${index + 1}.mp3`);
    await generateSpeech(
      scene.text,
      scene.voiceId ?? parameters.defaultVoiceId,
      file,
    );
    work.push(
      recordAsset(
        version.id,
        scene.id,
        "audio",
        ttsProvider,
        file,
        "audio/mpeg",
        {
          text: scene.text,
          voiceId: scene.voiceId ?? parameters.defaultVoiceId,
          label: scene.title,
          source: "generated",
        },
      ),
    );
  }
  for (const choice of narrative.choices) {
    characters += choice.label.length;
    const file = path.join(audioDir, `choice_${safeFileName(choice.id)}.mp3`);
    await generateSpeech(choice.label, parameters.defaultVoiceId, file);
    work.push(
      recordAsset(
        version.id,
        `choice:${choice.id}`,
        "audio",
        ttsProvider,
        file,
        "audio/mpeg",
        {
          text: choice.label,
          voiceId: parameters.defaultVoiceId,
          label: `Choix : ${choiceDisplayLabel(narrative, choice)}`,
          source: "generated",
        },
      ),
    );
  }
  await Promise.all(work);
  recordUsage(
    version.id,
    ttsProvider,
    "tts",
    characters,
    ttsProvider.toLowerCase() === "piper"
      ? 0
      : Math.max(1, Math.ceil((characters / 1000) * 30)),
  );
  return { generated: narrative.scenes.length + narrative.choices.length + 1 };
}

async function runImages(jobId: string) {
  const { story, version } = jobContext(jobId);
  const narrative = loadNarrative(version.id)!;
  const parameters = JSON.parse(version.parametersJson) as CreationParameters;
  const imageProvider = getProviderConfig("image").provider;
  const illustrationMode = parameters.illustrationMode ?? "choices";
  const visualContext = buildStoryVisualContext(narrative, parameters);
  const base = path.join(versionDirectory(story.id, version.version), "assets");
  const imageDir = path.join(base, "images");
  const coverPath = path.join(base, "cover.png");
  const coverPrompt = coverImagePrompt(
    narrative,
    visualContext,
    parameters.childName,
  );
  await generateImage(coverPrompt, coverPath);
  await fs.copyFile(coverPath, path.join(base, "title.png"));
  await recordAsset(
    version.id,
    null,
    "cover",
    imageProvider,
    coverPath,
    "image/png",
    {
      prompt: coverPrompt,
      label: "Couverture",
      source: "generated",
    },
  );
  await recordAsset(
    version.id,
    null,
    "title_image",
    imageProvider,
    path.join(base, "title.png"),
    "image/png",
    {
      prompt: coverPrompt,
      label: "Écran titre",
      source: "generated",
      linkedTo: "cover",
    },
  );
  for (const [index, scene] of narrative.scenes.entries()) {
    if (illustrationMode !== "every-scene") continue;
    if (!scene.imagePrompt) continue;
    const file = path.join(imageDir, `s${index + 1}.png`);
    const prompt = noTextImagePrompt(
      scene.imagePrompt,
      visualContext,
      parameters.childName,
    );
    await generateImage(prompt, file, coverPath);
    await recordAsset(
      version.id,
      scene.id,
      "image",
      imageProvider,
      file,
      "image/png",
      {
        prompt,
        label: scene.title,
        source: "generated",
      },
    );
  }
  for (const choice of narrative.choices) {
    if (illustrationMode === "cover") break;
    const file = path.join(imageDir, `choice_${safeFileName(choice.id)}.png`);
    const prompt = choiceImagePrompt(
      narrative,
      choice,
      visualContext,
      parameters.childName,
    );
    await generateImage(
      prompt,
      file,
      coverPath,
      isMultipleChoiceImage(narrative, choice),
    );
    await recordAsset(
      version.id,
      `choice:${choice.id}`,
      "image",
      imageProvider,
      file,
      "image/png",
      {
        prompt,
        label: `Choix : ${choiceDisplayLabel(narrative, choice)}`,
        source: "generated",
      },
    );
  }
  const generated =
    (illustrationMode === "every-scene"
      ? narrative.scenes.filter((item) => item.imagePrompt).length
      : 0) +
    (illustrationMode === "cover" ? 0 : narrative.choices.length) +
    2;
  recordUsage(
    version.id,
    imageProvider,
    "images",
    generated,
    imageProvider.toLowerCase() === "codex" ? 0 : generated * 4,
  );
  return { generated };
}

async function runCompile(jobId: string) {
  const { story, version } = jobContext(jobId);
  const retainPublishedStatus = version.status === "published";
  if (!version.mediaReviewedAt)
    throw new ApiError(
      409,
      "MEDIA_REVIEW_REQUIRED",
      "Vérifiez les images et les narrations avant de créer le ZIP.",
    );
  const narrative = loadNarrative(version.id)!;
  const parameters = JSON.parse(version.parametersJson) as {
    illustrationMode?: "cover" | "choices" | "every-scene";
    author?: string;
    defaultVoiceName?: string;
  };
  const illustrationMode = parameters.illustrationMode ?? "choices";
  const config = db
    .select()
    .from(settings)
    .where(eq(settings.id, "primary"))
    .get();
  const credits = {
    author: parameters.author ?? config?.instanceName ?? "Telmi AI Studio",
    voice: parameters.defaultVoiceName,
    publisher: config?.instanceName ?? "Telmi AI Studio",
  };
  const documents = compileTelmiDocuments(
    narrative,
    story.uuid,
    version.version,
    illustrationMode,
    credits,
  );
  const validation = validateTelmiDocuments(documents.nodes);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const base = versionDirectory(story.id, version.version);
  const assetDir = path.join(base, "assets");
  await fs.mkdir(assetDir, { recursive: true });
  const imageDir = path.join(assetDir, "images");
  await fs.mkdir(imageDir, { recursive: true });
  await fs.copyFile(
    path.join(assetDir, "cover.png"),
    path.join(imageDir, "story_cover.png"),
  );
  const requiredImages = new Set<string>(["title.png", "cover.png"]);
  const requiredAudios = new Set<string>(["title.mp3"]);
  for (const stage of Object.values(documents.nodes.stages)) {
    if (stage.image) requiredImages.add(stage.image);
    if (stage.audio) requiredAudios.add(stage.audio);
  }
  for (const file of requiredImages) {
    const target =
      file === "title.png" || file === "cover.png"
        ? path.join(assetDir, file)
        : path.join(assetDir, "images", file);
    if (!(await validateImage(target)))
      throw new Error(`Image Telmi absente ou invalide : ${file}`);
  }
  for (const file of requiredAudios) {
    const target =
      file === "title.mp3"
        ? path.join(assetDir, file)
        : path.join(assetDir, "audios", file);
    if (!(await validateAudio(target)))
      throw new Error(`Audio Telmi absent ou invalide : ${file}`);
  }
  const packPath = path.join(
    base,
    `${safeFileName(story.title)}-v${version.version}.zip`,
  );
  const temporaryPackPath = path.join(
    base,
    `.${safeFileName(story.title)}-${randomUUID()}.tmp.zip`,
  );
  try {
    await buildTelmiPack({
      story: narrative,
      uuid: story.uuid,
      version: version.version,
      assetDirectory: assetDir,
      outputPath: temporaryPackPath,
      illustrationMode,
      ...credits,
    });
    await fs.rename(temporaryPackPath, packPath);
  } finally {
    await fs.rm(temporaryPackPath, { force: true });
  }
  await recordAsset(
    version.id,
    null,
    "pack",
    "telmi-ai-studio",
    packPath,
    "application/zip",
  );
  db.update(storyVersions)
    .set({
      status: retainPublishedStatus ? "published" : "ready",
      packPath,
      coverPath: path.join(assetDir, "cover.png"),
      updatedAt: new Date(),
    })
    .where(eq(storyVersions.id, version.id))
    .run();
  return { packPath };
}

export async function runJobStep(jobId: string, step: JobStepName) {
  const record = db
    .select()
    .from(jobSteps)
    .where(
      and(
        eq(jobSteps.jobId, jobId),
        eq(jobSteps.step, step),
        eq(jobSteps.assetId, "all"),
      ),
    )
    .get();
  if (!record) throw new ApiError(404, "STEP_NOT_FOUND", "Étape introuvable.");
  if (record.status === "completed")
    return JSON.parse(record.resultJson ?? "{}");
  const configuredSteps = JOB_STEPS.filter((name) =>
    db
      .select({ id: jobSteps.id })
      .from(jobSteps)
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.step, name)))
      .get(),
  );
  const stepIndex = configuredSteps.indexOf(step);
  const claimed = db
    .update(jobSteps)
    .set({
      status: "running",
      attempts: record.attempts + 1,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobSteps.id, record.id),
        inArray(jobSteps.status, ["pending", "failed"]),
      ),
    )
    .run();
  if (claimed.changes !== 1) {
    const current = db
      .select()
      .from(jobSteps)
      .where(eq(jobSteps.id, record.id))
      .get();
    if (current?.status === "completed")
      return JSON.parse(current.resultJson ?? "{}");
    throw new ApiError(
      409,
      "STEP_IN_PROGRESS",
      "Cette étape est déjà en cours d’exécution.",
    );
  }
  db.update(generationJobs)
    .set({
      status: "running",
      currentStep: step,
      progress: Math.round((stepIndex / configuredSteps.length) * 100),
      updatedAt: new Date(),
    })
    .where(eq(generationJobs.id, jobId))
    .run();
  try {
    const context = jobContext(jobId);
    if (!context.job.overrideBudget && ["tts", "images"].includes(step)) {
      const budget = getBudgetState(context.version.id);
      if (
        (budget.monthlyBudgetCents > 0 &&
          budget.monthlySpentCents >= budget.monthlyBudgetCents) ||
        (budget.storyBudgetCents > 0 &&
          budget.storySpentCents >= budget.storyBudgetCents)
      )
        throw new ApiError(
          409,
          "BUDGET_EXCEEDED",
          "Le budget a été atteint avant l’appel fournisseur.",
        );
    }
    const result =
      step === "validate"
        ? await runValidate(jobId)
        : step === "tts"
          ? await runTts(jobId)
          : step === "images"
            ? await runImages(jobId)
            : await runCompile(jobId);
    db.update(jobSteps)
      .set({
        status: "completed",
        resultJson: JSON.stringify(result),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(jobSteps.id, record.id))
      .run();
    const progress = Math.round(
      ((stepIndex + 1) / configuredSteps.length) * 100,
    );
    db.update(generationJobs)
      .set({
        status: progress === 100 ? "completed" : "running",
        currentStep: step,
        progress,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, jobId))
      .run();
    if (progress === 100 && step !== "compile")
      db.update(storyVersions)
        .set({
          status: "validated",
          mediaReviewedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(storyVersions.id, context.version.id))
        .run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    db.update(jobSteps)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(jobSteps.id, record.id))
      .run();
    db.update(generationJobs)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(generationJobs.id, jobId))
      .run();
    const failedJob = db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .get();
    if (failedJob) {
      const failedVersion = db
        .select()
        .from(storyVersions)
        .where(eq(storyVersions.id, failedJob.versionId))
        .get();
      db.update(storyVersions)
        .set({
          status:
            failedVersion?.status === "published" ? "published" : "failed",
          updatedAt: new Date(),
        })
        .where(eq(storyVersions.id, failedJob.versionId))
        .run();
    }
    throw error;
  }
}

const scheduledJobs = new Set<string>();
let internalQueue: Promise<void> = Promise.resolve();

async function runInternalPipeline(jobId: string, startStep?: JobStepName) {
  const job = getGenerationJob(jobId);
  if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "Travail introuvable.");
  const configuredSteps = JOB_STEPS.filter((step) =>
    job.steps.some((record) => record.step === step),
  );
  const firstIncomplete = configuredSteps.findIndex(
    (step) =>
      job.steps.find((record) => record.step === step)?.status !== "completed",
  );
  const start = startStep
    ? configuredSteps.indexOf(startStep)
    : firstIncomplete < 0
      ? configuredSteps.length
      : firstIncomplete;
  if (start < 0)
    throw new ApiError(404, "STEP_NOT_FOUND", "Étape absente de ce travail.");
  for (const step of configuredSteps.slice(start))
    await runJobStep(jobId, step);
}

export function scheduleInternalPipeline(
  jobId: string,
  startStep?: JobStepName,
) {
  if (scheduledJobs.has(jobId))
    return { mode: "internal" as const, queued: false };

  const job = db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .get();
  if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "Travail introuvable.");
  const now = new Date();
  db.transaction((tx) => {
    tx.update(generationJobs)
      .set({ status: "queued", error: null, updatedAt: now })
      .where(eq(generationJobs.id, jobId))
      .run();
    tx.update(storyVersions)
      .set({ status: "generating", updatedAt: now })
      .where(eq(storyVersions.id, job.versionId))
      .run();
  });

  scheduledJobs.add(jobId);
  const task = internalQueue
    .then(() => runInternalPipeline(jobId, startStep))
    .catch(async (error) => {
      try {
        await writeAppLog("error", "Échec du pipeline de génération interne", {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // The queue must remain usable even if the log volume is unavailable.
      }
    })
    .finally(() => {
      scheduledJobs.delete(jobId);
    });
  internalQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return { mode: "internal" as const, queued: true };
}

export function recoverInterruptedJobs() {
  ensureDatabase();
  const interrupted = db
    .select()
    .from(generationJobs)
    .where(inArray(generationJobs.status, ["queued", "running"]))
    .all();
  for (const job of interrupted) {
    db.update(jobSteps)
      .set({
        status: "failed",
        error: "Reprise après redémarrage",
        updatedAt: new Date(),
      })
      .where(and(eq(jobSteps.jobId, job.id), eq(jobSteps.status, "running")))
      .run();
    scheduleInternalPipeline(job.id);
  }
}
