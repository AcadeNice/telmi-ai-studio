import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { apiErrorResponse } from "@/server/api/response";
import { db } from "@/server/db";
import { generatedAssets, stories, storyVersions } from "@/server/db/schema";
import { requireStoreEnabled } from "@/server/store/auth";

export async function GET() {
  try {
    const config = requireStoreEnabled();
    const published = db
      .select({ story: stories, version: storyVersions })
      .from(stories)
      .innerJoin(
        storyVersions,
        and(
          eq(stories.activeVersionId, storyVersions.id),
          eq(storyVersions.status, "published"),
        ),
      )
      .where(
        and(
          isNull(stories.deletedAt),
          isNotNull(storyVersions.packPath),
          isNotNull(storyVersions.coverPath),
        ),
      )
      .all();
    const origin = config.publicUrl.replace(/\/$/, "");
    const data = published.map(({ story, version }) => {
      const parameters = readCredits(version.parametersJson);
      const pack = db
        .select()
        .from(generatedAssets)
        .where(
          and(
            eq(generatedAssets.versionId, version.id),
            eq(generatedAssets.type, "pack"),
          ),
        )
        .get();
      const cover = db
        .select()
        .from(generatedAssets)
        .where(
          and(
            eq(generatedAssets.versionId, version.id),
            eq(generatedAssets.type, "cover"),
          ),
        )
        .get();
      const assetUrl = (id: string) => `${origin}/store/assets/${id}`;
      return {
        age: story.age,
        title: story.title,
        description: story.description,
        thumbs: {
          small: cover ? assetUrl(cover.id) : "",
          medium: cover ? assetUrl(cover.id) : "",
        },
        download: pack ? assetUrl(pack.id) : "",
        download_count: 0,
        awards: [],
        created_at: version.createdAt.toISOString(),
        updated_at: (version.publishedAt ?? version.updatedAt).toISOString(),
        uuid: story.uuid,
        author: parameters.author ?? config.instanceName,
        ...(parameters.defaultVoiceName
          ? { voice: parameters.defaultVoiceName }
          : {}),
        designer: "Telmi AI Studio",
        publisher: config.instanceName,
        category: "Histoire Interactive",
        version: version.version,
        license: "Privé",
      };
    });
    return Response.json(
      {
        banner: {
          image: `${origin}/store/banner.svg`,
          background: "#efe7ff",
          link: origin,
        },
        data,
      },
      {
        headers: {
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function readCredits(parametersJson: string) {
  try {
    const value = JSON.parse(parametersJson) as {
      author?: unknown;
      defaultVoiceName?: unknown;
    };
    return {
      author:
        typeof value.author === "string" && value.author.trim()
          ? value.author.trim()
          : undefined,
      defaultVoiceName:
        typeof value.defaultVoiceName === "string" &&
        value.defaultVoiceName.trim()
          ? value.defaultVoiceName.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}
