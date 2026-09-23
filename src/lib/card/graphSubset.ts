import { CARD_PORTAL } from "../../config/cardPortal";
import type { GraphEdge, GraphNode } from "../graph";

export type PortalKind = GraphNode["kind"] | "core" | "hub" | "memory";
export interface PortalNode extends GraphNode { portalKind: PortalKind; cluster: "works" | "projects" | "lab" | "garden" | "core"; synthetic?: boolean }
export interface CardPortalGraph { nodes: PortalNode[]; edges: GraphEdge[]; semanticEdges: GraphEdge[]; syntheticEdges: GraphEdge[] }

const HUBS: PortalNode[] = [
  { id: "card:core", title: "станивёрс", summary: "Стас Ермоленко — XR, AI, цифровые архивы и медиа.", kind: "core", portalKind: "core", cluster: "core", href: "/universe/", topics: [], sourceTags: [], featured: true, synthetic: true },
  ...([ ["works", "РАБОТЫ", "/works/"], ["projects", "ПРОЕКТЫ", "/projects/"], ["lab", "ЛАБА", "/lab/"], ["garden", "САД", "/garden/"] ] as const).map(([cluster, title, href]) => ({ id: `card:hub:${cluster}`, title, summary: cluster === "garden" ? "Публичная память: материалы, темы и связи." : `Избранные материалы раздела «${title.toLocaleLowerCase("ru-RU")}».`, kind: "hub", portalKind: "hub", cluster, href, topics: [], sourceTags: [], featured: true, synthetic: true })),
];

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}
function clusterFor(node: GraphNode): PortalNode["cluster"] {
  if (node.kind === "work") return "works";
  if (node.kind === "project") return "projects";
  if (node.kind === "experiment") return "lab";
  return "garden";
}
const withPortal = (node: GraphNode): PortalNode => ({ ...node, portalKind: node.kind === "topic" ? "memory" : node.kind, cluster: clusterFor(node) });

export function getCardPortalGraph(fullGraph: { nodes: GraphNode[]; edges: GraphEdge[] }): CardPortalGraph {
  const byId = new Map(fullGraph.nodes.map((node) => [node.id, node]));
  const curated = CARD_PORTAL.curatedIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
  const topics = CARD_PORTAL.topicIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
  const remainingFeatured = fullGraph.nodes.filter((node) => node.featured && !curated.includes(node) && node.kind !== "topic").sort((a, b) => hash(a.id) - hash(b.id));
  const foreground = [...curated, ...remainingFeatured].slice(0, CARD_PORTAL.foregroundLimit);
  const selectedIds = new Set([...foreground, ...topics].map((node) => node.id));
  const background = fullGraph.nodes.filter((node) => !selectedIds.has(node.id)).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, CARD_PORTAL.backgroundLimit);
  const content = [...foreground, ...topics, ...background].map(withPortal);
  const contentIds = new Set(content.map((node) => node.id));
  const semanticEdges = fullGraph.edges.filter((edge) => contentIds.has(edge.source) && contentIds.has(edge.target)).sort((a, b) => b.confidence - a.confidence).slice(0, CARD_PORTAL.edgeLimit);
  const syntheticEdges: GraphEdge[] = [...foreground, ...topics].map((node) => ({ source: `card:hub:${clusterFor(node)}`, target: node.id, type: "part-of", evidence: "computed", confidence: 1, provenance: { kind: "deterministic", method: "card portal visual grouping" } }));
  return { nodes: [...HUBS, ...content], edges: [...semanticEdges, ...syntheticEdges], semanticEdges, syntheticEdges };
}
