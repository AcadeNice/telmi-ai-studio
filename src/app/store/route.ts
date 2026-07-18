import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { apiErrorResponse } from "@/server/api/response";
import { db } from "@/server/db";
import { generatedAssets, stories, storyVersions } from "@/server/db/schema";
import { requireStoreKey } from "@/server/store/auth";

export async function GET(request: Request) {
  try {
    const { config, key } = requireStoreKey(request);
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
      const withKey = (id: string) =>
        `${origin}/store/assets/${id}?api_key=${encodeURIComponent(key)}`;
      return {
        age: story.age,
        title: story.title,
        description: story.description,
        thumbs: {
          small: cover ? withKey(cover.id) : "",
          medium: cover ? withKey(cover.id) : "",
        },
        download: pack ? withKey(pack.id) : "",
        download_count: 0,
        awards: [],
        created_at: version.createdAt.toISOString(),
        updated_at: (version.publishedAt ?? version.updatedAt).toISOString(),
        uuid: story.uuid,
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
