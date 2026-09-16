import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AllowlistedChannel,
  type VideoManifestEntry,
  verifyVideoOwnership,
  youtubeThumbnailUrl,
} from "./video-manifest";

export interface MaterializedVideo extends VideoManifestEntry {
  ownership: "verified" | "pending" | "external";
  verification: ReturnType<typeof verifyVideoOwnership>["verification"];
}

export function materializeVideo(video: VideoManifestEntry, channels: AllowlistedChannel[]): MaterializedVideo {
  const result = verifyVideoOwnership(video, channels);
  return { ...video, ownership: result.ownership, verification: result.verification };
}
/** Prefers the poster fetched into public/media/video by fetch-video-posters,
 * falling back to the CDN URL when the local copy is missing. */
const localPosterPath = (platform: string, videoId: string) =>
  existsSync(resolve("public/media/video", `${platform}-${videoId}.jpg`)) ? `/media/video/${platform}-${videoId}.jpg` : undefined;

export function materializedFrontmatter(video: MaterializedVideo) {
  const kind = video.ownership === "verified" && video.platform === "youtube" ? "youtube-video" : "video";
  const channel = video.channelKey ? { key: video.channelKey, handle: video.channelHandle, platform: video.platform } : undefined;
  const summary = video.ownership === "verified"
    ? `Авторское видео, связанное с ${video.target}.`
    : video.ownership === "external"
      ? `Внешний видеоисточник, сохранённый как reference для ${video.target}.`
      : `Видео, связанное с ${video.target}; принадлежность каналу ожидает проверки.`;
  const data = {
    id: `publication:${video.platform}:${video.id}`,
    kind,
    title: video.title,
    summary,
    tags: [video.platform, "video"],
    entities: [],
    featured: false,
    sourceUrl: video.sourceUrl,
    sourceId: video.id,
    ...(video.publishedAt ? { date: video.publishedAt } : {}),
    threadIds: [],
    media: [],
    platform: video.platform,
    videoId: video.id,
    format: video.format,
    ...(video.platform === "youtube" ? { thumbnailUrl: localPosterPath(video.platform, video.id) ?? youtubeThumbnailUrl(video.id) } : {}),
    ...(video.embedUrl ? { embedUrl: video.embedUrl } : {}),
    ...(channel ? { channel } : {}),
    ...(video.channelId ? { channelId: video.channelId } : {}),
    ownership: video.ownership,
    verification: video.verification,
    relations: [{ target: video.target, type: "part-of", evidence: "editorial", confidence: 1 }],
  };
  const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  return `---\n${frontmatter}\n---\n\n[Открыть на платформе](${video.sourceUrl})\n`;
}

export async function materializeVideos(options: { manifestPath?: string; channelsPath?: string; outputDir?: string } = {}) {
  const manifestPath = options.manifestPath ?? resolve("pipeline/video-manifest.json");
  const channelsPath = options.channelsPath ?? resolve("pipeline/video-channels.json");
  const output = options.outputDir ?? resolve("src/content/publications/video");
  const videos = JSON.parse(await readFile(manifestPath, "utf8")) as VideoManifestEntry[];
  const channels = JSON.parse(await readFile(channelsPath, "utf8")) as AllowlistedChannel[];
  const materialized = videos
    .map((rawVideo) => materializeVideo(rawVideo, channels))
    .filter((video) => video.ownership !== "external");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const video of materialized) {
    const filename = video.id.startsWith(`${video.platform}-`) ? video.id : `${video.platform}-${video.id}`;
    await writeFile(resolve(output, `${filename}.md`), materializedFrontmatter(video), "utf8");
  }
  return { videos: materialized.length, excludedExternal: videos.length - materialized.length, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await materializeVideos();
  console.log(JSON.stringify(result));
}
