/**
 * The lab directory: standalone web experiments that live outside the Astro site
 * and deploy straight into the bucket under /lab/<name>/ (see
 * .github/workflows/lab.yml and docs/deploy/yandex-object-storage.md).
 *
 * An experiment earns a row here when it has a folder in experiments/<name>/
 * that builds static output into dist/ — the page below never hardcodes markup.
 */
export interface Experiment {
  /** Folder name in experiments/; also the public path segment. */
  name: string;
  title: string;
  summary: string;
  stack: string[];
  status: "live" | "soon";
  /** Public URL once deployed; keep the /lab/<name>/ convention. */
  href?: string;
  /** Source repository when the experiment lives outside this monorepo. */
  repo?: string;
}

/**
 * Empty on purpose: a row appears here only when a real, working experiment
 * ships in experiments/<name>/. Placeholder "coming soon" cards are not
 * published — the lab pipeline (lab.yml) stays warm regardless.
 */
export const experiments: Experiment[] = [];
