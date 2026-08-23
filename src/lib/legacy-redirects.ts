const workIds = [
  "ai-vayfu-i-virtualnye-pomoschniki", "arka-vyatskogo-kremlya", "avtomaticheskiy-kanal-dlya-proekta-chertezhi",
  "chertezhi-tekhdiplomy", "ermil-kostrov", "katalog-promyshlennoy-arkhitektury", "lending-prilozheniya-logoped-buduschego",
  "otborochnaya-rabota-artmasters", "prepodavanie-metodicheskaya-rabota-i-prodakshn-v-tsifrovykh-kafedrakh",
  "prodakshn-dlya-staniverse", "prodakshn-dlya-ya-ty-gorod", "rabota-k-yubileyu-goroda", "sayt-advokata-antona-okulova",
  "sayt-programmy-razvitiya-vyatgu-na-2021-2030-gody", "sayt-proekta-ya-ty-gorod",
  "sayt-regionalnogo-tsentra-finansovoy-gramotnosti-kirovskoy-oblasti",
  "sayt-vserossiyskogo-foruma-inklyuzivnogo-vysshego-obrazovaniya", "sistema-sbora-i-analiza-trendov-na-n8n",
  "tsifrovaya-stsenografiya-dlya-nomera-na-artmasters", "video-dlya-regionalnogo-operatora-po-obrascheniyu-s-tko",
  "virtualnyy-ofis-advokata",
];

export const legacyRedirects = new Map<string, string>([
  ...workIds.map((id) => [`works/cases/${id}`, `/works/${id}/`] as const),
  ["articles/ii-vayfu-na-14-fevralya-instruktsiya-po-primeneniyu-i-sozdaniyu", "/articles/ai-waifu/"],
  ["articles/index", "/garden/"], ["works/index", "/works/"], ["garden/index", "/garden/"],
  ["contacts", "/about/"], ["profile", "/about/"], ["manifesto", "/articles/manifesto/"],
]);
