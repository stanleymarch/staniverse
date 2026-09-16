import { defineConfig } from "astro/config";

/**
 * Deployment identity.
 *
 * Production keeps the canonical root domain and an empty base path, so the
 * local build and the GitLab Pages build are root-based exactly as before.
 * The GitHub Pages preview overrides both variables with the project-site URL
 * reported by actions/configure-pages (see .github/workflows/pages.yml), which
 * is why no second config file or duplicated site is needed.
 *
 * `site` may include the base path (Pages' `base_url` output does); Astro uses
 * only its origin to build page URLs and already carries the base in
 * `Astro.url.pathname`.
 */
const site = process.env.SITE_URL?.trim() || "https://staniverse.xyz";
const base = process.env.BASE_PATH?.trim() || "/";

export default defineConfig({
  site,
  base,
  output: "static",
  build: { format: "directory" },
  markdown: { shikiConfig: { theme: "github-dark" } },
});
