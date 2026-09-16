/**
 * Downloads YouTube thumbnails into public/media/video so /videos/ and post
 * pages render instantly and never depend on i.ytimg.com reachability (which is
 * slow or blocked in the site's home region).
 *
 * Idempotent: posters already on disk are kept, so reruns only fetch new videos.
 * Run after `videos:sync` and before `videos:materialize`.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { youtubeThumbnailUrl, type VideoManifestEntry } from "./video-manifest";

const manifestPath = resolve("pipeline/video-manifest.json");
const outputDir = resolve("public/media/video");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as VideoManifestEntry[];

await mkdir(outputDir, { recursive: true });
let downloaded = 0;
let cached = 0;
const failed: string[] = [];
for (const video of manifest) {
  if (video.platform !== "youtube") continue;
  const target = resolve(outputDir, `${video.platform}-${video.id}.jpg`);
  if (await stat(target).then((info) => info.size > 0).catch(() => false)) { cached++; continue; }
  try {
    const response = await fetch(youtubeThumbnailUrl(video.id), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 100) throw new Error(`suspiciously small poster (${bytes.byteLength} bytes)`);
    await writeFile(target, bytes);
    downloaded++;
  } catch (error) {
    failed.push(`${video.platform}-${video.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(JSON.stringify({ downloaded, cached, failed: failed.length, failures: failed.slice(0, 5), outputDir }));
