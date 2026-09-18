/**
 * Client half of the garden map: turns whatever the catalogue is currently
 * showing into a drawn graph. The selection is the most connected materials plus
 * the most frequent topics, laid out by `forceLayout`, with the neighbourhood of
 * the pointed node lit and everything else stepped back.
 */
import { forceLayout } from "./force-layout";
import { pluralRu } from "./plural";
import { mountGraphView } from "./svg-graph-view";

interface MapTopic {
  id: string;
  label: string;
  href: string;
}

interface MapRelation {
  target: string;
  evidence?: string;
  reviewStatus?: string;
  provenance?: string | { kind?: string };
}

export interface MapRecord {
  id: string;
  title: string;
  href: string;
  kindLabel: string;
  date?: string;
  topics: MapTopic[];
  relations: MapRelation[];
}

interface DrawnNode {
  id: string;
  title: string;
  href: string;
  kindLabel: string;
  topics: MapTopic[];
  relations: MapRelation[];
  topic?: MapTopic;
}

const ns = "http://www.w3.org/2000/svg";
const width = 800;
const height = 560;
const maxMaterials = 24;
const maxTopics = 8;
const maxLabels = 10;

interface DrawnEdge {
  source: string;
  target: string;
  inferred: boolean;
}

export function mountGardenMap(): void {
  const svg = document.querySelector<SVGSVGElement>("[data-garden-map-svg]");
  const list = document.querySelector<HTMLOListElement>("[data-garden-map-list]");
  if (!svg || !list) return;
  /* Mouse dragging pans the map; touch keeps the stage's own scrolling gesture. */
  const view = mountGraphView(svg);

  /* Written once per render, read by the pointer handlers below. */
  let graph = { nodes: new Map<string, { element: SVGAElement; neighbours: Set<string> }>(), edges: [] as Array<{ source: string; target: string; element: SVGLineElement }> };

  const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };

  const highlight = (id?: string) => {
    for (const [key, node] of graph.nodes) {
      const linked = Boolean(id) && (key === id || node.neighbours.has(id!));
      node.element.classList.toggle("is-hot", key === id);
      node.element.classList.toggle("is-linked", linked && key !== id);
      node.element.classList.toggle("is-dim", Boolean(id) && !linked);
    }
    for (const edge of graph.edges) {
      const touches = Boolean(id) && (edge.source === id || edge.target === id);
      edge.element.classList.toggle("is-hot", touches);
      edge.element.classList.toggle("is-dim", Boolean(id) && !touches);
    }
  };

  const nearestNode = (target: EventTarget | null) => (target instanceof Element ? target.closest<SVGAElement>(".garden-map-node") : null);

  svg.addEventListener("pointerover", (event) => {
    const node = nearestNode(event.target);
    if (node) highlight(node.dataset.nodeId);
  });
  svg.addEventListener("pointerout", (event) => {
    if (!nearestNode(event.relatedTarget)) highlight();
  });
  svg.addEventListener("focusin", (event) => {
    const node = nearestNode(event.target);
    if (node) highlight(node.dataset.nodeId);
  });
  svg.addEventListener("focusout", () => highlight());

  const render = (records: MapRecord[]) => {
    const selected = new Set(records.map((record) => record.id));
    const links = (record: MapRecord) => (record.relations ?? []).filter((relation) => selected.has(relation.target)).length;
    const materials = [...records]
      .sort((a, b) => links(b) - links(a) || (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, maxMaterials);
    const topicCounts = new Map<string, MapTopic & { count: number }>();
    for (const record of materials) {
      for (const topic of record.topics) {
        const current = topicCounts.get(topic.id) ?? { ...topic, count: 0 };
        current.count += 1;
        topicCounts.set(topic.id, current);
      }
    }
    const topicNodes: DrawnNode[] = [...topicCounts.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"))
      .slice(0, maxTopics)
      .map((topic) => ({ id: `topic:${topic.id}`, title: topic.label, href: topic.href, kindLabel: "Тема", topics: [], relations: [], topic }));
    const visible: DrawnNode[] = [...materials, ...topicNodes];

    const count = document.querySelector<HTMLElement>("[data-garden-map-count]");
    if (count) count.textContent = records.length
      ? `На карте ${pluralRu(materials.length, "материал", "материала", "материалов")} из ${records.length} — самые связанные в наборе — и ${pluralRu(topicNodes.length, "тема", "темы", "тем")}.`
      : "В наборе нет материалов.";

    /* One edge list drives both the drawing and the layout: materials joined by
       their reviewed relations, materials joined to the topics they carry. */
    const drawn: DrawnEdge[] = [];
    const seenEdges = new Set<string>();
    const visibleIds = new Set(visible.map((record) => record.id));
    const add = (source: string, target: string, inferred: boolean) => {
      if (source === target || !visibleIds.has(source) || !visibleIds.has(target)) return;
      const key = [source, target].sort().join("|");
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      drawn.push({ source, target, inferred });
    };
    for (const record of visible) {
      for (const relation of record.relations ?? []) {
        const provenance = typeof relation.provenance === "string" ? relation.provenance : relation.provenance?.kind;
        const inferred = relation.reviewStatus === "inferred" || relation.reviewStatus === "proposed" || ["deterministic", "enrichment", "inferred"].includes(provenance ?? "") || ["topic", "semantic", "entity"].includes(relation.evidence ?? "");
        add(record.id, relation.target, inferred);
      }
      for (const topic of record.topics) add(record.id, `topic:${topic.id}`, true);
    }

    const ids = [...visibleIds].sort();
    const positions = forceLayout(ids, drawn.map((edge) => [edge.source, edge.target]), { width, height });
    const neighbours = new Map(ids.map((id) => [id, new Set<string>()]));
    for (const edge of drawn) {
      neighbours.get(edge.source)?.add(edge.target);
      neighbours.get(edge.target)?.add(edge.source);
    }

    view.layer.replaceChildren();
    list.replaceChildren();
    graph = { nodes: new Map(), edges: [] };

    const edgeLayer = el("g", { class: "garden-map-edges" });
    for (const edge of drawn) {
      const from = positions.get(edge.source)!;
      const to = positions.get(edge.target)!;
      const line = el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: `garden-map-edge${edge.inferred ? " inferred" : " proven"}` });
      edgeLayer.append(line);
      graph.edges.push({ source: edge.source, target: edge.target, element: line });
    }
    view.layer.append(edgeLayer);

    /* Hub labels only: four dozen labels would be a wall of text, the rest keep
       their title tooltip and their row in the list under the map. */
    const labelled = new Set([...ids].sort((a, b) => (neighbours.get(b)?.size ?? 0) - (neighbours.get(a)?.size ?? 0) || a.localeCompare(b)).slice(0, maxLabels));
    const nodeLayer = el("g", { class: "garden-map-nodes" });
    for (const record of visible) {
      const point = positions.get(record.id)!;
      const degree = neighbours.get(record.id)?.size ?? 0;
      const anchor = el("a", { href: record.href, class: `garden-map-node${record.topic ? " is-topic" : ""}`, "data-node-id": record.id });
      const title = el("title");
      title.textContent = `${record.title} — ${record.kindLabel}`;
      anchor.append(title, el("circle", { cx: point.x, cy: point.y, r: (4 + Math.sqrt(degree) * 2.6).toFixed(1) }));
      if (labelled.has(record.id)) {
        const labelOnLeft = point.x > width * 0.72;
        const label = el("text", { x: point.x + (labelOnLeft ? -12 : 12), y: point.y + 4, "text-anchor": labelOnLeft ? "end" : "start" });
        label.textContent = record.title.length > 34 ? `${record.title.slice(0, 32)}…` : record.title;
        anchor.append(label);
      }
      nodeLayer.append(anchor);
      graph.nodes.set(record.id, { element: anchor, neighbours: neighbours.get(record.id) ?? new Set() });

      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = record.href;
      link.textContent = record.title;
      item.append(link);
      list.append(item);
    }
    view.layer.append(nodeLayer);
  };

  document.addEventListener("garden:results", (event) => render((event as CustomEvent<{ records: MapRecord[] }>).detail.records));
  /* The catalogue script runs while the document is still parsing, so its first
     event has already fired by the time this module executes: ask for the current
     selection rather than waiting for the next one. */
  document.dispatchEvent(new CustomEvent("garden:request-results"));
}
