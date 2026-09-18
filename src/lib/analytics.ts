/** Public build-time configuration. Empty means analytics is not shipped. */
const rawCounterId = (import.meta.env.PUBLIC_YANDEX_METRIKA_ID ?? "").trim();

if (rawCounterId && !/^\d+$/.test(rawCounterId)) {
  console.warn("[analytics] PUBLIC_YANDEX_METRIKA_ID must contain digits only; Yandex Metrica is disabled.");
}

export const metrikaCounterId = /^\d+$/.test(rawCounterId) ? rawCounterId : "";
export const webmasterVerification = (import.meta.env.YANDEX_WEBMASTER_VERIFICATION ?? "").trim();
export const analyticsEnabled = metrikaCounterId.length > 0;
