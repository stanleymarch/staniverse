/**
 * One branded 1200×630 card per section, rendered by `scripts/gen-og.mjs` into
 * `dist/og/` on every build.
 *
 * Both consumers read this map: `Base.astro` for `og:image` and `EntryPage.astro`
 * for the `image` of the page's JSON-LD node. They used to carry a copy each, so
 * the page and its structured data could advertise different files — the card
 * renamed from `experiments.png` to `lab.png` is exactly what that drift cost.
 */
export const sectionOgImages: Record<string, string> = {
  works: "/og/works.png",
  projects: "/og/projects.png",
  garden: "/og/garden.png",
  videos: "/og/videos.png",
  topics: "/og/topics.png",
  articles: "/og/articles.png",
  about: "/og/about.png",
  universe: "/og/universe.png",
  donate: "/og/donate.png",
  contacts: "/og/contacts.png",
  manifesto: "/og/manifesto.png",
  licenses: "/og/licenses.png",
  privacy: "/og/privacy.png",
  lab: "/og/lab.png",
  /* Experiments are chapters of the lab and share its card. */
  experiments: "/og/lab.png",
};

export const defaultOgImage = "/og/staniverse.png";

/** Card for a URL section, falling back to the site-wide one. */
export const ogImageFor = (section: string | undefined): string =>
  (section && sectionOgImages[section]) || defaultOgImage;
