import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { CanonicalPublication } from "./types";

interface Archive {version:number;channel:string;publications:CanonicalPublication[]}
const [archiveFile="pipeline/telegram/archive/canonical.json",sourceFolder="pipeline/telegram/archive/source",outputFolder="public/media/telegram"]=process.argv.slice(2);
const archive=JSON.parse(await readFile(resolve(archiveFile),"utf8")) as Archive;const output=resolve(outputFolder);await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const run=promisify(execFile);
let written=0,missing=0,sourceBytes=0,outputBytes=0;
// Parallel pool: photo (sharp) and audio work is cheap, but 149 source videos
// (3.4 GB) would take hours sequentially. Four workers match the build laptop's
// four cores; each task stays single-process (sharp/ffmpeg), so peak load ≈ 4 cores.
const WORKERS = 4;
const jobs: Array<() => Promise<void>> = [];
for (const publication of archive.publications) for (const media of publication.media) {
  jobs.push(async () => {
    const stem = `${publication.sourceId}-${media.messageId}-${media.order}`;
    const source = resolve(sourceFolder, media.sourcePath);
    try {
      sourceBytes += (await stat(source)).size;
      let basename: string;
      if (media.type === "image") {
        basename = `${stem}.webp`;
        await sharp(source).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toFile(resolve(output, basename));
      } else if (media.type === "video") {
        basename = `${stem}.mp4`;
        await run("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-vf", "scale=w='min(960,iw)':h=-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", resolve(output, basename)]);
      } else if (media.type === "audio") {
        basename = `${stem}.mp3`;
        await run("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-c:a", "libmp3lame", "-b:a", "96k", resolve(output, basename)]);
      } else {
        basename = `${stem}${extname(media.sourcePath).toLowerCase() || ".bin"}`;
        await copyFile(source, resolve(output, basename));
      }
      outputBytes += (await stat(resolve(output, basename))).size;
      media.publicPath = `/media/telegram/${basename}`;
      written++;
    } catch (error) { console.warn(`media skipped: ${media.sourcePath}: ${error instanceof Error ? error.message : String(error)}`); missing++; }
  });
}
let next = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  for (let index = next++; index < jobs.length; index = next++) await jobs[index]();
}));
await writeFile(resolve(archiveFile),JSON.stringify(archive,null,2),"utf8");console.log(JSON.stringify({written,missing,sourceMB:Number((sourceBytes/1048576).toFixed(1)),outputMB:Number((outputBytes/1048576).toFixed(1)),output}));
