import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

type Meta = Record<string,string|string[]|boolean|number>;
interface Relation { target:string; type:"related"|"develops"|"documents"; evidence:"editorial"; confidence:number }

const legacyRoot=resolve(process.argv[2]??"F:/Code/active/sverseq/content");
const targetRoot=resolve(process.argv[3]??"src/content");
const legacyRepo=resolve(legacyRoot,"..");
// This list comes from the generated index that was actually published, not from
// whichever drafts happen to be present in the old working tree today.
const publishedWorkSlugs=[
  "ai-vayfu-i-virtualnye-pomoschniki","arka-vyatskogo-kremlya","audiospektakl-saltykiada",
  "chertezhi-tekhdiplomy","dver-kotoraya-zhdyot","ermil-kostrov","katalog-promyshlennoy-arkhitektury","lending-prilozheniya-logoped-buduschego",
  "maslenitsa-v-slobodskom","prepodavanie-metodicheskaya-rabota-i-prodakshn-v-tsifrovykh-kafedrakh",
  "prodakshn-dlya-ya-ty-gorod","rabota-k-yubileyu-goroda","sayt-advokata-antona-okulova",
  "rubyspot",
  "sayt-proekta-ya-ty-gorod","sayt-programmy-razvitiya-vyatgu-na-2021-2030-gody",
  "sayt-regionalnogo-tsentra-finansovoy-gramotnosti-kirovskoy-oblasti",
  "sayt-vserossiyskogo-foruma-inklyuzivnogo-vysshego-obrazovaniya","sistema-sbora-i-analiza-trendov-na-n8n",
  "tsifrovoy-sad-staniverse-xyz","tyaga","video-dlya-regionalnogo-operatora-po-obrascheniyu-s-tko",
  "virtualnyy-ofis-advokata","ya-obmanyvat-sebya-ne-stanu",
] as const;
const workAliases:Record<string,string>={};
const projectAliases:Record<string,string>={};
const curated:Record<string,Relation[]>={
  "project:staniverse":[{target:"publication:telegram:staniverse:1013",type:"documents",evidence:"editorial",confidence:1}],
  "project:albina":[{target:"article:ai-waifu",type:"develops",evidence:"editorial",confidence:1},{target:"publication:telegram:staniverse:566",type:"documents",evidence:"editorial",confidence:1}],
  "project:metavyatka":[{target:"work:arka-vyatskogo-kremlya",type:"develops",evidence:"editorial",confidence:1},{target:"project:ya-ty-gorod",type:"related",evidence:"editorial",confidence:.9}],
  "project:ya-ty-gorod":[{target:"work:sayt-proekta-ya-ty-gorod",type:"develops",evidence:"editorial",confidence:1},{target:"project:nearventure",type:"related",evidence:"editorial",confidence:1}],
  "work:arka-vyatskogo-kremlya":[{target:"project:metavyatka",type:"develops",evidence:"editorial",confidence:1}],
  "work:sistema-sbora-i-analiza-trendov-na-n8n":[{target:"article:ai-diploma",type:"related",evidence:"editorial",confidence:.9}],
  "article:ai-waifu":[{target:"project:albina",type:"develops",evidence:"editorial",confidence:1},{target:"publication:youtube:ncQ31xB3GLE",type:"related",evidence:"editorial",confidence:1}],
  "article:ai-diploma":[{target:"work:sistema-sbora-i-analiza-trendov-na-n8n",type:"related",evidence:"editorial",confidence:.9},{target:"publication:telegram:staniverse:1032",type:"documents",evidence:"editorial",confidence:1},{target:"publication:youtube:1Q6KahaYrPA",type:"related",evidence:"editorial",confidence:1}],
};

function readPublishedWork(slug:string){
  const relative=`content/works/cases/${slug}.md`;
  const commit=execFileSync("git",["log","--diff-filter=AM","-1","--format=%H","--",relative],{cwd:legacyRepo,encoding:"utf8"}).trim();
  if(!commit)throw new Error(`Published work has no source in Git history: ${slug}`);
  return execFileSync("git",["show",`${commit}:${relative}`],{cwd:legacyRepo,encoding:"utf8",maxBuffer:10*1024*1024});
}

function parseSource(source:string){
  const match=source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if(!match) throw new Error("Missing frontmatter");
  const meta:Meta={}; let current:string|undefined;
  for(const raw of match[1].split(/\r?\n/)){
    const list=raw.match(/^-\s+(.*)$/); if(list&&current){(meta[current] as string[]).push(list[1].trim());continue}
    const field=raw.match(/^([\w-]+):\s*(.*)$/); if(!field)continue;
    current=field[1];const value=field[2].trim();
    if(!value){meta[current]=[];continue}
    meta[current]=value==="true"?true:value==="false"?false:/^\d+$/.test(value)?Number(value):value.replace(/^['"]|['"]$/g,"");
  }
  return {meta,body:match[2].trim()};
}
const arr=(value:Meta[string])=>Array.isArray(value)?value:value?[String(value)]:[];
const plain=(value:string)=>value.replace(/<[^>]+>/g," ").replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,"$2").replace(/[`*_>#]/g,"").replace(/\s+/g," ").trim();
const sectionBullets=(body:string,title:string)=>{const escaped=title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");const match=body.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,"mi"));return match?[...match[1].matchAll(/^[-*]\s+(.+)$/gm)].map((item)=>plain(item[1])):[]};
const summary=(body:string)=>{const narrative=body.replace(/^#{1,6}\s+.*$/gm,"").replace(/^[-*]\s+.*$/gm,"").replace(/<[^>]+>/g," ");const paragraphs=narrative.split(/\r?\n\s*\r?\n/).map(plain).filter((text)=>text&&!/^https?:/.test(text));const value=paragraphs[0]??"Описание опыта и результата.";return value.length>220?`${value.slice(0,219).trimEnd()}…`:value};
const yaml=(value:unknown)=>JSON.stringify(value);
const canonicalWork=(slug:string)=>workAliases[slug]??slug;
const canonicalProject=(slug:string)=>projectAliases[slug]??slug;
const allTargets=new Map<string,string>();

const workFiles=publishedWorkSlugs.map((slug)=>`${slug}.md`);
const projectFiles=(await readdir(resolve(legacyRoot,"lab"))).filter((file)=>file.endsWith(".md")&&file!=="index.md");
for(const file of workFiles){const slug=basename(file,".md"),target=`work:${canonicalWork(slug)}`;allTargets.set(slug,target);const {meta}=parseSource(readPublishedWork(slug));for(const alias of arr(meta.aliases))allTargets.set(alias.split("/").at(-1)!,target)}
for(const file of projectFiles){const slug=basename(file,".md"),target=`project:${canonicalProject(slug)}`;allTargets.set(slug,target);const {meta}=parseSource(await readFile(resolve(legacyRoot,"lab",file),"utf8"));for(const alias of arr(meta.aliases))allTargets.set(alias.split("/").at(-1)!,target)}

function convertWikiLinks(body:string){return body.replace(/!\[[^\]]*\]\(\/assets\/(?:foo\.jpg|Pasted%20image%2020260418202604\.png|diplom-14-n8n-workflow\.jpg)\)\s*/g,"").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,raw,label)=>{const slug=String(raw).split("/").at(-1)!;const target=allTargets.get(slug);const text=label??slug;if(!target)return text;const [kind,id]=target.split(":");return `[${text}](/${kind==="work"?"works":"projects"}/${id}/)`})}
const cleanMarkdown=(body:string)=>convertWikiLinks(body)
  .replace(/^##\s+Связи\s*$[\s\S]*?(?=^##\s|(?![\s\S]))/gmi,"")
  .replace(/\bParametrick\b/g,"[Mnemoform (раньше Parametrick)](/projects/mnemoform/)")
  .replace(/[ \t]+$/gm,"")
  .trim();
function relationsFor(body:string,id:string){const found=[...body.matchAll(/\[\[([^\]|/]+)(?:\|[^\]]+)?\]\]/g)].flatMap((match)=>{const target=allTargets.get(match[1]);return target&&target!==id?[{target,type:"related" as const,evidence:"editorial" as const,confidence:.8}]:[]});return [...new Map([...(curated[id]??[]),...found].map((relation)=>[relation.target,relation])).values()]}

async function migrateWork(file:string){
  const slug=basename(file,".md"),canonical=canonicalWork(slug),sourcePath=`${legacyRepo.replace(/\\/g,"/")}#published:${slug}`;const {meta,body}=parseSource(readPublishedWork(slug));
  const features=sectionBullets(body,"Что делал лично");const clientLine=body.match(/^-\s+Клиент(?:ы\s*\/\s*партнёры)?[ \t]*:[ \t]*(.+)$/mi)?.[1];const projectLine=body.match(/^-\s+Проект[ \t]*:[ \t]*(.+)$/mi)?.[1];
  const id=`work:${canonical}`;const relations=relationsFor(body,id);const domains=arr(meta.domain);const tags=arr(meta.tags);
  const workStatus=meta.status==="ongoing"?"ongoing":"completed";
  const explicitClient=clientLine?plain(clientLine).replace(/^-\s*/,""):undefined;
  const ownerTarget=projectLine?.match(/\[\[([^\]|]+)/)?.[1]?.split("/").at(-1);
  const ownerId=ownerTarget?canonicalProject(ownerTarget):undefined;
  const ownerNames:Record<string,string>={albina:"Albina",metavyatka:"MetaVyatka",omnipub:"OmniPub",staniverse:"staniverse","ya-ty-gorod":"я.ты.город"};
  const client=explicitClient||(ownerId&&ownerNames[ownerId]?`Проект: ${ownerNames[ownerId]}`:undefined);
  const front=["---",`id: ${yaml(id)}`,"kind: work",`title: ${yaml(String(meta.title??slug))}`,`summary: ${yaml(summary(body))}`,`year: ${yaml(meta.year??"—")}`,`genres: ${yaml(domains.length?domains:tags)}`,`role: ${yaml(features.slice(0,3).join("; ")||"Автор и исполнитель")}`,client?`client: ${yaml(client)}`:undefined,`status: ${workStatus}`,`tags: ${yaml(tags)}`,"entities: []",`featured: ${Boolean(meta.featured)}`,`features: ${yaml(features)}`,`legacySource: ${yaml(sourcePath.replace(/\\/g,"/"))}`,`relations: ${yaml(relations)}`,"---",""].filter((line):line is string=>line!==undefined).join("\n");
  await writeFile(resolve(targetRoot,"works",`${canonical}.md`),`${front}${cleanMarkdown(body)}\n`,"utf8");
}
async function migrateProject(file:string){
  const slug=basename(file,".md"),canonical=canonicalProject(slug),sourcePath=resolve(legacyRoot,"lab",file);const {meta,body}=parseSource(await readFile(sourcePath,"utf8"));const id=`project:${canonical}`;const rawStatus=String(meta.status??"idea");const statuses:Record<string,string>={wip:"development","in-progress":"development",ongoing:"active",concept:"idea"};const status=statuses[rawStatus]??rawStatus;
  const front=["---",`id: ${yaml(id)}`,"kind: project",`title: ${yaml(String(meta.title??slug))}`,`summary: ${yaml(summary(body))}`,`status: ${yaml(status)}`,`domains: ${yaml(arr(meta.domain))}`,`tags: ${yaml(arr(meta.tags))}`,"entities: []",`featured: ${Boolean(meta.featured)}`,meta.updated?`updated: ${yaml(meta.updated)}`:undefined,`legacySource: ${yaml(sourcePath.replace(/\\/g,"/"))}`,`relations: ${yaml(relationsFor(body,id))}`,"---",""].filter((line):line is string=>line!==undefined).join("\n");
  await writeFile(resolve(targetRoot,"projects",`${canonical}.md`),`${front}${cleanMarkdown(body)}\n`,"utf8");
}
async function migrateArticle(file:string,canonical:string){
  const sourcePath=resolve(legacyRoot,"articles",file);const {meta,body}=parseSource(await readFile(sourcePath,"utf8"));const id=`article:${canonical}`;
  const front=["---",`id: ${yaml(id)}`,"kind: article",`title: ${yaml(String(meta.title??canonical))}`,`summary: ${yaml(summary(body))}`,meta.date?`date: ${yaml(meta.date)}`:undefined,meta.updated?`updated: ${yaml(meta.updated)}`:undefined,`tags: ${yaml(arr(meta.tags))}`,"entities: []","featured: true",`legacySource: ${yaml(sourcePath.replace(/\\/g,"/"))}`,`relations: ${yaml(relationsFor(body,id))}`,"---",""].filter((line):line is string=>line!==undefined).join("\n");
  await writeFile(resolve(targetRoot,"articles",`${canonical}.md`),`${front}${cleanMarkdown(body)}\n`,"utf8");
  return body;
}
await rm(resolve(targetRoot,"works"),{recursive:true,force:true});await mkdir(resolve(targetRoot,"works"),{recursive:true});await mkdir(resolve(targetRoot,"projects"),{recursive:true});await mkdir(resolve(targetRoot,"articles"),{recursive:true});await Promise.all(workFiles.map(migrateWork));await Promise.all(projectFiles.map(migrateProject));
const articleBodies=await Promise.all([migrateArticle("ii-vayfu-na-14-fevralya-instruktsiya-po-primeneniyu-i-sozdaniyu.md","ai-waifu"),migrateArticle("kak-ya-zaschitil-diplom-na-otlichno-s-pomoschyu-ii-agentov-i-sistemy-znaniy.md","ai-diploma")]);
await mkdir(resolve("public/assets"),{recursive:true});let copiedAssets=0,missingAssets=0;const assetNames=new Set(["zapovednaya-vyatka-ekovyatka-mockup.png",...articleBodies.flatMap((body)=>[...body.matchAll(/\/assets\/([^\s)\"']+)/g)].map((match)=>decodeURIComponent(match[1])))]);for(const asset of assetNames){try{await copyFile(resolve(legacyRoot,"assets",asset),resolve("public/assets",asset));copiedAssets++}catch{missingAssets++}}
console.log(JSON.stringify({works:workFiles.length,projects:projectFiles.length,articles:2,assets:copiedAssets,missingAssets,droppedBrokenLegacyImages:3}));
