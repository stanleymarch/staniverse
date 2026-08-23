(() => {
  const source = document.querySelector("#garden-records"),
    list = document.querySelector("[data-garden-list]");
  if (!source || !list) return;
  const records = JSON.parse(source.textContent || "[]"),
    search = document.querySelector("[data-garden-search]"),
    count = document.querySelector("[data-result-count]"),
    active = document.querySelector("[data-active-filters]"),
    more = document.querySelector("[data-garden-more]"),
    empty = document.querySelector("[data-garden-empty]"),
    layout = document.querySelector(".garden-layout"),
    facets = document.querySelector("[data-garden-facets]");
  let limit = 24;
  const selected = (s) =>
      [...document.querySelectorAll(s + ":checked")].map((i) => i.value),
    esc = (v) =>
      String(v).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      ),
    date = (v) =>
      v
        ? new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(new Date(v))
        : "";
  function filtered() {
    const q = (search?.value || "").trim().toLocaleLowerCase("ru-RU"),
      k = selected("[data-kind-filter]"),
      c = selected("[data-channel-filter]"),
      t = selected("[data-topic-filter]"),
      m = document.querySelector("[data-media-filter]:checked");
    return records.filter((r) => {
      const hay = [r.title, r.summary, ...r.topics.map((x) => x.label)]
        .join(" ")
        .toLocaleLowerCase("ru-RU");
      return (
        (!q || hay.includes(q)) &&
        (!k.length || k.includes(r.kind)) &&
        (!c.length || c.includes(r.channelKey)) &&
        (!t.length || t.every((x) => r.topics.some((y) => y.id === x))) &&
        (!m || r.media > 0 || r.thumbnail)
      );
    });
  }
  function render() {
    const result = filtered(),
      visible = result.slice(0, limit);
    list.innerHTML = visible
      .map(
        (r) =>
          `<a class="garden-row${r.thumbnail ? " has-thumbnail" : ""}" href="${esc(r.href)}"><div class="garden-row-meta">${r.thumbnail ? `<img class="garden-row-thumbnail" src="${esc(r.thumbnail)}" alt="" loading="lazy" width="320" height="180">` : ""}<span>${esc(r.channelLabel || r.kindLabel)}</span></div><div><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p><div class="garden-row-topics">${r.topics
            .slice(0, 4)
            .map((t) => `<span>${esc(t.label)}</span>`)
            .join(
              "",
            )}</div></div><time class="garden-row-date" datetime="${esc(r.date)}">${esc(date(r.date))}</time></a>`,
      )
      .join("");
    count.textContent = `${result.length} материалов`;
    const terms = [
      ...selected("[data-kind-filter]"),
      ...selected("[data-channel-filter]"),
      ...selected("[data-topic-filter]"),
    ];
    active.textContent = terms.length
      ? `Выбрано фильтров: ${terms.length}`
      : "Все темы и форматы";
    empty.hidden = result.length > 0;
    more.hidden = visible.length >= result.length;
    const url = new URL(location.href),
      q = (search?.value || "").trim();
    q ? url.searchParams.set("q", q) : url.searchParams.delete("q");
    history.replaceState(null, "", url);
    document.dispatchEvent(
      new CustomEvent("garden:results", { detail: { records: result } }),
    );
  }
  document.addEventListener("change", (e) => {
    if (
      e.target.matches(
        "[data-kind-filter],[data-channel-filter],[data-topic-filter],[data-media-filter]",
      )
    ) {
      limit = 24;
      render();
    }
  });
  search?.addEventListener("input", () => {
    limit = 24;
    render();
  });
  more?.addEventListener("click", () => {
    limit += 24;
    render();
  });
  document
    .querySelector("[data-garden-reset]")
    ?.addEventListener("click", () => {
      document
        .querySelectorAll(
          "[data-kind-filter],[data-channel-filter],[data-topic-filter],[data-media-filter]",
        )
        .forEach((i) => (i.checked = false));
      if (search) search.value = "";
      limit = 24;
      render();
    });
  document
    .querySelector("[data-filter-toggle]")
    ?.addEventListener("click", (e) => {
      const open = facets?.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", String(!!open));
    });
  document.querySelectorAll("[data-garden-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      document
        .querySelectorAll("[data-garden-mode]")
        .forEach((i) => i.classList.toggle("active", i === b));
      layout?.classList.toggle("map-active", b.dataset.gardenMode === "map");
      layout?.classList.toggle("feed-active", b.dataset.gardenMode === "feed");
    }),
  );
  const q = new URL(location.href).searchParams.get("q");
  if (q && search) search.value = q;
  render();
})();
