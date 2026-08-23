import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { CanonicalPublication } from "./types";

interface Archive {version:number;channel:string;publications:CanonicalPublication[]}
const [archiveFile="pipeline/telegram/archive/canonical.json",sourceFolder="pipeline/telegram/archive/source",outputFolder="public/media/telegram"]=process.argv.slice(2);
const archive=JSON.parse(await readFile(resolve(archiveFile),"utf8")) as Archive;const output=resolve(outputFolder);await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
let written=0,missing=0,sourceBytes=0,outputBytes=0;
for(const publication of archive.publications)for(const media of publication.media){if(media.type!=="image")continue;const basename=`${publication.sourceId}-${media.messageId}-${media.order}.webp`;const target=resolve(output,basename);try{const source=resolve(sourceFolder,media.sourcePath);const result=await sharp(source).rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).webp({quality:82,effort:4}).toFile(target);sourceBytes+=(await stat(source)).size;outputBytes+=result.size;media.publicPath=`/media/telegram/${basename}`;written++}catch{missing++}}
await writeFile(resolve(archiveFile),JSON.stringify(archive,null,2),"utf8");console.log(JSON.stringify({written,missing,sourceMB:Number((sourceBytes/1048576).toFixed(1)),outputMB:Number((outputBytes/1048576).toFixed(1)),output}));
