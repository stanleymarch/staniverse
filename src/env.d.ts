/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_YANDEX_METRIKA_ID?: string;
  readonly YANDEX_WEBMASTER_VERIFICATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
