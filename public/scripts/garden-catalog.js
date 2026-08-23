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
    facets = document.querySelector("[data-garden-facets]"),
    filterToggle = document.querySelector("[data-filter-toggle]");
  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "garden-filter-backdrop";
  backdrop.setAttribute("aria-label", "Закрыть фильтры");
  backdrop.hidden = true;
  document.body.append(backdrop);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "garden-filter-close";
  closeButton.textContent = "Закрыть ×";
  facets?.querySelector(".garden-facet-head")?.append(closeButton);
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
        (!t.length || t.some((x) => r.topics.some((y) => y.id === x))) &&
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
            .map((t) => `<span class="${t.origin === "automatic" ? "is-automatic" : "is-source"}" title="${t.origin === "automatic" ? "Автоматическая тематическая гипотеза" : "Авторский или редакторский тег"}">${esc(t.label)}</span>`)
            .join(
              "",
            )}</div></div><time class="garden-row-date" datetime="${esc(r.date)}">${esc(date(r.date))}</time></a>`,
      )
      .join("");
    count.textContent = `${result.length} материалов`;
    const checked = [...document.querySelectorAll("[data-kind-filter]:checked,[data-channel-filter]:checked,[data-topic-filter]:checked,[data-media-filter]:checked")];
    active.replaceChildren();
    if (!checked.length) active.textContent = "Все темы и форматы";
    checked.forEach((input) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "garden-filter-chip";
      chip.textContent = `${input.closest("label")?.textContent?.trim().replace(/\s+\d+$/, "") || input.value} ×`;
      chip.addEventListener("click", () => { input.checked = false; limit = 24; render(); });
      active.append(chip);
    });
    filterToggle.textContent = checked.length ? `Фильтры · ${checked.length}` : "Фильтры";
    empty.hidden = result.length > 0;
    more.hidden = visible.length >= result.length;
    const url = new URL(location.href),
      q = (search?.value || "").trim();
    q ? url.searchParams.set("q", q) : url.searchParams.delete("q");
    [["kind", selected("[data-kind-filter]")], ["channel", selected("[data-channel-filter]")], ["topic", selected("[data-topic-filter]")]].forEach(([key, values]) => values.length ? url.searchParams.set(key, values.join(",")) : url.searchParams.delete(key));
    document.querySelector("[data-media-filter]:checked") ? url.searchParams.set("media", "1") : url.searchParams.delete("media");
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
  const setFacetsOpen = (open) => {
    facets?.classList.toggle("open", open);
    filterToggle?.setAttribute("aria-expanded", String(open));
    backdrop.hidden = !open;
    document.documentElement.classList.toggle("garden-filters-open", open);
  };
  filterToggle?.addEventListener("click", () => setFacetsOpen(!facets?.classList.contains("open")));
  backdrop.addEventListener("click", () => setFacetsOpen(false));
  closeButton.addEventListener("click", () => setFacetsOpen(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setFacetsOpen(false); });
  document.querySelectorAll("[data-garden-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      document
        .querySelectorAll("[data-garden-mode]")
        .forEach((i) => i.classList.toggle("active", i === b));
      layout?.classList.toggle("map-active", b.dataset.gardenMode === "map");
      layout?.classList.toggle("feed-active", b.dataset.gardenMode === "feed");
      const url = new URL(location.href);
      url.searchParams.set("mode", b.dataset.gardenMode);
      history.replaceState(null, "", url);
    }),
  );
  const initialUrl = new URL(location.href);
  const q = initialUrl.searchParams.get("q");
  if (q && search) search.value = q;
  [["kind", "[data-kind-filter]"], ["channel", "[data-channel-filter]"], ["topic", "[data-topic-filter]"]].forEach(([key, selector]) => {
    const values = new Set((initialUrl.searchParams.get(key) || "").split(",").filter(Boolean));
    document.querySelectorAll(selector).forEach((input) => { input.checked = values.has(input.value); });
  });
  const mediaInput = document.querySelector("[data-media-filter]");
  if (mediaInput) mediaInput.checked = initialUrl.searchParams.get("media") === "1";
  const initialMode = initialUrl.searchParams.get("mode");
  if (initialMode) document.querySelector(`[data-garden-mode="${CSS.escape(initialMode)}"]`)?.click();
  render();
})();
