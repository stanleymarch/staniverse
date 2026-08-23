# Staniverse rebuild design

## Purpose

Build Staniverse from scratch as a public, immersive map of Stanislav's work, own projects, publications, experience, themes, and ideas. The new site must not depend on Obsidian or Quartz. Existing repositories are migration sources only.

## Core distinctions

- **Work** is a completed result for a client, organization, contest, or clearly bounded external task. Works have genres and may be featured.
- **Project** is a self-directed, living system. Projects can be ideas, planned, in development, active, paused, completed, or archived.
- A project remains one living page. It may link to separate work cases when it produces a bounded external or completed result.
- **Publication** covers Telegram posts, Telegram articles, authored long-form articles, and YouTube videos.
- **Topic** and **entity** connect all content types.
- A **dossier** is a generated view of a sufficiently rich cluster, not another manually maintained source file.

## Source of truth

The repository is the only public-content source of truth. Hand-authored pages and metadata live in typed content collections. Telegram and YouTube importers write neutral source records and canonical publications. Generated enrichment is stored separately from authorial text.

## Content policy

- Rewrite and normalize descriptions of works, projects, profile pages, and other permanent editorial pages into a consistent first-person voice.
- Preserve Telegram post wording. Rebuild posts from primary Telegram data with correct formatting, message chains, links, captions, and media references.
- Do not migrate the existing Quartz-generated Telegram Markdown. Use it only to audit completeness and extract regression fixtures for difficult historical cases.
- Use standard Markdown links in bodies and stable typed IDs in structured relationships.
- Preserve legacy URLs through a redirect map.
- Preserve raw imported source data as an immutable archive.

## Import pipeline

The Telegram importer is rewritten without Obsidian concepts. It re-fetches or re-parses primary Telegram history instead of copying the current generated Markdown. The previous implementation supplies algorithms and test fixtures for self-reply chains, explicit continuation links, albums, reply context, entities and hyperlinks, captions, media, and incremental deduplication. It must not create wikilinks, wiki stubs, or Quartz frontmatter. Telegram article records are imported through the current Telegram API and normalized as publications while preserving their source identity.

Pipeline: `raw archive -> normalize -> validate -> enrich -> graph build`.

## Graph model

Every edge has a source, target, type, provenance, and confidence. Explicit replies, hyperlinks, embeds, and manual relations are authoritative. Entity overlap, topics, semantic similarity, temporal proximity, and possible influence are derived signals.

The same graph data powers related-content blocks, filters, dossiers, timelines, the compact local graph on content pages, and the separate fullscreen WebXR experience.

## Experience

The homepage must immediately explain who Stanislav is and expose CV, completed work, own projects, experience, and contact paths. The cinematic graph, generative sound, and spatial interaction are a signature experience, not the entire site.

The fullscreen graph and compact local graph are separate components with separate interaction models. The fullscreen view supports exploration and later WebXR. The local graph only explains the immediate context of one item.

## Technology

- Astro 6, TypeScript, static output for GitLab Pages.
- Typed Astro content collections.
- Client-side islands only for filtering, graph interaction, sound, and WebXR.
- A neutral build-generated graph artifact; no runtime database is required.
- Git-native editing for the first release. A later admin UI may commit to GitLab through OAuth and the repository API without changing the content model.

## First vertical slice

The first verified slice includes representative works, own projects with different statuses, an article, Telegram posts, topic pages, a homepage, works and projects catalogs, publication filtering, related-content data, a compact local graph, and a distinct fullscreen cinematic graph. It also includes a neutral importer prototype and tests for thread construction.

## Verification

- Schema and referential-integrity tests reject invalid types and missing relation targets.
- Importer tests cover reply chains, continuation links, albums, and deduplication.
- Astro type checking and production build pass.
- Browser checks confirm primary navigation, filtering, local graph behavior, fullscreen graph behavior, responsive layout, keyboard access, and reduced-motion behavior.
- A final requirements audit distinguishes demonstrated vertical-slice behavior from later full-corpus migration work.
