# Staniverse visual reference analysis v1

These images define composition and interaction hierarchy only. Generated portraits, media, titles, dates, counts and project names are placeholders and must never enter canonical content.

## Homepage

Source: `homepage-v1.png`

- Priority is correct: identity and commissioned work/project navigation are visible before the Universe portal.
- The 40/60 asymmetric hero keeps author copy readable while the spatial visual provides a signature.
- A single thin cyan accent is sufficient for the primary CTA, spatial focal point and small interactive states.
- The first screen is too dense vertically for a 768px-tall laptop if capabilities remain inside the hero. Implementation should keep only identity, CTAs and media above the fold; capabilities start immediately below.
- The generated portrait is not the author and must be replaced with a verified existing portrait or an explicitly approved new portrait.
- The generated project/work titles are not data. Canonical titles and media come from the content audit.
- Typography target: display approximately `clamp(3rem, 6vw, 6.5rem)`, body 16-19px, reading line height 1.5-1.65. Mobile headline must stay within two visual lines.
- The horizontal timeline is useful on desktop but should become a compact vertical timeline below 768px.
- Selected Works and Projects need stronger content differentiation: editorial media-led commissioned cases versus status-led project rows.

## Garden

Source: `garden-v1.png`

- The three-zone hierarchy works: facet rail, results, contextual map. The map is a catalogue aid, not the Universe.
- Filters are explicit and multi-select. Active state remains visible above results and can be encoded in the URL.
- Catalogue rows are more scannable than the current card wall and can mix entries with or without media.
- Topic badges must remain restrained. Raw Telegram tags are never promoted into this UI automatically.
- Solid cyan edges versus dotted neutral semantic recommendations provide the required provenance distinction, but text labels must accompany color/style.
- At 1024px the graph panel should close into a drawer and filters should become a modal/drawer. At 768px and below, search plus mode switch remain in the main header and all other facets move into one filter control.
- Initial DOM should be bounded to 20-30 results. Pagination or progressive loading is required.
- Generated material titles, counts, dates, thumbnails and ownership labels are illustrative only. Implementation uses canonical records.
- The mockup is slightly too dashboard-like. Implementation should remove the outer panel borders, reduce chips, use more open whitespace and keep only boundaries that explain real filter or graph state.

## Shared tokens inferred

- Page background: near `#050708`; raised surface: `#0b0f12`; subtle surface: `#10161a`.
- Primary text: cool white around `#eef7fb`; secondary text: `#8f9ba3`.
- Accent: cold cyan around `#57c8ff`, used as the only persistent accent.
- Borders: cool white at 10-16% opacity, generally one-sided rather than boxing every row.
- Shape: 0-6px radius for editorial surfaces, 8-10px only for controls/media; no giant rounded wrappers.
- Motion: 160-240ms for controls, 350-600ms for editorial reveal, longer motion reserved for Universe focus/flight.
- Minimum interactive target: 44x44px. Visible focus ring uses cyan plus an off-black offset.

## Required next references

Before implementing page templates, generate standalone references for Work/Project, Telegram Article with inline media, local graph and Universe. Each reference must use the same token system and be checked separately at desktop and mobile collapse level.
