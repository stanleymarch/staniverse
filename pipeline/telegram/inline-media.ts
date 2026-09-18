import type { CanonicalMedia, CanonicalPublication } from "./types";

function singleMedia(item: CanonicalMedia) {
  if (!item.publicPath) return "";
  if (item.type === "image") return `![Иллюстрация из Telegram Article](${item.publicPath})`;
  if (item.type === "video") return `<video class="telegram-inline-media" controls preload="metadata" src="${item.publicPath}">Видео из Telegram Article</video>`;
  if (item.type === "audio") return `<audio class="telegram-inline-media" controls preload="metadata" src="${item.publicPath}">Аудио из Telegram Article</audio>`;
  return `[Документ из Telegram Article](${item.publicPath})`;
}

function imageCarousel(items: CanonicalMedia[]) {
  const slides = items.map((item, index) => `<figure class="media-carousel-slide" data-carousel-slide><a href="${item.publicPath}"><img src="${item.publicPath}" alt="Иллюстрация из Telegram Article · изображение ${index + 1}" loading="${index > 0 ? "lazy" : "eager"}" decoding="async"></a><figcaption>${index + 1} / ${items.length}</figcaption></figure>`).join("");
  const dots = items.map((_, index) => `<button type="button" data-carousel-dot="${index}" aria-label="Фото ${index + 1}" aria-current="${index === 0 ? "true" : "false"}"></button>`).join("");
  return `<section class="media-carousel telegram-article-carousel" data-media-carousel aria-label="Фотографии Telegram-статьи · ${items.length}"><div class="media-carousel-viewport" data-carousel-viewport><div class="media-carousel-track">${slides}</div></div><div class="media-carousel-controls"><button type="button" data-carousel-prev aria-label="Предыдущее фото">←</button><div class="media-carousel-dots" aria-label="Выбрать фото">${dots}</div><output data-carousel-status aria-live="polite">1 / ${items.length}</output><button type="button" data-carousel-next aria-label="Следующее фото">→</button></div></section>`;
}

export function inlineTelegramMedia(body: string, publication: CanonicalPublication) {
  const bySource = new Map(publication.media.filter((item) => item.publicPath).map((item) => [item.sourcePath, item]));
  const grouped = body.replace(/(?:<!--telegram-media:[^>]+-->\s*){2,}/g, (run) => {
    const items = [...run.matchAll(/<!--telegram-media:([^>]+)-->/g)]
      .map((match) => bySource.get(decodeURIComponent(match[1])))
      .filter((item): item is CanonicalMedia => Boolean(item?.publicPath));
    if (items.length > 1 && items.every((item) => item.type === "image")) return `\n\n${imageCarousel(items)}\n\n`;
    return items.map(singleMedia).filter(Boolean).join("\n\n");
  });
  return grouped.replace(/<!--telegram-media:([^>]+)-->/g, (_match, encoded: string) => {
    const item = bySource.get(decodeURIComponent(encoded));
    return item ? singleMedia(item) : "";
  });
}
