import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeExport } from "./normalize";
import type { TelegramExport } from "./types";

const [input, output = "pipeline/telegram/archive/canonical.json", handle = "staniverse"] = process.argv.slice(2);
if (!input) throw new Error("Usage: tsx pipeline/telegram/import-export.ts <result.json> [output.json] [channel-handle]");
const source = JSON.parse(await readFile(resolve(input), "utf8")) as TelegramExport;
const publications = normalizeExport(source, handle);
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), JSON.stringify({ version: 1, channel: handle, publications }, null, 2), "utf8");
console.log(JSON.stringify({ messages: source.messages.length, publications: publications.length, output: resolve(output) }));
