/**
 * Display copy reads without a final full stop.
 *
 * A period closes a sentence; a lead, a card blurb or a caption is not a
 * sentence but a label for what surrounds it. Interface style guides agree
 * (Apple: no period in a title, headline or single-sentence fragment; GOV.UK and
 * Mailchimp: full stops in sentences, none in headings, labels and buttons), and
 * on a wall of cards the terminal dots add up to a dotted rhythm that fights the
 * layout instead of carrying meaning.
 *
 * The rule stops at running text. Article bodies, publication originals and the
 * sentence slots built from them — meta description, og:description, RSS,
 * JSON-LD — keep the author's punctuation, so they never pass through here.
 */

/** A stop that closes one of these is not a sentence stop: "и др.", "см. рис.". */
const ABBREVIATIONS: Record<string, true> = { др: true, рис: true, см: true, стр: true, руб: true, коп: true, тыс: true, гг: true, вв: true };

export const withoutTrailingStop = (value: string): string => {
  /* Only a stop that follows a word: ellipses and "…" belong to the author. */
  if (!/(?:^|[^.\s])\.$/.test(value)) return value;
  /* One-letter tokens are abbreviations too: "т. д.", "А. С.", "см. с.". */
  const token = value.slice(0, -1).split(/[\s(«"]/).pop()?.toLocaleLowerCase("ru-RU") ?? "";
  if (token.length <= 1 || ABBREVIATIONS[token]) return value;
  return value.slice(0, -1);
};
