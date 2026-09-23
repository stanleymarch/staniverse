import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import { rewriteOutboundLinks } from "./src/lib/content-link-redirects.mjs";
import { embedStandaloneYouTube } from "./src/lib/youtube-embeds.mjs";

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

/**
 * MindAR 1.2.5 is built against the Three.js r137–r162 era (`sRGBEncoding`,
 * pre-color-management renderer flags). The site itself runs current Three, so
 * the AR chunk gets its documented companion version through the `three-mindar`
 * npm alias; this rewrite points MindAR's own bare `three` imports at it. The
 * two runtimes never mix: everything behind `/card/`'s AR session imports
 * `three-mindar`, everything else keeps `three`.
 */
const mindarThreePin = {
  name: "mindar-three-pin",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("mind-ar")) return null;
    const rewritten = code.replace(/(["'])three\/addons\//g, "$1three-mindar/addons/").replace(/(["'])three\1/g, "$1three-mindar$1");
    return rewritten === code ? null : { code: rewritten, map: null };
  },
};
export default defineConfig({
  site,
  base,
  output: "static",
  /* Stylesheets are inlined into every document. As external files they were
     render-blocking: the tab stayed blank for as long as the CSS round trip took,
     which read as a white flash between pages. Inlining paints the first frame
     styled and costs the same total bytes. */
  build: { format: "directory", inlineStylesheets: "always" },
  vite: { plugins: [mindarThreePin], optimizeDeps: { exclude: ["mind-ar"] } },
  markdown: { shikiConfig: { theme: "github-dark" }, processor: unified({ rehypePlugins: [rewriteOutboundLinks, embedStandaloneYouTube] }) },
  /* Hovering a link starts fetching its document, so a click paints the next page
     from cache instead of waiting a round trip on a dark canvas. */
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
