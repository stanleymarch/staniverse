(() => {
  const controls = document.querySelector('[data-filter-controls]');
  const cards = [...document.querySelectorAll('[data-filter-grid] .content-card')];
  const empty = document.querySelector('.empty-state');
  if (!controls || !cards.length) return;
  let active = new URLSearchParams(location.search).get('tag') || 'all';
  let query = '';
  const apply = () => {
    let visible = 0;
    cards.forEach((card) => {
      const terms = `${card.dataset.kind} ${card.dataset.tags}`;
      const matchesFilter = active === 'all' || terms.split(' ').includes(active);
      const matchesQuery = !query || card.dataset.search.includes(query);
      card.hidden = !(matchesFilter && matchesQuery); if (!card.hidden) visible++;
    });
    if (empty) empty.style.display = visible ? 'none' : 'block';
  };
  controls.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    controls.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active'); active = button.dataset.filter; apply();
  }));
  controls.querySelector('input[type="search"]')?.addEventListener('input', (event) => { query = event.target.value.trim().toLowerCase(); apply(); });
  apply();
})();
