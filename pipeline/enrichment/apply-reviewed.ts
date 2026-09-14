import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, parseDocument, isMap, type Node } from "yaml";
import { sourceHash } from "./prepare";
import type { AcceptedEnrichmentBundle, AcceptedEnrichmentResult } from "./types";

interface StoredRelation {
  target: string;
  type: string;
  evidence: string;
  provenance?: string | { kind?: string; [key: string]: unknown };
  confidence?: number;
  explanation?: string;
  reviewStatus?: string;
  status?: string;
  [key: string]: unknown;
}

const REVIEWED_FIELDS = ["summary", "topics", "entities", "relations"] as const;

function contentPath(id: string, contentRoot: string): string {
  if (id.startsWith("publication:telegram:staniverse:")) return resolve(contentRoot, "publications", "telegram", `tg-${id.split(":").at(-1)}.md`);
  if (id.startsWith("project:")) return resolve(contentRoot, "projects", `${id.slice("project:".length)}.md`);
  throw new Error(`No reviewed content path mapping for ${id}.`);
}

function splitMarkdown(raw: string): { yaml: string; body: string; yamlOffset: number; closeOffset: number; newline: string } {
  const match = raw.match(/^---(?:\r?\n)([\s\S]*?)(\r?\n)---(?:\r?\n)([\s\S]*)$/);
  if (!match || match.index !== 0) throw new Error("Markdown file has no parseable frontmatter.");
  const yamlOffset = raw.indexOf(match[1]);
  return { yaml: match[1], body: match[3], yamlOffset, closeOffset: yamlOffset + match[1].length + match[2].length, newline: match[2] };
}

function relationKey(relation: Pick<StoredRelation, "target" | "type">): string {
  return `${relation.target}:${relation.type}`;
}

function isGeneratedEnrichment(relation: StoredRelation): boolean {
  return relation.evidence === "enrichment" || (typeof relation.provenance === "object" && relation.provenance?.kind === "enrichment");
}

function reviewedRelations(existing: StoredRelation[], accepted: AcceptedEnrichmentResult): StoredRelation[] {
  const byKey = new Map(existing.filter((relation) => !isGeneratedEnrichment(relation)).map((relation) => [relationKey(relation), relation]));
  for (const relation of accepted.relations) {
    const value: StoredRelation = {
      target: relation.targetId,
      type: relation.type,
      evidence: "enrichment",
      provenance: {
        kind: "enrichment",
        source: "pipeline/enrichment/generated/accepted.json",
        sourceId: accepted.id,
        method: "slow-review",
        version: accepted.resultHash,
      },
      confidence: relation.confidence,
      explanation: relation.explanation,
      reviewStatus: "accepted",
    };
    byKey.set(relationKey(value), value);
  }
  return [...byKey.values()];
}

function replacementRanges(raw: string, accepted: AcceptedEnrichmentResult): Array<{ start: number; end: number; value: string }> {
  const frontmatter = splitMarkdown(raw);
  const document = parseDocument(frontmatter.yaml, { keepSourceTokens: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error(`Invalid YAML for ${accepted.id}: ${document.errors.join("; ")}`);
  if (document.get("id") !== accepted.id) throw new Error(`Content id does not match reviewed result ${accepted.id}.`);
  const existing = parse(frontmatter.yaml) as Record<string, unknown>;
  const existingRelations = existing.relations as StoredRelation[] | undefined;
  const values: Record<(typeof REVIEWED_FIELDS)[number], unknown> = {
    summary: accepted.summary,
    topics: accepted.topics,
    entities: accepted.entities.map(({ entity }) => entity),
    relations: reviewedRelations(Array.isArray(existingRelations) ? existingRelations : [], accepted),
  };
  return REVIEWED_FIELDS.map((key) => {
    const node = document.get(key, true) as Node | undefined;
    const range = node?.range;
    const value = JSON.stringify(values[key]);
    if (!range || range.length < 2) {
      // Absent reviewed fields are appended as new frontmatter keys before the closing delimiter.
      return { start: frontmatter.closeOffset, end: frontmatter.closeOffset, value: `${key}: ${value}${frontmatter.newline}` };
    }
    return { start: frontmatter.yamlOffset + range[0], end: frontmatter.yamlOffset + range[1], value };
  }).sort((a, b) => b.start - a.start);
}


export async function applyReviewedBundle(bundlePath: string, contentRoot = "src/content"): Promise<{ updated: number; unchanged: number }> {
  const bundle = JSON.parse(await readFile(resolve(bundlePath), "utf8")) as AcceptedEnrichmentBundle;
  if (bundle.version !== 2 || bundle.lifecycle !== "accepted" || !Array.isArray(bundle.results)) throw new Error("--apply-reviewed requires a version 2 accepted bundle.");
  let updated = 0;
  let unchanged = 0;
  for (const accepted of bundle.results) {
    const path = contentPath(accepted.id, contentRoot);
    const before = await readFile(path, "utf8");
    const bodyBefore = splitMarkdown(before).body;
    if (sourceHash(bodyBefore) !== accepted.fileBodyHash) throw new Error(`Content body for ${accepted.id} differs from the accepted review; nothing was written.`);
    let after = before;
    for (const replacement of replacementRanges(before, accepted)) {
      after = after.slice(0, replacement.start) + replacement.value + after.slice(replacement.end);
    }
    if (splitMarkdown(after).body !== bodyBefore) throw new Error(`Reviewed edit changed the source body for ${accepted.id}; nothing was written.`);
    if (after === before) {
      unchanged += 1;
    } else {
      await writeFile(path, after, "utf8");
      updated += 1;
    }
  }
  return { updated, unchanged };
}
