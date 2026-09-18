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
];

export type AlternateLink = { lang: "ru" | "en"; href: string };

/** Alternates for a pathname, RU first; empty when the page has no twin yet. */
export function alternatesFor(pathname: string): AlternateLink[] {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const pair = languageAlternates.find((item) => item.ru === normalized || item.en === normalized);
  return pair ? [{ lang: "ru", href: pair.ru }, { lang: "en", href: pair.en }] : [];
}
