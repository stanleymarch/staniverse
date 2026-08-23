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
    const materials = records.slice(0, 24);
    const topicCounts = new Map();
    materials.forEach((record) => record.topics.forEach((topic) => {
      const current = topicCounts.get(topic.id) || { ...topic, count: 0 };
      current.count += 1;
      topicCounts.set(topic.id, current);
    }));
    const topicNodes = [...topicCounts.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"))
      .slice(0, 8)
      .map((topic) => ({ id: `topic:${topic.id}`, title: topic.label, href: topic.href, kindLabel: "Тема", topics: [], relations: [], topic }));
    const visible = [...materials, ...topicNodes];
    const positions = new Map(visible.map((record, index) => [record.id, point(index)]));
    svg.replaceChildren();
    list.replaceChildren();
    const edges = el("g", { class: "garden-map-edges" });
    const seenEdges = new Set();
    visible.forEach((record) => {
      const from = positions.get(record.id);
      (record.relations || []).forEach((relation) => {
        const to = positions.get(relation.target);
        const key = [record.id, relation.target].sort().join("|");
        if (!from || !to || seenEdges.has(key)) return;
        seenEdges.add(key);
        const provenance = typeof relation.provenance === "string" ? relation.provenance : relation.provenance?.kind;
        const inferred = relation.reviewStatus === "inferred" || relation.reviewStatus === "proposed" || ["deterministic", "enrichment", "inferred"].includes(provenance) || ["topic", "semantic", "entity"].includes(relation.evidence);
        edges.append(el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: inferred ? "garden-map-edge inferred" : "garden-map-edge proven" }));
      });
    });
    materials.forEach((record) => {
      const from = positions.get(record.id);
      record.topics.forEach((topic) => {
        const to = positions.get(`topic:${topic.id}`);
        if (from && to) edges.append(el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: "garden-map-edge inferred" }));
      });
    });
    topicNodes.forEach((record) => {
      const from = positions.get(record.id);
      record.topic.related.forEach((targetId) => {
        const targetKey = `topic:${targetId}`;
        const to = positions.get(targetKey);
        if (from && to && record.id < targetKey) edges.append(el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: "garden-map-edge inferred curated" }));
      });
    });
    svg.append(edges);
    const nodes = el("g", { class: "garden-map-nodes" });
    const labelledTitles = new Set();
    visible.forEach((record, index) => {
      const pos = positions.get(record.id);
      const anchor = el("a", { href: record.href, class: `garden-map-node${record.topic ? " is-topic" : ""}` });
      const title = el("title");
      title.textContent = `${record.title} — ${record.kindLabel}`;
      anchor.append(title, el("circle", { cx: pos.x, cy: pos.y, r: index < 5 ? 9 : 6 }));
      if (index < 10 && !labelledTitles.has(record.title)) {
        labelledTitles.add(record.title);
        const labelOnLeft = pos.x > 570;
        const label = el("text", { x: pos.x + (labelOnLeft ? -13 : 13), y: pos.y + 4, "text-anchor": labelOnLeft ? "end" : "start" });
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
