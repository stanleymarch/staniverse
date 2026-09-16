import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AllowlistedChannel, VideoManifestEntry } from "./video-manifest";

const channelsPath = resolve("pipeline/video-channels.json");
const manifestPath = resolve("pipeline/video-manifest.json");
const channels = JSON.parse(await readFile(channelsPath, "utf8")) as AllowlistedChannel[];
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as VideoManifestEntry[];
const existing = new Map(manifest.map((video) => [`${video.platform}:${video.id}`, video]));

const decodeXml = (value: string) => value
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'");
const field = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`))?.[1]?.trim() ?? "");

const synced: VideoManifestEntry[] = [];
for (const channel of channels.filter((item) => item.platform === "youtube")) {
  if (!channel.channelId) throw new Error(`YouTube channel ${channel.key} has no verified channelId`);
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.channelId)}`);
  if (!response.ok) throw new Error(`YouTube feed ${channel.key} returned ${response.status}`);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  for (const entry of entries) {
    const id = field(entry, "yt:videoId");
    if (!id) continue;
    const previous = existing.get(`youtube:${id}`);
    synced.push({
      id,
      title: field(entry, "title"),
      platform: "youtube",
      format: previous?.format ?? "video",
      ownership: "pending",
      channelKey: channel.key,
      channelHandle: channel.handle,
      channelId: channel.channelId,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      target: previous?.target ?? `project:${channel.key}`,
      publishedAt: field(entry, "published"),
    });
  }
}

// Only the canonical channel feeds create first-class YouTube records. Explicit
// external references and non-YouTube platforms remain in the manifest solely
// as supporting sources for the material they document.
const syncedIds = new Set(synced.map((video) => video.id));
const references = manifest.flatMap((video): VideoManifestEntry[] => {
  if (video.platform !== "youtube") return [video];
  if (syncedIds.has(video.id)) return [];
  // A YouTube URL mentioned by a work or article is still useful evidence, but
  // if it is absent from both canonical channel feeds it must not be presented
  // as Staniverse media.
  const { channelKey: _channelKey, channelHandle: _channelHandle, channelId: _channelId, ...reference } = video;
  return [{ ...reference, ownership: "external" }];
});
const output = [...synced, ...references];
await writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ channels: channels.length, youtube: synced.length, references: references.length }, null, 2));
