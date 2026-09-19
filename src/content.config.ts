import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const relationType = z.enum([
  "mentions",
  "references",
  "documents",
  "develops",
  "inspired",
  "uses",
  "uses-result",
  "part-of",
  "contains-video",
  "client",
  "grew-from",
  "continues",
  "reply-to",
  "derived-from",
  "supports",
  "contradicts",
  "related",
]);

const relationEvidence = z.enum([
  "editorial",
  "hyperlink",
  "telegram-reply",
  "telegram-link",
  "continuation",
  "embed",
  "known-public-url",
  "entity",
  "topic",
  "semantic",
  "temporal",
  "manual",
  "frontmatter",
  "source-id",
  "computed",
  "enrichment",
]);

const relationProvenance = z.union([
  z.enum(["manual", "imported", "deterministic", "enrichment", "inferred"]),
  z.object({
    kind: z.enum(["manual", "imported", "deterministic", "enrichment", "inferred"]).optional(),
    source: z.string().optional(),
    sourceId: z.string().optional(),
    messageId: z.union([z.number(), z.string()]).optional(),
    url: z.string().optional(),
    field: z.string().optional(),
    method: z.string().optional(),
    extractor: z.string().optional(),
    version: z.string().optional(),
  }),
]);

const relationReviewStatus = z.enum(["proposed", "accepted", "rejected", "needs-review", "pending", "confirmed", "inferred"]);

const relation = z.object({
  target: z.string(),
  type: relationType,
  evidence: relationEvidence,
  provenance: relationProvenance.optional(),
  confidence: z.number().min(0).max(1).default(1),
  /** Human-readable reason retained from deterministic or reviewed enrichment. */
  explanation: z.string().optional(),
  /** Review state is separate from evidence: an inferred edge may be accepted. */
  reviewStatus: relationReviewStatus.optional(),
  /** `status` is retained as an input alias for older review exports. */
  status: relationReviewStatus.optional(),
});

const common = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  sourceTags: z.array(z.string()).optional(),
  topics: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  relations: z.array(relation).default([]),
  featured: z.boolean().default(false),
  date: z.coerce.date().optional(),
  updated: z.coerce.date().optional(),
});

const works = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/works" }),
  schema: common.extend({
    kind: z.literal("work"),
    year: z.union([z.number(), z.string()]),
    genres: z.array(z.string()),
    role: z.string(),
    client: z.string().optional(),
    features: z.array(z.string()).default([]),
    legacySource: z.string().optional(),
    status: z.enum(["ongoing", "completed"]),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: common.extend({
    kind: z.literal("project"),
    status: z.enum(["idea", "planned", "development", "active", "paused", "completed", "archived"]),
    started: z.union([z.number(), z.string()]).optional(),
    domains: z.array(z.string()),
    // Concept visuals of a project: their own webp files under /media/projects/.
    gallery: z.array(z.object({ src: z.string(), caption: z.string() })).default([]),
    legacySource: z.string().optional(),
  }),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: common.extend({ kind: z.literal("article"), sourceUrl: z.url().optional(), legacySource: z.string().optional() }),
});

const publications = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/publications" }),
  schema: common.extend({
    kind: z.enum(["telegram-post", "telegram-article", "youtube-video", "video"]),
    sourceUrl: z.url(),
    sourceId: z.string(),
    threadIds: z.array(z.string()).default([]),
    media: z.array(z.object({ sourcePath: z.string(), publicPath: z.string().optional(), type: z.enum(["image", "video", "audio", "document"]), messageId: z.number() })).default([]),
    platform: z.enum(["youtube", "vk", "telegram"]).optional(),
    videoId: z.string().optional(),
    format: z.enum(["video", "short", "stream", "embed"]).optional(),
    embedUrl: z.url().optional(),
    // Local poster copies (fetched by pipeline/fetch-video-posters.ts) or the CDN URL.
    thumbnailUrl: z.union([z.url(), z.string().regex(/^\/media\//)]).optional(),
    channel: z.object({ key: z.string(), handle: z.string().optional(), platform: z.enum(["youtube", "vk"]) }).optional(),
    channelId: z.string().optional(),
    verification: z.object({
      status: z.enum(["verified", "pending", "external"]),
      reason: z.string(),
      evidence: z.array(z.object({ kind: z.enum(["local-link", "channel-page", "manifest"]), path: z.string(), url: z.url() })),
    }).optional(),
    // `own` is accepted only for legacy entries; the verifier/materializer never emits it.
    ownership: z.enum(["verified", "pending", "external", "own"]).optional(),
  }),
});

export const collections = { works, projects, articles, publications };
