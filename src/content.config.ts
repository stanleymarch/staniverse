import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const relation = z.object({
  target: z.string(),
  type: z.enum(["mentions", "documents", "develops", "inspired", "uses", "part-of", "related"]),
  evidence: z.enum(["editorial", "hyperlink", "telegram-reply", "entity", "topic", "semantic", "temporal"]),
  confidence: z.number().min(0).max(1).default(1),
});

const common = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
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
    status: z.literal("completed"),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: common.extend({
    kind: z.literal("project"),
    status: z.enum(["idea", "planned", "development", "active", "paused", "completed", "archived"]),
    started: z.union([z.number(), z.string()]).optional(),
    domains: z.array(z.string()),
  }),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: common.extend({ kind: z.literal("article"), sourceUrl: z.url().optional() }),
});

const publications = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/publications" }),
  schema: common.extend({
    kind: z.enum(["telegram-post", "telegram-article", "youtube-video"]),
    sourceUrl: z.url(),
    sourceId: z.string(),
    threadIds: z.array(z.string()).default([]),
    media: z.array(z.object({ sourcePath: z.string(), type: z.enum(["image", "video", "audio", "document"]), messageId: z.number() })).default([]),
  }),
});

export const collections = { works, projects, articles, publications };
