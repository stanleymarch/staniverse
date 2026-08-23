import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://staniverse.xyz",
  output: "static",
  build: { format: "directory" },
  markdown: { shikiConfig: { theme: "github-dark" } },
});
