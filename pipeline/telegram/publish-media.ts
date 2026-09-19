import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { CanonicalPublication } from "./types";

interface Archive {version:number;channel:string;publications:CanonicalPublication[]}
const [archiveFile="pipeline/telegram/archive/canonical.json",sourceFolder="pipeline/telegram/archive/source",outputFolder="public/media/telegram"]=process.argv.slice(2);
const archive=JSON.parse(await readFile(resolve(archiveFile),"utf8")) as Archive;const output=resolve(outputFolder);await mkdir(output,{recursive:true});
const run=promisify(execFile);
let written=0,reused=0,missing=0,sourceBytes=0,outputBytes=0;
// Parallel pool: photo (sharp) and audio work is cheap, but 149 source videos
// (3.4 GB) would take hours sequentially. Four workers match the build laptop's
// four cores; each task stays single-process (sharp/ffmpeg), so peak load ≈ 4 cores.
const WORKERS = 4;
const jobs: Array<() => Promise<void>> = [];
for (const publication of archive.publications) for (const media of publication.media) {
  jobs.push(async () => {
    const stem = `${publication.sourceId}-${media.messageId}-${media.order}`;
    const source = resolve(sourceFolder, media.sourcePath);
    const name = media.type === "image" ? `${stem}.webp`
      : media.type === "video" ? `${stem}.mp4`
      : media.type === "audio" ? `${stem}.mp3`
      : `${stem}${extname(media.sourcePath).toLowerCase() || ".bin"}`;
    const target = resolve(output, name);
    try {
      const sourceInfo = await stat(source);
      const existing = await stat(target).catch(() => undefined);
      // Encode only what the showcase does not already hold: an output at least as
      // fresh as its source is reused, so a nightly sync costs seconds instead of
      // re-encoding the whole archive.
      if (existing && existing.size > 0 && existing.mtimeMs >= sourceInfo.mtimeMs) {
        media.publicPath = `/media/telegram/${name}`;
        reused++;
        return;
      }
      sourceBytes += sourceInfo.size;
      if (media.type === "image") {
        await sharp(source).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toFile(target);
      } else if (media.type === "video") {
        await run("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-vf", "scale=w='min(960,iw)':h=-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", target]);
      } else if (media.type === "audio") {
        await run("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-c:a", "libmp3lame", "-b:a", "96k", target]);
      } else {
        await copyFile(source, target);
      }
      outputBytes += (await stat(target)).size;
      media.publicPath = `/media/telegram/${name}`;
      written++;
    } catch (error) { console.warn(`media skipped: ${media.sourcePath}: ${error instanceof Error ? error.message : String(error)}`); missing++; }
  });
}
let next = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  for (let index = next++; index < jobs.length; index = next++) await jobs[index]();
}));
// The showcase still mirrors the archive exactly: a file no publication claims any
// more (or the partial leftovers of an interrupted run) is removed here, once.
const referenced = new Set<string>();
for (const publication of archive.publications) for (const media of publication.media) if (media.publicPath) referenced.add(basename(media.publicPath));
let pruned = 0;
for (const name of await readdir(output)) if (!referenced.has(name)) { await rm(resolve(output, name), { force: true }); pruned++; }
await writeFile(resolve(archiveFile),JSON.stringify(archive,null,2),"utf8");console.log(JSON.stringify({written,reused,missing,pruned,sourceMB:Number((sourceBytes/1048576).toFixed(1)),outputMB:Number((outputBytes/1048576).toFixed(1)),output}));
