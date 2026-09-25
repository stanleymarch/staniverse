export const CARD_PORTAL = {
  /** The one card file the portal fetches at runtime. */
  targetSrc: "/card/targets/card-target-dev.mind",
  /** Source artwork of the compiled target, measured at build time only; kept out of `public/`. */
  targetAspectSource: "design/card/targets/card-target-source-dev.png",
  /** Only used when the source artwork cannot be measured at build time. */
  targetAspectFallback: 85 / 55,
  portalScale: 0.82,
  lostDelayMs: 700,
  resetDelayMs: 30_000,
  foregroundLimit: 14,
  backgroundLimit: 120,
  edgeLimit: 32,
  curatedIds: [
    "project:loci",
    "project:nearventure",
    "project:metavyatka",
    "project:omnipub",
    "project:mnemoform",
    "experiment:reality-field",
    "experiment:city-orbit",
    "experiment:sound-space",
    "experiment:echo-room",
    "work:virtualnyy-ofis-advokata",
    "work:arka-vyatskogo-kremlya",
    "work:maslenitsa-v-slobodskom",
    "work:ya-obmanyvat-sebya-ne-stanu",
  ],
  topicIds: ["topic:ai", "topic:xr", "topic:place-heritage", "topic:agents-automation", "topic:games", "topic:sound"],
} as const;

export type CardQuality = "high" | "medium" | "low";
