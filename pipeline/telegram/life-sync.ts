/** The life channel is a private diary feed, not the public staniverse channel:
 * no public t.me link may name it, and its evening reply chains are one live
 * publication, not a series. The raw archive accumulates in
 * `archive/life/source/result.json`: a Desktop export carries the full history,
 * a nightly Telethon fetch only the new messages — both merge by Telegram id
 * (mergeMessages), and media files settle next to the archive result.json so the
 * publisher has one stable source root for either flow. */
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mergeMessages } from "./incremental";
import { normalizeExport } from "./normalize";
import type { TelegramExport, TelegramMessage } from "./types";

const [inputPath = "pipeline/telegram/incoming/life-ChatExport_2026-10-01/result.json", output = "pipeline/telegram/archive/life/canonical.json", sourceRoot = "pipeline/telegram/archive/life/source"] = process.argv.slice(2);
const incomingRoot = dirname(resolve(inputPath));
const archiveRoot = resolve(sourceRoot);
const rawPath = resolve(archiveRoot, "result.json");

const incoming = JSON.parse(await readFile(resolve(inputPath), "utf8")) as TelegramExport;
let previous: TelegramExport = { messages: [] };
try { previous = JSON.parse(await readFile(rawPath, "utf8")) as TelegramExport; } catch { /* first import */ }
const stats = mergeMessages(previous.messages, incoming.messages);
const merged: TelegramExport = { ...previous, ...incoming, messages: stats.messages };

// Media referenced by the incoming slice settles into the archive root; the
// Desktop export and the nightly fetch differ only in where files appear.
const mediaFields = ["photo", "thumbnail", "file", "video_file", "audio_file", "voice_message"] as const;
const mediaPaths = new Set<string>();
const collect = (value: unknown) => {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of mediaFields) if (typeof record[key] === "string") mediaPaths.add(record[key] as string);
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach(collect);
    else if (child && typeof child === "object") collect(child);
  }
};
incoming.messages.forEach(collect);
let copied = 0;
const missing: string[] = [];
await mkdir(archiveRoot, { recursive: true });
for (const relative of mediaPaths) {
  try {
    const target = resolve(archiveRoot, relative);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(incomingRoot, relative), target);
    copied++;
  } catch (error) { missing.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`); }
}
const existing = new Set(await readdir(archiveRoot, { recursive: true }).then((entries) => entries.map(String)).catch(() => [] as string[]));
await writeFile(rawPath, JSON.stringify(merged, null, 2), "utf8");

const publications = normalizeExport(merged, "life", { liveMergeHours: 6, publicSource: false });
let priorState: { entityId?: number } = {};
try { priorState = JSON.parse(await readFile(resolve(archiveRoot, "state.json"), "utf8")); } catch { /* first import */ }
const state = { version: 1, channel: "life", ...(priorState.entityId !== undefined ? { entityId: priorState.entityId } : {}), lastMessageId: Math.max(0, ...stats.messages.map((message: TelegramMessage) => message.id)), messageCount: stats.messages.length, publicationCount: publications.length, syncedAt: new Date().toISOString() };
await writeFile(resolve(output), JSON.stringify({ version: 2, channel: "life", sourceChannel: "life", publications }, null, 2), "utf8");

await writeFile(resolve(archiveRoot, "state.json"), JSON.stringify(state, null, 2), "utf8");

console.log(JSON.stringify({ added: stats.added, updated: stats.updated, unchanged: stats.unchanged, totalMessages: stats.messages.length, publications: publications.length, lives: publications.filter((p) => p.rawMessageIds.length > 1).length, mediaReferenced: mediaPaths.size, mediaCopied: copied, mediaMissing: missing.length, missingPaths: missing.slice(0, 5), archiveFiles: existing.size, output }));
