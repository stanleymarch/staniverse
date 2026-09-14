/**
 * Client-side site search over the static /api/search.json index.
 * Russian-friendly: case/ё-insensitive token matching with weighted scoring
 * (title > topics > summary > body) and AND-semantics across tokens.
 * Exported pure helpers are unit-tested; the DOM layer initialises once. */

const normalizeToken = (token) => token.toLocaleLowerCase("ru-RU").normalize("NFKC").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

export function tokenize(query) {
  const seen = new Set();
  for (const raw of String(query ?? "").split(/[^\p{L}\p{N}]+/u)) {
    const token = normalizeToken(raw);
    if (token.length >= 1 && !seen.has(token)) seen.add(token);
  }
  return [...seen];
}

const fields = (entry) => ({
  title: normalizeToken(entry.t),
  topics: normalizeToken(entry.p ?? ""),
  summary: normalizeToken(entry.s ?? ""),
  text: normalizeToken(entry.x ?? ""),
});

/** Null when any token is missing (AND semantics), otherwise a weight where
 * title hits dominate, topic labels follow, body text breaks ties. */
export function scoreEntry(entry, tokens) {
  const f = fields(entry);
  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    if (f.title.includes(token)) tokenScore += f.title.startsWith(token) ? 16 : 10;
    if (f.topics.includes(token)) tokenScore += 6;
    if (f.summary.includes(token)) tokenScore += 3;
    if (f.text.includes(token)) tokenScore += 1;
    if (tokenScore === 0) return null;
    score += tokenScore;
  }
  return score;
}

export function snippetFor(entry, tokens, radius = 80) {
  const source = (entry.x ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  let at = -1;
  for (const token of tokens) {
    const found = source.indexOf(token);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return entry.s ?? "";
  const start = Math.max(0, at - radius);
  const end = Math.min(source.length, at + tokenLikeLength(tokens, source, at) + radius);
  return (start > 0 ? "…" : "") + (entry.x ?? "").slice(start, end) + (end < source.length ? "…" : "");
}

const tokenLikeLength = (tokens, source, at) => {
  let length = 1;
  for (const token of tokens) if (source.startsWith(token, at)) length = Math.max(length, token.length);
  return length;
};

export function searchEntries(entries, query, limit = 12) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return entries
    .map((entry) => {
      const score = scoreEntry(entry, tokens);
      return score === null ? null : { entry, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (b.entry.d ?? "").localeCompare(a.entry.d ?? ""))
    .slice(0, limit)
    .map(({ entry }) => ({ entry, snippet: snippetFor(entry, tokens) }));
}

const highlight = (value, tokens) => {
  const fragment = document.createDocumentFragment();
  const lowered = value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  let from = 0;
  while (from < value.length) {
    let hit = -1;
    let hitToken = "";
    for (const token of tokens) {
      const found = lowered.indexOf(token, from);
      if (found >= 0 && (hit < 0 || found < hit)) { hit = found; hitToken = token; }
    }
    if (hit < 0) { fragment.append(value.slice(from)); break; }
    fragment.append(value.slice(from, hit));
    const mark = document.createElement("mark");
    mark.textContent = value.slice(hit, hit + hitToken.length);
    fragment.append(mark);
    from = hit + hitToken.length;
  }
  return fragment;
};

let indexPromise = null;
const loadIndex = () => (indexPromise ??= fetch("/api/search.json").then((response) => response.json()).then((payload) => payload.documents));

function render(panel, results, tokens) {
  const list = panel.querySelector("[data-search-results]");
  const status = panel.querySelector("[data-search-status]");
  list.replaceChildren();
  status.textContent = results.length ? `${results.length} ${results.length === 1 ? "результат" : "результатов"}` : "Ничего не найдено";
  for (const { entry, snippet } of results) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.h;
    const title = document.createElement("strong");
    title.append(highlight(entry.t, tokens));
    const meta = document.createElement("small");
    meta.textContent = [entry.k, entry.d, entry.p].filter(Boolean).join(" · ");
    const lead = document.createElement("p");
    lead.append(highlight(snippet, tokens));
    link.append(title, meta, lead);
    item.append(link);
    list.append(item);
  }
}

async function runSearch(panel, input) {
  const query = input.value.trim();
  const list = panel.querySelector("[data-search-results]");
  const status = panel.querySelector("[data-search-status]");
  if (query.length === 0) {
    list.replaceChildren();
    status.textContent = "Введите запрос: тема, проект, технология, место…";
    return;
  }
  const tokens = tokenize(query);
  try {
    const documents = await loadIndex();
    if (input.value.trim() !== query) return;
    render(panel, searchEntries(documents, query), tokens);
  } catch {
    indexPromise = null;
    if (input.value.trim() !== query) return;
    list.replaceChildren();
    status.textContent = "Не удалось загрузить поиск. Измените запрос, чтобы повторить.";
  }
}

function setup(panel) {
  const input = panel.querySelector("[data-search-input]");
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void runSearch(panel, input), 120);
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(panel);
    if (event.key === "Tab") {
      const controls = [...panel.querySelectorAll("input, button, a[href]")];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    const links = [...panel.querySelectorAll("[data-search-results] a")];
    if (links.length === 0) return;
    const active = panel.querySelector("[data-search-results] a:focus");
    const index = links.indexOf(active);
    event.preventDefault();
    if (event.key === "Enter") { (active ?? links[0]).click(); return; }
    const next = event.key === "ArrowDown" ? (index + 1) % links.length : (index <= 0 ? links.length - 1 : index - 1);
    links[next].focus();
  });
}

const close = (panel) => {
  panel.hidden = true;
  document.documentElement.removeAttribute("data-search-open");
  document.querySelector("button[data-search-open]")?.focus();
};

const openPanel = (panel) => {
  panel.hidden = false;
  document.documentElement.setAttribute("data-search-open", "true");
  const input = panel.querySelector("[data-search-input]");
  input.focus();
  input.select();
};

export function initSiteSearch() {
  const panel = document.querySelector("[data-search-panel]");
  const opener = document.querySelector("[data-search-open]");
  if (!panel || !opener || panel.dataset.ready === "true") return;
  panel.dataset.ready = "true";
  setup(panel);
  opener.addEventListener("click", () => openPanel(panel));
  panel.addEventListener("click", (event) => {
    if (event.target === panel || event.target.closest("[data-search-close]")) close(panel);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      panel.hidden ? openPanel(panel) : close(panel);
    }
    if (event.key === "/" && !/^(input|textarea)$/i.test(document.activeElement?.tagName ?? "") && !document.activeElement?.isContentEditable) {
      event.preventDefault();
      openPanel(panel);
    }
  });
  panel.querySelector("[data-search-results]")?.addEventListener("click", (event) => {
    if (event.target.closest("a")) close(panel);
  });
}

if (typeof document !== "undefined") initSiteSearch();
