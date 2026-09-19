import { legacyPostRedirects, legacyTagRedirects } from "./legacy-post-redirects";
import { publicationRedirects } from "./publication-redirects";

const workIds = [
  "ai-vayfu-i-virtualnye-pomoschniki", "arka-vyatskogo-kremlya", "audiospektakl-saltykiada",
  "chertezhi-tekhdiplomy", "ermil-kostrov", "katalog-promyshlennoy-arkhitektury", "lending-prilozheniya-logoped-buduschego",
  "dver-kotoraya-zhdyot", "maslenitsa-v-slobodskom", "prepodavanie-metodicheskaya-rabota-i-prodakshn-v-tsifrovykh-kafedrakh",
  "rabota-k-yubileyu-goroda", "sayt-advokata-antona-okulova",
  "rubyspot",
  "sayt-programmy-razvitiya-vyatgu-na-2021-2030-gody",
  "sayt-regionalnogo-tsentra-finansovoy-gramotnosti-kirovskoy-oblasti",
  "sayt-vserossiyskogo-foruma-inklyuzivnogo-vysshego-obrazovaniya", "sistema-sbora-i-analiza-trendov-na-n8n",
  "tsifrovoy-sad-staniverse-xyz", "video-dlya-regionalnogo-operatora-po-obrascheniyu-s-tko",
  "virtualnyy-ofis-advokata", "ya-obmanyvat-sebya-ne-stanu",
];

const projectIds = [
  "albina", "metavyatka", "mnemoform", "omnipub", "open-relational-lab",
  "staniverse", "ya-ty-gorod", "zapovednaya-vyatka-360",
];

/**
 * Every URL the previous Quartz site published keeps working after the cutover.
 *
 * Curated entries cover the section routes that changed shape; `/garden/posts/*`
 * and `/tags/*` come from the generated map (see scripts/build-legacy-redirects.ts),
 * because those 594 post URLs and 190 tag URLs are derived from the published index.
 * `/works/` and `/garden/` are real routes here, so their old `index` file names need none.
 * `/garden/telegram/tg-<id>` entries come from the materialized albums themselves
 * (see publication-redirects.ts), because a Telegram album publishes one page while the
 * ids it absorbed keep their former address.
 */
export const legacyRedirects = new Map<string, string>([
  ...Object.entries(publicationRedirects()),
  ...workIds.map((id) => [`works/cases/${id}`, `/works/${id}/`] as const),
  ...projectIds.map((id) => [`lab/${id}`, `/projects/${id}/`] as const),
  ...Object.entries(legacyPostRedirects),
  ...Object.entries(legacyTagRedirects),
  // Merged entities: both the old `works/cases/*` alias and the work URL published
  // before the merge keep working and point at the canonical record.
  ["works/cases/avtomaticheskiy-kanal-dlya-proekta-chertezhi", "/works/chertezhi-tekhdiplomy/"],
  ["works/avtomaticheskiy-kanal-dlya-proekta-chertezhi", "/works/chertezhi-tekhdiplomy/"],
  ["works/cases/prodakshn-dlya-staniverse", "/projects/staniverse/"],
  ["works/prodakshn-dlya-staniverse", "/projects/staniverse/"],
  ["works/cases/prodakshn-dlya-ya-ty-gorod", "/projects/ya-ty-gorod/"],
  ["works/prodakshn-dlya-ya-ty-gorod", "/projects/ya-ty-gorod/"],
  ["works/cases/sayt-proekta-ya-ty-gorod", "/projects/ya-ty-gorod/"],
  ["works/sayt-proekta-ya-ty-gorod", "/projects/ya-ty-gorod/"],
  ["works/otborochnaya-rabota-artmasters", "/works/dver-kotoraya-zhdyot/"],
  ["works/tsifrovaya-stsenografiya-dlya-nomera-na-artmasters", "/works/ya-obmanyvat-sebya-ne-stanu/"],
  ["lab/parametrick", "/projects/mnemoform/"],
  // «Тяга» была записью в каталоге работ, затем проектом и наконец экспериментом:
  // оба прежних адреса ведут на страницу опыта в лаборатории.
  ["works/cases/tyaga", "/experiments/tyaga/"],
  ["projects/tyaga", "/experiments/tyaga/"],
  ["articles/ii-vayfu-na-14-fevralya-instruktsii-po-primeneniyu-i-sozdaniyu", "/articles/ai-waifu/"],
  ["articles/kak-ya-zaschitil-diplom-na-otlichno-s-pomoschyu-ii-agentov-i-sistemy-znaniy", "/articles/ai-diploma/"],
  ["articles", "/garden/"],
  ["contacts", "/contacts/"], ["profile", "/about/"], ["manifesto", "/manifesto/"], ["articles/manifesto", "/manifesto/"], ["donaty", "/donate/"],
]);
