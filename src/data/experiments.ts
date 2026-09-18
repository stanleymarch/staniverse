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

export const experiments: Experiment[] = [
  {
    name: "hello-lab",
    title: "Hello, Lab",
    summary: "Пробный запуск конвейера: минимальная страница, которая собирается из experiments/hello-lab и уезжает в бакет тем же git-пушем, что и остальные эксперименты.",
    stack: ["HTML", "vanilla JS"],
    status: "live",
    href: "/lab/hello-lab/",
  },
  {
    name: "building-blocks",
    title: "Google Building Blocks",
    summary: "WebXR-сцена на блоках Google Building Block: собранная в эксперименте пространственная механика, доступная прямо из браузера со шлемом.",
    stack: ["WebXR", "three.js"],
    status: "soon",
  },
  {
    name: "meta-sdk",
    title: "Meta XR SDK",
    summary: "Демо возможностей Meta XR SDK в браузере: контроллеры, руки и сцена — шаг к прототипам следующей Вселенной.",
    stack: ["WebXR", "Meta XR SDK"],
    status: "soon",
  },
];
