(() => {
  const source = document.querySelector('#garden-records');
  const list = document.querySelector('[data-garden-list]');
  if (!source || !list) return;

  const records = JSON.parse(source.textContent || '[]');
  const search = document.querySelector('[data-garden-search]');
  const sort = document.querySelector('[data-garden-sort]');
  const count = document.querySelector('[data-result-count]');
  const active = document.querySelector('[data-active-filters]');
  const more = document.querySelector('[data-garden-more]');
  const empty = document.querySelector('[data-garden-empty]');
  const layout = document.querySelector('.garden-layout');
  const facets = document.querySelector('[data-garden-facets]');
  const filterToggle = document.querySelector('[data-filter-toggle]');
  const filterSide = document.querySelector('.garden-side');
  const filterBackdrop = document.querySelector('[data-filter-backdrop]');
  const filterClose = document.querySelector('[data-filter-close]');
  const mapPanel = document.querySelector('[data-garden-map]');
  const modes = ['catalog', 'map'];
  const plural = new Intl.PluralRules('ru-RU');
  const forms = { one: 'материал', few: 'материала', many: 'материалов' };
  const groups = {
    kind: '[data-kind-filter]',
    topic: '[data-topic-filter]',
    project: '[data-project-filter]',
    channel: '[data-channel-filter]',
  };
  let limit = 24;
  let lastResult = [];
  let searchTimer = 0;
  let sourceFilter = '';

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '';
  const countLabel = (value) => value ? `${value} ${forms[plural.select(value)] || 'материалов'}` : 'Ничего не найдено';
  const selected = (selector) => [...document.querySelectorAll(`${selector}:checked`)].map((input) => input.value);
  const allInputs = () => Object.values(groups).flatMap((selector) => [...document.querySelectorAll(selector)]).concat([...document.querySelectorAll('[data-media-filter]')]);
  const labelFor = (input) => input.closest('label')?.querySelector('span')?.textContent?.trim() || input.value;

  const currentState = () => ({
    q: (search?.value || '').trim(),
    mode: document.querySelector('[data-garden-mode][aria-pressed="true"]')?.dataset.gardenMode || 'catalog',
    sort: sort?.value || 'newest',
    media: Boolean(document.querySelector('[data-media-filter]:checked')),
    source: sourceFilter ? [sourceFilter] : [],
    ...Object.fromEntries(Object.entries(groups).map(([key, selector]) => [key, selected(selector)])),
  });

  function urlFor() {
    const url = new URL(location.href);
    const state = currentState();
    for (const [key, value] of Object.entries(state)) {
      if (key === 'mode') value === 'catalog' ? url.searchParams.delete(key) : url.searchParams.set(key, value);
      else if (key === 'sort') value === 'newest' ? url.searchParams.delete(key) : url.searchParams.set(key, value);
      else if (key === 'q') value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
      else if (key === 'media') value ? url.searchParams.set(key, '1') : url.searchParams.delete(key);
      else value.length ? url.searchParams.set(key, value.join(',')) : url.searchParams.delete(key);
    }
    return url;
  }

  function syncUrl(push) {
    const url = urlFor();
    if (url.href === location.href) return;
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  function filtered() {
    const state = currentState();
    const query = state.q.toLocaleLowerCase('ru-RU');
    const result = records.filter((record) => {
      const haystack = [
        record.title,
        record.summary,
        record.topics.map((topic) => `${topic.label} ${(topic.aliases || []).join(' ')}`).join(' '),
        record.entities.join(' '),
        record.sourceTags.join(' '),
      ].join(' ').toLocaleLowerCase('ru-RU');
      return (!query || haystack.includes(query))
        && (!state.kind.length || state.kind.includes(record.kind))
        && (!state.channel.length || state.channel.includes(record.channelKey))
        && (!state.topic.length || state.topic.some((id) => record.topics.some((topic) => topic.id === id)))
        && (!state.source.length || state.source.some((tag) => record.sourceTags.includes(tag)))
        && (!state.project.length || state.project.some((id) => record.projectIds.includes(id)))
        && (!state.media || record.media > 0 || record.thumbnail);
    });
    return result.sort((first, second) => {
      const firstTime = first.date ? Date.parse(first.date) : Number.NaN;
      const secondTime = second.date ? Date.parse(second.date) : Number.NaN;
      if (!Number.isFinite(firstTime)) return Number.isFinite(secondTime) ? 1 : 0;
      if (!Number.isFinite(secondTime)) return -1;
      return state.sort === 'oldest' ? firstTime - secondTime : secondTime - firstTime;
    });
  }

  function render(push) {
    const result = filtered();
    const visible = result.slice(0, limit);
    const label = countLabel(result.length);
    list.innerHTML = visible.map((record) => `<a class="garden-row${record.thumbnail ? ' has-thumbnail' : ''}" href="${escapeHtml(record.href)}"><div class="garden-row-meta">${record.thumbnail ? `<img class="garden-row-thumbnail" src="${escapeHtml(record.thumbnail)}" alt="" loading="lazy" width="320" height="180">` : ''}<span>${escapeHtml(record.channelLabel || record.kindLabel)}</span></div><div class="garden-row-body"><h2>${escapeHtml(record.title)}</h2><p>${escapeHtml(record.summary)}</p><div class="garden-row-topics">${record.topics.slice(0, 4).map((topic) => `<span class="${topic.origin === 'automatic' ? 'is-automatic' : 'is-source'}">${escapeHtml(topic.label)}</span>`).join('')}</div></div><time class="garden-row-date" datetime="${escapeHtml(record.date)}">${escapeHtml(formatDate(record.date))}</time></a>`).join('');
    if (count) count.textContent = label;

    const checked = allInputs().filter((input) => input.checked);
    const state = currentState();
    active?.replaceChildren();
    const chips = [];
    const addChip = (text, aria, remove, focusAfter) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'garden-filter-chip';
      chip.textContent = `${text} ×`;
      chip.setAttribute('aria-label', aria);
      chip.addEventListener('click', () => {
        const index = chips.indexOf(chip);
        remove();
        limit = 24;
        render(true);
        const remaining = [...active.querySelectorAll('.garden-filter-chip')];
        if (focusAfter) focusAfter();
        else (remaining[index] || remaining[remaining.length - 1] || count)?.focus();
      });
      chips.push(chip);
      active?.append(chip);
    };

    if (state.q) addChip(`Поиск: «${state.q}»`, `Убрать поиск: ${state.q}`, () => { if (search) search.value = ''; }, () => search?.focus());
    if (sourceFilter) addChip(`#${sourceFilter}`, `Убрать тег: ${sourceFilter}`, () => { sourceFilter = ''; });
    checked.forEach((input) => {
      const name = labelFor(input);
      addChip(name, `Убрать фильтр: ${name}`, () => { input.checked = false; });
    });
    if (!chips.length) active.textContent = 'Все темы и форматы';
    else {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'garden-filter-reset';
      reset.textContent = 'Сбросить всё';
      reset.addEventListener('click', () => resetAll(reset));
      active?.append(reset);
    }

    const filterCount = checked.length + (sourceFilter ? 1 : 0);
    if (filterToggle) {
      filterToggle.textContent = filterCount ? `Ещё фильтры · ${filterCount}` : 'Ещё фильтры';
      filterToggle.classList.toggle('is-active', filterCount > 0);
    }
    if (empty) empty.hidden = result.length > 0;
    if (more) more.hidden = visible.length >= result.length;
    syncUrl(push);
    lastResult = result;
    document.dispatchEvent(new CustomEvent('garden:results', { detail: { records: result } }));
  }

  function applyMode(mode) {
    const next = modes.includes(mode) ? mode : 'catalog';
    document.querySelectorAll('[data-garden-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.gardenMode === next)));
    layout?.classList.toggle('map-active', next === 'map');
    if (mapPanel) mapPanel.hidden = next !== 'map';
  }

  function setFiltersOpen(open, focus = true) {
    if (!facets || !filterToggle) return;
    const mobile = !matchMedia('(min-width: 1100px)').matches;
    facets.hidden = !open;
    filterToggle.setAttribute('aria-expanded', String(open));
    filterSide?.classList.toggle('is-open', open && mobile);
    if (filterBackdrop) filterBackdrop.hidden = !open || !mobile;
    document.documentElement.classList.toggle('garden-filters-open', open && mobile);
    if (open && focus) requestAnimationFrame(() => (filterClose || facets.querySelector('input, button'))?.focus());
  }

  function applyUrl() {
    const url = new URL(location.href);
    if (search) search.value = url.searchParams.get('q') || '';
    sourceFilter = url.searchParams.get('source') || '';
    for (const [key, selector] of Object.entries(groups)) {
      const values = new Set((url.searchParams.get(key) || '').split(',').filter(Boolean));
      document.querySelectorAll(selector).forEach((input) => { input.checked = values.has(input.value); });
    }
    const media = document.querySelector('[data-media-filter]');
    if (media) media.checked = url.searchParams.get('media') === '1';
    applyMode(url.searchParams.get('mode') || 'catalog');
    if (sort) sort.value = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
    limit = 24;
    render(false);
  }

  function resetAll(trigger) {
    allInputs().forEach((input) => { input.checked = false; });
    if (search) search.value = '';
    if (sort) sort.value = 'newest';
    sourceFilter = '';
    limit = 24;
    render(true);
    if (trigger?.closest('[data-garden-empty]')) count?.focus();
  }

  document.querySelectorAll('[data-garden-reset]').forEach((button) => button.addEventListener('click', () => resetAll(button)));
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-kind-filter],[data-channel-filter],[data-topic-filter],[data-project-filter],[data-media-filter],[data-garden-sort]')) {
      limit = 24;
      render(true);
    }
  });
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { limit = 24; render(false); }, 300);
  });
  search?.addEventListener('search', () => {
    clearTimeout(searchTimer);
    limit = 24;
    render(false);
  });
  more?.addEventListener('click', () => { limit += 24; render(false); });
  filterToggle?.addEventListener('click', () => setFiltersOpen(facets?.hidden));
  document.querySelectorAll('[data-garden-mode]').forEach((button) => button.addEventListener('click', () => {
    applyMode(button.dataset.gardenMode);
    render(true);
  }));
  filterClose?.addEventListener('click', () => { setFiltersOpen(false, false); filterToggle?.focus(); });
  filterBackdrop?.addEventListener('click', () => { setFiltersOpen(false, false); filterToggle?.focus(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !wide.matches && facets && !facets.hidden) {
      setFiltersOpen(false, false);
      filterToggle?.focus();
    }
  });
  window.addEventListener('popstate', applyUrl);

  /* On a desktop the facet rail is a permanent left column: open it without
     stealing focus, and let a resize carry the state across the breakpoint. */
  const wide = matchMedia('(min-width: 1100px)');
  if (wide.matches) setFiltersOpen(true, false);
  wide.addEventListener('change', (event) => setFiltersOpen(event.matches, false));
  /* The map mounts as a module, after this script has already rendered once:
     it asks for the current selection instead of waiting for the next change. */
  document.addEventListener('garden:request-results', () => {
    document.dispatchEvent(new CustomEvent('garden:results', { detail: { records: lastResult } }));
  });
  applyUrl();
})();
