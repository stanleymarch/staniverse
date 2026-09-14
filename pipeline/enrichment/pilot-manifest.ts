import { readFileSync } from "node:fs";

export type PilotManifestSplit = "tuning" | "holdout";
export type PilotSplit = PilotManifestSplit | "all";

export interface PilotManifestSource {
  id: string;
  split: PilotManifestSplit;
  reason: string;
}

interface PilotManifestFile {
  version: number;
  sources: PilotManifestSource[];
}

function loadPilotManifest(): PilotManifestFile {
  const parsed = JSON.parse(readFileSync(new URL("./pilot-manifest.json", import.meta.url), "utf8")) as Partial<PilotManifestFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.sources) || parsed.sources.length !== 30) {
    throw new Error("Pilot manifest must be version 1 with exactly 30 stable sources.");
  }
  const sources = parsed.sources;
  if (new Set(sources.map(({ id }) => id)).size !== sources.length) throw new Error("Pilot manifest source IDs must be unique.");
  for (const source of sources) {
    if (!source.id || !["tuning", "holdout"].includes(source.split) || !source.reason) {
      throw new Error("Every pilot manifest source needs an id, split, and reason.");
    }
  }
  return { version: parsed.version, sources };
}

export const PILOT_MANIFEST = loadPilotManifest();
export const PILOT_TUNING_SOURCES = PILOT_MANIFEST.sources.filter(({ split }) => split === "tuning");
export const PILOT_HOLDOUT_SOURCES = PILOT_MANIFEST.sources.filter(({ split }) => split === "holdout");
export const PILOT_PROJECT_SOURCES = PILOT_MANIFEST.sources.filter(({ id }) => id.startsWith("project:")).map(({ id }) => id);
export const PILOT_TUNING_IDS = PILOT_TUNING_SOURCES.filter(({ id }) => id.startsWith("publication:")).map(({ id }) => Number(id.split(":").at(-1)));
export const PILOT_HOLDOUT_IDS = PILOT_HOLDOUT_SOURCES.filter(({ id }) => id.startsWith("publication:")).map(({ id }) => Number(id.split(":").at(-1)));
export const PILOT_IDS = [...PILOT_TUNING_IDS, ...PILOT_HOLDOUT_IDS];
export const PILOT_LIMIT = PILOT_MANIFEST.sources.length;

export function pilotSplitForSource(id: string): PilotManifestSplit | undefined {
  const stableId = id.replace(/::\d+$/, "");
  return PILOT_MANIFEST.sources.find((source) => source.id === stableId)?.split;
}
