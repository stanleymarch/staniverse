(() => {
  const svg = document.querySelector("[data-garden-map-svg]");
  const list = document.querySelector("[data-garden-map-list]");
  if (!svg || !list) return;
  const ns = "http://www.w3.org/2000/svg";
  const point = (index) => {
    const ring = index % 3;
    const radius = [118, 205, 255][ring];
    const angle = index * 2.399963 + ring * 0.4;
    return { x: 400 + Math.cos(angle) * radius, y: 280 + Math.sin(angle) * radius };
  };
  const el = (name, attrs = {}) => {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  };
  function render(records) {
    const visible = records.slice(0, 30);
    const positions = new Map(visible.map((record, index) => [record.id, point(index)]));
    svg.replaceChildren();
    list.replaceChildren();
    const edges = el("g", { class: "garden-map-edges" });
    visible.forEach((record) => {
      const from = positions.get(record.id);
      (record.relations || []).forEach((relation) => {
        const to = positions.get(relation.target);
        if (!from || !to || record.id >= relation.target) return;
        const inferred = relation.type === "topic" || relation.type === "semantic";
        edges.append(el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: inferred ? "garden-map-edge inferred" : "garden-map-edge proven" }));
      });
    });
    svg.append(edges);
    const nodes = el("g", { class: "garden-map-nodes" });
    visible.forEach((record, index) => {
      const pos = positions.get(record.id);
      const anchor = el("a", { href: record.href, class: "garden-map-node" });
      const title = el("title");
      title.textContent = `${record.title} — ${record.kindLabel}`;
      anchor.append(title, el("circle", { cx: pos.x, cy: pos.y, r: index < 5 ? 9 : 6 }));
      if (index < 10) {
        const label = el("text", { x: pos.x + 13, y: pos.y + 4 });
        label.textContent = record.title.length > 34 ? `${record.title.slice(0, 32)}…` : record.title;
        anchor.append(label);
      }
      nodes.append(anchor);
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = record.href;
      link.textContent = record.title;
      item.append(link);
      list.append(item);
    });
    svg.append(nodes);
  }
  document.addEventListener("garden:results", (event) => render(event.detail.records));
})();
