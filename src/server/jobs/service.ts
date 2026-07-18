import { and, eq, gte, inArray, sql } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  compileTelmiDocuments,
  validateTelmiDocuments,
} from "@/lib/telmi/compiler";
import { validateNarrativeGraph } from "@/lib/narrative/validator";
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
import { generateSpeech } from "@/server/providers/elevenlabs";
import { loadNarrative } from "@/server/stories/service";
import {
  buildTelmiPack,
  validateAudio,
  validateImage,
} from "@/server/telmi/pack";
import { safeFileName, versionDirectory } from "@/server/storage/paths";
import { signN8nRequest } from "@/server/security/hmac";

export const JOB_STEPS = ["validate", "tts", "images", "compile"] as const;
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

function recordUsage(
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
    for (const step of JOB_STEPS)
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
      .set({ status: "generating", updatedAt: now })
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

export function failGenerationDispatch(jobId: string, message: string) {
  const job = db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .get();
  if (!job) return;
  const now = new Date();
  db.transaction((tx) => {
    tx.update(generationJobs)
      .set({ status: "failed", error: message, updatedAt: now })
      .where(eq(generationJobs.id, jobId))
      .run();
    tx.update(storyVersions)
      .set({ status: "validated", updatedAt: now })
      .where(eq(storyVersions.id, job.versionId))
      .run();
  });
}

function recordAsset(
  versionId: string,
  sceneKey: string | null,
  type: typeof generatedAssets.$inferInsert.type,
  provider: string | null,
  filePath: string,
  mimeType: string,
) {
  const statPromise = fs.stat(filePath);
  return statPromise.then((stat) => {
    db.delete(generatedAssets)
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
    db.insert(generatedAssets)
      .values({
        id: randomUUID(),
        versionId,
        sceneKey,
        type,
        provider,
        path: filePath,
        mimeType,
        bytes: stat.size,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
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
    throw new Error("Aucune voix ElevenLabs n’est sélectionnée.");
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
    "elevenlabs",
    path.join(base, "title.mp3"),
    "audio/mpeg",
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
        "elevenlabs",
        file,
        "audio/mpeg",
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
        "elevenlabs",
        file,
        "audio/mpeg",
      ),
    );
  }
  await Promise.all(work);
  recordUsage(
    version.id,
    "elevenlabs",
    "tts",
    characters,
    Math.max(1, Math.ceil((characters / 1000) * 30)),
  );
  return { generated: narrative.scenes.length + narrative.choices.length + 1 };
}

async function runImages(jobId: string) {
  const { story, version } = jobContext(jobId);
  const narrative = loadNarrative(version.id)!;
  const parameters = JSON.parse(version.parametersJson) as {
    illustrationMode?: "cover" | "choices" | "every-scene";
  };
  const illustrationMode = parameters.illustrationMode ?? "choices";
  const base = path.join(versionDirectory(story.id, version.version), "assets");
  const imageDir = path.join(base, "images");
  const coverPrompt = `Illustration jeunesse douce, sans texte, couverture pour ${narrative.title}. ${narrative.description}`;
  await generateImage(coverPrompt, path.join(base, "cover.png"));
  await fs.copyFile(path.join(base, "cover.png"), path.join(base, "title.png"));
  await recordAsset(
    version.id,
    null,
    "cover",
    "openai",
    path.join(base, "cover.png"),
    "image/png",
  );
  await recordAsset(
    version.id,
    null,
    "title_image",
    "openai",
    path.join(base, "title.png"),
    "image/png",
  );
  for (const [index, scene] of narrative.scenes.entries()) {
    if (illustrationMode !== "every-scene") continue;
    if (!scene.imagePrompt) continue;
    const file = path.join(imageDir, `s${index + 1}.png`);
    await generateImage(scene.imagePrompt, file);
    await recordAsset(
      version.id,
      scene.id,
      "image",
      "openai",
      file,
      "image/png",
    );
  }
  for (const choice of narrative.choices) {
    if (illustrationMode === "cover") break;
    const file = path.join(imageDir, `choice_${safeFileName(choice.id)}.png`);
    await generateImage(
      `Illustration jeunesse simple représentant ce choix : ${choice.label}. Sans texte.`,
      file,
    );
    await recordAsset(
      version.id,
      `choice:${choice.id}`,
      "image",
      "openai",
      file,
      "image/png",
    );
  }
  const generated =
    (illustrationMode === "every-scene"
      ? narrative.scenes.filter((item) => item.imagePrompt).length
      : 0) +
    (illustrationMode === "cover" ? 0 : narrative.choices.length) +
    2;
  recordUsage(version.id, "openai", "images", generated, generated * 4);
  return { generated };
}

async function runCompile(jobId: string) {
  const { story, version } = jobContext(jobId);
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
  await buildTelmiPack({
    story: narrative,
    uuid: story.uuid,
    version: version.version,
    assetDirectory: assetDir,
    outputPath: packPath,
    illustrationMode,
    ...credits,
  });
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
      status: "ready",
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
  const stepIndex = JOB_STEPS.indexOf(step);
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
      progress: Math.round((stepIndex / JOB_STEPS.length) * 100),
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
    const progress = Math.round(((stepIndex + 1) / JOB_STEPS.length) * 100);
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
    if (failedJob)
      db.update(storyVersions)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(storyVersions.id, failedJob.versionId))
        .run();
    throw error;
  }
}

export async function runLocalPipeline(jobId: string) {
  for (const step of JOB_STEPS) await runJobStep(jobId, step);
}

export function recoverInterruptedJobs() {
  ensureDatabase();
  const usesN8n = Boolean(
    db.select().from(settings).where(eq(settings.id, "primary")).get()
      ?.n8nWebhookUrl,
  );
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
    void (
      usesN8n ? dispatchGenerationJob(job.id) : runLocalPipeline(job.id)
    ).catch(() => undefined);
  }
}

export async function dispatchGenerationJob(jobId: string) {
  const config = db
    .select()
    .from(settings)
    .where(eq(settings.id, "primary"))
    .get();
  if (!config?.n8nWebhookUrl) {
    void runLocalPipeline(jobId).catch(() => undefined);
    return { mode: "local" as const };
  }
  const body = JSON.stringify({ jobId, callbackBaseUrl: config.publicUrl });
  const timestamp = String(Date.now());
  const signed = signN8nRequest(body, timestamp);
  const response = await fetch(config.n8nWebhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telmi-timestamp": signed.timestamp,
      "x-telmi-nonce": signed.nonce,
      "x-telmi-signature": signed.signature,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`n8n webhook: HTTP ${response.status}`);
  return { mode: "n8n" as const };
}
