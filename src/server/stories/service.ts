import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, ensureDatabase } from "@/server/db";
import {
  choices,
  generatedAssets,
  generationJobs,
  scenes,
  stories,
  storyVersions,
} from "@/server/db/schema";
import type {
  CreationParameters,
  NarrativeStory,
} from "@/lib/narrative/schema";

export function listStories(includeDeleted = false) {
  ensureDatabase();
  const list = db
    .select()
    .from(stories)
    .where(includeDeleted ? undefined : isNull(stories.deletedAt))
    .orderBy(desc(stories.updatedAt))
    .all();
  return list.map((story) => getStory(story.id)!);
}

export function createStory(input: {
  title: string;
  description: string;
  age: number;
  parameters: CreationParameters;
}) {
  ensureDatabase();
  const storyId = randomUUID();
  const versionId = randomUUID();
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(stories)
      .values({
        id: storyId,
        uuid: `ffffff-${randomUUID().replaceAll("-", "").slice(0, 13)}`,
        title: input.title,
        description: input.description,
        age: input.age,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const estimatedCostCents = estimateStoryCost(input.parameters);
    tx.insert(storyVersions)
      .values({
        id: versionId,
        storyId,
        version: 1,
        status: "draft",
        parametersJson: JSON.stringify(input.parameters),
        estimatedCostCents,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.update(stories)
      .set({ activeVersionId: versionId })
      .where(eq(stories.id, storyId))
      .run();
  });
  return getStory(storyId);
}

function estimateStoryCost(parameters: CreationParameters) {
  return (
    5 +
    parameters.decisionCount * parameters.choicesPerDecision * 5 +
    parameters.targetDurationMinutes * 2
  );
}

export function updateDraftCreation(
  storyId: string,
  versionId: string,
  input: {
    title: string;
    description: string;
    parameters: CreationParameters;
  },
) {
  ensureDatabase();
  const version = db
    .select()
    .from(storyVersions)
    .where(
      and(eq(storyVersions.id, versionId), eq(storyVersions.storyId, storyId)),
    )
    .get();
  if (!version) return null;
  if (version.status !== "draft") return "immutable" as const;

  const now = new Date();
  db.transaction((tx) => {
    tx.update(stories)
      .set({
        title: input.title,
        description: input.description,
        age: input.parameters.age,
        updatedAt: now,
      })
      .where(eq(stories.id, storyId))
      .run();
    tx.update(storyVersions)
      .set({
        parametersJson: JSON.stringify(input.parameters),
        estimatedCostCents: estimateStoryCost(input.parameters),
        updatedAt: now,
      })
      .where(eq(storyVersions.id, versionId))
      .run();
  });

  return getStory(storyId);
}

export function getStory(id: string) {
  const story = db.select().from(stories).where(eq(stories.id, id)).get();
  if (!story) return null;
  const versions = db
    .select()
    .from(storyVersions)
    .where(eq(storyVersions.storyId, id))
    .orderBy(desc(storyVersions.version))
    .all();
  const assets = versions[0]
    ? db
        .select()
        .from(generatedAssets)
        .where(eq(generatedAssets.versionId, versions[0].id))
        .all()
    : [];
  const latestJob = versions[0]
    ? db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.versionId, versions[0].id))
        .orderBy(desc(generationJobs.createdAt))
        .get()
    : null;
  const cover = db
    .select({
      id: generatedAssets.id,
      updatedAt: generatedAssets.updatedAt,
    })
    .from(generatedAssets)
    .innerJoin(storyVersions, eq(generatedAssets.versionId, storyVersions.id))
    .where(
      and(eq(storyVersions.storyId, id), eq(generatedAssets.type, "cover")),
    )
    .orderBy(desc(storyVersions.version), desc(generatedAssets.updatedAt))
    .get();
  return {
    ...story,
    versions,
    assets,
    latestJob,
    coverUrl: cover
      ? `/api/media-assets/${cover.id}/content?v=${cover.updatedAt.getTime()}`
      : null,
  };
}

export function createVersion(storyId: string, parametersJson?: string) {
  const story = getStory(storyId);
  if (!story) return null;
  const latest =
    db
      .select({ value: max(storyVersions.version) })
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .get()?.value ?? 0;
  const source = story.versions[0];
  const id = randomUUID();
  db.insert(storyVersions)
    .values({
      id,
      storyId,
      version: latest + 1,
      status: "draft",
      parametersJson: parametersJson ?? source?.parametersJson ?? "{}",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  db.update(stories)
    .set({ activeVersionId: id, updatedAt: new Date() })
    .where(eq(stories.id, storyId))
    .run();
  if (source) {
    const narrative = loadNarrative(source.id);
    if (narrative) saveNarrative(id, narrative);
  }
  return db.select().from(storyVersions).where(eq(storyVersions.id, id)).get();
}

export function saveNarrative(
  versionId: string,
  narrative: NarrativeStory,
  rawResponse?: unknown,
) {
  const now = new Date();
  db.transaction((tx) => {
    tx.delete(choices).where(eq(choices.versionId, versionId)).run();
    tx.delete(scenes).where(eq(scenes.versionId, versionId)).run();
    for (const [order, scene] of narrative.scenes.entries())
      tx.insert(scenes)
        .values({
          id: randomUUID(),
          versionId,
          key: scene.id,
          type: scene.type,
          title: scene.title,
          text: scene.text,
          imagePrompt: scene.imagePrompt,
          voiceId: scene.voiceId,
          positionX: scene.position?.x ?? order * 220,
          positionY: scene.position?.y ?? 100,
          order,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    for (const choice of narrative.choices)
      tx.insert(choices)
        .values({
          id: randomUUID(),
          versionId,
          key: choice.id,
          sourceSceneKey: choice.sourceSceneId,
          label: choice.label,
          targetSceneKey: choice.targetSceneId,
          order: choice.order,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    tx.update(storyVersions)
      .set({
        startSceneKey: narrative.startSceneId,
        rawResponseJson: rawResponse ? JSON.stringify(rawResponse) : undefined,
        updatedAt: now,
      })
      .where(eq(storyVersions.id, versionId))
      .run();
  });
}

export function loadNarrative(versionId: string): NarrativeStory | null {
  const version = db
    .select()
    .from(storyVersions)
    .where(eq(storyVersions.id, versionId))
    .get();
  if (!version) return null;
  const story = db
    .select()
    .from(stories)
    .where(eq(stories.id, version.storyId))
    .get();
  const sceneRows = db
    .select()
    .from(scenes)
    .where(eq(scenes.versionId, versionId))
    .orderBy(asc(scenes.order))
    .all();
  const choiceRows = db
    .select()
    .from(choices)
    .where(eq(choices.versionId, versionId))
    .orderBy(asc(choices.order))
    .all();
  if (!story || sceneRows.length === 0) return null;
  return {
    schemaVersion: "1.0",
    title: story.title,
    description: story.description,
    age: story.age,
    targetDurationSeconds:
      (JSON.parse(version.parametersJson).targetDurationMinutes ?? 10) * 60,
    startSceneId: version.startSceneKey ?? sceneRows[0]!.key,
    scenes: sceneRows.map((scene) => ({
      id: scene.key,
      type: scene.type,
      title: scene.title,
      text: scene.text,
      imagePrompt: scene.imagePrompt ?? undefined,
      voiceId: scene.voiceId ?? undefined,
      position: { x: scene.positionX, y: scene.positionY },
    })),
    choices: choiceRows.map((choice) => ({
      id: choice.key,
      sourceSceneId: choice.sourceSceneKey,
      label: choice.label,
      targetSceneId: choice.targetSceneKey,
      order: choice.order,
    })),
  };
}

export function trashStory(id: string) {
  const now = new Date();
  return db.transaction((tx) => {
    const story = tx.select().from(stories).where(eq(stories.id, id)).get();
    if (!story || story.deletedAt) return false;
    if (story.activeVersionId)
      tx.update(storyVersions)
        .set({ status: "superseded", updatedAt: now })
        .where(eq(storyVersions.id, story.activeVersionId))
        .run();
    return (
      tx
        .update(stories)
        .set({
          activeVersionId: null,
          deletedAt: now,
          purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
          updatedAt: now,
        })
        .where(and(eq(stories.id, id), isNull(stories.deletedAt)))
        .run().changes > 0
    );
  });
}

export function restoreStory(id: string) {
  return (
    db
      .update(stories)
      .set({ deletedAt: null, purgeAfter: null, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .run().changes > 0
  );
}

export function purgeStory(id: string) {
  const story = db.select().from(stories).where(eq(stories.id, id)).get();
  if (!story?.deletedAt) return false;
  return db.delete(stories).where(eq(stories.id, id)).run().changes > 0;
}
