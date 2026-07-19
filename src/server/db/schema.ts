import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
};

export const admins = sqliteTable("admins", {
  id: text("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("sessions_token_idx").on(table.tokenHash)],
);

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStartedAt: integer("window_started_at", {
    mode: "timestamp_ms",
  }).notNull(),
  blockedUntil: integer("blocked_until", { mode: "timestamp_ms" }),
});

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("primary"),
  instanceName: text("instance_name").notNull(),
  childName: text("child_name").notNull(),
  publicUrl: text("public_url").notNull(),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(2000),
  storyBudgetCents: integer("story_budget_cents").notNull().default(300),
  storeEnabled: integer("store_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  storeApiKeyHash: text("store_api_key_hash").notNull(),
  storeApiKeyEncrypted: text("store_api_key_encrypted").notNull(),
  ...timestamps,
});

export const providerConfigurations = sqliteTable(
  "provider_configurations",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["text", "image", "tts"] }).notNull(),
    provider: text("provider").notNull(),
    baseUrl: text("base_url"),
    model: text("model"),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("provider_type_unique").on(table.type)],
);

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    uuid: text("uuid").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    age: integer("age").notNull(),
    activeVersionId: text("active_version_id"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    purgeAfter: integer("purge_after", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [index("stories_deleted_idx").on(table.deletedAt)],
);

export const storyVersions = sqliteTable(
  "story_versions",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", {
      enum: [
        "draft",
        "validated",
        "generating",
        "ready",
        "published",
        "superseded",
        "failed",
      ],
    })
      .notNull()
      .default("draft"),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    parametersJson: text("parameters_json").notNull(),
    rawResponseJson: text("raw_response_json"),
    startSceneKey: text("start_scene_key"),
    validatedAt: integer("validated_at", { mode: "timestamp_ms" }),
    mediaReviewedAt: integer("media_reviewed_at", { mode: "timestamp_ms" }),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    actualCostCents: integer("actual_cost_cents").notNull().default(0),
    packPath: text("pack_path"),
    coverPath: text("cover_path"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("story_version_unique").on(table.storyId, table.version),
  ],
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => storyVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    type: text("type", { enum: ["narrative", "choice", "ending"] }).notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    imagePrompt: text("image_prompt"),
    voiceId: text("voice_id"),
    positionX: real("position_x").notNull().default(0),
    positionY: real("position_y").notNull().default(0),
    order: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex("scene_key_unique").on(table.versionId, table.key)],
);

export const choices = sqliteTable(
  "choices",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => storyVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sourceSceneKey: text("source_scene_key").notNull(),
    label: text("label").notNull(),
    targetSceneKey: text("target_scene_key").notNull(),
    order: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("choices_version_idx").on(table.versionId),
    uniqueIndex("choice_key_unique").on(table.versionId, table.key),
  ],
);

export const generationJobs = sqliteTable("generation_jobs", {
  id: text("id").primaryKey(),
  versionId: text("version_id")
    .notNull()
    .references(() => storyVersions.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["queued", "running", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("queued"),
  currentStep: text("current_step"),
  progress: integer("progress").notNull().default(0),
  overrideBudget: integer("override_budget", { mode: "boolean" })
    .notNull()
    .default(false),
  error: text("error"),
  ...timestamps,
});

export const jobSteps = sqliteTable("job_steps", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => generationJobs.id, { onDelete: "cascade" }),
  step: text("step").notNull(),
  assetId: text("asset_id").notNull().default("all"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  resultJson: text("result_json"),
  error: text("error"),
  ...timestamps,
});

export const generatedAssets = sqliteTable("generated_assets", {
  id: text("id").primaryKey(),
  versionId: text("version_id")
    .notNull()
    .references(() => storyVersions.id, { onDelete: "cascade" }),
  sceneKey: text("scene_key"),
  type: text("type", {
    enum: ["audio", "image", "cover", "title_audio", "title_image", "pack"],
  }).notNull(),
  provider: text("provider"),
  path: text("path").notNull(),
  mimeType: text("mime_type").notNull(),
  bytes: integer("bytes").notNull().default(0),
  metadataJson: text("metadata_json"),
  ...timestamps,
});

export const usageRecords = sqliteTable("usage_records", {
  id: text("id").primaryKey(),
  versionId: text("version_id").references(() => storyVersions.id, {
    onDelete: "set null",
  }),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  units: real("units").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  level: text("level", {
    enum: ["info", "warning", "error", "success"],
  }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
