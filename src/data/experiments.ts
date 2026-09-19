/**
 * The lab directory: standalone web experiments that live outside the Astro site.
 *
 * Two shipping schemes coexist. An experiment may be built from experiments/<name>/
 * in this monorepo and synced into the bucket under /lab/<name>/ (see
 * .github/workflows/lab.yml and docs/deploy/yandex-object-storage.md); or it may
 * live in a repository of its own and be published elsewhere — then `repo` points
 * at the code and `href` at the address the thing actually runs on. Either way the
 * page below never hardcodes markup.
 *
 * The facets are deliberately wider than games: an experiment may be an
 * application rather than a game, may run on headsets rather than on phones, and
 * may carry AI or a backend. A facet is a free-form string; the vocabularies below
 * are derived from the rows, so the first AI application adds "ИИ" to the filters
 * simply by existing.
 */
export interface Experiment {
  /** Experiment slug: the folder name in experiments/, or the name the external build goes by. */
  name: string;
  title: string;
  summary: string;
  /** Technologies: 8th Wall, A-Frame, three.js, cannon-es, WebAudio, RAG… */
  stack: string[];
  /** What the thing is: игра, песочница, приложение, инструмент, демо SDK. */
  types: string[];
  /** Where it runs: мобильные, гарнитуры, десктоп. */
  platforms: string[];
  /** What it can do beyond rendering: ИИ, бэкенд, физика, звук, мультиплеер. */
  capabilities: string[];
  /** 1 — одна механика, 2 — механика со счётом или физикой, 3 — несколько состояний и прогрессия. */
  complexity: ExperimentComplexity;
  status: "live" | "soon";
  /** Where the experiment runs: /lab/<name>/ for in-repo builds, an absolute address for external ones. */
  href?: string;
  /** Source repository when the experiment lives outside this monorepo. */
  repo?: string;
}

export type ExperimentComplexity = 1 | 2 | 3;

/** The same three words the filter buttons read, so a card and a chip never disagree. */
export const complexityLabels: Record<ExperimentComplexity, string> = {
  1: "Простая",
  2: "Средняя",
  3: "Сложная",
};

/**
 * Three AR experiments on 8th Wall. They share one repository of their own
 * (github.com/stanleymarch/ar-experiments), build to static output and are
 * published on GitHub Pages — nothing of them is bundled into this site, the
 * cards link out. A row appears here only once the experiment really works:
 * placeholder "coming soon" cards are not published.
 */
export const experiments: Experiment[] = [
  {
    name: "portal",
    title: "Портал",
    summary: "Тап по полу открывает в комнате дверной проём — из него в игрока летят кубы. Зелёные ловят тапом и получают по очку, красные обходят стороной: и тап по красному, и его подлёт к камере отнимают одну из трёх жизней.",
    stack: ["8th Wall", "A-Frame", "three.js"],
    types: ["игра"],
    platforms: ["мобильные"],
    capabilities: [],
    complexity: 2,
    status: "live",
    href: "https://stanleymarch.github.io/ar-experiments/experiments/portal/",
    repo: "https://github.com/stanleymarch/ar-experiments",
  },
  {
    name: "knockdown",
    title: "Knockdown",
    summary: "Физическая песочница: тап по полу ставит на пол пирамиду из пятнадцати кирпичей, дальше тап в любую точку бросает в неё шарик. Счёт внизу ведёт кирпичи, сдвинутые со своего места или заваленные сильнее чем на 44°; когда падают все, пирамиду можно поставить заново.",
    stack: ["8th Wall", "A-Frame", "cannon-es"],
    types: ["песочница"],
    platforms: ["мобильные"],
    capabilities: ["физика"],
    complexity: 2,
    status: "live",
    href: "https://stanleymarch.github.io/ar-experiments/experiments/knockdown/",
    repo: "https://github.com/stanleymarch/ar-experiments",
  },
  {
    name: "sea-battle",
    title: "Морской бой",
    summary: "Советский перископный автомат в дополненной реальности: тап по полу разворачивает акваторию, корабли идут по трём линиям на разной глубине. Тап по морю выпускает торпеду из-под ног — бить нужно с упреждением; за игру даётся десять пусков, а десять попаданий подряд открывают призовую игру с тремя лишними торпедами.",
    stack: ["8th Wall", "A-Frame", "three.js", "WebAudio"],
    types: ["игра"],
    platforms: ["мобильные"],
    capabilities: ["звук"],
    complexity: 3,
    status: "live",
    href: "https://stanleymarch.github.io/ar-experiments/experiments/sea-battle/",
    repo: "https://github.com/stanleymarch/ar-experiments",
  },
];

/* Facet vocabularies are derived from the rows themselves: a new experiment adds
   its own type, platform, capability or technology to the filters just by existing. */
const byLabel = (a: string, b: string) => a.localeCompare(b, "ru");
const vocabulary = (values: string[]) => [...new Set(values)].sort(byLabel);

export const typeFacets = vocabulary(experiments.flatMap((item) => item.types));
export const platformFacets = vocabulary(experiments.flatMap((item) => item.platforms));
export const capabilityFacets = vocabulary(experiments.flatMap((item) => item.capabilities));
export const stackFacets = vocabulary(experiments.flatMap((item) => item.stack));
export const complexityFacets = ([3, 2, 1] as const).filter((level) => experiments.some((item) => item.complexity === level));
