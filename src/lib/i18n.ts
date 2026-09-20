/**
 * Central RU↔EN route pairs. Base.astro turns these into hreflang clusters
 * (ru, en, x-default) and sitemap.xml.ts into xhtml:link alternates, so a page
 * gains a translated twin by adding one row here — never by editing templates.
 *
 * Only pairs where BOTH sides exist may be listed: partial hreflang clusters
 * are worse than none.
 */
export interface LanguageAlternate {
  ru: string;
  en: string;
}

export const languageAlternates: LanguageAlternate[] = [
  { ru: "/", en: "/en/" },
  { ru: "/works/", en: "/en/works/" },
  { ru: "/projects/", en: "/en/projects/" },
  { ru: "/projects/metavyatka/", en: "/en/projects/metavyatka/" },
  { ru: "/projects/ya-ty-gorod/", en: "/en/projects/ya-ty-gorod/" },
  { ru: "/projects/mnemoform/", en: "/en/projects/mnemoform/" },
  { ru: "/projects/staniverse/", en: "/en/projects/staniverse/" },
  { ru: "/works/ai-vayfu-i-virtualnye-pomoschniki/", en: "/en/works/ai-vayfu-i-virtualnye-pomoschniki/" },
  { ru: "/works/arka-vyatskogo-kremlya/", en: "/en/works/arka-vyatskogo-kremlya/" },
  { ru: "/works/audiospektakl-saltykiada/", en: "/en/works/audiospektakl-saltykiada/" },
  { ru: "/works/chertezhi-tekhdiplomy/", en: "/en/works/chertezhi-tekhdiplomy/" },
  { ru: "/works/dver-kotoraya-zhdyot/", en: "/en/works/dver-kotoraya-zhdyot/" },
  { ru: "/works/ermil-kostrov/", en: "/en/works/ermil-kostrov/" },
  { ru: "/works/katalog-promyshlennoy-arkhitektury/", en: "/en/works/katalog-promyshlennoy-arkhitektury/" },
  { ru: "/works/lending-prilozheniya-logoped-buduschego/", en: "/en/works/lending-prilozheniya-logoped-buduschego/" },
  { ru: "/works/maslenitsa-v-slobodskom/", en: "/en/works/maslenitsa-v-slobodskom/" },
  { ru: "/works/prepodavanie-metodicheskaya-rabota-i-prodakshn-v-tsifrovykh-kafedrakh/", en: "/en/works/prepodavanie-metodicheskaya-rabota-i-prodakshn-v-tsifrovykh-kafedrakh/" },
  { ru: "/works/rabota-k-yubileyu-goroda/", en: "/en/works/rabota-k-yubileyu-goroda/" },
  { ru: "/works/rubyspot/", en: "/en/works/rubyspot/" },
  { ru: "/works/sayt-advokata-antona-okulova/", en: "/en/works/sayt-advokata-antona-okulova/" },
  { ru: "/works/sayt-programmy-razvitiya-vyatgu-na-2021-2030-gody/", en: "/en/works/sayt-programmy-razvitiya-vyatgu-na-2021-2030-gody/" },
  { ru: "/works/sayt-regionalnogo-tsentra-finansovoy-gramotnosti-kirovskoy-oblasti/", en: "/en/works/sayt-regionalnogo-tsentra-finansovoy-gramotnosti-kirovskoy-oblasti/" },
  { ru: "/works/sayt-vserossiyskogo-foruma-inklyuzivnogo-vysshego-obrazovaniya/", en: "/en/works/sayt-vserossiyskogo-foruma-inklyuzivnogo-vysshego-obrazovaniya/" },
  { ru: "/works/sistema-sbora-i-analiza-trendov-na-n8n/", en: "/en/works/sistema-sbora-i-analiza-trendov-na-n8n/" },
  { ru: "/works/tsifrovoy-sad-staniverse-xyz/", en: "/en/works/tsifrovoy-sad-staniverse-xyz/" },
  { ru: "/works/video-dlya-regionalnogo-operatora-po-obrascheniyu-s-tko/", en: "/en/works/video-dlya-regionalnogo-operatora-po-obrascheniyu-s-tko/" },
  { ru: "/works/virtualnyy-ofis-advokata/", en: "/en/works/virtualnyy-ofis-advokata/" },
  { ru: "/works/ya-obmanyvat-sebya-ne-stanu/", en: "/en/works/ya-obmanyvat-sebya-ne-stanu/" },
  { ru: "/projects/albina/", en: "/en/projects/albina/" },
  { ru: "/projects/lichnoe-delo/", en: "/en/projects/lichnoe-delo/" },
  { ru: "/projects/loci/", en: "/en/projects/loci/" },
  { ru: "/projects/nearventure/", en: "/en/projects/nearventure/" },
  { ru: "/projects/omnipub/", en: "/en/projects/omnipub/" },
  { ru: "/projects/open-relational-lab/", en: "/en/projects/open-relational-lab/" },
  { ru: "/projects/zapovednaya-vyatka-360/", en: "/en/projects/zapovednaya-vyatka-360/" },
  { ru: "/about/", en: "/en/about/" },
  { ru: "/contacts/", en: "/en/contacts/" },
  { ru: "/lab/", en: "/en/lab/" },
  { ru: "/experiments/knockdown/", en: "/en/experiments/knockdown/" },
  { ru: "/experiments/parametrick/", en: "/en/experiments/parametrick/" },
  { ru: "/experiments/portal/", en: "/en/experiments/portal/" },
  { ru: "/experiments/sea-battle/", en: "/en/experiments/sea-battle/" },
  { ru: "/experiments/stansim/", en: "/en/experiments/stansim/" },
  { ru: "/experiments/tyaga/", en: "/en/experiments/tyaga/" },
  { ru: "/articles/ai-waifu/", en: "/en/articles/ai-waifu/" },
  { ru: "/articles/ai-diploma/", en: "/en/articles/ai-diploma/" },
];

export type AlternateLink = { lang: "ru" | "en"; href: string };

/** Alternates for a pathname, RU first; empty when the page has no twin yet. */
export function alternatesFor(pathname: string): AlternateLink[] {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const pair = languageAlternates.find((item) => item.ru === normalized || item.en === normalized);
  return pair ? [{ lang: "ru", href: pair.ru }, { lang: "en", href: pair.en }] : [];
}
