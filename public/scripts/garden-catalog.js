(() => {
  const source = document.querySelector('#garden-records'), list = document.querySelector('[data-garden-list]');
  if (!source || !list) return;
  const records = JSON.parse(source.textContent || '[]');
  const search = document.querySelector('[data-garden-search]'), sort = document.querySelector('[data-garden-sort]'), count = document.querySelector('[data-result-count]'), active = document.querySelector('[data-active-filters]'), more = document.querySelector('[data-garden-more]'), empty = document.querySelector('[data-garden-empty]'), layout = document.querySelector('.garden-layout'), facets = document.querySelector('[data-garden-facets]'), filterToggle = document.querySelector('[data-filter-toggle]'), closeButton = document.querySelector('[data-filter-close]'), applyButton = document.querySelector('[data-filter-apply]'), sourceSearch = document.querySelector('[data-source-tag-search]'), sourceEmpty = document.querySelector('[data-source-tag-empty]'), mapPanel = document.querySelector('[data-garden-map]'), facetCount = document.querySelector('[data-facet-count]');
  // Pointer-only scrim: keyboard users dismiss the drawer with Escape or its own button,
  // so it must not duplicate a "Закрыть" button name or take focus.
  const backdrop = document.createElement('div');
  backdrop.className = 'garden-filter-backdrop'; backdrop.setAttribute('aria-hidden', 'true'); backdrop.hidden = true;
  document.body.append(backdrop);
  const MODES = ['feed', 'catalog', 'map'], DESKTOP = '(min-width: 1025px)';
  const PLURAL = new Intl.PluralRules('ru-RU'), FORMS = { one: 'материал', few: 'материала', many: 'материалов' };
  let limit = 24, lastFocus = null, searchTimer = 0;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), date = (v) => v ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)) : '';
  /** Russian counts: "1 материалов" and "2 материалов" are both wrong. */
  const countLabel = (n) => n ? `${n} ${FORMS[PLURAL.select(n)] || 'материалов'}` : 'Ничего не найдено';
  const groups = { kind: '[data-kind-filter]', topic: '[data-topic-filter]', source: '[data-source-tag-filter]', project: '[data-project-filter]', channel: '[data-channel-filter]' }, selected = (s) => [...document.querySelectorAll(`${s}:checked`)].map((i) => i.value), allInputs = () => Object.values(groups).flatMap((s) => [...document.querySelectorAll(s)]).concat([...document.querySelectorAll('[data-media-filter]')]);
  const labelFor = (input) => input.closest('label')?.querySelector('span')?.textContent?.trim() || input.closest('label')?.textContent?.trim() || input.value;
  const state = () => ({ q: (search?.value || '').trim(), mode: document.querySelector('[data-garden-mode][aria-pressed="true"]')?.dataset.gardenMode || 'catalog', sort: sort?.value || 'newest', media: Boolean(document.querySelector('[data-media-filter]:checked')), ...Object.fromEntries(Object.entries(groups).map(([k, s]) => [k, selected(s)])) });
  const urlFor = () => { const u = new URL(location.href), s = state(); Object.entries(s).forEach(([k, v]) => { if (k === 'mode') { v === 'catalog' ? u.searchParams.delete(k) : u.searchParams.set(k, v); } else if (k === 'sort') { v === 'newest' ? u.searchParams.delete(k) : u.searchParams.set(k, v); } else if (k === 'q') v ? u.searchParams.set(k, v) : u.searchParams.delete(k); else if (k === 'media') v ? u.searchParams.set(k, '1') : u.searchParams.delete(k); else v.length ? u.searchParams.set(k, v.join(',')) : u.searchParams.delete(k); }); return u; };
  function syncUrl(push) {
    const u = urlFor();
    if (u.href === location.href) return;
    if (push) history.pushState(null, '', u); else history.replaceState(null, '', u);
  }
  function filtered() {
    const s = state(), q = s.q.toLocaleLowerCase('ru-RU');
    const result = records.filter((r) => {
      const hay = [r.title, r.summary, ...r.topics.map((x) => x.label), ...(r.entities || []), ...(r.sourceTags || [])].join(' ').toLocaleLowerCase('ru-RU'), projects = new Set(r.projectIds || []);
      return (!q || hay.includes(q)) && (!s.kind.length || s.kind.includes(r.kind)) && (!s.channel.length || s.channel.includes(r.channelKey)) && (!s.topic.length || s.topic.some((x) => r.topics.some((y) => y.id === x))) && (!s.source.length || s.source.some((x) => r.sourceTags.includes(x))) && (!s.project.length || s.project.some((x) => projects.has(x))) && (!s.media || r.media > 0 || r.thumbnail);
    });
    return result.sort((a, b) => {
      const aTime = a.date ? Date.parse(a.date) : Number.NaN, bTime = b.date ? Date.parse(b.date) : Number.NaN;
      if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
      if (!Number.isFinite(bTime)) return -1;
      return s.sort === 'oldest' ? aTime - bTime : bTime - aTime;
    });
  }
  function render(push) {
    const result = filtered(), visible = result.slice(0, limit), label = countLabel(result.length);
    list.innerHTML = visible.map((r) => `<a class="garden-row${r.thumbnail ? ' has-thumbnail' : ''}" href="${esc(r.href)}"><div class="garden-row-meta">${r.thumbnail ? `<img class="garden-row-thumbnail" src="${esc(r.thumbnail)}" alt="" loading="lazy" width="320" height="180">` : ''}<span>${esc(r.channelLabel || r.kindLabel)}</span></div><div class="garden-row-body"><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p><div class="garden-row-topics">${r.topics.slice(0, 4).map((t) => `<span class="${t.origin === 'automatic' ? 'is-automatic' : 'is-source'}">${esc(t.label)}</span>`).join('')}</div></div><time class="garden-row-date" datetime="${esc(r.date)}">${esc(date(r.date))}</time></a>`).join('');
    count.textContent = label;
    if (facetCount) facetCount.textContent = result.length ? `Найдено: ${label}` : 'Ничего не найдено';
    const checked = allInputs().filter((i) => i.checked), current = state();
    active.replaceChildren();
    if (!checked.length && !current.q) active.textContent = 'Все темы и форматы';
    const chips = [];
    const addChip = (text, aria, remove, focusAfter) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'garden-filter-chip'; chip.textContent = `${text} ×`; chip.setAttribute('aria-label', aria);
      chip.addEventListener('click', () => {
        const index = chips.indexOf(chip);
        remove();
        limit = 24;
        render(true);
        // The activated chip is gone with the re-render: keep focus in the chip row
        // instead of dropping it on the document body.
        const rest = [...active.querySelectorAll('.garden-filter-chip')];
        if (focusAfter) focusAfter();
        else (rest[index] || rest[rest.length - 1] || count)?.focus();
      });
      chips.push(chip);
      active.append(chip);
    };
    if (current.q) addChip(`Поиск: «${current.q}»`, `Убрать поиск: ${current.q}`, () => { if (search) search.value = ''; }, () => search?.focus());
    checked.forEach((input) => { const name = labelFor(input); addChip(name, `Убрать фильтр: ${name}`, () => { input.checked = false; }); });
    filterToggle.textContent = checked.length ? `Фильтры · ${checked.length}` : 'Фильтры';
    filterToggle.classList.toggle('is-active', Boolean(checked.length || current.q));
    empty.hidden = result.length > 0;
    more.hidden = visible.length >= result.length;
    syncUrl(push);
    document.dispatchEvent(new CustomEvent('garden:results', { detail: { records: result } }));
  }
  function applyMode(mode) {
    const next = MODES.includes(mode) ? mode : 'catalog';
    document.querySelectorAll('[data-garden-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gardenMode === next)));
    layout?.classList.toggle('map-active', next === 'map');
    layout?.classList.toggle('feed-active', next === 'feed');
    if (mapPanel) mapPanel.hidden = next !== 'map';
  }
  /** popstate only reads the URL; it resets pagination and never writes history. */
  function applyUrl() {
    const u = new URL(location.href);
    if (search) search.value = u.searchParams.get('q') || '';
    Object.entries(groups).forEach(([k, s]) => { const values = new Set((u.searchParams.get(k) || '').split(',').filter(Boolean)); document.querySelectorAll(s).forEach((i) => i.checked = values.has(i.value)); });
    const media = document.querySelector('[data-media-filter]'); if (media) media.checked = u.searchParams.get('media') === '1';
    applyMode(u.searchParams.get('mode') || 'catalog');
    if (sort) sort.value = u.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
    limit = 24;
    render(false);
  }
  function reset(trigger) {
    allInputs().forEach((i) => { i.checked = false; });
    if (search) search.value = '';
    if (sort) sort.value = 'newest';
    if (sourceSearch) sourceSearch.value = '';
    document.querySelectorAll('[data-source-tag-label]').forEach((label) => { label.dataset.hidden = '0'; });
    if (sourceEmpty) sourceEmpty.hidden = true;
    limit = 24;
    render(true);
    // The empty state and its button vanish with the reset; park focus on the live count.
    if (trigger?.closest('[data-garden-empty]')) count?.focus();
  }
  document.querySelectorAll('[data-garden-reset]').forEach((button) => button.addEventListener('click', () => reset(button)));
  document.addEventListener('change', (e) => { if (e.target.matches('[data-kind-filter],[data-channel-filter],[data-topic-filter],[data-source-tag-filter],[data-project-filter],[data-media-filter],[data-garden-sort]')) { limit = 24; render(true); } });
  const commitSearch = () => { limit = 24; render(true); };
  search?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(commitSearch, 300); });
  search?.addEventListener('search', () => { clearTimeout(searchTimer); commitSearch(); });
  more?.addEventListener('click', () => { limit += 24; render(false); });
  sourceSearch?.addEventListener('input', () => {
    const q = sourceSearch.value.trim().toLocaleLowerCase('ru-RU');
    let shown = 0;
    document.querySelectorAll('[data-source-tag-label]').forEach((label) => { const match = !q || label.dataset.sourceTagLabel.toLocaleLowerCase('ru-RU').includes(q); label.dataset.hidden = match ? '0' : '1'; if (match) shown += 1; });
    if (sourceEmpty) sourceEmpty.hidden = shown > 0;
  });
  /** The facets live as a sidebar on desktop and as a modal drawer under it. */
  function setOpen(open) {
    if (!facets) return;
    if (open) lastFocus = document.activeElement;
    facets.classList.toggle('open', open);
    filterToggle?.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
    if (open) { facets.setAttribute('role', 'dialog'); facets.setAttribute('aria-modal', 'true'); } else { facets.removeAttribute('role'); facets.removeAttribute('aria-modal'); }
    document.documentElement.classList.toggle('garden-filters-open', open);
    if (open) closeButton?.focus(); else lastFocus?.focus?.();
  }
  filterToggle?.addEventListener('click', () => setOpen(!facets?.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  closeButton?.addEventListener('click', () => setOpen(false));
  applyButton?.addEventListener('click', () => { setOpen(false); count?.focus(); });
  // Crossing to desktop closes the dialog and clears the modal scroll lock.
  const closeForDesktop = () => {
    if (!facets?.classList.contains('open') || !matchMedia(DESKTOP).matches) return;
    facets.classList.remove('open');
    facets.removeAttribute('role');
    facets.removeAttribute('aria-modal');
    backdrop.hidden = true;
    filterToggle?.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('garden-filters-open');
  };
  matchMedia(DESKTOP).addEventListener('change', closeForDesktop);
  window.addEventListener('resize', closeForDesktop);
  document.addEventListener('keydown', (e) => {
    if (!facets?.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key !== 'Tab') return;
    const items = [...facets.querySelectorAll('button, input, select, a[href]')].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], lastItem = items[items.length - 1], current = document.activeElement;
    // Focus must never leave the modal drawer, including from outside it.
    if (!facets.contains(current)) { e.preventDefault(); (e.shiftKey ? lastItem : first).focus(); return; }
    if (e.shiftKey && current === first) { e.preventDefault(); lastItem.focus(); }
    else if (!e.shiftKey && current === lastItem) { e.preventDefault(); first.focus(); }
  });
  document.querySelectorAll('[data-garden-mode]').forEach((b) => b.addEventListener('click', () => { applyMode(b.dataset.gardenMode); render(true); }));
  window.addEventListener('popstate', applyUrl);
  applyUrl();
})();
