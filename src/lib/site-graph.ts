import { allEntries } from "./content";
import { buildGraph } from "./graph";

let graphPromise: ReturnType<typeof loadGraph> | undefined;

async function loadGraph() {
  return buildGraph(await allEntries());
}

export function getSiteGraph() {
  graphPromise ??= loadGraph();
  return graphPromise;
}
