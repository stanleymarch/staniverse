import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AllowlistedChannel, VideoManifestEntry } from "./video-manifest";
import { verifyVideoOwnership } from "./video-manifest";

const manifest = JSON.parse(await readFile(resolve("pipeline/video-manifest.json"), "utf8")) as VideoManifestEntry[];
const channels = JSON.parse(await readFile(resolve("pipeline/video-channels.json"), "utf8")) as AllowlistedChannel[];
const report = manifest.map((video) => ({
  id: video.id,
  sourceUrl: video.sourceUrl,
  ...verifyVideoOwnership(video, channels),
}));

console.log(JSON.stringify({ verified: report.filter((item) => item.ownership === "verified").length, pending: report.filter((item) => item.ownership === "pending").length, external: report.filter((item) => item.ownership === "external").length, videos: report }, null, 2));
